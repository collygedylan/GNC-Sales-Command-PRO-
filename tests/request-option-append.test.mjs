import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260901192727_repair_request_option_append.sql');
const html = read('../index.html');
const performanceWorkflow = read('../.github/workflows/performance-monitor.yml');
const sqlTest = read('../supabase/tests/request_option_append_test.sql');

const sliceFunction = (name, nextName) => {
  const start = html.indexOf(`function ${name}`);
  const end = nextName ? html.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.notEqual(start, -1, `${name} must exist`);
  return html.slice(start, end === -1 ? start + 12000 : end);
};

test('append RPC is authenticated, server-authoritative, transactional, and append-only', () => {
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(migration, /create or replace function public\.append_request_options_v1\(/);
  assert.match(migration, /idx_ph_active_request_open_folder_append_v1/);
  assert.match(migration, /idx_ph_request_delivery_outbox_folder_type_created_v1/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /actor := private\.current_active_profile\(\)/);
  assert.match(migration, /private\.can_create_general_requests\(\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('request-option-append:'/);
  assert.match(migration, /from public\.ph_active_request request[\s\S]*for update/);
  assert.match(migration, /where btrim\(coalesce\(request\.request_folder, ''\)\) = folder_value[\s\S]*order by request\.unique_id[\s\S]*for update/);
  assert.match(migration, /from public\.ph_master_inventory master[\s\S]*for update/);
  assert.match(migration, /source_request\.req_qty/);
  assert.match(migration, /source_request\.desired_spec/);
  assert.match(migration, /source_request\.desired_caliper/);
  assert.match(migration, /source_request\.est_ship/);
  assert.match(migration, /source_request\.req_reserve/);
  assert.match(migration, /source_request\.request_note/);
  assert.match(migration, /actor\.username[\s\S]*actor\.display_name[\s\S]*actor_email/);
  assert.match(migration, /revoke all on function public\.append_request_options_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.append_request_options_v1[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /delete from public\.(?:ph_active_request|ph_request_history|ph_request_delivery_outbox)/i);
  assert.match(performanceWorkflow, /20260901192727_repair_request_option_append\.sql/);
  assert.match(performanceWorkflow, /request_option_append_test\.sql/);
  assert.match(sqlTest, /select plan\(25\)/);
});

test('server accepts only compatible current inventory options and deduplicates retries', () => {
  assert.match(migration, /source_itemcode_key[\s\S]*candidate_itemcode_key = source_itemcode_key/);
  assert.match(migration, /source_commonname_key[\s\S]*candidate_commonname_key = source_commonname_key/);
  assert.match(migration, /source_contsize_key = '' or candidate_contsize_key = source_contsize_key/);
  assert.match(migration, /request\.master_id = candidate\.unique_id/);
  assert.match(migration, /request\.itemcode[\s\S]*request\.locationcode[\s\S]*request\.lotcode/);
  assert.match(migration, /request-options-appended:' \|\| p_client_batch_id::text/);
  assert.match(migration, /REQUEST_OPTION_BATCH_CONFLICT/);
  assert.match(migration, /'status', 'already_in_request'/);
  assert.match(migration, /REQUEST_FOLDER_ALREADY_COMPLETED/);
});

test('silent append membership cannot be claimed for email or push and completes in the original folder thread', () => {
  assert.match(migration, /'request_options_appended'[\s\S]*'delivered', now\(\), 'internal_silent_append'/);
  assert.match(migration, /'deliveryPolicy', 'silent_until_completion'/);
  assert.match(migration, /o\.event_type in \('request_created', 'request_options_appended'\)/);
  assert.match(migration, /membership\.event_type in \('request_created', 'request_options_appended'\)/);
  assert.match(migration, /dependencyEventKeys/);
  assert.match(migration, /event_type = 'request_completed'/);
  assert.doesNotMatch(migration, /email_delivered_at|push_delivered_at/);
});

test('both existing-request option buttons use the protected append RPC without REP picker state', () => {
  const thisLocation = sliceFunction('addSelectedRequestThisLocationRows', 'renderRequestMatchingInventoryOptions');
  const itemCodeOptions = sliceFunction('addSelectedRequestItemCodeOptions', 'applyAvNoteFieldVisibilityForPrefix');
  const helper = sliceFunction('appendSelectedOptionsToExistingRequest', 'addSelectedRequestThisLocationRows');

  assert.match(thisLocation, /await appendSelectedOptionsToExistingRequest\(activeItem, selectedRows\)/);
  assert.match(itemCodeOptions, /await appendSelectedOptionsToExistingRequest\(activeItem, selectedRows\)/);
  assert.doesNotMatch(thisLocation, /tempSelectedReqRep|finalizeRequestAction|resolveRequestRepSelectionForCurrentUser/);
  assert.doesNotMatch(itemCodeOptions, /tempSelectedReqRep|finalizeRequestAction|resolveRequestRepSelectionForCurrentUser/);
  assert.match(helper, /supabaseRpc\('append_request_options_v1'/);
  assert.match(helper, /p_request_folder: folderId/);
  assert.match(helper, /p_source_request_id: sourceRequestId/);
  assert.match(helper, /p_inventory_row_ids: inventoryRowIds/);
  assert.doesNotMatch(helper, /requested_by|req_customer|p_(?:requested|customer|recipient|email)/i);
});

test('client waits for confirmation, refreshes cross-device state, and uses explicit outcomes', () => {
  const helper = sliceFunction('appendSelectedOptionsToExistingRequest', 'addSelectedRequestThisLocationRows');
  const errorMapper = sliceFunction('getRequestOptionAppendErrorState', 'mergeConfirmedRequestOptionRows');

  assert.match(helper, /const rawResult = await supabaseRpc/);
  assert.match(helper, /mergeConfirmedRequestOptionRows\(result\.rows\)/);
  assert.match(helper, /await flushQueuedAppLiveEvents\(\)/);
  assert.match(helper, /syncAlwaysOnRequestData\(0, \{ minIntervalMs: 0, force: true, once: true \}\)/);
  assert.match(helper, /showToast\('Already In Request'/);
  assert.match(helper, /showToast\('Options Added'/);
  assert.match(errorMapper, /Request Already Completed/);
  assert.match(errorMapper, /Could Not Add — Retry/);
});
