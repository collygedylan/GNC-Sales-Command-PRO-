import ts from 'typescript';
import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { toolingModularAgentManifests, toolingSkillManifests } from '../scripts/run-tooling-release-checks.mjs';
import { findDuplicateGlobalFunctionDeclarations, INDEX_HTML_BUDGET, inspectSourceBudget } from '../scripts/code-health-governance.mjs';
import { generatedDatabaseTypesPath, readGeneratedDatabaseTypes } from '../scripts/database-type-parts.mjs';
import { verifyRegisteredSymbol } from './helpers/release-gems-symbol-ownership.mjs';
import { goldenRegistrationOrder } from './helpers/golden-registration-ratchet.mjs';
import { previousRuntimeSources, runtimeSyntaxCounts } from './helpers/runtime-extraction-syntax.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_GOLDEN_INVARIANTS = 664;
const sourceCache = new Map();
const read = file => {
  if (!sourceCache.has(file)) sourceCache.set(file, file === generatedDatabaseTypesPath
    ? readGeneratedDatabaseTypes(root) : readFileSync(path.join(root, file), 'utf8'));
  return sourceCache.get(file);
};
const skillName = manifest => manifest.split('/').at(-2);
const registeredSkillManifests = new Map([...toolingSkillManifests, ...toolingModularAgentManifests]
  .map(manifest => [skillName(manifest), manifest]));

function scriptNodes(html) {
  const result = [];
  const visit = node => {
    if (node.tagName === 'script') result.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html));
  return result;
}

function isClassicInlineScript(node) {
  if ((node.attrs || []).some(attr => attr.name === 'src')) return false;
  const type = (node.attrs || []).find(attr => attr.name === 'type')?.value?.trim().toLowerCase() || '';
  return !type || ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type);
}

function scriptText(node) {
  return (node.childNodes || []).map(child => child.value || '').join('');
}

test('index shell stays within the bounded editable-source budget', () => {
  const html = read('index.html');
  const budget = inspectSourceBudget(html);
  assert.equal(budget.maxLines, 2920);
  assert.equal(budget.maxBytes, 360000);
  assert.equal(budget.withinBudget, true, `index.html is ${budget.lines} lines / ${budget.bytes} bytes`);
});

test('source budget rejects synthetic line and byte overages', () => {
  assert.deepEqual(inspectSourceBudget('a\nb', { maxLines: 1, maxBytes: 20 }), {
    lines: 2, bytes: 3, maxLines: 1, maxBytes: 20, withinBudget: false,
  });
  assert.equal(inspectSourceBudget('12345', { maxLines: 1, maxBytes: 4 }).withinBudget, false);
  assert.equal(inspectSourceBudget('a\nb', { maxLines: 2, maxBytes: 3 }).withinBudget, true);
});

test('duplicate classic-global function declarations fail while nested scopes remain independent', () => {
  const duplicate = findDuplicateGlobalFunctionDeclarations([
    { name: 'first.js', source: 'function sharedName() {} function outer() { function nested() {} }' },
    { name: 'second.js', source: 'function sharedName() {} function anotherOuter() { function nested() {} }' },
  ]);
  assert.deepEqual(duplicate, [{ name: 'sharedName', files: ['first.js', 'second.js'] }]);
  assert.deepEqual(findDuplicateGlobalFunctionDeclarations([
    { name: 'first.js', source: 'function same() {}' },
    { name: 'second.js', source: 'function different() {}' },
  ]), []);
});

test('current inline shell, runtime and watchdog module have no duplicate global functions', () => {
  const nodes = scriptNodes(read('index.html'));
  const inline = nodes.filter(isClassicInlineScript).map((node, index) => ({ name: `index.html:inline-${index + 1}`, source: scriptText(node) }));
  const sources = [
    ...inline,
    { name: 'assets/app-runtime.js', source: readComposedRuntimeSource() },
    { name: 'assets/runtime-watchdog-panel.js', source: read('assets/runtime-watchdog-panel.js') },
  ];
  assert.ok(inline.length > 0, 'the shell inline scripts are included');
  const duplicates = findDuplicateGlobalFunctionDeclarations(sources);
  assert.deepEqual(duplicates, [], `duplicate declarations: ${JSON.stringify(duplicates)}`);
});

test('v3.0.5 keeps watchdog status rendering modular and cache-busted', () => {
  const shell = read('index.html');
  const panel = read('assets/runtime-watchdog-panel.js');
  const version = JSON.parse(read('version.json')).version;
  assert.ok(shell.includes(`runtime-watchdog-panel.js?v=${version}`));
  assert.match(panel, /data-watchdog-tab="open"[^]*Resolved Fixes/);
  assert.match(panel, /RESOLVED_SKILL_FOLDERS/);
});

test('v3.0.5 keeps AURA open-stock resolution scoped and deterministic', () => {
  const appRuntime = read('assets/app-runtime.js');
  const runtime = appRuntime.slice(0, appRuntime.indexOf('async function openAuraQueryAction'));
  const appApi = read('supabase/functions/app-api/index.ts');
  const router = read('supabase/functions/_shared/aura-voice-handler.ts');
  assert.match(runtime, /requestAuraDeterministicInventoryAnswer[^]*operation: 'resolve_query'/);
  assert.match(runtime, /needsSeasonScope[^]*\? 'F1'[^]*scope\.season !== query\.season[^]*scope\.salesYear > query\.salesYear/);
  assert.match(appApi, /AURA_MAX_INVENTORY_ROWS[^]*resolveAuraDeterministicInventoryQuery/);
  assert.match(appApi, /commonName\.includes\(normalized\(term\)\)/);
  assert.match(router, /scopeAuraOpenStock[^]*strictInventoryIdentityMatch[^]*seasonLevelOpenStockTotal/);
});

test('v3.0.5 keeps Bunch Notes flexible without picker paging or option lock-in', () => {
  const bunchNote = read('assets/bunch-note.js');
  const styles = read('assets/bunch-note.css');
  const cardBoard = read('components/bunch-notes/CardBoard.jsx');
  const appApi = read('supabase/functions/app-api/index.ts');
  assert.match(bunchNote, /cardWizardGroups\(location,sortBy='commonname'\)[^]*?sortBy==='itemcode'/);
  assert.match(bunchNote, /sortPickerCards[^]*selectAllPickerCards[^]*clearPickerCards/);
  assert.doesNotMatch(bunchNote, /visibleLimit|Load more cards|loadMorePickerCards/);
  assert.match(bunchNote, /pickerUserSearch[^]*updatePickerAssignments/);
  assert.match(bunchNote, /Group selected cards together[^]*Individual cards[^]*pickerCardDraft/);
  assert.match(bunchNote, /groupSelectedCards[^]*ungroupSelectedCards/);
  assert.match(bunchNote, /function hybridField[^]*Type or choose/);
  assert.match(bunchNote, /Custom bulk Bunch house[^]*Enter a Move destination/);
  assert.doesNotMatch(bunchNote, /Choose a verified Move destination/);
  assert.match(cardBoard, /Quick Editor[^]*Group Selected[^]*Ungroup/);
  assert.match(cardBoard, /const listId = `bn-board-/);
  assert.match(styles, /background:rgba\(234,179,8,\.14\);border:1\.5px solid #facc15;color:#fef08a;font-weight:600/);
  assert.match(appApi, /cleanBunchNoteText\(entry\.work_type[^]*purpose_thread[^]*default_house_plan[^]*schedule_banner[^]*direction/);
});

test('v3.0.5 release governance prevents JWT gateway login lockout', () => {
  const config = read('supabase/config.toml');
  const runtime = readComposedRuntimeSource();
  const appApi = read('supabase/functions/app-api/index.ts');
  const agents = read('AGENTS.md');
  const workflow = read('.github/workflows/pages-static.yml');
  const probe = read('scripts/probe-production-login.mjs');
  assert.match(config, /\[functions\.app-api\][^[]*verify_jwt\s*=\s*false/);
  assert.match(config, /\[functions\.aura-llm-router\][^[]*verify_jwt\s*=\s*false/);
  assert.match(runtime, /PRELOGIN_BACKGROUND_ACTIONS[^]*isLoginScreenVisible/);
  assert.match(runtime, /const preLogin = response\.status === 401 && \(isLoginScreenVisible\(\) \|\| !getCurrentAppSessionToken\(\)\)/);
  assert.doesNotMatch(runtime, /\['navigation_preferences', 'get_user_preferences', 'user_access'/);
  assert.doesNotMatch(runtime, /Login service unavailable/);
  assert.match(appApi, /if \(action === "login"\) return await handleLogin\(payload, req\)/);
  assert.match(agents, /--no-verify-jwt[^]*breaks access-code login/);
  assert.match(workflow, /PRODUCTION_SUPABASE_SERVICE_ROLE_KEY[^]*probe-production-login\.mjs/);
  assert.match(probe, /production_access_code_login_failed[^]*production_user_access_failed[^]*production_native_session_bridge_failed/);
});

test('ten architecture clusters preserve the thirty-nine source skill owners and register the modular owners', () => {
  const inventory = JSON.parse(read('docs/architecture/agdata-static-inventory.json'));
  const layout = inventory.sourceLayout;
  assert.ok(layout, 'sourceLayout metadata exists');

  const dependencyMap = read('docs/architecture/agdata-module-dependency-map.md');
  const mapClusters = [...dependencyMap.matchAll(/^## Cluster (\d+):/gm)].map(match => Number(match[1]));
  assert.deepEqual(mapClusters, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(layout.clusters, mapClusters);

  const domains = Object.keys(JSON.parse(read('docs/architecture/agdata-symbol-index.json')).domains);
  const sourceSkills = new Set(toolingSkillManifests.map(skillName));
  assert.equal(layout.skillCount, 39);
  assert.equal(domains.filter(domain => sourceSkills.has(domain)).length, layout.skillCount);
  assert.deepEqual(domains.filter(domain => !sourceSkills.has(domain)).sort(), [
    'agdata-canonical-engine', 'agdata-views-workflows',
  ]);
  assert.equal(toolingModularAgentManifests.length, 10);
  for (const [directory, registry] of [['.codex', toolingSkillManifests], ['.agents', toolingModularAgentManifests]]) {
    const onDisk = readdirSync(path.join(root, directory, 'skills'))
      .map(name => `${directory}/skills/${name}/SKILL.md`).sort();
    assert.deepEqual(onDisk, [...registry].sort());
    for (const manifest of registry) assert.ok(read(manifest).length > 0, manifest);
  }

  const html = read('index.html');
  const moduleTags = [...html.matchAll(/<script\b([^>]*\bdata-runtime-watchdog-panel\b[^>]*)><\/script>/gi)];
  assert.deepEqual(layout.classicModules, ['assets/runtime-watchdog-panel.js']);
  assert.equal(moduleTags.length, layout.classicModules.length);
  const version = JSON.parse(read('version.json')).version;
  assert.ok(moduleTags[0][1].includes(`src="./${layout.classicModules[0]}?v=${version}"`));
  assert.ok(html.indexOf('data-runtime-watchdog-panel') < html.indexOf('id="app-script-source"'), 'watchdog module loads before app runtime');
  assert.ok(html.includes(`src="./assets/app-runtime.js?v=${version}"`));
  assert.equal(layout.classicRuntime, 'assets/app-runtime.js');
  assert.equal(INDEX_HTML_BUDGET.maxLines, 2920);
});

test('release instructions lock zero-approval and forward-only workspace rules', () => {
  const agents = read('AGENTS.md');
  for (const marker of [
    'Never set `require_escalated` or any approval flag',
    'Never use `git commit --amend`, `git reset --hard`, or `git push --force`',
    'Never edit `.codex/**` files during a release',
    'Use `git grep -n "<pattern>" -- <paths>`',
    'edit existing files in place without throwaway copies',
  ]) assert.ok(agents.includes(marker), marker);
});

test('golden invariant ratchet stays active, contiguous, and release-wired', () => {
  const invariants = goldenRegistrationOrder(read);
  assert.ok(invariants.length >= MIN_GOLDEN_INVARIANTS, `${invariants.length} active invariants`);
  assert.deepEqual(invariants, Array.from({ length: invariants.length }, (_, index) => index + 1));
  const tooling = read('scripts/run-tooling-release-checks.mjs');
  assert.match(tooling, /['"]tests\/golden-invariants\.test\.mjs['"]/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:golden'], 'node --test tests/golden-invariants.test.mjs');
});

test('golden ratchet reads registered modules in order and rejects inactive tests', () => {
  const main = 'tests/golden-invariants.test.mjs';
  const first = "await import('../src/core/golden-final-polish.mjs');";
  const second = "await import('./helpers/golden-release-fixture-ratchet.mjs');";
  const cases = new Map([
    [main, "test('Invariant 1', check);" + first + second],
    ['src/core/golden-final-polish.mjs', "test('Invariant 2', check); await import('../../tests/erp-drive-post-upsert.test.mjs');"],
    ['tests/erp-drive-post-upsert.test.mjs', "test('Invariant 3', {skip:false}, check);"],
    ['tests/helpers/golden-release-fixture-ratchet.mjs', "test('Invariant 4', check);"],
  ]);
  const source = file => cases.get(file);
  assert.deepEqual(goldenRegistrationOrder(source),[1,2,3,4]);
  for (const inactive of ["test.skip('Invariant 3', check)", "test('Invariant 3', {todo:true}, check)", "test.only('Invariant 3', check)"]) {
    cases.set('tests/erp-drive-post-upsert.test.mjs',inactive);
    assert.throws(()=>goldenRegistrationOrder(source),/inactive or exclusive|inactive invariant options/);
  }
  cases.set('tests/erp-drive-post-upsert.test.mjs', "test('Invariant 3', check);");
  for (const layout of [second + first, first + second + second]) {
    cases.set(main,layout);
    assert.throws(()=>goldenRegistrationOrder(source),/duplicate or out-of-order invariant registration import/);
  }
  cases.set(main,first + second);
  cases.set('src/core/golden-final-polish.mjs',"test('Invariant 2', check);");
  assert.throws(()=>goldenRegistrationOrder(source),/missing invariant registration import/);
});

test('skills, Step 0, and the +1 ratchet remain mandatory', () => {
  const domains = Object.keys(JSON.parse(read('docs/architecture/agdata-symbol-index.json')).domains);
  for (const domain of domains) {
    const manifest = registeredSkillManifests.get(domain);
    assert.ok(manifest, `unregistered symbol owner ${domain}`);
    const skill = read(manifest);
    if (manifest.startsWith('.agents/')) {
      assert.match(skill, /^Own src\/(?:engine|views)\b/m, manifest);
      assert.match(skill, /^## (?:Canonical owners|Workflow scope)$/m, manifest);
      assert.match(skill, /^## (?:Behavior contracts|Required behavior)$/m, manifest);
      assert.match(skill, /^## Verification$/m, manifest);
    } else {
      assert.match(skill, /^## Owned Files, Canonical Functions & SQL Contracts$/m, manifest);
      assert.match(skill, /^## Cross-Layer Blast Radius$/m, manifest);
    }
    assert.match(skill, /^## Forbidden Anti-Patterns \(Never Repeat\)$/m, manifest);
  }
  const agents = read('AGENTS.md');
  assert.match(agents, /Mandatory Step 0[^]*agdata-symbol-index\.json[^]*Cross-Layer Blast Radius/);
  assert.match(agents, /\+1 Ratchet Learning Loop[^]*tests\/golden-invariants\.test\.mjs/);
});

test('canonical symbol index resolves every registered domain symbol', () => {
  const index = JSON.parse(read('docs/architecture/agdata-symbol-index.json'));
  assert.equal(index.release, `AgData v${JSON.parse(read('version.json')).version}`);
  for (const domain of Object.keys(index.domains)) assert.ok(registeredSkillManifests.has(domain), domain);
  for (const file of index.sourceLayers) assert.ok(read(file).length, file);
  const runtime = readComposedRuntimeSource();
  const verify = (file, symbols) => {
    for (const symbol of symbols) verifyRegisteredSymbol(file, symbol, read, runtime);
  };
  for (const [file, symbols] of Object.entries(index.sharedAssets || {})) verify(file, symbols);
  for (const { supportingFiles, ...files } of Object.values(index.domains)) {
    for (const [file, symbols] of Object.entries(files)) verify(file, symbols);
    for (const [file, symbols] of Object.entries(supportingFiles || {})) verify(file, symbols);
  }
  for (const contract of Object.values(index.canonicalContracts)) {
    verify(contract.primary.file, [contract.primary.symbol]);
    for (const consumer of contract.consumers) verify(consumer.file, [consumer.symbol]);
    for (const reference of contract.contracts || []) verify(reference.file, [reference.symbol]);
  }
});

function supportsCliTransaction(source) {
  return !/^\s*--\s*pg-delta:\s*transaction\s*=\s*false\s*$/im.test(source)
    && !/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i.test(source);
}
test('CLI transaction detection rejects opt-outs and concurrent indexes', () => {
  assert.equal(supportsCliTransaction('SET LOCAL lock_timeout = \'5s\';'), true);
  assert.equal(supportsCliTransaction('-- pg-delta: transaction=false\nSET LOCAL lock_timeout = \'5s\';'), false);
  assert.equal(supportsCliTransaction('CREATE INDEX CONCURRENTLY idx ON tab(id);'), false);
});

test('latest SQL lineage scopes security-definer compatibility views and keeps SET LOCAL transactional', () => {
  const migrationNames = readdirSync(path.join(root, 'supabase', 'migrations')).filter(name => name.endsWith('.sql')).sort();
  const securityMigrationName = '20261023203000_dashboard_warning_cleanup_and_reclass_recount_v1.sql';
  const securityIndex = migrationNames.indexOf(securityMigrationName);
  assert.ok(securityIndex >= 0);
  const securityMigration = read(`supabase/migrations/${securityMigrationName}`);
  const runner = read('scripts/apply-item-low-stock-migration.mjs');
  assert.match(runner, /return `begin;[^]*\$\{body\}[^]*commit;`/);
  assert.match(securityMigration, /alter view %I\.%I set \(security_invoker = true\)/i);
  for (const name of migrationNames) {
    const source = read(`supabase/migrations/${name}`);
    for (const match of source.matchAll(/\bset\s+local\b/gi)) {
      const prefix = source.slice(0, match.index).toLowerCase();
      const inside = prefix.lastIndexOf('begin;') > Math.max(prefix.lastIndexOf('commit;'), prefix.lastIndexOf('rollback;'));
      if (!inside) assert.ok(supportsCliTransaction(source), `${name}:${match.index}`);
    }
  }
  const compatibilityMigrationName = '20261025040000_agdata_v2364_request_browser_compatibility.sql';
  const compatibilityViews = new Set(['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows', 'ph_request_history']);
  for (const name of migrationNames.slice(securityIndex + 1)) {
    const source = read(`supabase/migrations/${name}`);
    for (const match of source.matchAll(/create(?:\s+or\s+replace)?\s+view\s+public\.([a-z0-9_]+)([^]*?)\bas\b/gi)) {
      const viewName = match[1].toLowerCase();
      if (name === compatibilityMigrationName && compatibilityViews.has(viewName)) {
        assert.match(match[0], /security_invoker\s*=\s*(?:false|'false')/i, `${name}:${match[0].slice(0, 100)}`);
        assert.match(source, new RegExp(`alter view public\\.${viewName} owner to postgres`));
      } else {
        assert.match(match[0], /security_invoker\s*=\s*(?:true|'true')/i, `${name}:${match[0].slice(0, 100)}`);
      }
    }
  }
  const compatibilityMigration = read(`supabase/migrations/${compatibilityMigrationName}`);
  assert.match(compatibilityMigration, /grant select on public\.ph_requests_pending, public\.ph_active_request[^]*to anon, authenticated, service_role/);
});


function assertEmptyCatchRatchet(file, counts, previous) {
  assert.ok(counts.emptyCatches <= previous.emptyCatches, `${file}: empty catches increased`);
}
test('empty catch ratchet rejects new silent catches while retaining old debt', () => {
  const count = source => runtimeSyntaxCounts('sample.js',source);
  const retained = count('function run() { function nested() { try {} catch {} } }');
  const repaired = count('function run() { function nested() { try {} catch { report() } } }');
  assert.deepEqual(retained,{declarations:2,emptyCatches:1});
  assert.deepEqual(repaired,{declarations:2,emptyCatches:0});
  assertEmptyCatchRatchet('sample.js', retained, retained);
  assert.throws(() => assertEmptyCatchRatchet('sample.js', retained, repaired), /empty catches increased/);
});

test('runtime extraction preserves declarations while raw source and empty catches ratchet downward', async () => {
  const files = ['assets/app-runtime.js', 'assets/bloom-runtime-functions.js', 'assets/live-sync-coordinator.js', 'assets/queue-inventory-hydration.js'];
  const previous = await previousRuntimeSources(root, files);
  assert.ok(read(files[0]).split('\n').length <= 168427);
  const fragment = ts.createSourceFile('fragment.js', read(files[1]), ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  assert.equal(fragment.statements.length, 213);
  assert.ok(fragment.statements.every(ts.isFunctionDeclaration), 'no initialization may move across the classic-script boundary');
  for (const file of files) {
    const current = read(file);
    const prior = previous.get(file);
    const counts = runtimeSyntaxCounts(file, current);
    if (file === files[0]) assert.ok(counts.declarations <= 8966);
    assertEmptyCatchRatchet(file, counts, prior === current ? counts : runtimeSyntaxCounts(file, prior));
  }
  const html = read('index.html');
  assert.ok(html.indexOf('agdata-kernel.js') < html.indexOf('live-sync-coordinator.js'));
  assert.ok(html.indexOf('bloom-runtime-functions.js') < html.indexOf('id="app-script-source"'));
});
