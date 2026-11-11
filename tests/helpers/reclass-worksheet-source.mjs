import { reclassDestinationLot } from '../../src/engine/reclass-physical-lot.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function reclassWorksheetSource() {
  return reclassDestinationLot.toString() + '\n' + readFileSync(new URL('../../assets/reclass-move-worksheet.js', import.meta.url), 'utf8');
}

export function extractReclassAppFunction(html, name) {
  if (['buildOptimisticInventoryReclassMoveModel', 'buildInventoryReclassMoveCommand'].includes(name)) return reclassWorksheetSource();
  const marker = `function ${name}(`;
  let start = html.indexOf(marker);
  if (start > 0 && html.slice(start - 6, start) === 'async ') start -= 6;
  assert.ok(start >= 0, `${name} exists`);
  const open = html.indexOf(') {', start) + 2;
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}
