import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runToolingReleaseChecks, toolingReleaseCheckFiles, toolingPerformanceCheckFile, toolingReleaseDeadlineMs } from '../scripts/run-tooling-release-checks.mjs';
import compactTestReporter from '../scripts/compact-test-reporter.mjs';

const reporterOption = '--test-reporter=./scripts/compact-test-reporter.mjs';
const passedSummary = count => `# tests ${count}\n# pass ${count}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
const workerPath = fileURLToPath(new URL('../scripts/tooling-test-worker.mjs',import.meta.url));

async function reportEvents(events) {
  let output = '';
  for await (const chunk of compactTestReporter(events)) output += chunk;
  return output;
}

function summaryEvent(file) {
  return { type: 'test:summary', data: { file, duration_ms: 1, counts: {
    tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0,
  } } };
}

test('compact reporter keeps exact final counts and bounded diagnostic details', async () => {
  const cause = Object.assign(new Error('specific assertion failed ' + 'x'.repeat(8000)), {
    code: 'ERR_ASSERTION', expected: 'matching row', actual: 'x'.repeat(8000),
  });
  const result = await reportEvents([
    {type: 'test:fail', data: {name:'receipt scope', file:'receipt.test.mjs', line:17, details:{error:{cause}}}},
    {type: 'test:stderr', data: {message:'diagnostic\n# pass 10\n'}},
    summaryEvent('receipt.test.mjs'),
    summaryEvent(),
  ]);
  const first = result.split('\n')[0];
  assert.ok(first.startsWith('not ok '));
  const detail = JSON.parse(first.slice(7));
  assert.equal(detail.name, 'receipt scope');
  assert.equal(detail.file, 'receipt.test.mjs');
  assert.equal(detail.line, 17);
  assert.equal(detail.code, 'ERR_ASSERTION');
  assert.match(detail.error, /^specific assertion failed/);
  assert.match(detail.expected, /matching row/);
  assert.ok(detail.actual.length < 600 && result.length < 1500);
  assert.match(result, /stderr "diagnostic\\n# pass 10\\n"/);
  assert.deepEqual(result.match(/^# pass .*$/gm), ['# pass 2']);
  assert.ok(result.includes(passedSummary(2)));
});

test('compact reporter rejects missing, duplicate, and malformed run summaries', async () => {
  await assert.rejects(reportEvents([summaryEvent('only-one-file.test.mjs')]), /TEST_SUMMARY_MISSING/);
  await assert.rejects(reportEvents([summaryEvent(), summaryEvent()]), /TEST_SUMMARY_DUPLICATE/);
  await assert.rejects(reportEvents([{type:'test:summary',data:{}}]), /TEST_SUMMARY_COUNTS_MISSING/);
});

test('functional worker starts files in supplied order and reports exact totals and failures', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(),'agdata-worker-'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const first = path.join(dir,'z-first.test.mjs'), second = path.join(dir,'a-second.test.mjs');
    const marker = JSON.stringify(path.join(dir,'started'));
    writeFileSync(first,`import test from 'node:test'; import {writeFileSync} from 'node:fs';
      test('first',()=>writeFileSync(${marker},'started'));`);
    writeFileSync(second,`import test from 'node:test'; import {readFileSync} from 'node:fs';
      test('second',()=>{ if(readFileSync(${marker},'utf8')!=='started') throw Error('first test ran late'); });`);
    const pass = spawnSync(process.execPath,[workerPath,'--test-concurrency=1',first,second],{env,encoding:'utf8',timeout:10000});
    assert.equal(pass.status,0,pass.stdout || pass.stderr);
    assert.ok(pass.stdout.includes(passedSummary(2)));
    writeFileSync(second,"import test from 'node:test'; test('failure witness',()=>{throw Error('intentional failure');});");
    const bad = spawnSync(process.execPath,[workerPath,'--test-concurrency=1',first,second],{env,encoding:'utf8',timeout:10000});
    assert.equal(bad.status,1,bad.stderr);
    assert.match(bad.stdout,/not ok .*failure witness.*intentional failure/);
    assert.match(bad.stdout,/# tests 2\n# pass 1\n# fail 1/);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

test('daytime tooling runs only focused scope, registration, governance and mocked runner contracts', () => {
  assert.deepEqual(toolingReleaseCheckFiles, [
    'tests/anti-spaghetti-lock.test.mjs',
    'tests/release-automation.test.mjs',
    'tests/manager-table-workspace.test.mjs',
    'tests/manager-workspace-restoration.test.mjs',
    'tests/modular-agent-skills.test.mjs',
    'tests/apps-script-fingerprint-repair.test.mjs',
    'tests/maintenance-database-target.test.mjs',
    'tests/production-database-maintenance.test.mjs',
    'tests/supabase-quota-security.test.mjs',
    'tests/access-permission-workspace.test.mjs',
    'scripts/enforce-all-14-gems-gate.mjs',
    'tests/golden-invariants.test.mjs',
    'tests/completed-row-workflow.test.mjs',
    'tests/photo-suspend-recovery.test.mjs',
    'tests/user-access-lifecycle.test.mjs',
    'tests/request-capability-fallback.test.mjs',
    'tests/role-access-parity.test.mjs',
    'tests/release-scope.test.mjs', 'tests/main-release-registration.test.mjs',
    'tests/tooling-release-runner.test.mjs',
    'tests/code-health-governance.test.mjs',
    'tests/agdata-governance.test.mjs', 'tests/agdata-architecture.test.mjs',
    'tests/customer-mapping.test.mjs',
  ]);
  const logs = [];
  const errors = [];
  let calls = 0;
  const result = runToolingReleaseChecks({ now: () => 0, print: message => logs.push(message), error: message => errors.push(message),
    spawn(command, args, options) {
      calls++;
      assert.equal(command, process.execPath);
      if (calls === 1) assert.deepEqual(args, ['--test', reporterOption, '--test-concurrency=1', toolingPerformanceCheckFile]);
      else {
        assert.deepEqual(args.slice(0,3), ['scripts/tooling-test-worker.mjs','--test-concurrency=4','tests/golden-invariants.test.mjs']);
        assert.deepEqual(args.slice(2).sort(), [...toolingReleaseCheckFiles].sort());
      }
      assert.equal(options.shell, false);
      assert.equal(options.timeout, calls === 1 ? 75000 : toolingReleaseDeadlineMs);
      assert.equal(options.windowsHide, true);
      return { status: 0, stdout: passedSummary(7) };
    },
  });
  assert.deepEqual(result, { exitCode: 0, passed: 14 });
  assert.equal(calls, 2);
  assert.equal(errors.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /14 tests/);
});

test('tooling failures and the bounded process timeout retain failure evidence', () => {
  for (const failure of [{ status: 3 }, { status: null, error: { code: 'ETIMEDOUT' } }, { status: null, error: { code: 'ENOENT' } }]) {
    const logs = [];
    const errors = [];
    const result = runToolingReleaseChecks({ spawn: () => ({ ...failure, stdout: 'failure detail', stderr: 'failure context' }),
      now: () => 0, print: message => logs.push(message), error: message => errors.push(message) });
    assert.equal(result.exitCode, failure.status || 1);
    assert.deepEqual(errors.slice(0, 2), ['failure detail', 'failure context']);
    assert.equal(logs.length, 0);
  }
});

test('an empty successful child cannot claim that checks passed', () => {
  const logs = [];
  const result = runToolingReleaseChecks({ spawn: () => ({ status: 0, stdout: '# pass 0\n' }),
    now: () => 0, print: message => logs.push(message), error() {} });
  assert.equal(result.exitCode, 1);
  assert.equal(logs.length, 0);
});

test('positive passes cannot hide failed, cancelled, skipped, todo, or incomplete outcomes', () => {
  const valid = passedSummary(1);
  const summaries = [
    ...['fail', 'cancelled', 'skipped', 'todo'].map(name => valid.replace(`# ${name} 0`, `# ${name} 1`)),
    valid.replace('# todo 0\n', ''),
    valid.replace('# tests 1', '# tests 2'),
    valid.replace('# pass 1', '# pass 1 invalid'),
    passedSummary(9007199254740992),
    valid + '# pass 1\n',
  ];
  for (const stdout of summaries) {
    const logs = [];
    const errors = [];
    const result = runToolingReleaseChecks({ spawn: () => ({ status: 0, stdout }), now: () => 0,
      print: message => logs.push(message), error: message => errors.push(message) });
    assert.equal(result.exitCode, 1);
    assert.equal(logs.length, 0);
    assert.equal(errors[0], stdout);
  }
});

test('full serial audit is explicit, consumed once, and never inherited', () => {
 const env={AGDATA_FULL_AUDIT_ONCE:'1'},argsSeen=[];
 const spawn=(command,args,options)=>{assert.equal(command,process.execPath);argsSeen.push(args);assert.equal(options.env.AGDATA_FULL_AUDIT_ONCE,undefined);return {status:0,stdout:passedSummary(1)};};
 for(let i=0;i<2;i++)assert.equal(runToolingReleaseChecks({env,spawn,print(){}}).exitCode,0);
 assert.ok(argsSeen[0].includes(toolingPerformanceCheckFile));assert.ok(argsSeen[1].includes('--test-concurrency=1'));
 assert.ok(argsSeen[2].includes(toolingPerformanceCheckFile));assert.ok(argsSeen[3].includes('--test-concurrency=4'));
 assert.equal(env.AGDATA_FULL_AUDIT_ONCE,undefined);
});

test('large child output does not exhaust the child process buffer', () => {
  const script = `process.stdout.write('x'.repeat(17 * 1024 * 1024) + ${JSON.stringify('\n' + passedSummary(1))})`;
  const result = runToolingReleaseChecks({
    spawn: (command, args, options) => {
      assert.ok(args.includes('--test') || args[0] === 'scripts/tooling-test-worker.mjs');
      return spawnSync(command, ['-e', script], options);
    },
    print() {},
    error(message) { throw new Error(message); },
  });
  assert.deepEqual(result, { exitCode: 0, passed: 2 });
});

test('large failed output preserves diagnostics and the child exit status', () => {
  const script = String.raw`process.stderr.write('x'.repeat(17 * 1024 * 1024) + '\nFAILURE_MARKER'); process.exitCode = 3`;
  const errors = [];
  const result = runToolingReleaseChecks({
    spawn: (command, args, options) => {
      assert.ok(args.includes('--test'));
      return spawnSync(command, ['-e', script], options);
    },
    print() {},
    error: message => errors.push(message),
  });
  assert.equal(result.exitCode, 3);
  assert.match(errors[0], /FAILURE_MARKER$/);
  assert.match(errors[1], /exit 3/);
});

test('performance failure stops functional work and functional failure remains fatal', () => {
  const good = passedSummary(1);
  for (const failingLane of [0, 1]) {
    let calls = 0;
    const result = runToolingReleaseChecks({ now:()=>0, print(){}, error(){},
      spawn() { return calls++ === failingLane ? {status:3,stdout:'failed lane'} : {status:0,stdout:good}; } });
    assert.equal(result.exitCode, 3);
    assert.equal(calls, failingLane + 1);
  }
});

test('performance time is charged against the bounded shared 120-second deadline', () => {
  assert.equal(toolingReleaseDeadlineMs,120000);
  const times = [0, 15000, 15000], timeouts = [];
  const result = runToolingReleaseChecks({ now:()=>times.shift(), print(){}, error(){},
    spawn(_command,_args,options) { timeouts.push(options.timeout); return {status:0,stdout:passedSummary(1)}; } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(timeouts, [75000, 105000]);
});

test('an exhausted shared deadline prevents functional work', () => {
  const times = [0,toolingReleaseDeadlineMs], errors = [];
  let launches = 0;
  const result = runToolingReleaseChecks({now:()=>times.shift(),print(){},error:message=>errors.push(message),
    spawn(){launches++;return {status:0,stdout:passedSummary(1)};}});
  assert.equal(result.exitCode,1);
  assert.equal(launches,1);
  assert.deepEqual(errors,['Tooling release checks exceeded the 120-second deadline.']);
});

function checkInvalidLane(bad, failingLane) {
  const good = passedSummary(1);
  let calls = 0;
  const result = runToolingReleaseChecks({ now:()=>0, print(){}, error(){},
    spawn() { return {status:0,stdout:calls++ === failingLane ? bad : good}; } });
  assert.equal(result.exitCode, 1);
  assert.equal(calls, failingLane + 1);
}

test('every lane rejects incomplete and nonzero outcomes', () => {
  const good = passedSummary(1);
  for (const bad of ['# pass 1\n', good.replace('# cancelled 0','# cancelled 1'), good.replace('# skipped 0','# skipped 1')]) {
    for (const failingLane of [0, 1]) checkInvalidLane(bad, failingLane);
  }
});
