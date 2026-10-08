export const PO_MANAGEMENT_PROJECTION_FIELDS = Object.freeze([
  'id', 'run_id', 'row_index', 'itemcode', 'commonname', 'contsize', 'locationcode', 'priority', 'lotcode',
  'holdstopcode', 'holdstopreason', 'total_quantity_ordered', 'ptronhand', 'total_ptronhand', 'lot_pend_rec',
  'salesrepid', 'salesrepname', 'customername', 'consigneename', 'consigneestate', 'stopnumber', 'quantityordered',
  'requestdate', 'stagename', 'step', 'dock', 'po_remain', 'built_at'
]);

const PO_MANAGEMENT_FIELD_SET = new Set(PO_MANAGEMENT_PROJECTION_FIELDS);

export function poManagementRow(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('PO_MANAGEMENT_FIXTURE_OVERRIDES_INVALID');
  }
  const unknown = Object.keys(overrides).filter((key) => !PO_MANAGEMENT_FIELD_SET.has(key));
  if (unknown.length) throw new Error(`PO_MANAGEMENT_FIXTURE_FIELDS_UNSUPPORTED:${unknown.join(',')}`);
  return { ...Object.fromEntries(PO_MANAGEMENT_PROJECTION_FIELDS.map((field) => [field, null])), ...overrides };
}

export function poManagementCanaryRows() {
  return [
    poManagementRow({ id: 1, run_id: 'CANARY', row_index: 1, itemcode: 'CANARY.PO.001', commonname: 'Synthetic PO Canary', contsize: '#1 TEST', lotcode: '27.F1', po_remain: 12, built_at: '2026-08-27T00:00:00Z' }),
    poManagementRow({ id: 2, run_id: 'CANARY', row_index: 2, itemcode: 'CANARY.PO.002', commonname: 'Synthetic PO Canary Two', contsize: '#3 TEST', lotcode: '27.F1', po_remain: 8, built_at: '2026-08-27T00:00:00Z' })
  ];
}
