import test from 'node:test';
import { assertDocksSuspendIntegrity } from '../src/core/golden-docks-suspend-integrity.mjs';
test('Docks and Suspend share exact display evidence, deduplication and receipts',assertDocksSuspendIntegrity);
