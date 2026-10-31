import ts from 'typescript';
import { readComposedRuntimeSource } from '../scripts/composed-app-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { toolingSkillManifests } from '../scripts/run-tooling-release-checks.mjs';
import { findDuplicateGlobalFunctionDeclarations, INDEX_HTML_BUDGET, inspectSourceBudget } from '../scripts/code-health-governance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_GOLDEN_INVARIANTS = 20;
const sourceCache = new Map();
const read = file => {
  if (!sourceCache.has(file)) sourceCache.set(file, readFileSync(path.join(root, file), 'utf8'));
  return sourceCache.get(file);
};

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

test('v2.3.120 keeps watchdog status rendering modular and cache-busted', () => {
  const shell = read('index.html');
  const panel = read('assets/runtime-watchdog-panel.js');
  assert.match(shell, /runtime-watchdog-panel\.js\?v=2\.3\.120/);
  assert.match(panel, /data-watchdog-tab="open"[^]*Resolved Fixes/);
  assert.match(panel, /RESOLVED_SKILL_FOLDERS/);
});

test('v2.3.120 keeps AURA open-stock resolution scoped and deterministic', () => {
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

test('v2.3.120 keeps Bunch Notes flexible without picker paging or option lock-in', () => {
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

test('v2.3.120 release governance prevents JWT gateway login lockout', () => {
  const config = read('supabase/config.toml');
  const runtime = read('assets/app-runtime.js');
  const appApi = read('supabase/functions/app-api/index.ts');
  const agents = read('AGENTS.md');
  const workflow = read('.github/workflows/pages-static.yml');
  const probe = read('scripts/probe-production-login.mjs');
  assert.match(config, /\[functions\.app-api\][^[]*verify_jwt\s*=\s*false/);
  assert.match(config, /\[functions\.aura-llm-router\][^[]*verify_jwt\s*=\s*false/);
  assert.match(runtime, /PRELOGIN_BACKGROUND_ACTIONS[^]*isLoginScreenVisible[^]*expectedPreLoginAuthFailure/);
  assert.doesNotMatch(runtime, /\['navigation_preferences', 'get_user_preferences', 'user_access'/);
  assert.doesNotMatch(runtime, /Login service unavailable/);
  assert.match(appApi, /if \(action === "login"\) return await handleLogin\(payload, req\)/);
  assert.match(agents, /--no-verify-jwt[^]*breaks access-code login/);
  assert.match(workflow, /PRODUCTION_SUPABASE_SERVICE_ROLE_KEY[^]*probe-production-login\.mjs/);
  assert.match(probe, /production_access_code_login_failed[^]*production_user_access_failed[^]*production_native_session_bridge_failed/);
});

test('ten architecture clusters and nineteen registered skills stay synchronized with source layout', () => {
  const inventory = JSON.parse(read('docs/architecture/agdata-static-inventory.json'));
  const layout = inventory.sourceLayout;
  assert.ok(layout, 'sourceLayout metadata exists');

  const dependencyMap = read('docs/architecture/agdata-module-dependency-map.md');
  const mapClusters = [...dependencyMap.matchAll(/^## Cluster (\d+):/gm)].map(match => Number(match[1]));
  assert.deepEqual(mapClusters, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(layout.clusters, mapClusters);

  const registered = [...new Set(toolingSkillManifests)].sort();
  const onDiskSkills = readdirSync(path.join(root, '.codex', 'skills'))
    .filter(name => name.startsWith('agdata-'))
    .map(name => `.codex/skills/${name}/SKILL.md`).sort();
  assert.equal(registered.length, 19);
  assert.equal(layout.skillCount, registered.length);
  assert.deepEqual(onDiskSkills, registered);
  for (const manifest of registered) assert.ok(readFileSync(path.join(root, manifest), 'utf8').length > 0, manifest);

  const html = read('index.html');
  const moduleTags = [...html.matchAll(/<script\b([^>]*\bdata-runtime-watchdog-panel\b[^>]*)><\/script>/gi)];
  assert.deepEqual(layout.classicModules, ['assets/runtime-watchdog-panel.js']);
  assert.equal(moduleTags.length, layout.classicModules.length);
  assert.match(moduleTags[0][1], new RegExp(`src="\\./${layout.classicModules[0].replaceAll('/', '\\/')}\\?v=2\\.3\\.120"`));
  assert.ok(html.indexOf('data-runtime-watchdog-panel') < html.indexOf('id="app-script-source"'), 'watchdog module loads before app runtime');
  assert.match(html, /<script\b[^>]*id="app-script-source"[^>]*src="\.\/assets\/app-runtime\.js\?v=2\.3\.120"/);
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
  const golden = read('tests/golden-invariants.test.mjs');
  const invariants = [...golden.matchAll(/\btest\(\s*['"`]Invariant (\d+)\b/g)].map(match => Number(match[1]));
  assert.ok(invariants.length >= MIN_GOLDEN_INVARIANTS, `${invariants.length} active invariants`);
  assert.deepEqual(invariants, Array.from({ length: invariants.length }, (_, index) => index + 1));
  assert.doesNotMatch(golden, /\btest\.(?:skip|todo)\s*\(|\b(?:skip|todo)\s*:\s*true/);
  const tooling = read('scripts/run-tooling-release-checks.mjs');
  assert.match(tooling, /['"]tests\/golden-invariants\.test\.mjs['"]/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:golden'], 'node --test tests/golden-invariants.test.mjs');
});

test('skills, Step 0, and the +1 ratchet remain mandatory', () => {
  for (const manifest of toolingSkillManifests) {
    const skill = read(manifest);
    assert.match(skill, /^## Owned Files, Canonical Functions & SQL Contracts$/m, manifest);
    assert.match(skill, /^## Cross-Layer Blast Radius$/m, manifest);
    assert.match(skill, /^## Forbidden Anti-Patterns \(Never Repeat\)$/m, manifest);
  }
  const agents = read('AGENTS.md');
  assert.match(agents, /Mandatory Step 0[^]*agdata-symbol-index\.json[^]*Cross-Layer Blast Radius/);
  assert.match(agents, /\+1 Ratchet Learning Loop[^]*tests\/golden-invariants\.test\.mjs/);
});

test('canonical symbol index resolves every registered domain symbol', () => {
  const index = JSON.parse(read('docs/architecture/agdata-symbol-index.json'));
  assert.equal(index.release, 'AgData v2.3.120');
  assert.deepEqual(Object.keys(index.domains).sort(), toolingSkillManifests.map(file => file.split('/').at(-2)).sort());
  const verify = (file, symbols) => {
    const source = read(file);
    for (const symbol of symbols) {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(source, new RegExp(`\\b(?:function\\s+|class\\s+|(?:export\\s+)?(?:const|let|var)\\s+)?${escaped}\\b`), `${file}:${symbol}`);
    }
  };
  for (const [file, symbols] of Object.entries(index.sharedAssets || {})) verify(file, symbols);
  for (const domain of Object.values(index.domains)) {
    for (const file of index.sourceLayers) verify(file, domain[file] || []);
    for (const [file, symbols] of Object.entries(domain.supportingFiles || {})) verify(file, symbols);
  }
  for (const contract of Object.values(index.canonicalContracts)) {
    verify(contract.primary.file, [contract.primary.symbol]);
    for (const consumer of contract.consumers) verify(consumer.file, [consumer.symbol]);
  }
});

test('latest SQL lineage scopes security-definer compatibility views and keeps SET LOCAL transactional', () => {
  const migrationNames = readdirSync(path.join(root, 'supabase', 'migrations')).filter(name => name.endsWith('.sql')).sort();
  const securityMigrationName = '20261023203000_dashboard_warning_cleanup_and_reclass_recount_v1.sql';
  const securityIndex = migrationNames.indexOf(securityMigrationName);
  assert.ok(securityIndex >= 0);
  const securityMigration = read(`supabase/migrations/${securityMigrationName}`);
  assert.match(securityMigration, /alter view %I\.%I set \(security_invoker = true\)/i);
  for (const name of migrationNames) {
    const source = read(`supabase/migrations/${name}`);
    for (const match of source.matchAll(/\bset\s+local\b/gi)) {
      const prefix = source.slice(0, match.index).toLowerCase();
      assert.ok(prefix.lastIndexOf('begin;') > Math.max(prefix.lastIndexOf('commit;'), prefix.lastIndexOf('rollback;')), `${name}:${match.index}`);
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


test('runtime extraction preserves declarations while raw source and empty catches ratchet downward', () => {
  const raw = read('assets/app-runtime.js');
  assert.ok(raw.split('\n').length <= 168420);
  let count = 0;
  const tree = ts.createSourceFile('runtime.js', raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = n => { if (ts.isFunctionDeclaration(n)) count++; ts.forEachChild(n, visit); }; visit(tree);
  assert.ok(count <= 8966);
  const fragment = ts.createSourceFile('fragment.js', read('assets/bloom-runtime-functions.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(fragment.statements.length, 213);
  assert.ok(fragment.statements.every(ts.isFunctionDeclaration), 'no initialization may move across the classic-script boundary');
  for (const file of ['assets/app-runtime.js', 'assets/bloom-runtime-functions.js', 'assets/live-sync-coordinator.js', 'assets/queue-inventory-hydration.js']) {
    const syntax = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let empty = 0; const walk = n => { if (ts.isCatchClause(n) && n.block.statements.length === 0) empty++; ts.forEachChild(n, walk); }; walk(syntax);
    assert.equal(empty, 0, file);
  }
  const html = read('index.html');
  assert.ok(html.indexOf('agdata-kernel.js') < html.indexOf('live-sync-coordinator.js'));
  assert.ok(html.indexOf('bloom-runtime-functions.js') < html.indexOf('id="app-script-source"'));
});
