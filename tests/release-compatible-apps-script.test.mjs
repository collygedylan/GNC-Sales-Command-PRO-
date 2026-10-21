import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCompatibleAppsScript } from '../scripts/check-compatible-apps-script.mjs';
import fs from 'node:fs';

const candidate = 'a'.repeat(40);
const olderSameCode = 'b'.repeat(40);
const incompatible = 'c'.repeat(40);
const candidateBlob = 'd'.repeat(40);
const oldBlob = 'e'.repeat(40);

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('frontend compatibility accepts an older live commit with the identical Code.gs blob', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/contents/Code.gs')) return jsonResponse({ type: 'file', sha: candidateBlob });
    return jsonResponse({ ok: true, deployedCommit: olderSameCode });
  };
  const result = await waitForCompatibleAppsScript({ serviceRoleKey: 'synthetic-signing-key', repository: 'owner/repo', candidateCommit: candidate,
    deploymentId: 'deployment', token: 'token', fetchImpl, sleep: async () => {}, attempts: 1 });
  assert.equal(result.compatible, true);
  assert.equal(result.appsScriptCommit, olderSameCode);
  assert.equal(calls.filter(call => call.url.includes('/contents/Code.gs')).length, 2);
  assert.ok(calls.find(call => call.url.includes('script.google')).options.headers.authorization === undefined);
});

test('frontend compatibility waits through an incompatible live commit and fails closed when unchanged', async () => {
  let healthReads = 0; let sleeps = 0;
  const fetchImpl = async url => {
    if (url.includes(`ref=${candidate}`)) return jsonResponse({ type: 'file', sha: candidateBlob });
    if (url.includes(`ref=${incompatible}`)) return jsonResponse({ type: 'file', sha: oldBlob });
    healthReads += 1; return jsonResponse({ ok: true, deployedCommit: incompatible });
  };
  await assert.rejects(waitForCompatibleAppsScript({ serviceRoleKey: 'synthetic-signing-key', repository: 'owner/repo', candidateCommit: candidate,
    deploymentId: 'deployment', token: 'token', fetchImpl, sleep: async () => { sleeps += 1; }, attempts: 3 }), /CODE_MISMATCH/);
  assert.equal(healthReads, 3);
  assert.equal(sleeps, 2);
});

test('frontend compatibility succeeds after the Apps Script workflow catches up', async () => {
  let healthReads = 0; let sleeps = 0;
  const fetchImpl = async url => {
    if (url.includes(`ref=${candidate}`)) return jsonResponse({ type: 'file', sha: candidateBlob });
    if (url.includes(`ref=${incompatible}`)) return jsonResponse({ type: 'file', sha: oldBlob });
    healthReads += 1;
    return jsonResponse({ ok: true, deployedCommit: healthReads === 1 ? incompatible : candidate });
  };
  const result = await waitForCompatibleAppsScript({ serviceRoleKey: 'synthetic-signing-key', repository: 'owner/repo', candidateCommit: candidate,
    deploymentId: 'deployment', token: 'token', fetchImpl, sleep: async () => { sleeps += 1; }, attempts: 3 });
  assert.equal(result.appsScriptCommit, candidate);
  assert.equal(sleeps, 1);
});

test('Pages publication is independent of Apps Script compatibility and production backend probes', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/pages-static.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /check-compatible-apps-script|probe-production-auth-health|APPS_SCRIPT_COMPATIBILITY/);
  assert.match(workflow, /run-backend-tests: false/);
  assert.match(workflow, /run-schema-tests: false/);
  assert.match(workflow, /REQUIRE_CURRENT_LIVE_DESCRIPTOR: '1'/);
});
