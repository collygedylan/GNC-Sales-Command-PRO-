// @test-group: foundation
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { baselineChanged, hasCurrentHumanApproval, isApprovedRoadmapTimingChange } from '../scripts/check-performance-baseline-review.mjs';
const manifest = JSON.parse(readFileSync(new URL('../performance/baseline.json', import.meta.url), 'utf8'));
test('only subsequent baseline changes require a new explicit review', () => {
  assert.equal(baselineChanged(null, manifest), false);
  assert.equal(baselineChanged(manifest, manifest), false);
  assert.equal(baselineChanged(manifest, { ...manifest, fixtureVersion: 'reviewed-v2' }), true);
});

test('owner authorization covers the exact PR349 initial profile, PR357 floor increase, and Prompt 7 removal', () => {
  const profile100 = { ...manifest, temporaryTimingAllowance: { multiplier: 2, minimumBrowserAllowanceMs: 100, restoreAtPrompt: 7 } };
  const profile200 = { ...manifest, temporaryTimingAllowance: { multiplier: 2, minimumBrowserAllowanceMs: 200, restoreAtPrompt: 7 } };
  const strict = { ...profile100 };
  delete strict.temporaryTimingAllowance;
  assert.equal(isApprovedRoadmapTimingChange(strict, profile100, 349), true);
  assert.equal(isApprovedRoadmapTimingChange(strict, profile100, 357), false);
  assert.equal(isApprovedRoadmapTimingChange(strict, profile200, 349), false);
  assert.equal(isApprovedRoadmapTimingChange(strict, profile200, 357), false, 'PR357 cannot replace the initial PR349 profile');
  assert.equal(isApprovedRoadmapTimingChange(profile100, profile200, 357), true);
  assert.equal(isApprovedRoadmapTimingChange(profile100, profile200, 356), false);
  assert.equal(isApprovedRoadmapTimingChange(profile100, profile200, 358), false);
  assert.equal(isApprovedRoadmapTimingChange(profile200, strict, 400), true);
  assert.equal(isApprovedRoadmapTimingChange(profile100, strict, 400), true);
  assert.equal(isApprovedRoadmapTimingChange(profile100, profile100, 357), false);
  for (const changed of [{ baselineCommit: 'f'.repeat(40) }, { sqlSchemaCommit: 'f'.repeat(40) },
    { fixtureVersion: 'changed' }, { coldSamples: 10 }, { warmSamples: 20 },
    { profiles: manifest.profiles.map(profile => ({ ...profile, width: profile.width + 1 })) }]) {
    assert.equal(isApprovedRoadmapTimingChange(profile100, { ...profile200, ...changed }, 357), false);
    assert.equal(isApprovedRoadmapTimingChange(profile200, { ...strict, ...changed }, 400), false);
  }
  assert.throws(() => isApprovedRoadmapTimingChange(profile100, { ...profile100,
    temporaryTimingAllowance: { ...profile100.temporaryTimingAllowance, minimumBrowserAllowanceMs: 250 } }, 357), /TEMPORARY_TIMING_ALLOWANCE_INVALID/);
  assert.throws(() => isApprovedRoadmapTimingChange(profile100, { ...profile100,
    temporaryTimingAllowance: { ...profile100.temporaryTimingAllowance, multiplier: 3 } }, 357), /TEMPORARY_TIMING_ALLOWANCE_INVALID/);
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
