// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import fs, { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPerformanceFunctionPolicy,
  PERFORMANCE_API_FUNCTION_POLICY,
  setPerformanceFunctionPolicy,
} from '../scripts/performance-function-policy.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const containerId = 'a'.repeat(64);

function withWorkspace(configBytes, callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gnc-db-workspace-policy-'));
  const supabase = path.join(root, 'supabase');
  mkdirSync(supabase);
  const configPath = path.join(supabase, 'config.toml');
  if (configBytes !== null) writeFileSync(configPath, configBytes);
  const proof = { absolute: root, configPath, projectId: 'gncdb-policy-fixture', containerId };
  try { return callback({ root, configPath, proof }); }
  finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gnc-db-workspace-policy-'));
    const info = lstatSync(resolved);
    assert.ok(info.isDirectory() && !info.isSymbolicLink());
    rmSync(resolved, { recursive: true, force: false });
  }
}

const config = `project_id = "gncdb-policy-fixture"\r\n[api]\r\nport = 54321\r\n[db]\r\nport = 54322\r\n[edge_runtime]\r\nenabled = true\r\npolicy = "per_worker" # preserve comment\r\n[analytics]\r\nbackend = "postgres"\r\n`;

test('scopes oneshot to a verified disposable workspace and restores exact CRLF bytes', () => {
  withWorkspace(Buffer.from(`\uFEFF${config}`, 'utf8'), ({ configPath, proof }) => {
    const repositoryConfig = path.join(repositoryRoot, 'supabase', 'config.toml');
    const repositoryBytes = readFileSync(repositoryConfig);
    const original = readFileSync(configPath);
    const restore = setPerformanceFunctionPolicy(proof, repositoryRoot, PERFORMANCE_API_FUNCTION_POLICY);
    const configured = readFileSync(configPath, 'utf8');
    assert.match(configured, /policy = "oneshot" # preserve comment\r\n/);
    assert.match(configured, /\[analytics\]\r\nbackend = "postgres"/);
    assert.equal(assertPerformanceFunctionPolicy(proof, repositoryRoot), 'oneshot');
    assert.equal(restore(), true);
    assert.equal(restore(), false);
    assert.ok(readFileSync(configPath).equals(original));
    assert.ok(readFileSync(repositoryConfig).equals(repositoryBytes));
  });
});

test('restores the original bytes after a partial configuration write fails', (context) => {
  withWorkspace(Buffer.from(config), ({ configPath, proof }) => {
    const original = readFileSync(configPath);
    const actualWrite = fs.writeFileSync;
    let injected = false;
    context.mock.method(fs, 'writeFileSync', (target, bytes, ...options) => {
      if (path.resolve(String(target)) === configPath && !injected) {
        injected = true;
        actualWrite(target, Buffer.from('partial write'), ...options);
        throw new Error('INJECTED_CONFIG_WRITE_FAILURE');
      }
      return actualWrite(target, bytes, ...options);
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => setPerformanceFunctionPolicy(proof, repositoryRoot), /INJECTED_CONFIG_WRITE_FAILURE/);
      assert.ok(injected);
      assert.ok(readFileSync(configPath).equals(original));
    } finally {
      context.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
});

test('rejects missing, duplicated, malformed, or ambiguous edge runtime policy without mutation', () => {
  const invalidConfigs = [
    null,
    Buffer.from(config.replace('[edge_runtime]\r\n', ''), 'utf8'),
    Buffer.from(config.replace('policy = "per_worker" # preserve comment\r\n', ''), 'utf8'),
    Buffer.from(config.replace('policy = "per_worker" # preserve comment\r\n', 'policy = "per_worker"\r\npolicy = "oneshot"\r\n'), 'utf8'),
    Buffer.from(config.replace('policy = "per_worker" # preserve comment\r\n', 'policy = unknown\r\n'), 'utf8'),
    Buffer.from(config.replace('[analytics]\r\n', '[edge_runtime]\r\npolicy = "per_worker"\r\n[analytics]\r\n'), 'utf8'),
  ];
  for (const invalid of invalidConfigs) {
    withWorkspace(invalid, ({ configPath, proof }) => {
      const before = invalid === null ? null : readFileSync(configPath);
      assert.throws(() => setPerformanceFunctionPolicy(proof, repositoryRoot, 'oneshot'), /PERFORMANCE_FUNCTION_POLICY_/);
      if (before) assert.ok(readFileSync(configPath).equals(before));
      else assert.throws(() => lstatSync(configPath), error => error.code === 'ENOENT');
    });
  }
});

test('rejects unverified, repository-overlapping, and reparse-point workspace targets', () => {
  withWorkspace(Buffer.from(config), ({ root, configPath, proof }) => {
    const original = readFileSync(configPath);
    assert.throws(() => setPerformanceFunctionPolicy({ ...proof, containerId: 'invalid' }, repositoryRoot), /WORKSPACE_UNVERIFIED/);
    assert.throws(() => setPerformanceFunctionPolicy(proof, root), /WORKSPACE_UNSAFE/);
    assert.ok(readFileSync(configPath).equals(original));
    assert.throws(() => setPerformanceFunctionPolicy(proof, repositoryRoot, 'development'), /POLICY_VALUE_INVALID/);
  });

  withWorkspace(Buffer.from(config), ({ root, proof }) => {
    const supabasePath = path.join(root, 'supabase');
    const targetPath = path.join(root, 'supabase-target');
    renameSync(supabasePath, targetPath);
    symlinkSync(targetPath, supabasePath, 'junction');
    assert.throws(() => setPerformanceFunctionPolicy(proof, repositoryRoot), /PATH_UNSAFE/);
  });
});

