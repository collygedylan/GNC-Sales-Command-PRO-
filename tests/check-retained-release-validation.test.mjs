// @test-group: @release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  captureScopedReleaseSources,
  hashScopedFile,
  scopedSourceDigest,
  verifyScopedRetainedValidation,
} from '../scripts/check-retained-release-validation.mjs';

const release = 'v2.3.15';
const receiptPath = 'docs/releases/v2.3.15-retained-validation.json';
const evidencePrefix = 'docs/releases/v2.3.15-validation/';
const previousReceipt = 'docs/releases/v2.3.11-retained-validation.json';
const migration = 'supabase/migrations/20261020150827_v2315_reclass_email_report_policy.sql';
const hash = value => createHash('sha256').update(value).digest('hex');
const write = (root, relative, contents) => {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
};
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function fixture({ protectedEdit = false, omitDatabase = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agdata-scoped-validation-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Scoped validation test');
  git(root, 'config', 'user.email', 'scoped-validation@example.invalid');
  write(root, 'package.json', JSON.stringify({
    name: 'agdata-fixture', version: '2.3.15', scopedValidationReceipt: receiptPath,
    appsScriptPatchFunctions: ['sendCompletedReclassEmail'], dependencies: {}, devDependencies: {}, overrides: {},
  }));
  write(root, 'package-lock.json', '{"name":"agdata-fixture","lockfileVersion":3}\n');
  write(root, 'Code.gs', 'function sendCompletedReclassEmail(){ return "old"; }\nfunction protectedBackfill(){ return true; }\n');
  write(root, 'src/app.js', 'export const version = "old";\n');
  write(root, previousReceipt, '{"schemaVersion":"preserved-v2311"}\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture base');
  const base = git(root, 'rev-parse', 'HEAD');

  write(root, 'src/app.js', 'export const version = "new";\n');
  write(root, 'Code.gs', `function sendCompletedReclassEmail(){ return "new"; }\nfunction protectedBackfill(){ return true; }\n${protectedEdit ? 'const BACKFILL_PAUSED = false;\n' : ''}`);
  write(root, migration, 'select 1;\n');
  write(root, 'supabase/functions/request-delivery-worker/index.ts', 'export const handler = () => true;\n');

  const sourceHashes = captureScopedReleaseSources({ rootDir: root, base, receiptPath, evidencePrefix });
  const sourceDigest = scopedSourceDigest({ rootDir: root, receiptPath, evidencePrefix });
  const evidence = [
    { kind: 'unit', passed: 1, failed: 0 },
    { kind: 'tooling', passed: 1 },
    { kind: 'browser', browserEvidence: ['desktop-chromium', 'android-chromium', 'iphone-webkit'].map(project => ({
      project, metrics: { renderMs: 200, cards: 1, expectedCards: 1, masterRows: 1,
        sorted: true, metricsVerified: true, productionWrites: false },
      lastCardLayout: { inViewport: true, cardOverflow: false, completeTagVisible: true,
        metrics: [{ id: 'on-hand', label: 'On Hand', value: '1', labelSingleLine: true, valueSingleLine: true }] },
    })) },
    ...(!omitDatabase ? [{ kind: 'database', assertions: 1, disposable: true, failed: 0, errors: 0 }] : []),
  ].map(item => ({ ...item, status: 'passed', sourceDigest, productionWrites: false, realEmailsSent: false,
    capturedAt: '2026-10-20T12:00:00.000Z' }));
  const evidenceHashes = {};
  evidence.forEach((item, index) => {
    const file = `${evidencePrefix}${item.kind}.json`;
    const contents = `${JSON.stringify(item)}\n`;
    write(root, file, contents);
    evidenceHashes[file] = hash(Buffer.from(contents));
  });

  const dependencyManifest = { dependencies: {}, devDependencies: {}, overrides: {} };
  const receipt = {
    schemaVersion: 'agdata-scoped-validation-v1', release, base, sourceDigest, sourceHashes,
    evidencePathPrefix: evidencePrefix, evidenceHashes,
    dependencySeal: { lockfiles: ['package-lock.json'], lockfileHashes: {
      'package-lock.json': hash(fs.readFileSync(path.join(root, 'package-lock.json'))),
    }, manifestDigest: hash(Buffer.from(JSON.stringify(dependencyManifest))) },
    requiredRetainedReceipts: [previousReceipt], retainedReceipts: {
      [previousReceipt]: hash(fs.readFileSync(path.join(root, previousReceipt))),
    },
    appsScriptChangedFunctions: ['sendCompletedReclassEmail'],
    deployment: { edgeFunctions: ['request-delivery-worker'], migrations: [migration] },
    testedMigrationHashes: { [migration]: hash(fs.readFileSync(path.join(root, migration))) },
    browserContract: { projects: ['desktop-chromium', 'android-chromium', 'iphone-webkit'], metricIds: ['on-hand'], expectedCards: 1,
      minimumMasterRows: 1, renderMsMaximum: 2000, requireSorted: true, requireMetrics: true,
      requireNoProductionWrites: true, requireLastCard: true, requireCompleteControl: true, requireNoOverflow: true },
  };
  if (omitDatabase) {
    receipt.evidenceHashes = Object.fromEntries(Object.entries(evidenceHashes).filter(([file]) => !file.endsWith('/database.json')));
  }
  write(root, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { root, receipt, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('scoped release verifier excludes receipt/evidence while validating source and deployment seals', () => {
  const state = fixture();
  try {
    const result = verifyScopedRetainedValidation({ rootDir: state.root });
    assert.equal(result.release, 'AgData v2.3.15');
    assert.deepEqual(result.deployment, state.receipt.deployment);
    assert.equal(result.evidence.database.assertions, 1);
  } finally { state.dispose(); }
});

test('scoped file seals normalize text newlines while preserving binary bytes', () => {
  assert.equal(hashScopedFile('src/app.js', Buffer.from('const x = 1;\r\n')),
    hashScopedFile('src/app.js', Buffer.from('const x = 1;\n')));
  assert.equal(hashScopedFile('supabase/migrations/change.sql', Buffer.from('select 1;\r\n')),
    hashScopedFile('supabase/migrations/change.sql', Buffer.from('select 1;\n')));
  assert.notEqual(hashScopedFile('assets/payload.bin', Buffer.from([0, 13, 10, 255])),
    hashScopedFile('assets/payload.bin', Buffer.from([0, 10, 255])));
});

test('scoped release verifier rejects tampered source and mismatched deployment receipt', () => {
  const state = fixture();
  try {
    write(state.root, 'src/app.js', 'export const version = "tampered";\n');
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_SOURCE_SEAL_MISMATCH/);
  } finally { state.dispose(); }
});

test('scoped release verifier rejects omitted disposable database evidence for SQL changes', () => {
  const state = fixture({ omitDatabase: true });
  try {
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_REQUIRED_EVIDENCE_MISSING:database/);
  } finally { state.dispose(); }
});

test('scoped release verifier rejects Code.gs protected edits outside the allowlist', () => {
  const state = fixture({ protectedEdit: true });
  try {
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_PROTECTED_SCRIPT_CHANGED/);
  } finally { state.dispose(); }
});

test('scoped release verifier rejects relaxed or incomplete browser release gates', () => {
  const state = fixture();
  try {
    state.receipt.browserContract.renderMsMaximum = 2000.01;
    write(state.root, receiptPath, `${JSON.stringify(state.receipt, null, 2)}\n`);
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_BROWSER_CONTRACT_INVALID/);
    state.receipt.browserContract.renderMsMaximum = 2000;
    state.receipt.browserContract.requireNoOverflow = false;
    write(state.root, receiptPath, `${JSON.stringify(state.receipt, null, 2)}\n`);
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_BROWSER_CONTRACT_INVALID/);
  } finally { state.dispose(); }
});

test('scoped release verifier requires a Code.gs allowlist and resolves changed shared imports', () => {
  const state = fixture();
  try {
    state.receipt.appsScriptChangedFunctions = [];
    write(state.root, receiptPath, `${JSON.stringify(state.receipt, null, 2)}\n`);
    assert.throws(() => verifyScopedRetainedValidation({ rootDir: state.root }), /SCOPED_SCRIPT_ALLOWLIST_REQUIRED/);

    state.receipt.appsScriptChangedFunctions = ['sendCompletedReclassEmail'];
    write(state.root, 'supabase/functions/_shared/notify.ts', 'export const notify = () => true;\n');
    write(state.root, 'supabase/functions/app-api/index.ts', 'import { notify } from "../_shared/notify.ts";\nexport const handler = notify;\n');
    state.receipt.sourceHashes = captureScopedReleaseSources({ rootDir: state.root, base: state.receipt.base,
      receiptPath, evidencePrefix });
    state.receipt.sourceDigest = scopedSourceDigest({ rootDir: state.root, receiptPath, evidencePrefix });
    state.receipt.deployment.edgeFunctions.push('app-api');
    state.receipt.deployment.edgeFunctions.sort();
    for (const file of Object.keys(state.receipt.evidenceHashes)) {
      const item = JSON.parse(fs.readFileSync(path.join(state.root, file), 'utf8'));
      item.sourceDigest = state.receipt.sourceDigest;
      const contents = `${JSON.stringify(item)}\n`;
      write(state.root, file, contents);
      state.receipt.evidenceHashes[file] = hash(Buffer.from(contents));
    }
    write(state.root, receiptPath, `${JSON.stringify(state.receipt, null, 2)}\n`);
    const result = verifyScopedRetainedValidation({ rootDir: state.root });
    assert.deepEqual(result.deployment.edgeFunctions, ['app-api', 'request-delivery-worker']);
  } finally { state.dispose(); }
});
