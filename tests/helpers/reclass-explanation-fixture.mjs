import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../assets/row-workflow-functions.js', import.meta.url), 'utf8');
export function installReclassExplanationFixture(context) {
  for (const name of ['getReclassExplanation', 'requireReclassExplanation']) {
    const match = source.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
}
