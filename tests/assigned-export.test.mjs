import test from 'node:test';
import { assertAssignedExportSnapshot } from './helpers/assigned-export-contract.mjs';

test('Assigned Items exports the complete filtered snapshot without waiting for warehouse pages',assertAssignedExportSnapshot);
