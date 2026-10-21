// @test-group: release-tooling
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const domains = {
  'drive-and-av-specialist': ['EXPORT EXCEL', 'COMMONNAME', 'CONTSIZE', 'SEASON', 'Loc Photo Match', 'Loc On Hand', 'ORANGE', 'NS 1.0', 'LD'],
  'bloom-and-request-specialist': ['CLEAR BLOOM PICKER', 'Consignee', 'ITEM 1 OF N', 'Sales Rep', 'Take Back', '2nd Cut', 'Shear', 'TX', 'NE', 'ADV'],
  'queue-and-reclass-specialist': ['physical', 'tag line ID', 'locationcode', 'lotcode', 'HTML', 'PDF', 'dylan_collyge', 'megan_kelly', 'jd_jones', 'sunday_ellis'],
  'field-ops-and-qc': ['LOCATION MOVES', 'RECOUNT', 'SHEAR LIST', 'EVAL WORK', 'BUNCH NOTES', 'overwintering'],
  'docks-and-orders-specialist': ['PLANSTART', 'Dock', 'Drop', 'SOC-10-Open-Orders', 'SOC-10-Reserves', 'Warehouse Assigned Items', 'Pikes', 'Stine'],
  'sync-and-supabase-architect': ['UP_TO_DATE', 'TEMP_*', '~$*', '120s', 'READY', 'America/Chicago', 'paused'],
  'zero-lockout-guard': ['same-account', 'Verifying updated access', 'Drive Inventory unavailable', 'Row Details Unavailable', 'v2.1.x', 'revocation'],
  'release-governor': ['scripts/run-release-smoke.mjs', '2,000 ms', '9,487', 'allowlist', 'zero retries', 'historical'],
  'skill-learner': ['ERP', 'Supabase', 'UI', 'same commit', 'allowlist', 'SKILL.md'],
  'app-shell-and-navigation': ['goBackUniversal', 'switchView', 'viewHistoryStack', 'global-header-inline-back', 'data-secondary-back', 'Home'],
  'aura-assistant': ['callAuraLlmRouter', 'requestAuraQuery', 'switchView', 'aura_voice_access_v1', 'legacy'],
  'runtime-watchdog': ['GncRuntimeWatchdog', 'VIEW_LOAD_STALL', 'watchdog_log_event', 'watchdog_list_events', 'COPY AI FIX BRIEF', 'switchView', 'goBackUniversal'],
};

test('all AgData domain skills have valid unique manifests and requested contracts', () => {
  const skillRoot = path.join(root, '.codex/skills');
  const names = fs.readdirSync(skillRoot).filter(name => name.startsWith('agdata-')).sort();
  assert.deepEqual(names, Object.keys(domains).map(name => `agdata-${name}`).sort());
  const governance = read('AGENTS.md');
  for (const [domain, terms] of Object.entries(domains)) {
    const name = `agdata-${domain}`;
    const source = read(`.codex/skills/${name}/SKILL.md`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
    assert.ok(frontmatter, name);
    const manifest = yaml.safeLoad(frontmatter[1]);
    assert.equal(manifest.name, name);
    assert.equal(typeof manifest.description, 'string');
    assert.ok(manifest.description.length > 20);
    assert.ok(governance.includes(`.codex/skills/${name}/SKILL.md`), `${name} must be routed`);
    for (const term of terms) assert.ok(source.includes(term), `${name}: missing ${term}`);
    assert.doesNotMatch(source, /TODO|\[insert|\\r\\n/);
  }
});

test('governance, LF attributes and effort defaults preserve explicit boundaries', () => {
  const source = read('AGENTS.md');
  // Approved governance plus source-audited skill routing; Markdown remains LF.
  assert.equal(createHash('sha256').update(source).digest('hex'),
    'b9ba8243b8e701e17a1414d71e2e16bcc70d7bd5951f3def08c4b465414caa32');
  assert.ok(source.startsWith('# CRITICAL: Zero-Downtime, Zero-Lockout & Autonomous Execution Protocols\n'));
  assert.doesNotMatch(source, /\\r\\n|STEP 2:|Markdown#/);
  assert.ok(source.includes('<= 2,000 ms'));
  assert.ok(source.includes('eight consecutive attempts'));
  assert.ok(source.includes('must remain PAUSED whenever explicitly instructed'));
  const attributes = read('.gitattributes');
  for (const ext of ['js', 'mjs', 'ts', 'json', 'html', 'css', 'sql', 'gs', 'webmanifest', 'md', 'yml']) {
    assert.ok(attributes.split('\n').includes(`*.${ext} text eol=lf`), ext);
  }
  assert.ok(attributes.indexOf('assets/vendor/supabase-browser-*.min.js binary') > attributes.indexOf('*.js text eol=lf'));
  assert.match(read('.codex/config.toml'), /^model_reasoning_effort = "medium"$/m);
  assert.match(read('.codex/config.toml'), /^default_subagent_reasoning_effort = "medium"$/m);
  assert.equal(Object.hasOwn(JSON.parse(read('package.json')), 'scopedValidationReceipt'), false);
});

test('setup documentation supplies a compiler prompt without claiming account activation', () => {
  const source = read('docs/gnc-codex-app.md');
  assert.ok(source.includes('You are the AgData Codex Compiler'));
  assert.ok(source.includes('does not create account-side skills'));
  assert.ok(source.includes('Build Cloud and Testcontainers Cloud remain disabled'));
  assert.ok(source.includes('88/142/387 ms'));
  assert.ok(source.includes('not measurements of the modified harness'));
});
