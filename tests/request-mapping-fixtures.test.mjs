// @test-group: foundation
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('successful native Request fixtures use mapped IDs while retaining authenticated permission checks', () => {
  const source = readFileSync(new URL('../supabase/tests/request_integrity_rls_test.sql', import.meta.url), 'utf8');
  const batches = [...source.matchAll(/'(\[\{"unique_id"[^\n]+\])'::jsonb/g)].map(match => JSON.parse(match[1]));
  const reps = { 'Rep Test': '01', 'Chance Alldredge': '02', 'Kayla Knepp': '03' };
  let checked = 0;
  for (const rows of batches) for (const row of rows) if (reps[row.requested_by]) {
    assert.equal(row.customeridentityid, 'INTEGRITY-C');
    assert.equal(row.consigneeidentityid, 'INTEGRITY-CN');
    assert.equal(row.request_selected_salesrep_id, reps[row.requested_by]);
    assert.equal(row.request_selected_rep_display, row.requested_by);
    checked++;
  }
  assert.equal(checked, 6);
  assert.match(source, /select plan\(78\)/);
  assert.match(source, /set local role authenticated/);
  assert.doesNotMatch(source, /set_config\('request\.jwt\.claim\.role','service_role'/);
  const retries = batches.flat().filter(row => row.unique_id === 'REQ-CSR-1');
  assert.equal(retries.length, 2);
  assert.deepEqual(retries[0], retries[1]);
});

test('legacy notification fixtures retain explicit internal provenance and service authorization', () => {
  const source = readFileSync(new URL('../supabase/tests/request_metadata_notifications_test.sql', import.meta.url), 'utf8');
  assert.match(source, /set_config\('request\.jwt\.claim\.role','service_role',true\)/);
  const seeds = [...source.matchAll(/insert into public\.ph_active_request\(([^)]+)\)\r?\nvalues\(([^;]+)\);/g)];
  assert.equal(seeds.length, 3);
  for (const seed of seeds) {
    assert.match(seed[1], /request_source/);
    assert.match(seed[2], /,'legacy'$/);
  }
});
