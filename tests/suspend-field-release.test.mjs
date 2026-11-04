import test from 'node:test';

test('Invariant 437 (Complete Tag closes blank False Block rows on the first paint)', async () => {
    const { closeUnreviewedContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await closeUnreviewedContract();
});

test('Invariant 438 (confirmed pulls preview the exact Dock, Drop, Drive and AV allocation)', async () => {
    const { confirmedLocationContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await confirmedLocationContract();
});

test('Invariant 439 (canonical SOC membership excludes stale and completed lines and honors resolved owners)', async () => {
    const { activeSocContract } = await import('./helpers/suspend-field-release-contract.mjs');
    await activeSocContract();
});
