import test from 'node:test';

test('Invariant 440 (priority-independent location photos serve the queue, detail and AV search)', async () => {
    const { mediaParity } = await import('./helpers/field-parity-contract.mjs');
    await mediaParity();
});

test('Invariant 441 (queue scope settings govern both tabs, counts and empty membership)', async () => {
    const { queueParity } = await import('./helpers/field-parity-contract.mjs');
    await queueParity();
});

test('Invariant 442 (search coalesces and completion preserves the mounted list)', async () => {
    const { interactionParity } = await import('./helpers/field-parity-contract.mjs');
    await interactionParity();
});

test('Invariant 443 (incident copy emits one current release brief)', async () => {
    const { watchdogParity } = await import('./helpers/field-parity-contract.mjs');
    await watchdogParity();
});

test('Invariant 444 (authenticated Watchdog review sends the exact remote-only command)', async () => {
    const { reviewerParity } = await import('./helpers/field-parity-contract.mjs');
    await reviewerParity();
});

test('Invariant 445 (AV Photos hydrates named matches when the local catalog lacks their media)', async () => {
    const { avNameParity } = await import('./helpers/field-parity-contract.mjs');
    await avNameParity();
});
