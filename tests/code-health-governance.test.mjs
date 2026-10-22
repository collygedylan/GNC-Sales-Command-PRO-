import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { toolingSkillManifests } from '../scripts/run-tooling-release-checks.mjs';
import { findDuplicateGlobalFunctionDeclarations, INDEX_HTML_BUDGET, inspectSourceBudget } from '../scripts/code-health-governance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');

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
  assert.equal(budget.maxLines, 3000);
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
    { name: 'assets/app-runtime.js', source: read('assets/app-runtime.js') },
    { name: 'assets/runtime-watchdog-panel.js', source: read('assets/runtime-watchdog-panel.js') },
  ];
  assert.ok(inline.length > 0, 'the shell inline scripts are included');
  const duplicates = findDuplicateGlobalFunctionDeclarations(sources);
  assert.deepEqual(duplicates, [], `duplicate declarations: ${JSON.stringify(duplicates)}`);
});

test('ten architecture clusters and twelve registered skills stay synchronized with source layout', () => {
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
  assert.equal(registered.length, 12);
  assert.equal(layout.skillCount, registered.length);
  assert.deepEqual(onDiskSkills, registered);
  for (const manifest of registered) assert.ok(readFileSync(path.join(root, manifest), 'utf8').length > 0, manifest);

  const html = read('index.html');
  const moduleTags = [...html.matchAll(/<script\b([^>]*\bdata-runtime-watchdog-panel\b[^>]*)><\/script>/gi)];
  assert.deepEqual(layout.classicModules, ['assets/runtime-watchdog-panel.js']);
  assert.equal(moduleTags.length, layout.classicModules.length);
  assert.match(moduleTags[0][1], new RegExp(`src="\\./${layout.classicModules[0].replaceAll('/', '\\/')}\\?v=2\\.3\\.39"`));
  assert.ok(html.indexOf('data-runtime-watchdog-panel') < html.indexOf('id="app-script-source"'), 'watchdog module loads before app runtime');
  assert.match(html, /<script\b[^>]*id="app-script-source"[^>]*src="\.\/assets\/app-runtime\.js\?v=2\.3\.39"/);
  assert.equal(layout.classicRuntime, 'assets/app-runtime.js');
  assert.equal(INDEX_HTML_BUDGET.maxLines, 3000);
});
