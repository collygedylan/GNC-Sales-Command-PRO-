// @test-group: foundation
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { renderIdentity } from '../services/renderIdentity.mjs';
import { operationalTokens } from '../components/bunch-notes/model.mjs';

test('database row keys survive cloned snapshots and reordered rows', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(rows.map(row => renderIdentity(row, row.id)), ['a', 'b']);
  assert.deepEqual(rows.toReversed().map(row => renderIdentity({ ...row }, row.id)), ['b', 'a']);
  const transient = [{}, {}];
  const keys = transient.map(row => renderIdentity(row, null));
  assert.notEqual(keys[0], keys[1]);
  assert.deepEqual(transient.toReversed().map(row => renderIdentity(row, null)), keys.toReversed());
});

test('operational text token keys are unique and unchanged by unrelated prepended text', () => {
  const first = operationalTokens('Red flag and Red flag');
  assert.equal(new Set(first.map(token => token.key)).size, first.length);
  const next = operationalTokens('New instruction: Red flag and Red flag');
  assert.deepEqual(next.filter(token => token.color).map(token => token.key), first.filter(token => token.color).map(token => token.key));
});

test('application React components never key rendered records by their array position', () => {
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) inspect(filename);
      else if (/\.[jt]sx$/.test(entry.name)) {
        assert.doesNotMatch(readFileSync(filename, 'utf8'), /\bkey=\{(?:index|idx|i)\}/, filename);
      }
    }
  }
  inspect('components'); inspect('v2/src');
});
