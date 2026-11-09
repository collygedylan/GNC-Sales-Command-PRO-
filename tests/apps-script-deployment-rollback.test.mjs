import test from 'node:test';
import { assertAmbiguousDeploymentUpdates, assertScopedDeploymentRollback, assertScopedDeploymentRollbackCounterexamples,
  assertScopedDeploymentSuccessBoundary } from '../src/services/golden-apps-script-rollback.mjs';

test('a scoped Apps Script health or file verification failure restores the exact captured deployment', assertScopedDeploymentRollback);
test('a scoped rollback preserves a newer deployment or metadata edit and skips a switch that never applied', assertScopedDeploymentRollbackCounterexamples);
test('the scoped switch requires restored HEAD and matching config; config and evidence failures roll back', assertScopedDeploymentSuccessBoundary);
test('an ambiguous scoped switch observes late visibility and rolls back only the exact candidate', assertAmbiguousDeploymentUpdates);
