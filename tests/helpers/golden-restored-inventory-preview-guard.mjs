import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExpressionAt } from 'acorn';

const readRepository = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

export async function invariant554({ read = readRepository } = {}) {
  assert.match(read('assets/row-workflow-functions.js'), /function resolveLiveInventoryForCard\(row\)\s*\{\s*return resolveExactLiveInventoryCard\(row\);/);
  const sourceText = read('assets/canonical-inventory-evidence.js');
  const start = sourceText.indexOf('function resolveExactLiveInventoryCard(');
  assert.ok(start >= 0, 'the canonical live card display resolver remains available');
  const node = parseExpressionAt(sourceText, start, { ecmaVersion: 'latest' });
  const source = sourceText.slice(node.start, node.end);
  assert.doesNotMatch(source, /exactMaster[\s\S]*return\s+\{\.\.\.canonical/);
  assert.match(source, /hydrateLiveInventoryCardDisplay\(target, selected, atLocation, rows/);
  assert.match(source, /resolveCanonicalInventoryTarget\(row, masterInventoryById, masterInventoryByItemCode\)/);
  assert.match(read('src/core/dock-order-domain.js'), /resolveLiveInventoryCardPhotoMatch/);
  assert.match(read('.agents/skills/agdata-core-sync/SKILL.md'), /Invariant 554/);
}
