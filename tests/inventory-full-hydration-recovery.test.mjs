// @test-group: inventory
import test from 'node:test';
import {
  verifyBackgroundInventoryRevisionRecovery,
  verifyInventoryRecoveryLifecycle,
  verifyInventoryRecoveryTerminalFailures,
  verifyShortInventoryPageRecovery
} from '../src/core/golden-inventory-hydration-recovery.mjs';

test('a short continuation recovers all 9600 rows and 1613 names before assignments, then stays idle', async () => {
  await verifyShortInventoryPageRecovery();
});

test('a background revision 504 retries assignments while retaining the complete master', async () => {
  await verifyBackgroundInventoryRevisionRecovery();
});

test('hidden, logout and account changes stop pending inventory recovery for the old owner', async () => {
  await verifyInventoryRecoveryLifecycle();
});

test('projection and authorization failures never become automatic hydration retries', async () => {
  await verifyInventoryRecoveryTerminalFailures();
});
