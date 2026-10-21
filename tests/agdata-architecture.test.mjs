// @test-group: release-tooling
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolingSkillManifests } from '../scripts/run-tooling-release-checks.mjs';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = new Map();
const read = file => {
  if (!cache.has(file)) cache.set(file, file === 'index.html'
    ? readComposedAppSource({ directory: root })
    : fs.readFileSync(path.join(root, file), 'utf8'));
  return cache.get(file);
};
const map = read('docs/architecture/agdata-module-dependency-map.md');
const inventory = JSON.parse(read('docs/architecture/agdata-static-inventory.json'));
const clusters = [
  [1, 'app-shell-and-navigation', 'index.html', ['switchView', 'goBackUniversal', 'syncGlobalHeaderChrome'], '#global-header-inline-back'],
  [2, 'zero-lockout-guard', 'assets/live-sync-coordinator.js', ['createCoordinator', 'retainDisplay'], 'get_my_dataset_revisions_v1'],
  [3, 'drive-and-av-specialist', 'index.html', ['rebuildMasterInventoryIndexes', 'getCardLocationOnHandValue', 'renderDrive'], '#drive-content'],
  [4, 'queue-and-reclass-specialist', 'index.html', ['openArgosInventoryTransactionModal', 'submitArgosInventoryTransaction'], 'apply_inventory_reclass_moves_with_delivery_v1'],
  [5, 'field-ops-and-qc', 'index.html', ['renderManagers', 'renderProductionWorkflowPanel'], '#view-production'],
  [6, 'bloom-and-request-specialist', 'index.html', ['renderBloomPickerTrayRows', 'openRequestModal'], '#request-submit-btn'],
  [7, 'docks-and-orders-specialist', 'index.html', ['renderDocks', 'renderHlOrder', 'renderCommunicationHub'], 'save_dock_trip_status_v1'],
  [8, 'sync-and-supabase-architect', 'Code.gs', ['beginDatasetImportFence_', 'callMasterBulkSnapshotImport_'], 'finalize_master_snapshot_stage_v1'],
  [9, 'aura-assistant', 'index.html', ['syncAuraWidgetForSession', 'callAuraLlmRouter'], 'aura_voice_access_v1'],
  [10, 'release-governor', 'scripts/release-scope.mjs', ['classifyReleasePaths', 'selectReleaseRecoveryBase'], 'runToolingReleaseChecks'],
];

test('all installed skills are explicitly registered and provide bounded Node commands', () => {
  const actual = fs.readdirSync(path.join(root, '.codex/skills'))
    .filter(name => name.startsWith('agdata-')).map(name => `.codex/skills/${name}/SKILL.md`).sort();
  assert.equal(actual.length, 12);
  assert.deepEqual([...toolingSkillManifests].sort(), actual);
  assert.equal(new Set(toolingSkillManifests).size, toolingSkillManifests.length);
  for (const manifest of actual) {
    const skill = read(manifest);
    assert.ok(read('AGENTS.md').includes(manifest), `${manifest} must be routed`);
    assert.match(skill, /agdata-module-dependency-map\.md/, manifest);
    assert.match(skill, /(?:goBackUniversal|updateGlobalBackButton|Back\/navigation)/, manifest);
    const commands = [...skill.matchAll(/^node --test ([^\r\n]+)$/gm)];
    assert.equal(commands.length, 1, `${manifest}: one explicit scoped command`);
    const files = commands[0][1].trim().split(/\s+/);
    assert.ok(files.length >= 1 && files.length <= 3, manifest);
    assert.equal(new Set(files).size, files.length, manifest);
    for (const file of files) {
      assert.match(file, /^tests\/[a-z0-9-]+\.test\.mjs$/i, manifest);
      assert.doesNotMatch(file, /\.browser\.test\./, manifest);
      assert.ok(fs.statSync(path.join(root, file)).isFile(), `${manifest}: ${file}`);
    }
  }
});

test('ten cluster tables bind existing core functions, contracts and skill commands', () => {
  assert.deepEqual([...map.matchAll(/^## Cluster (\d+):/gm)].map(match => Number(match[1])),
    Array.from({ length: 10 }, (_, index) => index + 1));
  for (const [id, suffix, file, functions, contract] of clusters) {
    const heading = new RegExp(String.raw`^## Cluster ${id}:[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))`, 'm');
    const section = map.match(heading)?.[1];
    assert.ok(section, `cluster ${id}`);
    assert.ok(section.includes(`agdata-${suffix}`), `cluster ${id}: owner`);
    assert.ok(section.includes(contract), `cluster ${id}: ${contract}`);
    assert.ok(section.includes('|'), `cluster ${id}: dependency table`);
    for (const fn of functions) {
      assert.ok(section.includes(fn), `cluster ${id}: documented ${fn}`);
      assert.ok(read(file).includes(fn), `${file}: existing ${fn}`);
    }
    const command = read(`.codex/skills/agdata-${suffix}/SKILL.md`).match(/^node --test [^\r\n]+$/m)?.[0];
    assert.ok(command && section.includes(command), `cluster ${id}: same focused command`);
  }
});

test('current source layout resolves while the v2.3.17 census stays historical', () => {
  const layout = inventory.sourceLayout;
  assert.equal(layout.historicalCensusRetained, true);
  assert.equal(layout.shell, 'index.html');
  assert.equal(layout.classicRuntime, 'assets/app-runtime.js');
  assert.deepEqual(layout.clusters, Array.from({ length: 10 }, (_, index) => index + 1));
  assert.equal(toolingSkillManifests.length, 12);
  for (const file of [layout.shell, layout.classicRuntime, ...(layout.classicModules || []), ...layout.stylesheets]) {
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
  }
});

test('static census retains complete declared categories and honest snapshot metadata', () => {
  assert.equal(inventory.schemaVersion, 'agdata-static-architecture-v1');
  assert.match(inventory.auditCommit, /^[a-f0-9]{40}$/);
  assert.equal(inventory.appVersion, 'AgData v2.3.17');
  assert.deepEqual(inventory.clusters.map(cluster => cluster.id), clusters.map(cluster => cluster[0]));
  assert.ok(inventory.limitations.some(text => /name\/file hints/.test(text)));
  assert.ok(inventory.limitations.some(text => /not counts of independent business features/.test(text)));
  const files = inventory.files;
  assert.equal(new Set(files.map(file => file.path)).size, files.length);
  assert.equal(inventory.coverage.files, files.length);
  assert.equal(inventory.coverage.bytes, files.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(inventory.coverage.callableLocations, files.reduce((sum, file) => sum + (file.callables?.length || 0), 0));
  for (const file of ['index.html', 'Code.gs', 'supabase/functions/app-api/index.ts']) {
    assert.ok(files.some(entry => entry.path === file), file);
  }
  for (const [category, pattern] of [
    ['assetFiles', /^assets\/[^/]+\.js$/], ['migrationFiles', /^supabase\/migrations\//], ['testFiles', /^tests\//],
  ]) assert.equal(inventory.coverage[category], files.filter(file => pattern.test(file.path)).length, category);
  for (const entry of files) {
    assert.match(entry.path, /^(?:index\.html|Code\.gs|assets\/[^/]+\.js|supabase\/functions\/app-api\/index\.ts|supabase\/migrations\/.+|tests\/.+)$/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes >= 0);
    for (const [name, line, cluster] of entry.callables || []) {
      assert.ok(name && Number.isInteger(line) && line > 0, entry.path);
      assert.ok(Number.isInteger(cluster) && cluster >= 1 && cluster <= 10, entry.path);
    }
  }
  // Snapshot hashes identify the audited source; never compare them to current runtime files as a release gate.
  assert.match(map, /not release receipts/);
});

test('source links resolve and the Back diagnosis preserves Home, modal and non-Home distinctions', () => {
  const lineCounts = new Map();
  for (const match of map.matchAll(/\]\(\.\.\/\.\.\/([^\s)#]+)(?:#L(\d+))?\)/g)) {
    const [, file, line] = match;
    assert.ok(fs.statSync(path.join(root, file)).isFile(), file);
    if (line) {
      if (!lineCounts.has(file)) lineCounts.set(file, read(file).split('\n').length);
      assert.ok(Number(line) <= lineCounts.get(file), `${file}:${line}`);
    }
  }
  for (const name of ['getVisibleSecondaryBack', 'syncGlobalModalBack', 'global-back-btn', 'global-header-inline-back']) {
    assert.ok(map.includes(name));
    assert.ok(read('index.html').includes(name));
  }
  assert.ok(map.includes('does **not establish universal disappearance across non-Home views**'));
  assert.ok(map.includes('Home collapses the parent'));
  assert.ok(map.includes('Modal promotion is a separate path'));
  assert.ok(map.includes('not evidence of live email delivery'));
  assert.ok(map.includes('Historical backfill and the 15-minute automation remain paused'));
});
