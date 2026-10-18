import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const baseline = '57539e9e83003d0ebce810454c72074e12ee6472';
const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const manifest = JSON.parse(fs.readFileSync('docs/releases/v2.3.0-retained-validation.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main'
  || process.env.RUN_NIGHTLY_SUITES === 'true' || version !== '2.3.0') {
  throw new Error('RETAINED_VALIDATION_SCOPE_FORBIDDEN');
}
git(['merge-base', '--is-ancestor', baseline, 'HEAD']);
const allowed = new Set([
  'supabase/migrations/20261018183204_bunch_note_queue_execution_and_recounts.sql',
  'supabase/tests/bunch_note_per_card_test.sql',
  'supabase/functions/app-api/index.ts',
  'scripts/historical-database-migrations.json',
  'assets/ops-precision-pilot.css', 'index.html',
  'tests/suspend-tag-card-layout.test.mjs', 'tests/suspend-tag-compaction.e2e.spec.ts',
  'tests/fixtures/suspend-tag-57539e9e.css.gz',
  '.github/workflows/pages-static.yml', '.github/workflows/release-validation.yml',
  'scripts/check-v230-retained-validation.mjs', 'docs/releases/v2.3.0-retained-validation.json',
  ...['node', 'react', 'sql', 'suspendLayout'].map(name => `docs/releases/v2.3.0-evidence/${name}.txt.gz`),
]);
const changes = git(['diff', '--name-only', '--no-renames', baseline, 'HEAD']).split('\n').filter(Boolean);
if (changes.some(file => !allowed.has(file))) throw new Error('RETAINED_VALIDATION_SOURCE_SCOPE_CHANGED');
if (manifest.baseline !== baseline || manifest.authorization !== 'explicit-user-v230-reset'
  || manifest.node?.passed !== 3546 || manifest.react?.passed !== 147
  || !/^[a-f0-9]{64}$/.test(manifest.node?.logSha256 || '')
  || !/^[a-f0-9]{64}$/.test(manifest.react?.logSha256 || '')
  || manifest.sql?.status !== 'passed' || manifest.suspendLayout?.status !== 'passed'
  || !/^[a-f0-9]{64}$/.test(manifest.sql?.logSha256 || '')
  || !/^[a-f0-9]{64}$/.test(manifest.suspendLayout?.logSha256 || '')) {
  throw new Error('RETAINED_VALIDATION_RECEIPTS_INCOMPLETE');
}
const logs = {};
for (const name of ['node', 'react', 'sql', 'suspendLayout']) {
  const bytes = gunzipSync(fs.readFileSync(`docs/releases/v2.3.0-evidence/${name}.txt.gz`), { maxOutputLength: 32 * 1024 * 1024 });
  if (createHash('sha256').update(bytes).digest('hex') !== manifest[name].logSha256) {
    throw new Error(`RETAINED_VALIDATION_LOG_MISMATCH: ${name}`);
  }
  logs[name] = bytes.toString('utf8');
}
if (!/pass 3546\b/.test(logs.node) || !/fail 0\b/.test(logs.node)
  || !/Tests\s+147 passed \(147\)/.test(logs.react)
  || !logs.sql.includes('V230_FULL_SQL_VALIDATION_PASSED')
  || !/\d+ passed/.test(logs.suspendLayout)) throw new Error('RETAINED_VALIDATION_LOG_RESULTS_INVALID');
const evidenceFiles = [
  'supabase/migrations/20261018183204_bunch_note_queue_execution_and_recounts.sql',
  'supabase/tests/bunch_note_per_card_test.sql',
  'supabase/functions/app-api/index.ts',
  'scripts/historical-database-migrations.json',
  'assets/ops-precision-pilot.css', 'index.html',
  'tests/suspend-tag-compaction.e2e.spec.ts',
  'tests/suspend-tag-card-layout.test.mjs',
  'tests/fixtures/suspend-tag-57539e9e.css.gz',
  '.github/workflows/pages-static.yml', '.github/workflows/release-validation.yml',
  'scripts/check-v230-retained-validation.mjs',
];
for (const file of evidenceFiles) {
  const source = file.endsWith('.gz') ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const actual = createHash('sha256').update(source).digest('hex');
  if (manifest.sourceSha256?.[file] !== actual) throw new Error(`RETAINED_VALIDATION_SOURCE_MISMATCH: ${file}`);
}
console.log(JSON.stringify({ authorization: manifest.authorization, baseline, nodePassed: 3546,
  reactPassed: 147, suitesRerun: false, sql: manifest.sql, suspendLayout: manifest.suspendLayout, changedPaths: changes }));
