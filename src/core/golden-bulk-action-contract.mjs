import assert from 'node:assert/strict';
import {assertBulkProtectedRowResult} from '../services/bulk-master-http-protected-row.mjs';

export async function assertCrossRequestIdentity() {
  const impact = await import(new URL('../../assets/request-sales-impact.js', import.meta.url));
  const shared = {
    unique_id: 'STRICT-SHARED', folder_id: 'REQ-SHARED', itemcode: 'ITEM-9', contsize: '#5',
    locationcode: 'Z.09', lotcode: 'LOT-9', request_date: '2026-10-20T15:00:00Z',
    sales_rep: 'Rep One', customer_name: 'Customer One', consignee_name: 'Consignee One', qty: 2, list_price: 10,
  };
  const result = impact.aggregateRequestSalesImpactLines([
    { ...shared, source_row_id: 'ph_requests_completed_history:1', status: 'Completed' },
    { ...shared, source_row_id: 'ph_requests_pending:1', status: 'Pending' },
    { ...shared, unique_id: 'STRICT-SEPARATE-1', source_row_id: 'ph_requests_completed_history:2', status: 'Completed' },
    { ...shared, unique_id: 'STRICT-SEPARATE-2', source_row_id: 'ph_requests_completed_history:3', status: 'Completed' },
  ]);
  assert.equal(result.summary.total_line_items, 4);
  assert.equal(result.summary.total_dollar_value, 80);
  assert.equal(result.line_items.filter(row => row.source_row_id === 'ph_requests_completed_history:1').length, 1);
  assert.equal(result.line_items.filter(row => row.folder_id === 'REQ-SHARED').length, 4);
  assert.equal(new Set(result.line_items.map(row => row.unique_id)).size, 3);
}

export function assertBulkDiscrepancyReceipt() {
  const original={holdstopcode:'APP_HOLD',holdstopreason:'Supervisor hold',locationnote:'App note'};
  const report={holdstopcode:'H',holdstopreason:'ERP hold'};
  const actual={...report,locationnote:original.locationnote};
  const receipt={action_id:'17',canonical_unique_id:'fixture-row',reconciliation_status:'discrepant',
    absorbed_by_erp:true,sync_run_id:'run-1',import_run_id:'run-1',app_update_row:original,report_update_row:report,
    discrepancy_diff:Object.keys(report).map(field=>({field,app_expected_value:original[field],report_actual_value:report[field]}))};
  const safe={actual,original,report,receipt,runId:'run-1',actionId:'17',protectedId:'fixture-row'};
  assert.doesNotThrow(()=>assertBulkProtectedRowResult(safe));
  const invalid=[{receipt:undefined},{receipt:{...receipt,action_id:'18'}},
    {receipt:{...receipt,canonical_unique_id:'another-row'}},{receipt:{...receipt,reconciliation_status:'pending'}},
    {receipt:{...receipt,absorbed_by_erp:false}},{receipt:{...receipt,sync_run_id:'other-run'}},
    {receipt:{...receipt,import_run_id:'other-run'}},{receipt:{...receipt,discrepancy_diff:[]}},
    {receipt:{...receipt,app_update_row:report}},{receipt:{...receipt,report_update_row:original}},
    {actual:{...actual,locationnote:'ERP note'}},{actual:{...actual,holdstopcode:'APP_HOLD'}}];
  for(const changed of invalid) assert.throws(()=>assertBulkProtectedRowResult({...safe,...changed}),assert.AssertionError);
}
