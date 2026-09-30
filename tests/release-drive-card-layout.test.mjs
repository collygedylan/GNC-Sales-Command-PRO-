import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const html = read('index.html');
const css = read('assets/ops-precision-pilot.css');
const client = read('assets/ops-precision-pilot.js');

function splitSelectors(selectorList) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index++) {
    if (selectorList[index] === '(') depth++;
    if (selectorList[index] === ')') depth--;
    if (selectorList[index] === ',' && depth === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors;
}

test('Drive card header and details stay grouped inside the existing main wrapper', () => {
  const driveCard = html.slice(
    html.indexOf("if(sourceView==='drive' || sourceView==='crop-roll')"),
    html.indexOf("if(sourceView==='tasks')")
  );

  assert.match(driveCard, /<div class="app-drive-card-main"><div class="app-drive-card-header">[\s\S]*?<div class="app-drive-card-details"><div class="app-drive-card-quantity-band">\$\{driveQuantityRowHtml\}<\/div>[\s\S]*?<\/div><\/div>\$\{driveReclassActionHtml\}/);
  assert.match(driveCard, /class="app-drive-card-itemcode">\$\{esc\(item\.ITEMCODE \|\| '-'\)\}/);
});

test('Drive compact layout rules are scoped to Drive Mode and keep Reclass touch-sized', () => {
  const marker = '/* Drive Mode uses AV density. Embedded HL and Crop Roll cards keep their layout. */';
  const start = css.indexOf(marker);
  assert.ok(start >= 0, 'Drive-only compact card rules must be present');
  const end = css.indexOf('/* Grower inventory uses the Drive Mode card rhythm', start);
  assert.ok(end > start, 'Grower rules must follow the Drive-only card rules');
  const driveRules = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  let boundary = -1;
  for (let index = 0; index < driveRules.length; index++) {
    if (driveRules[index] === '}') boundary = index;
    if (driveRules[index] !== '{') continue;
    const selector = driveRules.slice(boundary + 1, index).trim();
    if (selector.startsWith('@')) {
      boundary = index;
      continue;
    }
    for (const item of splitSelectors(selector)) {
      assert.match(item.trim(), /^#drive-content\s+\.app-drive-compact-card\b/, `unscoped Drive card selector: ${item.trim()}`);
    }
    boundary = index;
  }

  assert.match(driveRules, /#drive-content \.app-drive-compact-card \.app-drive-card-reclass\s*\{[^}]*grid-area:\s*reclass;[^}]*position:\s*static !important/);
  assert.match(driveRules, /#drive-content \.app-drive-compact-card \.app-drive-card-reclass \.app-card-bottom-btn\s*\{[^}]*min-width:\s*44px !important;[^}]*min-height:\s*44px !important/);
  assert.match(driveRules, /@media\s*\(max-width:\s*900px\)[\s\S]*#drive-content \.app-drive-compact-card \.app-drive-card-grid\s*\{[^}]*"photo header reclass" "details details details"/);
});

test('Drive card compaction preserves quantity source, labels, and action handlers', () => {
  const driveCard = html.slice(
    html.indexOf("if(sourceView==='drive' || sourceView==='crop-roll')"),
    html.indexOf("if(sourceView==='tasks')")
  );

  assert.match(driveCard, /buildInventoryQuantityChipsHtml\(renderMeta\.verifiedQuantityRow \|\| item, \{ layout: 'row', compact: true, trailingChipsHtml: locPhotoMatchChipHtml, preserveUnknown: renderMeta && renderMeta\.preserveUnknownAvailability === true \}\)/);
  assert.match(driveCard, /class="app-drive-card-quantity-band">\$\{driveQuantityRowHtml\}/);
  assert.match(driveCard, /buildArgosInventoryTransactionRailHtml\(item, 'drive'\)/);
  assert.match(driveCard, /class="app-drive-card-reclass" onclick="event\.stopPropagation\(\);"/);
  assert.match(driveCard, /getInventoryCardBottomRailHtml\(item\.DOM_ID, driveBottomExtraHtml, \{ includeCart: includeDriveBloomPickerBtn, sourceView \}\)/);
  assert.match(driveCard, /toggleGlobalItem\('\$\{item\.DOM_ID\}', this\.checked, '\$\{safeCardSourceViewKey\}'\)/);
});

test('Drive width health measurement follows details after the main wrapper becomes display: contents', () => {
  assert.match(client, /#drive-content\[data-drive-detailed-records="true"\] \.app-drive-card-main[\s\S]*?\.map\(\(element\) => element\.querySelector\('\.app-drive-card-details'\) \|\| element\)/);
  assert.match(client, /const minimum = Math\.min\(\.\.\.mains\.slice\(0, 12\)\.map\(\(element\) => element\.getBoundingClientRect\(\)\.width\)\)/);
});
