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

test('owner authorization covers only PR349 temporary timing profile and its later removal', () => {
  const strict = { ...manifest };
  delete strict.temporaryTimingAllowance;
  assert.equal(isApprovedRoadmapTimingChange(strict, manifest, 349), true);
  assert.equal(isApprovedRoadmapTimingChange(strict, manifest, 350), false);
  assert.equal(isApprovedRoadmapTimingChange(strict, manifest, undefined), false);
  assert.equal(isApprovedRoadmapTimingChange(manifest, strict, 400), true);
  assert.equal(isApprovedRoadmapTimingChange(manifest, manifest, 349), false);
  for (const changed of [{ baselineCommit: 'f'.repeat(40) }, { sqlSchemaCommit: 'f'.repeat(40) },
    { fixtureVersion: 'changed' }, { coldSamples: 10 }, { warmSamples: 20 },
    { profiles: manifest.profiles.map(profile => ({ ...profile, width: profile.width + 1 })) }]) {
    assert.equal(isApprovedRoadmapTimingChange(strict, { ...manifest, ...changed }, 349), false);
    assert.equal(isApprovedRoadmapTimingChange(manifest, { ...strict, ...changed }, 400), false);
  }
  assert.throws(() => isApprovedRoadmapTimingChange(strict, { ...manifest,
    temporaryTimingAllowance: { ...manifest.temporaryTimingAllowance, multiplier: 3 } }, 349), /TEMPORARY_TIMING_ALLOWANCE_INVALID/);
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
