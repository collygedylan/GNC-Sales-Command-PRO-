import { test, expect } from '@playwright/test';
// @test-group: @database,@local-e2e



const localUrl = String(process.env.SUPABASE_LOCAL_URL || '').replace(/\/$/, '');
const anonKey = String(process.env.SUPABASE_LOCAL_ANON_KEY || '');
const serviceKey = String(process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY || '');

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function createUser(email, password, username, role) {
  const existing = await jsonFetch(`${localUrl}/rest/v1/profiles?select=id&username=eq.${encodeURIComponent(username)}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
  });
  expect(existing.response.ok, JSON.stringify(existing.body)).toBeTruthy();
  for (const profile of existing.body || []) {
    const removed = await jsonFetch(`${localUrl}/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(removed.response.ok, JSON.stringify(removed.body)).toBeTruthy();
  }
  const created = await jsonFetch(`${localUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  expect(created.response.ok, JSON.stringify(created.body)).toBeTruthy();
  const userId = created.body.id;
  const profile = await jsonFetch(`${localUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({ id: userId, username, display_name: username, role })
  });
  expect(profile.response.ok, JSON.stringify(profile.body)).toBeTruthy();
  return { userId, email, password, username, role };
}

async function signIn(user) {
  const result = await jsonFetch(`${localUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  expect(result.response.ok, JSON.stringify(result.body)).toBeTruthy();
  return result.body.access_token;
}

async function rpc(name, token, payload) {
  return jsonFetch(`${localUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

test.describe('Drive-canonical request transactions', {"tag":["@database","@local-e2e"]}, () => {
  test.skip(!localUrl || !anonKey || !serviceKey, {"tag":["@database","@local-e2e"]}, 'Local Supabase environment is required.');

  test('roles, retries, History/outbox, push, assignments, and browser outbox', {"tag":["@database","@local-e2e"]}, async ({ page }) => {
    const suffix = Date.now().toString(36);
    const password = 'Request-test-2026!';
    const rep = await createUser(`rep_${suffix}@example.com`, password, `rep_${suffix}`, 'REP');
    const csr = await createUser(`csr_${suffix}@example.com`, password, `csr_${suffix}`, 'CSR');
    const evalUser = await createUser(`eval_${suffix}@example.com`, password, `eval_${suffix}`, 'EVAL');
    const evalRoster = await jsonFetch(`${localUrl}/rest/v1/ph_eval_assignment_users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({ username: evalUser.username, display_name: evalUser.username, active: true, source: 'request_integrity_local' })
    });
    expect(evalRoster.response.ok, JSON.stringify(evalRoster.body)).toBeTruthy();
    const dylan = await createUser(`dylan_${suffix}@example.com`, password, 'dylan_collyge', 'ADMIN');

    const masterId = `MASTER-${suffix}`;
    const itemcode = `ITEM-${suffix}`.toUpperCase();
    const master = await jsonFetch(`${localUrl}/rest/v1/ph_master_inventory`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ unique_id: masterId, itemcode, genusname: 'Test Genus', commonname: 'Canonical Drive Name', locationcode: 'A.01.001', ptravailable: '20', app_tab_assignment: 'location' })
    });
    expect(master.response.ok, JSON.stringify(master.body)).toBeTruthy();

    const legacyRequestId = `REQ-LEGACY-${suffix}`;
    const legacyComplete = await jsonFetch(`${localUrl}/rest/v1/ph_active_request`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        unique_id: legacyRequestId,
        master_id: masterId,
        requested_by: 'legacy_ci',
        request_folder: `LEGACY-${suffix}`,
        req_status: 'Complete',
        date_completed: new Date().toISOString(),
        req_photo_link: 'https://example.invalid/legacy-photo.jpg',
        req_photo_name: 'legacy-photo.jpg'
      })
    });
    expect(legacyComplete.response.ok, JSON.stringify(legacyComplete.body)).toBeTruthy();
    const legacyHistory = await jsonFetch(`${localUrl}/rest/v1/ph_request_history?select=last_event,delivery_state,snapshot&unique_id=eq.${encodeURIComponent(legacyRequestId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(legacyHistory.body[0].last_event).toBe('completed');
    expect(legacyHistory.body[0].delivery_state).toBe('pending');
    expect(legacyHistory.body[0].snapshot.req_photo_link).toContain('legacy-photo.jpg');
    const legacyOutbox = await jsonFetch(`${localUrl}/rest/v1/ph_request_delivery_outbox?select=status,event_type&request_id=eq.${encodeURIComponent(legacyRequestId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(legacyOutbox.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'suppressed', event_type: 'request_completed' })
    ]));

    const repToken = await signIn(rep);
    const repRequestId = `REQ-REP-${suffix}`;
    const repBatchId = crypto.randomUUID();
    const requestPayload = [{ unique_id: repRequestId, master_id: masterId, requested_by: rep.username, request_folder: `FOLDER-${suffix}`, req_customer: 'Test Customer', req_qty: '2' }];
    const avCreate = await rpc('create_av_request_batch', repToken, { client_batch_id: repBatchId, requests: requestPayload });
    expect(avCreate.response.ok, JSON.stringify(avCreate.body)).toBeTruthy();
    expect(avCreate.body.rows[0].commonname).toBe('Canonical Drive Name');

    const generalDenied = await rpc('create_request_batch', repToken, { client_batch_id: crypto.randomUUID(), requests: requestPayload.map((row) => ({ ...row, unique_id: `${row.unique_id}-DENIED` })) });
    expect(generalDenied.response.status).toBe(403);

    const avRetry = await rpc('create_av_request_batch', repToken, { client_batch_id: repBatchId, requests: requestPayload });
    expect(avRetry.response.ok).toBeTruthy();
    const countResult = await jsonFetch(`${localUrl}/rest/v1/ph_active_request?select=id&unique_id=eq.${encodeURIComponent(repRequestId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(countResult.body).toHaveLength(1);

    const csrToken = await signIn(csr);
    const csrRequestId = `REQ-CSR-${suffix}`;
    const csrCreate = await rpc('create_request_batch', csrToken, {
      client_batch_id: crypto.randomUUID(),
      requests: [{ ...requestPayload[0], unique_id: csrRequestId, requested_by: csr.username }]
    });
    expect(csrCreate.response.ok, JSON.stringify(csrCreate.body)).toBeTruthy();
    const complete = await rpc('save_request_work', csrToken, {
      request_id: csrRequestId,
      expected_version: 1,
      patch: { req_match: '50', req_spec: '24 IN', req_photo_link: 'https://example.invalid/photo.jpg', req_photo_name: 'photo.jpg', loc_match_qty: '10' },
      complete: true
    });
    expect(complete.response.ok, JSON.stringify(complete.body)).toBeTruthy();
    expect(complete.body.delivery_state).toBe('pending');

    const history = await jsonFetch(`${localUrl}/rest/v1/ph_request_history?select=last_event,snapshot&unique_id=eq.${encodeURIComponent(csrRequestId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(history.body[0].last_event).toBe('completed');
    expect(history.body[0].snapshot.req_photo_link).toContain('photo.jpg');

    const push = await rpc('upsert_my_push_subscription', csrToken, {
      subscription: { endpoint: `https://push.invalid/${suffix}`, keys: { p256dh: 'p256dh', auth: 'auth' }, device_label: 'CI browser' }
    });
    expect(push.response.ok, JSON.stringify(push.body)).toBeTruthy();

    const defaultOwnerResult = await jsonFetch(`${localUrl}/rest/v1/ph_itemcode_default_owners?select=revision&itemcode_normalized=eq.${encodeURIComponent(itemcode)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(defaultOwnerResult.response.ok, JSON.stringify(defaultOwnerResult.body)).toBeTruthy();
    expect(defaultOwnerResult.body).toEqual([]);
    const expectedRevision = 0;
    const assignmentChanges = [{ itemcode, assignedto: evalUser.username, expectedRevision }];
    const deniedAssignment = await rpc('set_itemcode_default_owners_v1', csrToken, {
      p_changes: assignmentChanges,
      p_request_id: crypto.randomUUID()
    });
    expect(deniedAssignment.response.status).toBe(403);
    const dylanToken = await signIn(dylan);
    const assignmentRequestId = crypto.randomUUID();
    const assignment = await rpc('set_itemcode_default_owners_v1', dylanToken, {
      p_changes: assignmentChanges,
      p_request_id: assignmentRequestId
    });
    expect(assignment.response.ok, JSON.stringify(assignment.body)).toBeTruthy();
    expect(assignment.body.contractVersion).toBe('inventory-row-assignments-v1');
    expect(assignment.body.defaults).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemcode: itemcode, assignedto: evalUser.username, revision: expectedRevision + 1 })
    ]));
    expect(assignment.body.assignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        master_unique_id: masterId,
        unique_id: masterId,
        itemcode_normalized: itemcode,
        locationcode: 'A.01.001',
        assignedto: evalUser.username,
        default_assignedto: evalUser.username
      })
    ]));
    const assignmentRetry = await rpc('set_itemcode_default_owners_v1', dylanToken, {
      p_changes: assignmentChanges,
      p_request_id: assignmentRequestId
    });
    expect(assignmentRetry.response.ok, JSON.stringify(assignmentRetry.body)).toBeTruthy();
    expect(assignmentRetry.body).toEqual(assignment.body);

    const exactAssignment = await jsonFetch(`${localUrl}/rest/v1/ph_inventory_row_assignments?select=master_unique_id,assignedto,default_assignedto,assignment_reason,locationcode&master_unique_id=eq.${encodeURIComponent(masterId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    expect(exactAssignment.response.ok, JSON.stringify(exactAssignment.body)).toBeTruthy();
    expect(exactAssignment.body).toEqual([
      expect.objectContaining({
        master_unique_id: masterId,
        assignedto: evalUser.username,
        default_assignedto: evalUser.username,
        assignment_reason: 'itemcode_default',
        locationcode: 'A.01.001'
      })
    ]);

    await page.goto('/');
    const browserBatchId = crypto.randomUUID();
    await page.evaluate(async ({ browserBatchId }) => {
      await window.saveRequestOutboxEntry({
        clientBatchId: browserBatchId,
        requestSource: 'av',
        requests: [{ unique_id: 'LOCAL-PENDING-1' }],
        createdAt: new Date().toISOString()
      });
    }, { browserBatchId });
    await page.reload();
    const pending = await page.evaluate(async () => window.getAllIndexedDbRecords(window.REQUEST_OUTBOX_STORE || 'request_outbox'));
    expect(pending.some((entry) => entry.clientBatchId === browserBatchId)).toBeTruthy();
  });
});
