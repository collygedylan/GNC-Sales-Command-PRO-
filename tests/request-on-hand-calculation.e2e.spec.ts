import { expect, test, type Page, type Route } from '@playwright/test';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

const USER = 'request_quantity_fixture';
const MASTER_ID = 'request-quantity-master';
const REQUEST_ID = 'request-quantity-row';
const date = new Date().toISOString().slice(0, 10);
const PHOTO = `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${date}_request.webp`;
const profile = { id: '00000000-0000-4000-8000-000000000041', username: USER,
  display_name: 'Request Quantity Fixture', role: 'ADMIN', division: '10', language: 'English',
  disabled_at: null, locked_until: null, must_change_password: false, passkey_pilot: false };

function sdkSession() {
  const claims = { sub: profile.id, aud: 'authenticated', role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic-signature'].join('.');
  return { access_token: token, refresh_token: 'synthetic-request-quantity-refresh', expires_at: claims.exp,
    expires_in: 3600, token_type: 'bearer', user: { id: profile.id, aud: 'authenticated', role: 'authenticated',
      email: `${USER}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}

async function fixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const master = inventoryReadFixture.row({ unique_id: MASTER_ID, itemcode: 'QTY1001',
    commonname: 'Request Quantity Plant', contsize: '#3', season: 'F1', saleyear: '27',
    warehouseid: '10', warehousei: '10', blockalpha: 'A', locationcode: 'A001', lotcode: '27.F1',
    ptronhand: '1000', ptrreviewed: '50', ptravailable: '800', s_lts: '600', priority: '1',
    last_updated: new Date().toISOString(), source: 'INVENTORY', initial_ptr: '1200',
    match: '95', spec: 'Master-owned spec', av_note: 'Master-owned note' });
  // Match the Request live view: On Hand/Review are absent, availability can be
  // null on a legacy request, and Request-owned evidence remains independent.
  const request = { unique_id: REQUEST_ID, master_id: MASTER_ID, itemcode: 'QTY1001',
    commonname: 'Request Quantity Plant', contsize: '#3', locationcode: 'A001', lotcode: '27.F1',
    ptravailable: null, initial_ptr: '900', req_qty: '40', req_match: '50',
    req_spec: 'Request-owned spec', req_caliper: '2 inch', av_note: 'Request-owned note',
    request_note: 'Customer instructions', req_photo_link: PHOTO, req_photo_name: `${date}_request.webp`,
    requested_by: 'Request Quantity Fixture', request_folder: 'QUANTITY-FIXTURE', req_customer: 'Synthetic Customer',
    req_status: 'Pending', req_archived: false, app_tab_assignment: 'location', date_completed: null };
  const state = { errors: [] as string[], exactReads: 0, listReads: 0,
    runtime: [] as string[], blockedWrites: [] as string[] };
  const json = (route: Route, data: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
    status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] || 'authorization,apikey,content-type,x-client-info,prefer,range',
      'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(data) });
  const read = (table: string, query: string) => {
    if (table === 'ph_master_inventory') {
      const params = new URLSearchParams(query);
      let rows = [master];
      // Apply the exact item-code/size and common-name lookup filters used by
      // Request alternatives before the strict SELECT/ID boundary.
      for (const field of ['itemcode', 'contsize']) {
        if (!params.has(field)) continue;
        const filter = params.get(field)!;
        if (!filter.startsWith('eq.') || params.getAll(field).length !== 1) throw new Error(`Unsupported Request fixture ${field} filter`);
        rows = rows.filter(row => row[field] === filter.slice(3));
        params.delete(field);
      }
      if (params.has('commonname')) {
        const filter = params.get('commonname')!;
        if (!/^ilike\.[a-z0-9 *-]+$/i.test(filter) || params.getAll('commonname').length !== 1) throw new Error('Unsupported Request fixture commonname filter');
        const pattern = new RegExp('^' + filter.slice(6).split('*').map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
        rows = rows.filter(row => pattern.test(String(row.commonname || '')));
        params.delete('commonname');
      }
      const result = inventoryReadFixture.read(rows, params.toString());
      if (result.exact) state.exactReads++; else state.listReads++;
      return result.rows;
    }
    if (/^ph_active_request(?:_live_rows)?$/.test(table)) return [request];
    if (table === 'ph_app_settings') return [{ key: 'current_season_salesyear',
      value: { seasonCode: 'F1', salesYear: 27 }, updated_at: new Date().toISOString() }];
    return [];
  };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) state.runtime.push(response.url());
  });
  await page.addLocatorHandler(page.locator('#push-permission-help-modal'), async modal => {
    await modal.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin === origin && ['GET', 'HEAD'].includes(method)) return route.continue();
    if (method === 'OPTIONS') return json(route, {});
    if (url.pathname === '/auth/v1/user' && method === 'GET') return json(route, sdkSession().user);
    if (url.pathname === '/auth/v1/token') return json(route, sdkSession());
    if (url.pathname.startsWith('/storage/v1/') && method === 'GET') return route.fulfill({
      contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6E8AAAAASUVORK5CYII=', 'base64') });
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const operation = url.pathname.split('/').pop()!;
      const body = req.postDataJSON() || {};
      if (operation === 'get_my_app_permissions_v1') return json(route, {
        contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: USER, role: 'ADMIN',
        permissions: ['home', 'drive', 'av', 'request'].map(key => ({
          permissionKey: `module.${key}.view`, kind: 'module', moduleKey: key, allowed: true, scope: 'global' })) });
      if (operation === 'get_request_capabilities') return json(route, { contract_version: 2, username: USER,
        scope: 'global', can_view_queue: true, can_take_photo: true, can_edit: true, can_complete: true,
        can_archive: true, can_create_general: true, can_create_av: true });
      if (operation === 'get_my_dataset_revisions_v1') return json(route, { contractVersion: 1,
        permissionVersion: 'quantity-fixture-permission', serverTime: new Date().toISOString(),
        sources: (body.p_dataset_keys || []).map((key: string) => ({ key, revision: '1', state: 'ready' })) });
      if (operation === 'report_app_health_event') return json(route, { ok: true });
      if (/^(get_|list_|search_)/.test(operation)) return json(route, []);
      state.blockedWrites.push(`RPC:${operation}`);
      return json(route, { error: 'Business writes blocked by Request quantity fixture' }, 403);
    }
    if (url.pathname.startsWith('/rest/v1/') && ['GET', 'HEAD'].includes(method)) {
      const table = url.pathname.split('/').pop()!;
      if (table === 'profiles') return json(route, /vnd\.pgrst\.object/.test(req.headers().accept || '') ? profile : [profile]);
      const rows = read(table, url.search);
      return json(route, rows, 200, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
    }
    if (url.pathname.endsWith('/functions/v1/app-api')) {
      const body = req.postDataJSON() || {};
      if (body.action === 'native_session_bridge') return json(route, { ok: true, session: {
        token: 'synthetic-quantity-bridge', expiresAt: Date.now() + 3600000, username: USER,
        displayName: profile.display_name, role: 'ADMIN' } });
      if (body.action === 'db' && body.method === 'GET') return json(route, { ok: true, data: read(body.table, body.query || '') });
      if (body.action === 'season_sales_office' && body.operation === 'access') return json(route, { ok: true, allowed: true, canManage: true, users: [] });
      if (['eval_work', 'shear_location_work', 'location_work', 'dock_trip_status'].includes(body.action)
        && ['list', 'get', 'state'].includes(body.operation || 'list')) return json(route, { ok: true, data: [], manager: true });
      if (/get|load|state|status|preferences|capabilit|health|diagnostic|telemetry|event/.test(String(body.action || ''))) return json(route, { ok: true, eligible: false, data: [], preferences: {} });
      state.blockedWrites.push(`API:${body.action}:${body.operation || body.method || ''}`);
      return json(route, { ok: false, error: 'Business writes blocked by Request quantity fixture' }, 403);
    }
    if (!['GET', 'HEAD'].includes(method)) state.blockedWrites.push(`${method}:${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(value => localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(value)), sdkSession());
  await page.goto('/?request_quantity_fixture=1', { waitUntil: 'load' });
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();
  expect(state.runtime.length, 'exercise the generated compiled runtime').toBeGreaterThan(0);
  return { state, request };
}

test('Request detail shows verified On Hand and calculates LOC MATCH from Available', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await page.evaluate(() => (window as any).switchView('request'));
  await expect(page.locator('#view-request')).toBeVisible();
  await expect.poll(() => page.evaluate(id => window.eval(`requestsInventory.some(row=>row.UNIQUE_ID===${JSON.stringify(id)})`), REQUEST_ID)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.eval(`getDatasetState('master').listProjectionVersion`))).toBe('master-list-v1');
  await expect(page.locator('#view-request')).toHaveAttribute('data-verified', 'current');
  // Start the editor with precisely the Request-owned payload returned by its
  // live view. This also proves exact detail can restore quantities independently
  // of the opportunistic master-list merge that may have completed first.
  const opened = await page.evaluate(raw => {
    (window as any).__requestQuantityRaw = raw;
    return window.eval(`(() => {
      const row=formatFetchedRows([window.__requestQuantityRaw],'ph_active_request')[0];
      row.DOM_ID='req_'+row.UNIQUE_ID;
      requestsInventory=requestsInventory.map(existing=>existing.UNIQUE_ID===row.UNIQUE_ID?row:existing);
      rebuildRequestInventoryIndexes();
      openDetail(row.UNIQUE_ID,'request',{preferredTab:'request'});
      return {lookup:!!findRequestRowByUniqueId(row.UNIQUE_ID), currentView:getCurrentVisibleViewId(),
        activeId:activeItem?.UNIQUE_ID, status:productionMasterDetailSession?.status,
        error:productionMasterDetailSession?.error};
    })()`);
  }, f.request);
  await test.info().attach('request-detail-open', {contentType:'application/json',body:JSON.stringify(opened)});
  await expect(page.locator('#view-detail')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.eval(`productionMasterDetailSession?.status`))).toBe('ready');
  await expect.poll(() => f.state.exactReads).toBeGreaterThan(0);
  const info = page.locator('#request-open-info-modal');
  await expect(info).toBeVisible();
  await expect(info.locator('.request-open-info-cell').filter({ hasText: /^On hand/ })).toContainText('1000');
  await expect(info.locator('.request-open-info-cell').filter({ hasText: /^Available/ })).toContainText('800');
  await info.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(info).toBeHidden();
  const panel = page.locator('#det-request-desired-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.request-desired-chip').filter({ hasText: 'On hand' })).toContainText('1000');
  await expect(page.locator('#req-match')).toBeEditable();
  await page.locator('#req-match').fill('60');
  await expect(page.locator('#req-match-qty-val')).toHaveText('440');
  expect(await page.evaluate(() => window.eval(`({
    available:activeItem.PTRAVAILABLE,onHand:activeItem.PTRONHAND,baseline:activeItem.INITIAL_PTR,
    spec:activeItem.REQ_SPEC,note:activeItem.AV_NOTE,photo:activeItem.REQ_PHOTO_LINK,
    id:activeItem.UNIQUE_ID,masterId:activeItem.MASTER_ID
  })`))).toEqual({ available: '800', onHand: '1000', baseline: '900', spec: 'Request-owned spec',
    note: 'Request-owned note', photo: PHOTO, id: REQUEST_ID, masterId: MASTER_ID });
  expect(f.state.errors).toEqual([]);
  // Normal input autosave may be attempted; every external mutation is fulfilled
  // with a local rejection above. No request is forwarded to a business service.
});
