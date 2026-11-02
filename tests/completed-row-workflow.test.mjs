import test from 'node:test';
import {depletionContract,completionLockContract,fixedKeypadContract,optimisticCompletionContract,ownerAndSuspendContract} from './helpers/completed-row-contract.mjs';
test('completed evaluation depletes one-for-one with Available',depletionContract);
test('completed rows require an exact-row explicit unlock',completionLockContract);
test('measurement keys update values without rebuilding detail',fixedKeypadContract);
test('completion paints before I/O and rolls back truthfully',optimisticCompletionContract);
test('owner controls reuse the canonical writer and Eval filter',ownerAndSuspendContract);

test('ERP rows cannot overwrite app-owned evaluation baselines',async()=>{const {normalizeErpRowsChunk}=await import('../supabase/functions/_shared/erp-sync.mjs');const result=await normalizeErpRowsChunk([{itemcode:'A',locationcode:'A.1',lotcode:'27.F1',evalbaselineavailable:'999',initiallocphotomatch:'999'}],'drive_around',['itemcode','locationcode','lotcode','eval_baseline_available','initial_loc_photo_match']);const assert=(await import('node:assert/strict')).default;assert.equal(result.rows[0].eval_baseline_available,undefined);assert.equal(result.rows[0].initial_loc_photo_match,undefined);});
test('row capability grants do not read uninitialized role state',async()=>{const {rowCapabilityInitializationContract}=await import('./helpers/completed-row-contract.mjs');rowCapabilityInitializationContract();});
test('keyboard teardown queues chrome measurement after the completion transition',async()=>{const {keyboardCloseDoesNotMeasureContract}=await import('./helpers/completed-row-contract.mjs');keyboardCloseDoesNotMeasureContract();});
