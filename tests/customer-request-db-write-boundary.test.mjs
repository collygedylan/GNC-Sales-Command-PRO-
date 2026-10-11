import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const edgeSource = readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = edgeSource.indexOf('const INTERNAL_MOVE_REQUEST_INSERT_FIELDS = new Set(');
const end = edgeSource.indexOf('\nasync function restRequest(', start);
assert.ok(start >= 0 && end > start, 'request write boundary helpers should exist');
const harness = {
  actor: { username: 'dylan_collyge', display_name: 'Dylan Collyge', role: 'ADMIN' },
  master: { unique_id: 'MASTER-1', itemcode: '000123', locationcode: 'A1', lotcode: 'L1', commonname: 'Tree', contsize: '5 gal' },
};
const compiled = ts.transpileModule(`${edgeSource.slice(start, end)}\nthis.guard = protectCustomerRequestDbWrite; this.classify = classifyInternalCustomerRequestInsert; this.stamp = stampInternalCustomerRequestSource; this.authorize = authorizeInternalCustomerRequestInsert;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const context = vm.createContext({
  errorResponse: (message, status, extra = {}) => ({ message, status, ...extra }),
  databaseFailureResponse: (message, error, code) => ({ message, error, status: 503, code }),
  normalizeUsername: value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
  getRoleAccessState: role => ({ isAdmin: ['ADMIN', 'ADMINISTRATOR', 'MANAGER'].includes(String(role || '').toUpperCase()) }),
  FULL_ACCESS_USER_KEYS: new Set(['dylan_collyge', 'jd_jones', 'megan_kelly']),
  EVAL_WORK_MANAGER_USERS: new Set(['dylan_collyge', 'megan_kelly', 'jd_jones']),
  EVAL_WORK_ASSIGNABLE_USERS: new Set(['jd_jones', 'megan_kelly', 'dylan_collyge']),
  resolveActiveSessionProfile: async () => harness.actor,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: harness.master, error: null }) }) }) }) },
});
vm.runInContext(compiled, context);

test('generic request creation uses the authorized request batch endpoint', () => {
  const denied = context.guard('ph_active_request', 'POST', { unique_id: 'spoofed', request_source: 'internal' });
  assert.equal(denied.status, 410);
  assert.equal(denied.code, 'REQUEST_BATCH_API_REQUIRED');
});

test('only the narrow internal move and Eval assignment row shapes pass the POST shape gate', () => {
  const move = {
    unique_id: 'move_req_BATCH_SOURCE_DEST', master_id: 'MASTER-1', commonname: 'Tree', contsize: '5 gal',
    locationcode: 'A1', lotcode: 'L1', itemcode: '000123', ptravailable: '10', priority: '', requested_by: 'Dylan',
    request_folder: 'Location Move BATCH', req_customer: 'Location Move', req_qty: '3', desired_spec: '', desired_caliper: '',
    req_reserve: 'NO', req_comments: '', req_archived: false, req_status: 'Pending', app_tab_assignment: 'moves', assignedto: 'dylan_collyge',
    move_batch_id: 'BATCH', move_approval_stage: 'dylan', move_status: 'pending_dylan', move_group_key: 'g',
    move_from_locationcode: 'A1', move_to_locationcode: 'B2', move_planned_qty: '3', move_actual_qty: null,
    move_destination_needs_row: false, move_dylan_approved_at: null, move_jd_approved_at: null, move_completed_at: null,
    move_completed_by: null, created_at: '2026-10-09T12:00:00.000Z',
  };
  const evalTask = {
    unique_id: 'EVAL-MASTER-1-JD-abc123', master_id: 'MASTER-1', commonname: 'Tree', contsize: '5 gal', locationcode: 'A1',
    lotcode: 'L1', itemcode: '000123', ptravailable: '10', season_supply: '', priority: '', qualitycode: '', field_tag_color: '',
    requested_by: 'jd_jones', request_folder: 'EVAL-JD-Task', req_customer: 'EVAL Task - Standard', req_qty: '', desired_spec: '',
    desired_caliper: '', request_note: 'Assigned', est_ship: 'ASAP', req_reserve: 'NO', req_match: null, req_spec: null,
    req_caliper: null, req_pic_note: null, req_comments: 'Review', av_note: null, req_photo_link: null, req_photo_name: null,
    req_archived: false, date_completed: null, req_status: 'Pending',
  };
  assert.equal(context.classify(move), 'move');
  assert.equal(context.classify(evalTask), 'eval');
  assert.equal(context.guard('ph_active_request', 'POST', move), null);
  assert.equal(context.guard('ph_active_request', 'POST', evalTask), null);
  assert.equal(context.stamp(move).request_source, 'internal');
  assert.equal(context.stamp(evalTask).request_source, 'internal');
  assert.equal(context.guard('ph_active_request', 'POST', [{ ...move }, { ...move, unique_id: 'MOVE2' }]).status, 410);
  assert.equal(context.guard('ph_active_request', 'POST', { ...move, customername: 'Spoofed customer' }).status, 410);
  assert.equal(context.guard('ph_active_request', 'POST', { ...move, request_source: 'internal' }).status, 410);
  assert.equal(context.guard('ph_active_request', 'POST', { ...move, move_status: 'approved' }).status, 410);
});

test('internal move and Eval POSTs require a live authorized actor and verified source row', async () => {
  const move = {
    unique_id: 'move_req_BATCH_SOURCE_DEST', master_id: 'MASTER-1', commonname: 'Tree', contsize: '5 gal',
    locationcode: 'A1', lotcode: 'L1', itemcode: '000123', ptravailable: '10', priority: '', requested_by: 'Dylan Collyge',
    request_folder: 'Location Move BATCH', req_customer: 'Location Move', req_qty: '3', desired_spec: '', desired_caliper: '',
    req_reserve: 'NO', req_comments: '', req_archived: false, req_status: 'Pending', app_tab_assignment: 'moves', assignedto: 'dylan_collyge',
    move_batch_id: 'BATCH', move_approval_stage: 'dylan', move_status: 'pending_dylan', move_group_key: 'g',
    move_from_locationcode: 'A1', move_to_locationcode: 'B2', move_planned_qty: '3', move_actual_qty: null,
    move_destination_needs_row: false, move_dylan_approved_at: null, move_jd_approved_at: null, move_completed_at: null,
    move_completed_by: null, created_at: '2026-10-09T12:00:00.000Z',
  };
  assert.equal(await context.authorize({}, move), null);
  assert.equal(context.stamp(move).request_source, 'internal');
  assert.equal(await context.authorize({}, { ...move, commonname: 'Tree®', contsize: '5 Gallon' }), null,
    'cached display formatting does not change the stable item/location/lot source identity');

  harness.actor = { username: 'rep_user', display_name: 'Rep User', role: 'REP' };
  assert.equal((await context.authorize({}, move)).status, 403);
  harness.actor = { username: 'amy_manager', display_name: 'Amy Manager', role: 'MANAGER' };

  const evalTask = {
    unique_id: 'EVAL-MASTER-1-JD-abc123', master_id: 'MASTER-1', commonname: 'Tree', contsize: '5 gal', locationcode: 'A1',
    lotcode: 'L1', itemcode: '000123', ptravailable: '10', season_supply: '', priority: '', qualitycode: '', field_tag_color: '',
    requested_by: 'jd_jones', request_folder: 'EVAL-JD-Task', req_customer: 'EVAL Task - Standard', req_qty: '', desired_spec: '',
    desired_caliper: '', request_note: 'Assigned', est_ship: 'ASAP', req_reserve: 'NO', req_match: null, req_spec: null,
    req_caliper: null, req_pic_note: null, req_comments: 'Review', av_note: null, req_photo_link: null, req_photo_name: null,
    req_archived: false, date_completed: null, req_status: 'Pending',
  };
  assert.equal((await context.authorize({}, evalTask)).status, 403);
  harness.actor = { username: 'jd_jones', display_name: 'JD Jones', role: 'ADMIN' };
  assert.equal(await context.authorize({}, evalTask), null);

  harness.master = { ...harness.master, locationcode: 'A9' };
  assert.equal((await context.authorize({}, move)).status, 409);
  harness.master = { ...harness.master, locationcode: 'A1', itemcode: '999123' };
  assert.equal((await context.authorize({}, move)).status, 409);
  harness.master = { ...harness.master, itemcode: '000123' };
  assert.equal((await context.authorize({}, { ...move, move_planned_qty: '' })).status, 409);
  assert.equal((await context.authorize({}, { ...move, move_planned_qty: '1,000' })).status, 409);
  harness.master = null;
  assert.equal((await context.authorize({}, evalTask)).status, 409);
});

test('the real manual-move payload has a compatible unique ID and an existing master ID', async () => {
  harness.actor = { username: 'dylan_collyge', display_name: 'Dylan Collyge', role: 'ADMIN' };
  harness.master = { unique_id: 'MASTER-1', itemcode: '000123', locationcode: 'A1', lotcode: 'L1', commonname: 'Tree', contsize: '5 gal' };
  const start = appSource.indexOf('        function getMoveRecordBatchId(');
  const end = appSource.indexOf('        function buildMoveApprovalRequestClone(', start);
  assert.ok(start >= 0 && end > start, 'manual move payload builder should exist');
  const builderContext = vm.createContext({
    MOVE_REQUEST_ASSIGNMENT: 'moves',
    MOVE_APPROVAL_STAGE_DYLAN: 'dylan',
    MOVE_STATUS_PENDING_DYLAN: 'pending_dylan',
    currentUserDisplay: 'Dylan Collyge',
    currentUser: 'dylan_collyge',
    firstNonEmptyValue: (...values) => values.find(value => value !== null && value !== undefined && String(value).trim() !== ''),
  });
  vm.runInContext(`${appSource.slice(start, end)}\nthis.buildPayload = buildMoveApprovalRequestPayload;`, builderContext);
  const payload = builderContext.buildPayload({
    id: 'direct-move-1', source_unique_id: 'MASTER-1', move_batch_id: 'BATCH-1',
    itemcode: '000123', commonname: 'Tree', contsize: '5 gal', lotcode: 'L1', ptravailable: '10',
    from_locationcode: 'A1', to_locationcode: 'B2', move_planned_qty: '3',
  });
  assert.match(payload.unique_id, /^move_req_[A-Z0-9_]{1,120}$/);
  assert.equal(payload.master_id, 'MASTER-1');
  assert.equal(context.classify(payload), 'move');
  assert.equal(await context.authorize({}, payload), null);
});

test('generic completion updates remain available but cannot change request source or customer membership', () => {
  assert.equal(context.guard('ph_active_request', 'PATCH', { req_status: 'Completed', completed_by_username: 'actor' }), null);
  assert.equal(context.guard('ph_active_request', 'PATCH', [{ request_source: 'internal' }]).status, 410);
  for (const field of [
    'request_source', 'customeridentityid', 'customername', 'consigneeidentityid', 'consigneename',
    'requested_by', 'request_selected_rep_username', 'request_selected_rep_display',
  ]) {
    const denied = context.guard('ph_active_request', 'PATCH', { [field.toUpperCase()]: 'spoofed' });
    assert.equal(denied.status, 410, `${field} should require the protected workflow`);
    assert.equal(denied.code, 'REQUEST_BATCH_API_REQUIRED');
  }
});

test('the guard leaves unrelated tables and request deletes unchanged', () => {
  assert.equal(context.guard('ph_active_request', 'DELETE', null), null);
  assert.equal(context.guard('ph_request_history', 'POST', { event: 'internal' }), null);
});
