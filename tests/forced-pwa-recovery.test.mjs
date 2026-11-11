import test from 'node:test';
import { assertOnlyBannerStartsApply, assertExplicitUpdateTapRecovery, assertForcedWorkerRecovery, assertLogoutReleasesWorkLocks, assertStaleCheckpointRecovery } from './helpers/forced-pwa-recovery-contract.mjs';

test('completed workers wait for a banner tap and retain caches used by open tabs', assertForcedWorkerRecovery);
test('the update tap releases stale state and checkpoints before verifying the reload target', assertExplicitUpdateTapRecovery);
test('only a banner tap starts verification and repeated taps share one checkpoint', assertOnlyBannerStartsApply);
test('the update tap archives the stale tab checkpoint and blocks only a running photo job', assertStaleCheckpointRecovery);
test('logout archives the checkpoint and releases photo, camera and pending row work locks', assertLogoutReleasesWorkLocks);
