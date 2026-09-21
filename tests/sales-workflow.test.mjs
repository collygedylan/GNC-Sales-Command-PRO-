import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSalesEnvelope, decodeCreditPhoto, handleSalesWorkflow, SALES_CREDIT_BUCKET } from '../supabase/functions/_shared/sales-workflow.ts';

const actorId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const session = { ver: 2, authUserId: actorId, username: 'sales_rep', displayName: 'Sales Rep', role: 'REP', mustChangePassword: false, iat: 1, exp: 9999999999 };
const bytes = new Uint8Array([255, 216, 255, 224, 1, 2, 3]);
const base64 = Buffer.from(bytes).toString('base64');
const photoPayload = { sourceId, mime: 'image/jpeg', base64 };

test('envelopes accept paginated history and reject client actors and missing mutation IDs', () => {
  assert.equal(validateSalesEnvelope({ action: 'request_history', operation: 'folders', payload: { status: 'completed', cursor: { key: 'x' } } }).operation, 'folders');
  assert.throws(() => validateSalesEnvelope({ action: 'sales_credit', operation: 'submit', payload: {}, actorId }), /PAYLOAD_INVALID/);
  assert.throws(() => validateSalesEnvelope({ action: 'sales_credit', operation: 'submit', payload: {} }), /COMMAND_ID_REQUIRED/);
  assert.throws(() => validateSalesEnvelope({ action: 'sales_credit', operation: 'review_line', commandId, expectedRevision: -1 }), /REVISION_INVALID/);
  assert.throws(() => validateSalesEnvelope({ action: 'sales_credit', operation: 'attachment_finish', payload: {} }), /OPERATION_INVALID/);
});

test('evidence rejects MIME forgery, malformed base64, SVG, and empty data', () => {
  assert.equal(decodeCreditPhoto(photoPayload).mime, 'image/jpeg');
  assert.throws(() => decodeCreditPhoto({ ...photoPayload, mime: 'image/png' }), /ENCODING_INVALID/);
  assert.throws(() => decodeCreditPhoto({ ...photoPayload, base64: '%not base64' }), /PHOTO_INVALID/);
  assert.throws(() => decodeCreditPhoto({ mime: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64') }), /ENCODING_INVALID/);
  assert.throws(() => decodeCreditPhoto({ mime: 'image/jpeg', base64: '' }), /PHOTO_INVALID/);
});

test('unauthenticated requests never resolve a profile or call the database', async () => {
  const response = await handleSalesWorkflow({ session: null, payload: { action: 'request_history' }, supabase: {}, resolveActiveSessionProfile: () => { throw new Error('must not run'); } });
  assert.equal(response.status, 401);
});

test('request history uses the fresh trusted profile actor and forwards keyset pagination', async () => {
  let received;
  const response = await handleSalesWorkflow({ session, payload: { action: 'request_history', operation: 'search', payload: { query: ' hydrangea ', cursor: { at: '2026-09-01T00:00:00Z', id: 'r9' } } },
    resolveActiveSessionProfile: async () => ({ id: actorId }), supabase: { rpc: async (name, args) => { received = { name, args }; return { data: { rows: [], nextCursor: null } }; } } });
  assert.equal(response.status, 200);
  assert.equal(received.name, 'request_history_command_v1');
  assert.equal(received.args.p_actor_id, actorId);
  assert.equal(received.args.p_payload.cursor.id, 'r9');
});

function uploadHarness({ uploadError = false, existingBytes = bytes } = {}) {
  const operations = [];
  let reserved;
  const supabase = {
    rpc: async (name, args) => {
      operations.push(args.p_operation);
      assert.equal(name, 'sales_credit_attachment_v1');
      assert.equal(args.p_actor_id, actorId);
      if (args.p_operation === 'reserve') {
        reserved = args.p_payload;
        return { data: { id: commandId, object_path: `${actorId}/${commandId}.jpg` } };
      }
      return { data: { id: commandId, source_id: sourceId, mime: 'image/jpeg', byte_count: bytes.length } };
    },
    storage: { from: (bucket) => {
      assert.equal(bucket, SALES_CREDIT_BUCKET);
      return {
        upload: async (_path, content, options) => { assert.equal(options.upsert, false); assert.deepEqual(content, bytes); return { error: uploadError ? { message: 'already exists or interrupted' } : null }; },
        download: async () => ({ data: new Blob([existingBytes]) }),
      };
    } },
  };
  return { supabase, operations, reserved: () => reserved };
}

test('uploads use immutable private evidence and commit only after upload succeeds', async () => {
  const harness = uploadHarness();
  const response = await handleSalesWorkflow({ session, payload: { action: 'sales_credit', operation: 'attachment_upload', commandId, payload: photoPayload }, supabase: harness.supabase, resolveActiveSessionProfile: async () => ({ id: actorId }) });
  assert.equal(response.status, 200);
  assert.deepEqual(harness.operations, ['reserve', 'finish']);
  assert.equal(harness.reserved().id, commandId);
  assert.match(harness.reserved().sha256, /^[0-9a-f]{64}$/);
  assert.equal((await response.json()).data.attachmentId, commandId);
});

test('lost upload acknowledgements reuse the exact object after verifying its checksum', async () => {
  const harness = uploadHarness({ uploadError: true });
  const response = await handleSalesWorkflow({ session, payload: { action: 'sales_credit', operation: 'attachment_upload', commandId, payload: photoPayload }, supabase: harness.supabase, resolveActiveSessionProfile: async () => ({ id: actorId }) });
  assert.equal(response.status, 200);
  assert.deepEqual(harness.operations, ['reserve', 'finish']);
});

test('mismatched existing object remains uncommitted and the caller retains its photo', async () => {
  const harness = uploadHarness({ uploadError: true, existingBytes: new Uint8Array([1, 2, 3]) });
  const response = await handleSalesWorkflow({ session, payload: { action: 'sales_credit', operation: 'attachment_upload', commandId, payload: photoPayload }, supabase: harness.supabase, resolveActiveSessionProfile: async () => ({ id: actorId }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).code, /RETRY_SAME_PHOTO/);
  assert.deepEqual(harness.operations, ['reserve']);
});

test('unauthorized attachment download never signs a storage URL', async () => {
  let signed = false;
  const response = await handleSalesWorkflow({ session, payload: { action: 'sales_credit', operation: 'attachment_download', payload: { id: commandId } }, resolveActiveSessionProfile: async () => ({ id: actorId }),
    supabase: { rpc: async () => ({ error: { code: '42501', message: 'CREDIT_ATTACHMENT_FORBIDDEN' } }), storage: { from: () => { signed = true; return {}; } } } });
  assert.equal(response.status, 403);
  assert.equal(signed, false);
});

test('stale reviews return a conflict rather than a success acknowledgement', async () => {
  const response = await handleSalesWorkflow({ session, payload: { action: 'sales_credit', operation: 'review_line', commandId, expectedRevision: 2, payload: { lineId: commandId, decision: 'approved' } },
    resolveActiveSessionProfile: async () => ({ id: actorId }), supabase: { rpc: async () => ({ error: { message: 'CREDIT_REVISION_CONFLICT' } }) } });
  assert.equal(response.status, 409);
});

test('background refresh preserves expanded drafts and does not detach unchanged controls', async () => {
  const { JSDOM } = await import('jsdom');
  const { readFileSync } = await import('node:fs');
  const dom = new JSDOM('<div id="sales-credit-content"></div>', { url: 'https://test.invalid', runScripts: 'outside-only' });
  const w = dom.window;
  let count = 1;
  const calls = [];
  Object.assign(w, { currentUser: 'rep', APP_API_FUNCTION_URL: '/api', getCurrentVisibleViewId: () => 'sales-credit',
    postAppFunctionJson: async (_url, request) => {
      calls.push(request.operation);
      return { ok: true, data: request.operation === 'drafts' ? { drafts: [{ id: commandId, label: 'Saved customer' }] }
        : { folders: [{ customerKey: 'customer', label: 'Customer', count }] } };
    } });
  w.eval(readFileSync(new URL('../assets/sales-workspace.js', import.meta.url), 'utf8'));
  try {
    await w.SalesWorkspace.open('sales-credit');
    const disclosure = w.document.querySelector('details'); disclosure.open = true;
    const control = disclosure.querySelector('button');
    w.SalesWorkspace.applyRefresh(await w.SalesWorkspace.stageRefresh());
    assert.equal(w.document.querySelector('details button'), control);
    assert.equal(disclosure.open, true);
    const reads = calls.length;
    await w.SalesWorkspace.open('sales-credit');
    assert.equal(calls.length, reads, 'painting an already loaded view must not reload it');
    assert.equal(w.document.querySelector('details').open, true);
    count = 2;
    w.SalesWorkspace.applyRefresh(await w.SalesWorkspace.stageRefresh());
    assert.equal(w.document.querySelector('details').open, true, 'changed records retain the expanded draft list');
    assert.match(w.document.getElementById('sales-credit-content').textContent, /2 records/);
  } finally { dom.window.close(); }
});
