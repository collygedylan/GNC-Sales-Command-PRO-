import test from 'node:test';
import {assignedItemsHydrationContract,assignedItemsOwnerOptionsContract} from './helpers/assigned-items-hydration-contract.mjs';
test('Assigned Items enriches async rows from detail and itemcode sources',assignedItemsHydrationContract);
test('Assigned Items owner controls share all evaluators and existing owners',assignedItemsOwnerOptionsContract);
