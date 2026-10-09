// @test-group: foundation
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  closeFunctionServerLog,
  FUNCTION_SERVER_LOG_TAIL_BYTES,
  getFunctionServerFailureDiagnostics,
  openFunctionServerLog,
} from '../scripts/performance-function-server-diagnostics.mjs';

function fixture(t, text) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gnc-function-server-diagnostics-'));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^gnc-function-server-diagnostics-/);
  t.after(() => rmSync(resolved, { recursive: true, force: false }));
  const logPath = path.join(resolved, 'function-server.log');
  writeFileSync(logPath, text, { flag: 'wx', mode: 0o600 });
  return logPath;
}

function safeJson(diagnostics) {
  assert.deepEqual(Object.keys(diagnostics).sort(), ['classification', 'code', 'exitCode', 'signalCode', 'spawnErrorCode']);
  return JSON.stringify(diagnostics);
}

test('classifies registry rate limiting without returning the raw diagnostic', t => {
  const secret = 'eyJsynthetic.secret.must.not.escape';
  const logPath = fixture(t, `Error response from daemon: toomanyrequests: Rate exceeded ${secret}`);
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath, exitCode: 1 });
  assert.equal(diagnostics.classification, 'registry_rate_limited');
  assert.equal(diagnostics.exitCode, 1);
  assert.equal(safeJson(diagnostics).includes(secret), false);
});

test('classifies module download failures and redacts credential-shaped output', t => {
  const secret = 'Bearer eyJhbGciOiJIUzI1NiJ9.synthetic.signature';
  const logPath = fixture(t, `Error: failed to download module from registry ${secret}`);
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath });
  assert.equal(diagnostics.classification, 'module_download_failed');
  assert.equal(safeJson(diagnostics).includes(secret), false);
});

test('classifies runtime bootstrap failures using a fixed safe label', t => {
  const secret = 'APP_SESSION_SECRET=synthetic-sensitive-value';
  const logPath = fixture(t, `Edge runtime failed to initialize; ${secret}`);
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath });
  assert.equal(diagnostics.classification, 'runtime_bootstrap_failed');
  assert.equal(safeJson(diagnostics).includes(secret), false);
});

test('classifies worker resource limits with fixed labels and redacts log contents', async t => {
  const cases = [
    ['cpu_hard_limit', 'Edge runtime exceeded CPU hard limit'],
    ['cpu_soft_limit', 'CPU soft limit was exceeded'],
    ['memory_limit', 'memory limit exceeded'],
    ['wall_clock_limit', 'wall-clock limit reached'],
  ];
  for (const [classification, message] of cases) {
    await t.test(classification, subtest => {
      const secret = 'synthetic-worker-detail-secret';
      const logPath = fixture(subtest, `${message}: ${secret}`);
      const diagnostics = getFunctionServerFailureDiagnostics({ logPath, exitCode: 1 });
      assert.equal(diagnostics.classification, classification);
      assert.equal(safeJson(diagnostics).includes(secret), false);
    });
  }
});

test('unknown startup output is not echoed and only allowlisted process metadata is returned', t => {
  const secret = 'service-role-key=synthetic-sensitive-value';
  const logPath = fixture(t, `unclassified startup output ${secret}`);
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath, exitCode: 999, signalCode: 'SIGPRIVATE', spawnError: { code: 'EPRIVATE', message: secret } });
  assert.deepEqual(diagnostics, {
    code: 'PERFORMANCE_FUNCTION_SERVER_FAILED',
    classification: 'unknown',
    exitCode: null,
    signalCode: null,
    spawnErrorCode: null,
  });
  assert.equal(safeJson(diagnostics).includes(secret), false);
});

test('a missing or unreadable log safely falls back to unknown without masking the failure', () => {
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath: '', exitCode: 2 });
  assert.equal(diagnostics.classification, 'unknown');
  assert.equal(diagnostics.exitCode, 2);
});

test('classification reads only the bounded tail', t => {
  const prefix = `toomanyrequests: Rate exceeded\n${'x'.repeat(FUNCTION_SERVER_LOG_TAIL_BYTES + 10)}`;
  const logPath = fixture(t, `${prefix}tail has an unrelated startup error`);
  const diagnostics = getFunctionServerFailureDiagnostics({ logPath });
  assert.equal(diagnostics.classification, 'unknown');
});

test('private log descriptors are exclusive and reusable by child stdio', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'gnc-function-server-diagnostics-fd-'));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^gnc-function-server-diagnostics-fd-/);
  t.after(() => rmSync(resolved, { recursive: true, force: false }));
  const logPath = path.join(resolved, 'function-server.log');
  const fd = openFunctionServerLog(logPath);
  assert.throws(() => openFunctionServerLog(logPath), error => error.code === 'EEXIST');
  if (process.platform !== 'win32') assert.equal(statSync(logPath).mode & 0o777, 0o600);
  const child = spawnSync(process.execPath, ['-e', "process.stdout.write('x'.repeat(256 * 1024)); process.stderr.write('\\nRuntime startup failed');"], {
    stdio: ['ignore', fd, fd], timeout: 5000, windowsHide: true,
  });
  closeFunctionServerLog(fd);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, 'regular-file stdio drains beyond pipe capacity without a reader');
  const readFd = openSync(logPath, 'r');
  try { assert.equal(readFileSync(readFd, 'utf8'), 'x'.repeat(256 * 1024) + '\nRuntime startup failed'); }
  finally { closeSync(readFd); }
  assert.equal(getFunctionServerFailureDiagnostics({ logPath }).classification, 'runtime_bootstrap_failed');
});
