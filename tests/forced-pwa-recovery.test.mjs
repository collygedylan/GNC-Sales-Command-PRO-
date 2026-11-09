import test from 'node:test';
import { assertExplicitTapJoinsAutomaticApply, assertExplicitUpdateTapRecovery, assertForcedWorkerRecovery, assertLogoutReleasesWorkLocks, assertStaleCheckpointRecovery } from './helpers/forced-pwa-recovery-contract.mjs';

test('complete workers activate, recover verified legacy tabs and retire only unused root generations', assertForcedWorkerRecovery);
test('the update tap releases stale state and checkpoints before verifying the reload target', assertExplicitUpdateTapRecovery);
test('the update tap starts one checkpoint during an automatic shell verification', assertExplicitTapJoinsAutomaticApply);
test('the update tap archives the stale tab checkpoint and blocks only a running photo job', assertStaleCheckpointRecovery);
test('logout archives the checkpoint and releases photo, camera and pending row work locks', assertLogoutReleasesWorkLocks);
