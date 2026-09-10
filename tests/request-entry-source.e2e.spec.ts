import { expect, test, type Page, type Route } from '@playwright/test';
import { inventoryReadFixture } from './fixtures/inventory-list-read-fixture.mjs';

// Authentication and server responses are synthetic. The built shell's access
// checks, inventory loaders, detail navigation, modal and submission run unchanged.
const USER = 'tony_bono';
const UID = 'request-entry-master-fixture';
const PERSON = { id: '98000000-0000-4000-8000-000000000010', username: USER,
  display_name: 'Tony Bono', role: 'REP', division: '10', language: 'English',
  disabled_at: null, locked_until: null, must_change_password: false, passkey_pilot: false };
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const diagnostics = new WeakMap<Page, unknown>();

test.afterEach(async ({ page }, info) => {
  if (!diagnostics.has(page)) return;
  const browser = await page.evaluate(() => ({ toasts: (window as any).__entryToasts,
    failures: (window as any).__entryFailures })).catch(error => ({ error: String(error) }));
  await info.attach('request-entry-evidence', { contentType: 'application/json',
    body: JSON.stringify({ network: diagnostics.get(page), browser }, null, 2) });
});

function session() {
  const claims = { sub: PERSON.id, aud: 'authenticated', role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic-signature'].join('.');
  return { access_token: token, refresh_token: 'synthetic-entry-refresh', expires_at: claims.exp,
    expires_in: 3600, token_type: 'bearer', user: { id: PERSON.id, aud: 'authenticated', role: 'authenticated',
      email: 'tony-fixture@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}

async function fixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const master = inventoryReadFixture.row({ unique_id: UID, itemcode: 'SYNTH.030.1',
    commonname: 'Synthetic Request Holly', contsize: '#3', locationcode: 'F.10.000', lotcode: '27.F1',
    source: 'LD', season: 'F1', saleyear: '27', warehouseid: '10', warehousei: '10',
    ptronhand: '42', ptravailable: '42', s_lts: '42', a_lts: '42', si_lts: '42', ai_lts: '42',
    last_updated: '2026-09-10T12:00:00Z', photo_link: '', photo_name: '', spec: '', caliper: '', match: '', av_note: '', holdstopcode: '' });
  const state = { commits: [] as { operation: string; body: any }[], rows: [] as any[],
    errors: [] as string[], unexpectedWrites: [] as string[], runtime: [] as string[], exactReads: 0 };
  diagnostics.set(page, state);
  const json = (route: Route, value: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
    status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] || '*',
      'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(value) });
  const readTable = (table: string, query = '') => {
    if (table === 'ph_master_inventory') {
      const params = new URLSearchParams(query);
      let source = [master];
      for (const key of ['itemcode', 'commonname', 'contsize']) {
        const filter = params.get(key);
        if (!filter) continue;
        if (filter.startsWith('eq.')) source = source.filter(row => String(row[key]) === filter.slice(3).replace(/^"|"$/g, ''));
        else if (key === 'commonname' && filter.startsWith('ilike.')) {
          const words = filter.slice(6).split('*').filter(Boolean).map(word => word.toLowerCase());
          source = source.filter(row => words.every(word => String(row[key]).toLowerCase().includes(word)));
        } else throw new Error(`Unsupported fixture filter: ${key}=${filter}`);
        params.delete(key);
      }
      const result = inventoryReadFixture.read(source, params.toString());
      if (result.exact) state.exactReads++;
      return result.rows;
    }
    if (['ph_active_request', 'ph_active_request_live_rows', 'ph_request_queue_live_rows'].includes(table)) return state.rows;
    if (table === 'ph_app_settings') return [{ key: 'current_season_salesyear', value: { seasonCode: 'F1', salesYear: 27 } }];
    return [];
  };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) state.runtime.push(response.url());
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === origin && readMethods.has(method)) return route.continue();
    if (method === 'OPTIONS') return json(route, {});
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user') && method === 'GET') return json(route, session().user);
      if (url.pathname.endsWith('/token')) return json(route, session());
      return json(route, {}, 404);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const operation = url.pathname.split('/').pop()!, body = request.postDataJSON() || {};
      if (operation === 'get_my_app_permissions_v1') return json(route, {
        contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: USER, role: PERSON.role,
        permissions: ['home', 'drive', 'av', 'request', 'hours'].map(key => ({ permissionKey: `module.${key}.view`,
          kind: 'module', moduleKey: key, allowed: true, scope: 'rep' })) });
      if (operation === 'get_request_capabilities') return json(route, { contract_version: 2, username: USER,
        scope: 'rep', can_view_queue: true, can_take_photo: true, can_edit: true, can_complete: true,
        can_archive: false, can_create_general: false, can_create_av: true });
      if (operation === 'get_my_dataset_revisions_v1') return json(route, { contractVersion: 1,
        permissionVersion: 'request-entry-policy-1', sources: (body.p_dataset_keys || []).map((key: string) => ({ key, revision: '1', state: 'ready' })) });
      if (operation === 'get_request_schema_compatibility') return json(route, { compatible: true, contract_version: 2 });
      if (['create_av_request_batch', 'create_request_batch'].includes(operation)) {
        state.commits.push({ operation, body: structuredClone(body) });
        if (operation !== 'create_av_request_batch' || !body.requests?.length || body.requests.some((row: any) => row.request_source !== 'av' || row.master_id !== UID)) {
          state.unexpectedWrites.push(`Invalid ${operation}`); return json(route, { message: 'REQUEST_CREATE_FORBIDDEN' }, 403);
        }
        state.rows = body.requests.map((row: any) => ({ ...row, row_version: 1, updated_at: new Date().toISOString() }));
        return json(route, { ok: true, rows: state.rows });
      }
      if (operation === 'report_app_health_event') return json(route, { ok: true });
      if (/^(get_|list_|search_)/.test(operation)) return json(route, []);
      state.unexpectedWrites.push(`RPC ${operation}`); return json(route, {}, 403);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()!;
      if (!readMethods.has(method)) { state.unexpectedWrites.push(`${method} ${table}`); return json(route, {}, 403); }
      if (table === 'profiles') return json(route, /vnd\.pgrst\.object/.test(request.headers().accept || '') ? PERSON : [PERSON]);
      const rows = readTable(table, url.searchParams.toString());
      return json(route, rows, 200, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
    }
    if (url.pathname.endsWith('/functions/v1/app-api')) {
      const body = request.postDataJSON() || {};
      if (body.action === 'native_session_bridge') return json(route, { ok: true, session: { token: 'synthetic-entry-bridge',
        expiresAt: Date.now() + 3600000, username: USER, displayName: PERSON.display_name, role: PERSON.role } });
      if (body.action === 'db' && String(body.method).toUpperCase() === 'GET') return json(route, { ok: true, data: readTable(body.table, body.query) });
      if (body.action === 'season_sales_office' && body.operation === 'access') return json(route, { ok: true, allowed: false, canManage: false, users: [] });
      if (['eval_work', 'shear_location_work', 'location_work', 'dock_trip_status'].includes(body.action)
        && ['list', 'get', 'state'].includes(body.operation || 'list')) return json(route, { ok: true, data: [], manager: false });
      if (/get|load|state|status|preferences|capabilit|health|diagnostic|telemetry|event/.test(String(body.action || ''))) return json(route, { ok: true, eligible: false, data: [], preferences: {} });
      state.unexpectedWrites.push(`API ${body.action}:${body.operation || body.method || ''}`); return json(route, {}, 403);
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(value => localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(value)), session());
  await page.addLocatorHandler(page.locator('#push-permission-help-modal'), async modal => modal.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click'));
  await page.addLocatorHandler(page.locator('#mobile-push-enable-prompt'), async prompt => prompt.getByRole('button', { name: 'Dismiss', exact: true }).dispatchEvent('click'));
  await page.goto('/?request-entry-source-fixture=1', { waitUntil: 'load' });
  await expect(page.locator('#view-home')).toBeVisible();
  expect(state.runtime.length, 'The test must execute the compiled runtime').toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window as any, original = w.showToast;
    w.__entryToasts = [];
    w.__entryFailures = [];
    w.showToast = function (...args: any[]) { w.__entryToasts.push(args); return original.apply(this, args); };
    const guard = w.guardProductionDataCommand;
    w.guardProductionDataCommand = function (...args: any[]) {
      try { return guard.apply(this, args); }
      catch (error: any) {
        w.__entryFailures.push({ boundary: 'command', command: args[0], code: error.code, message: error.message,
          ...window.eval(`({ view:getCurrentVisibleViewId(), master:canUseVerifiedProductionData(['master']), requests:canUseVerifiedProductionData(['requests']) })`) });
        throw error;
      }
    };
    const saveOutbox = w.saveRequestOutboxEntry;
    w.saveRequestOutboxEntry = function (...args: any[]) {
      const result = saveOutbox.apply(this, args);
      result.catch((error: any) => w.__entryFailures.push({ boundary: 'outbox', code: error.code, message: error.message }));
      return result;
    };
  });
  const detail = async (view: 'av' | 'drive') => {
    await page.evaluate(value => (window as any).switchView(value), view);
    await expect(page.locator(`#view-${view}`)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.eval("canUseVerifiedProductionData(['master'])"))).toBe(true);
    await page.evaluate(({ uid, view }) => (window as any).openDetail(uid, view), { uid: UID, view });
    await expect(page.locator('#view-detail')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.eval("productionMasterDetailSession?.status === 'ready' && hasProductionMasterDetailForItem(activeItem)"))).toBe(true);
    expect(await page.evaluate(() => window.eval('getCurrentVisibleViewId()'))).toBe('detail');
    expect(await page.evaluate(() => window.eval('activeDetailSourceView'))).toBe(view);
  };
  const submit = () => page.evaluate(() => window.eval(`finalizeRequestAction(null, 'Synthetic Customer', {}, [{
    domId: activeItem.DOM_ID, item: activeItem, data: { qty: '1', reserve: 'NO', reuse: 'NO', note: 'Synthetic AV request' }
  }])`));
  const assertClean = () => {
    expect(state.errors).toEqual([]);
    expect(state.unexpectedWrites).toEqual([]);
  };
  return { state, detail, submit, assertClean };
}

test('AV-only REP opens Request from AV detail and submits through the AV transaction', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.detail('av');
  await page.evaluate(() => (window as any).openDetailRequestAction());
  await expect(page.locator('#request-rep-modal')).toBeVisible();
  await f.submit();
  await expect.poll(() => f.state.commits.length).toBe(1);
  expect(f.state.commits[0].operation).toBe('create_av_request_batch');
  expect(f.state.commits[0].body.requests).toHaveLength(1);
  expect(f.state.commits[0].body.requests[0]).toMatchObject({ master_id: UID, request_source: 'av', req_qty: '1', req_status: 'Pending' });
  await expect.poll(() => page.evaluate(() => (window as any).__entryToasts.some(([title]: string[]) => title === 'Success'))).toBe(true);
  expect(f.state.exactReads).toBeGreaterThan(0);
  f.assertClean();
});

test('AV-only REP remains restricted in Drive detail and stale AV access cannot create', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.detail('drive');
  await page.evaluate(() => (window as any).openDetailRequestAction());
  await expect(page.locator('#request-rep-modal')).toBeHidden();
  await f.submit();
  expect(await page.evaluate(() => (window as any).__entryToasts.filter(([title]: string[]) => title === 'Request Restricted').length)).toBe(2);
  expect(f.state.commits).toHaveLength(0);
  await f.detail('av');
  await page.evaluate(() => window.eval('requestCapabilityState.stale = true'));
  await page.evaluate(() => (window as any).openDetailRequestAction());
  await expect(page.locator('#request-rep-modal')).toBeHidden();
  await f.submit();
  expect(await page.evaluate(() => (window as any).__entryToasts.filter(([title]: string[]) => title === 'Request Access Check').length)).toBe(2);
  expect(f.state.commits).toHaveLength(0);
  f.assertClean();
});
