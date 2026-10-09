// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { baselineChanged, hasCurrentHumanApproval } from '../scripts/check-performance-baseline-review.mjs';
const manifest = JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8'));
test('only subsequent baseline changes require a new explicit review', () => {
  assert.equal(baselineChanged(null, manifest), false);
  assert.equal(baselineChanged(manifest, manifest), false);
  assert.equal(baselineChanged(manifest, { ...manifest, fixtureVersion: 'reviewed-v2' }), true);
});
test('baseline updates require current human collaborator approval, retaining dismissals and change requests', () => {
  const approval = { state: 'APPROVED', commit_id: 'head', user: { login: 'reviewer', type: 'User' }, author_association: 'MEMBER' };
  assert.equal(hasCurrentHumanApproval([approval], 'head'), true);
  assert.equal(hasCurrentHumanApproval([approval], 'new-head'), false);
  assert.equal(hasCurrentHumanApproval([{ ...approval, user: { ...approval.user, type: 'Bot' } }], 'head'), false);
  assert.equal(hasCurrentHumanApproval([{ ...approval, author_association: 'NONE' }], 'head'), false);
  assert.equal(hasCurrentHumanApproval([approval, { ...approval, state: 'CHANGES_REQUESTED' }], 'head'), false);
  assert.equal(hasCurrentHumanApproval([approval, { ...approval, state: 'DISMISSED' }], 'head'), false);
});
