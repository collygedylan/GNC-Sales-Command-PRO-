import test from 'node:test';
import { assertDisposableDatabasePorts, assertHistoricalRuntimeClosure } from './helpers/disposable-database-contract.mjs';

test('disposable database ports replace defaults and reject unsafe allocations', assertDisposableDatabasePorts);
test('historical Edge runtime includes exact authored ERP dependencies', assertHistoricalRuntimeClosure);
