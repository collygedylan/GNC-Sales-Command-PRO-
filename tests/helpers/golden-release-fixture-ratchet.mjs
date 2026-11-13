import assert from 'node:assert/strict';
import test from 'node:test';
import {assertClearedSuspendDefaultOwner} from './golden-restored-suspend-routing.mjs';
import {assertPlantingDrillUsesExactLocationPlans} from './golden-planting-drill-projection.mjs';
import {assertGoldenFixtureOwnership} from './golden-fixture-ownership-contract.mjs';
import {assertPhotoTransportDeadline} from './photo-field-lifecycle-contract.mjs';
import {runtimeSyntaxCounts} from './runtime-extraction-syntax.mjs';

test('Invariant 661 (Explicitly cleared exact Suspend owners override stale projections while zone overrides retain precedence)', assertClearedSuspendDefaultOwner);
test('Invariant 662 (Planting drill cards use the selected exact bay without leaking neighboring plans)', assertPlantingDrillUsesExactLocationPlans);
test('Invariant 663 (Golden fixtures retain explicit owners and fail on missing identities without activating optional UI)', assertGoldenFixtureOwnership);

test('Invariant 664 (Release fixtures preserve nested diagnostics and bound photo transport deadlines)', async () => {
  const current = 'function outer() { function inner() { try { read() } catch { report() } } }';
  assert.deepEqual(runtimeSyntaxCounts('fixture.js',current),{declarations:2,emptyCatches:0});
  assert.deepEqual(runtimeSyntaxCounts('fixture.js',current.replace('report()','')),{declarations:2,emptyCatches:1});
  await assertPhotoTransportDeadline();
});
