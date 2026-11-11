import test from 'node:test';
import { assertManualErpRestart, assertManualErpMetadata, assertPreparedIsNotPublished } from './helpers/erp-manual-sync-contract.mjs';

test('manual start forwards restart and preserves healthy checkpoints', assertManualErpRestart);
test('manual Home metadata awaits the authoritative same-account revision', assertManualErpMetadata);
test('prepared batches remain unpublished until a durable commit receipt', assertPreparedIsNotPublished);
