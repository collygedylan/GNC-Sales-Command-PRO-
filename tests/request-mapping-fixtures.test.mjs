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
  assert.match(source, /select plan\(82\)/);
  assert.match(source, /authenticated clients cannot read raw historical financial snapshots/);
  assert.match(source, /assigned rep reads the created history quantity through the protected redacted RPC/);
  assert.match(source, /completion never reopens raw historical snapshot access/);
  assert.match(source, /the unchanged real account guard still denies Kayla at the scheduled cutoff/);
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

test('append success fixtures retain complete customer tuples and the completed-folder assertions', () => {
  const source = readFileSync(new URL('../supabase/tests/request_option_append_test.sql', import.meta.url), 'utf8');
  const batches = [...source.matchAll(/'(\[\{"unique_id"[^\n]+\])'::jsonb/g)].map(match => JSON.parse(match[1]));
  assert.equal(batches.length, 2);
  for (const row of batches.flat()) {
    assert.equal(row.customeridentityid, 'APPEND-C');
    assert.equal(row.consigneeidentityid, 'APPEND-CN');
    assert.equal(row.customername, 'Persisted Customer');
    assert.equal(row.consigneename, 'Persisted Destination');
  }
  assert.match(source, /select plan\(26\)/);
  assert.match(source, /REQUEST_FOLDER_ALREADY_COMPLETED/);
});

test('history success fixture uses its own verified rep while retaining conflicting-ID coverage', () => {
  const source = readFileSync(new URL('../supabase/tests/sales_history_docks_test.sql', import.meta.url), 'utf8');
  assert.match(source, /'HD-REQUEST-REP','Brown, History Ben'/);
  assert.match(source, /"request_selected_salesrep_id":"HD-REQUEST-REP"/);
  assert.match(source, /conflicting external IDs cannot fall through to a display name/);
  assert.match(source, /completed request credit context survives active deletion/);
});

test('local browser native submissions use active mapping tuples and preserve role denials', () => {
  const source = readFileSync(new URL('../tests/request-integrity-local.spec.js', import.meta.url), 'utf8');
  for (const field of ['customeridentityid: customerId', 'consigneeidentityid: consigneeId', "'Test Customer','A'", "'Test Destination','A'",
    'request_selected_salesrep_id: salesrepIds.rep', 'request_selected_salesrep_id: salesrepIds.csr']) assert.ok(source.includes(field), field);
  assert.match(source, /request_source: 'legacy'/);
  assert.match(source, /expect\(generalDenied.response.status\).toBe\(403\)/);
  assert.match(source, /expect\(deniedAssignment.response.status\).toBe\(403\)/);
  assert.match(source, /const avRetry = await rpc\('create_av_request_batch', repToken/);
  assert.match(source, /expect\(\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\)\.toContain\(target.hostname\)/);
  assert.match(source, /expect\(target.pathname\)\.toBe\('\/postgres'\)/);
  assert.doesNotMatch(source, /grant insert|GRANT INSERT/);
});
