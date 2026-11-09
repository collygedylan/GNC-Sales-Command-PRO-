import test from 'node:test';
import { assertOperationalColdDisplay, assertOperationalColdDisplayFences } from './helpers/operational-cold-display-contract.mjs';

test('cold Drive, AV and Que render all saved rows while the authenticated live lanes are pending', assertOperationalColdDisplay);
test('cold hydration preserves confirmed empty queues and rejects a prior account cache', assertOperationalColdDisplayFences);
