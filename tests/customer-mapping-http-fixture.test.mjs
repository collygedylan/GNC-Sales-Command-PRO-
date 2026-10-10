import assert from 'node:assert/strict';
import test from 'node:test';
import { syntheticMappingSnapshot, runMappingHttpRegression } from '../supabase/ci/customer_rep_mapping_http.mjs';

test('HTTP regression parses the full synthetic workbook using the Apps Script importer', () => {
  const rows = syntheticMappingSnapshot();
  assert.equal(rows.length, 14645);
  assert.ok(rows.every(row => Object.keys(row.raw_data).length === 122));
  const activeMolly = rows.filter(row => row.salesrepid === 'S02' && row.customerstatus === 'A' && row.consigneestatus === 'A');
  assert.equal(activeMolly.length, 149);
  assert.equal(new Set(activeMolly.map(row => row.customeridentityid)).size, 119);
  assert.equal(new Set(rows.map(row => row.unique_id)).size, rows.length);
  assert.equal(rows[0].customeridentityid, '0000001');
  assert.equal(rows[0].consigneeid, '00000001');
  assert.equal(rows[0].source_row_number, 3);
  assert.equal(rows[0].customername, rows[1].customername);
  assert.notEqual(rows[0].customeridentityid, rows[1].customeridentityid);
  assert.ok(rows[0].raw_data.FUTURE_SOURCE_FIELD.includes('Café ® ™ 植物 0000123'));
  assert.ok(rows.some(row => row.customerstatus === 'I'));
  assert.ok(rows.some(row => row.consigneestatus === 'I'));
});

test('HTTP regression rejects a repository path before connecting to any database', async () => {
  await assert.rejects(runMappingHttpRegression(process.cwd()), /DISPOSABLE_SUPABASE_WORKSPACE_REQUIRED/);
});
