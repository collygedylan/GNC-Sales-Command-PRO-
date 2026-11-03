import test from 'node:test';
import { queueOwnerContract } from './helpers/queue-owner-contract.mjs';

test('Assigned Items ownership governs evaluator edits, Que visibility, counts, and mobile filter geometry', () => {
    queueOwnerContract();
});
