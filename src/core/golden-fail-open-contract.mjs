import assert from 'node:assert/strict';

export async function assertAuthenticatedTransientGateway(runFunctions) {
  const context = runFunctions('supabase/functions/app-api/index.ts', [
    'escapedDisplayTextFieldKey', 'normalizeEscapedDisplayText', 'escapedDisplayTextJsonReplacer',
    'jsonResponse', 'transientOkResponse', 'failOpenInventoryConflict'
  ], {
    Response, corsHeaders: {}, JSON, ESCAPED_DISPLAY_TEXT_FIELDS:new Set(['commonname']),
  });
  const roles = ['admin', 'sales_rep', 'supervisor', 'evaluator', 'kier', 'dock_office', 'qc_supervisor', 'shipping', 'data_entry', 'foreman', 'take_backs'];
  const actions = ['user_access', 'native_session_bridge', 'season_sales_office', 'dataset_read', 'av_read', 'customer-rep-map', 'aura_inventory_v2', 'report_read_v2', 'inventory_read', 'drive_reclass_inquiry', 'inventory_reclass_move'];
  const forbidden = new Set([401, 403, 409, 423]);
  for (const role of roles) for (const action of actions) {
    const response = context.transientOkResponse('RETAINED_READY', 'Last-known-good data retained.', { role, action });
    assert.equal(response.status, 200, `${role}:${action}`);
    assert.equal(forbidden.has(response.status), false, `${role}:${action}`);
  }
  const conflict = await context.failOpenInventoryConflict(new Response(JSON.stringify({ code: 'LOC_ON_HAND_REVISION_CHANGED' }), { status: 409 }));
  assert.equal(conflict.status, 200);
  assert.equal((await conflict.json()).data.revisionChanged, true);
}
