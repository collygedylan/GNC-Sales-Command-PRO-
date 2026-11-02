import test from 'node:test';
import {photoRecoveryContract,stagedReclassContract,suspendLocationContract} from './helpers/photo-suspend-contract.mjs';
test('quota recovery is exact-row authenticated and reports failed persistence',photoRecoveryContract);
test('Reclass retains two open rows and both staged drafts',stagedReclassContract);
test('Suspend opens canonical evidence and updates only its exact order source',suspendLocationContract);
