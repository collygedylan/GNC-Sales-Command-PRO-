// @test-group: inventory
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { captureInventoryLocationRevision, enrichInventoryLocationRows } from '../supabase/functions/_shared/inventory-location-on-hand.ts';

const source = fs.readFileSync(new URL('../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function handleManagerReportReadAction(');
const end = source.indexOf('type LivePilotFeatureKey', start);
assert.ok(start >= 0 && end > start);
const helpers = source.slice(source.indexOf('async function captureReadyInventoryLocationRevision('), source.indexOf('function ensureServerConfig('));
const code = ts.transpileModule(helpers + source.slice(start, end).replace('export async', 'async'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness({ error = '', readable = true, race = false } = {}) {
  const calls = [];
  const rows = [{ unique_id:'r1', itemcode:'001973.030.1', locationcode:'I.12.000' }];
  const request = {};
  for (const method of ['in', 'like', 'order', 'eq']) request[method] = () => request;
  request.range = async () => ({ data:rows, count:1, error:null });
  const context = vm.createContext({
    Error, captureInventoryLocationRevision, enrichInventoryLocationRows,
    normalizeUsername: value => String(value).toLowerCase(),
    resolveActiveSessionProfile: async session => session.profile,
    hasTableReadAccess: () => readable,
    INVENTORY_NCR_FIRST_STAGE_USERS: new Set(['dylan_collyge']),
    INVENTORY_NCR_JD_STAGE_USERS: new Set(),
    MANAGER_APPROVAL_VIEW_TYPES: { 'recount-approvals':'recount' },
    MANAGER_NOT_ON_INVENTORY_APPROVAL_VIEW:'not-on-inventory-approvals',
    INVENTORY_NOT_ON_INVENTORY_ASSIGNMENTS: new Set(),
    INVENTORY_NCR_QUEUE_FIELDS:'unique_id,itemcode,locationcode',
    inventoryActorQueueAssignments: () => ['ncr_approval_recount_dylan'],
    inventoryReadQuery: () => request,
    projectInventoryRows: data => data || [],
    jsonValue: value => value,
    jsonResponse: body => ({ status:200, body }),
    errorResponse: (message, status, details = {}) => ({ status, body:{ message, ...details } }),
    supabase:{
      from: () => ({ select:() => ({ eq:() => ({ maybeSingle:async () => ({ data:{ revision:12, state:'ready' } }) }) }) }),
      rpc:async (name, args) => {
        calls.push([name,args]);
        if (name === 'manager_report_read_v2') return { error:{ message:error } };
        assert.equal(name, 'inventory_location_on_hand_read_v1');
        if (race && args.p_expected_revision) return { error:{ message:'LOC_ON_HAND_REVISION_CHANGED' } };
        return { error:null, data:{ inventoryRevision:'12', rows:args.p_pairs.map(pair => ({ ...pair, loc_on_hand:2000, loc_on_hand_revision:'12' })) } };
      },
    },
  });
  vm.runInContext(code, context);
  const session = { profile:{ id:'actor-id', username:'dylan_collyge', role:'ADMIN' } };
  return { calls, read:query => context.handleManagerReportReadAction(session, { action:'report_read_v2', query }) };
}

test('Manager source readiness and revision failures retain the existing retry codes', async () => {
  for (const surface of ['assigned-items','eval1']) {
    for (const [error, status, code] of [
      ['LOC_ON_HAND_SOURCE_NOT_READY',423,'DATASET_NOT_READY'],
      ['LOC_ON_HAND_REVISION_CHANGED',409,'MANAGER_REPORT_SOURCE_REVISION_CHANGED'],
    ]) {
      const result = await harness({ error }).read({ surface, operation:'rows' });
      assert.equal(result.status,status);
      assert.equal(result.body.code,code);
      assert.equal(result.body.retryable,false);
      assert.equal(result.body.source,'ph_master_inventory');
    }
  }
});

test('Manager approval cards enrich only authorized rows and fence inventory revisions', async () => {
  const query = { surface:'approval', operation:'rows', filters:{ approvalTab:'recount-approvals' } };
  const fixture = harness();
  const result = await fixture.read(query);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.data.rows[0].loc_on_hand,2000);
  assert.equal(result.body.data.rows[0].loc_on_hand_revision,'12');
  assert.equal(result.body.data.inventoryRevision,'12');
  assert.equal(fixture.calls[1][1].p_actor_id,'actor-id');
  const denied = harness({ readable:false });
  assert.equal((await denied.read(query)).status,403);
  assert.equal(denied.calls.length,0);
  const changed = await harness({ race:true }).read(query);
  assert.equal(changed.status,409);
  assert.equal(changed.body.code,'MANAGER_REPORT_SOURCE_REVISION_CHANGED');
});
