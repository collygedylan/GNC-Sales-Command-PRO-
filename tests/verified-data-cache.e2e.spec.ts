import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The compiled shell, real Supabase SDK, IndexedDB, revision coordinator,
 * loaders, rendering and scheduling all run unchanged. Only network responses
 * and a persisted synthetic SDK session are fixtures. Nothing reaches production.
 */
const USER_A = 'verified_cache_a';
const USER_B = 'verified_cache_b';
const ROW_ID = 'verified-cache-row';
const SAVED_NAME = 'Verified Cache Fixture';
const CURRENT_NAME = 'Updated Cache Fixture';
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const inventorySchema = JSON.parse(readFileSync(resolve('tests/fixtures/inventory-list-schema.json'), 'utf8')) as {
  sampledRows: number;
  schema: { name: string; type: string; sampleNonNullRows: number }[];
  syntheticValues: Record<string, string | number>;
};
const physicalColumns = new Set(inventorySchema.schema.map(column => column.name));
type InventoryRow = Record<string, string | number | null>;

function profile(username: string) {
  return { id: username === USER_A ? '00000000-0000-4000-8000-000000000001' : '00000000-0000-4000-8000-000000000002',
    username, display_name: username, role: 'ADMIN', division: '10', language: 'English',
    disabled_at: null, locked_until: null, must_change_password: false, passkey_pilot: false };
}

function session(username: string) {
  const person = profile(username);
  const claims = { sub: person.id, aud: 'authenticated', role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'), 'synthetic-signature'].join('.');
  return { access_token: token, refresh_token: `synthetic-refresh-${username}`, expires_at: claims.exp,
    expires_in: 3600, token_type: 'bearer', user: { id: person.id, aud: 'authenticated', role: 'authenticated',
      email: `${username}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };
}

function stock(commonname = SAVED_NAME) {
  // Real physical schema and types, never non-schema padding or numeric values
  // in text columns. Unpopulated nullable columns remain explicit nulls.
  return Object.assign(Object.fromEntries(inventorySchema.schema.map(column => [column.name, null])), {
    unique_id: ROW_ID, itemcode: 'CACHE1001', commonname, botanicalname: 'Synthetic fixture',
    contsize: '3G', season: 'F1', saleyear: '27', warehouseid: '10', warehousei: '10',
    blockalpha: 'A', locationcode: 'A001', lotcode: '27.F1', ptravailable: '42', ptronhand: '42',
    s_lts: '42', a_lts: '42', si_lts: '42', ai_lts: '42', holdstopcode: '',
    last_updated: '2026-09-10T12:00:00Z', unitprice: '45.67', quantityordered: '987',
    internalinvnote: 'Synthetic exact full-only note',
  }) as InventoryRow;
}

function fullSchemaRows(): InventoryRow[] {
  return Array.from({ length: inventorySchema.sampledRows }, (_, index) => Object.fromEntries(
    inventorySchema.schema.map(column => {
      const value = index < column.sampleNonNullRows ? inventorySchema.syntheticValues[column.name] : null;
      expect(value, `Explicit synthetic value for ${column.name}`).not.toBeUndefined();
      return [column.name, column.name === 'unique_id' ? `${value}-${index}` : value];
    })));
}

function selectedMasterRows(source: InventoryRow[], query: URLSearchParams) {
  const select = query.get('select') || '*';
  const filter = query.get('unique_id');
  let matching = source;
  if (filter) {
    let ids: string[];
    if (filter.startsWith('eq.')) ids = [filter.slice(3).replace(/^"|"$/g, '')];
    else if (filter.startsWith('in.(') && filter.endsWith(')')) {
      ids = filter.slice(4, -1).split(',').map(id => id.trim().replace(/^"|"$/g, ''));
    } else throw new Error(`Unsupported synthetic exact-ID filter: ${filter}`);
    matching = source.filter(row => ids.includes(String(row.unique_id)));
  }
  const offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || 1000);
  const page = matching.slice(offset, offset + limit);
  // Emulate the documented PostgREST alias transformation from the SELECT
  // string actually sent by the app, not from a duplicate projection contract.
  const rows = select === '*' ? structuredClone(page) : page.map(row => Object.fromEntries(select.split(',').map(field => {
    const match = /^(?:([A-Za-z]\w*):)?([a-z_]\w*)$/.exec(field);
    if (!match || !physicalColumns.has(match[2])) throw new Error(`Nonphysical synthetic selected field: ${field}`);
    return [match[1] || match[2], row[match[2]]];
  })));
  return { rows, offset, total: matching.length, select, exact: !!filter };
}

type Gate = { promise: Promise<void>; release: () => void };
const fixtureDiagnostics = new WeakMap<Page, { release: () => void; report: () => unknown }>();
test.afterEach(async ({ page }, info) => {
  const diagnostic = fixtureDiagnostics.get(page);
  if (diagnostic) {
    const browser = await page.evaluate(() => {
      const measured = (window as any).__cacheMetrics;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        measurementScope: 'Latest document navigation; timestamps are milliseconds from navigation start',
        ...measured,
        launchToHomeMs: measured?.homeVisibleAt || null,
        requiredAccessToSavedVisibleMs: measured?.accessResolvedAt && measured?.savedVisibleAt
          ? measured.savedVisibleAt - measured.accessResolvedAt : null,
        launchToVerifiedVisibleMs: measured?.verifiedVisibleAt || null,
        resourceTiming: {
          requestCount: resources.length,
          reportedTransferBytes: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
          reportedEncodedBodyBytes: resources.reduce((sum, resource) => sum + resource.encodedBodySize, 0),
          zeroTransferSizeEntries: resources.filter(resource => !resource.transferSize).length,
          note: 'Browser-reported resource sizes may be zero for cache hits, routed responses, or unavailable timing.',
        },
      };
    }).catch(error => ({ unavailable: String(error) }));
    await info.attach('verified-data-cache-metrics', {
      body: JSON.stringify({ test: info.title, project: info.project.name, status: info.status,
        latestNavigation: browser, wholeScenarioNetwork: diagnostic.report() }, null, 2),
      contentType: 'application/json',
    });
  }
  diagnostic?.release();
  if (info.status !== info.expectedStatus && diagnostic) {
    await info.attach('synthetic-network-state', { body: JSON.stringify(diagnostic.report(), null, 2), contentType: 'application/json' });
  }
});

async function fixture(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const state = {
    username: USER_A, revision: '1', permission: 'fixture-permission-1', denied: false,
    sourceRevisions: {} as Record<string, string>,
    rows: [stock()], reads: [] as { table: string; full: boolean; select?: string; exact?: boolean }[], revisions: 0,
    exactDetailUnavailable: false,
    masterResponses: [] as { select: string; exact: boolean; rowCount: number; fieldCount: number; bodyBytes: number }[],
    forbidden: [] as string[], runtime: [] as string[], gates: new Map<string, Gate>(),
    held: [] as string[], permissionResponses: 0, errors: [] as string[], unconfigured: [] as string[],
    syntheticJsonResponses: 0, syntheticUncompressedJsonBodyBytes: 0,
    syntheticUncompressedInventoryBodyBytes: 0,
    warmReloadFullInventoryDownloads: null as number | null,
    warmReloadUncompressedInventoryBodyBytes: null as number | null,
  };
  fixtureDiagnostics.set(page, {
    release: () => { state.gates.forEach(pending => pending.release()); state.gates.clear(); },
    report: () => ({ ...state, gates: Array.from(state.gates.keys()) }),
  });
  page.on('pageerror', error => state.errors.push(error.message));
  const gate = (key: string) => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    state.gates.set(key, { promise, release });
    return () => { state.gates.delete(key); release(); };
  };
  const wait = async (key: string) => {
    const pending = state.gates.get(key);
    if (pending) { state.held.push(key); await pending.promise; }
  };
  const json = (route: Route, value: unknown, status = 200, headers: Record<string, string> = {}) => {
    const body = JSON.stringify(value);
    state.syntheticJsonResponses++;
    state.syntheticUncompressedJsonBodyBytes += Buffer.byteLength(body);
    if (new URL(route.request().url()).pathname.endsWith('/rest/v1/ph_master_inventory')) {
      state.syntheticUncompressedInventoryBodyBytes += Buffer.byteLength(body);
    }
    return route.fulfill({ status,
      contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'timing-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
        'access-control-allow-headers': route.request().headers()['access-control-request-headers']
          || 'authorization, apikey, content-type, x-client-info, prefer, range',
        'access-control-expose-headers': 'content-range', ...headers }, body });
  };
  page.on('response', response => {
    if (/\/assets\/live-app-runtime[^/]*\.js/.test(new URL(response.url()).pathname)) state.runtime.push(response.url());
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === origin && readMethods.has(method)) return route.continue();
    if (method === 'OPTIONS') return json(route, {});
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user') && method === 'GET') return json(route, session(state.username).user);
      if (url.pathname.endsWith('/token')) return json(route, session(state.username));
      return json(route, { error: 'Synthetic auth endpoint unavailable' }, 404);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const operation = url.pathname.split('/').pop()!;
      const body = request.postDataJSON() || {};
      if (operation === 'get_my_app_permissions_v1') {
        state.permissionResponses++;
        return json(route, { contractVersion: 'app-access-v1', enforcementMode: 'enforced', username: state.username,
          role: profile(state.username).role, permissions: ['home', 'drive', 'av', 'request', 'hours'].map(key => ({
            permissionKey: `module.${key}.view`, kind: 'module', moduleKey: key, allowed: true, scope: 'global' })) });
      }
      if (operation === 'get_request_capabilities') {
        state.permissionResponses++;
        return json(route, { contract_version: 2, username: state.username, scope: 'global', can_view_queue: true,
          can_take_photo: true, can_edit: true, can_complete: true, can_archive: true, can_create_general: true, can_create_av: true });
      }
      if (operation === 'get_my_dataset_revisions_v1') {
        state.revisions++;
        await wait('revisions');
        return json(route, { contractVersion: 1, permissionVersion: state.permission, serverTime: new Date().toISOString(),
          sources: (body.p_dataset_keys || []).map((key: string) => ({ key, revision: state.denied ? null : state.sourceRevisions[key] || state.revision,
            state: state.denied ? 'unavailable' : 'ready' })) });
      }
      // A telemetry acknowledgement is isolated here, like the other server responses.
      if (operation === 'report_app_health_event') return json(route, { ok: true });
      // Unrelated read-only APIs are synthetic empty results, never live traffic.
      if (/^(get_|list_|search_)/.test(operation)) return json(route, []);
      state.forbidden.push(`RPC ${operation}`);
      return json(route, { error: 'Mutation blocked by test fixture' }, 403);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').pop()!;
      if (!readMethods.has(method)) {
        state.forbidden.push(`${method} ${table}`);
        return json(route, { error: 'Mutation blocked by test fixture' }, 403);
      }
      if (table === 'profiles') return json(route, /vnd\.pgrst\.object/.test(request.headers().accept || '')
        ? profile(state.username) : [profile(state.username)]);
      const select = url.searchParams.get('select') || '*';
      if (table === 'ph_master_inventory') {
        const result = selectedMasterRows(state.rows, url.searchParams);
        state.reads.push({ table, full: !result.exact, select, exact: result.exact });
        await wait(table);
        if (result.exact) await wait('master-detail');
        const rows = result.exact && state.exactDetailUnavailable ? [] : result.rows;
        state.masterResponses.push({ select, exact: result.exact, rowCount: rows.length,
          fieldCount: rows[0] ? Object.keys(rows[0]).length : 0, bodyBytes: Buffer.byteLength(JSON.stringify(rows)) });
        return json(route, rows, 200, { 'content-range': rows.length
          ? `${result.offset}-${result.offset + rows.length - 1}/${result.total}` : `*/${result.total}` });
      }
      state.reads.push({ table, full: select === '*' || select.includes('commonname') });
      await wait(table);
      if (table === 'ph_app_settings') return json(route, [{ key: 'current_season_salesyear',
        value: { seasonCode: 'F1', salesYear: 27 }, updated_at: '2026-09-10T12:00:00Z' }]);
      return json(route, []);
    }
    if (url.pathname.endsWith('/functions/v1/app-api')) {
      const body = request.postDataJSON() || {};
      if (body.action === 'native_session_bridge') return json(route, { ok: true,
        session: { token: `synthetic-bridge-${state.username}`, expiresAt: Date.now() + 3600000,
          username: state.username, displayName: state.username, role: 'ADMIN' } });
      if (body.action === 'season_sales_office' && body.operation === 'access') {
        return json(route, { ok: true, allowed: true, canManage: true, users: [] });
      }
      if (body.action === 'db') {
        if (String(body.method || '').toUpperCase() !== 'GET') {
          state.forbidden.push(`Proxy ${body.method} ${body.table}`);
          return json(route, { ok: false, error: 'Mutation blocked by test fixture' }, 403);
        }
        const query = new URLSearchParams(body.query || '');
        const select = query.get('select') || '*';
        if (body.table === 'ph_master_inventory') {
          const result = selectedMasterRows(state.rows, query);
          state.reads.push({ table: body.table, full: !result.exact, select, exact: result.exact });
          await wait(body.table);
          if (result.exact) await wait('master-detail');
          const rows = result.exact && state.exactDetailUnavailable ? [] : result.rows;
          state.masterResponses.push({ select, exact: result.exact, rowCount: rows.length,
            fieldCount: rows[0] ? Object.keys(rows[0]).length : 0, bodyBytes: Buffer.byteLength(JSON.stringify(rows)) });
          state.syntheticUncompressedInventoryBodyBytes += Buffer.byteLength(JSON.stringify(rows));
          return json(route, { ok: true, data: rows });
        }
        state.reads.push({ table: body.table, full: select === '*' || select.includes('commonname') });
        await wait(body.table);
        return json(route, { ok: true, data: [] });
      }
      if (['eval_work', 'shear_location_work', 'location_work', 'dock_trip_status'].includes(body.action)
        && ['list', 'get', 'state'].includes(body.operation || 'list')) return json(route, { ok: true, data: [], manager: true });
      if (body.action === 'supabase_write' && (body.method || '').toUpperCase() === 'GET') return json(route, { ok: true, data: [] });
      if (/get|load|state|status|preferences|capabilit|health|diagnostic|telemetry|event/.test(String(body.action || ''))) {
        return json(route, { ok: true, eligible: false, data: [], preferences: {} });
      }
      state.unconfigured.push(`${body.action || ''}:${body.operation || body.method || ''}:${body.table || ''}`);
      return json(route, { ok: false, error: `Unconfigured synthetic action: ${String(body.action || '')}` }, 503);
    }
    return route.abort('blockedbyclient');
  });
  await page.addInitScript(({ sdkSession }) => {
    // Seed only authentication; dataset caches are produced by normal live reads.
    if (!localStorage.getItem('gnc_supabase_auth_v1')) localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(sdkSession));
    const supportsLongTasks = typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes.includes('longtask');
    const metrics = (window as any).__cacheMetrics = {
      moduleAccessResolvedAt: 0, requestAccessResolvedAt: 0, accessResolvedAt: 0,
      homeVisibleAt: 0, savedVisibleAt: 0, verifiedVisibleAt: 0,
      lifecycle: [] as { event: string; at: number; details?: unknown }[],
      longTasks: supportsLongTasks ? { supported: true, count: 0, totalDurationMs: 0, maxDurationMs: 0 }
        : { supported: false, count: null, totalDurationMs: null, maxDurationMs: null },
    };
    if (supportsLongTasks) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          metrics.longTasks.count++;
          metrics.longTasks.totalDurationMs += entry.duration;
          metrics.longTasks.maxDurationMs = Math.max(metrics.longTasks.maxDurationMs, entry.duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    }
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const metadata = /\/rpc\/get_my_dataset_revisions_v1(?:\?|$)/.test(String(args[0]));
      if (metadata) metrics.lifecycle.push({ event: 'metadata-start', at: performance.now() });
      const response = await original(...args);
      if (metadata) metrics.lifecycle.push({ event: 'metadata-response', at: performance.now() });
      if (/\/rpc\/get_my_app_permissions_v1(?:\?|$)/.test(String(args[0]))) metrics.moduleAccessResolvedAt = performance.now();
      if (/\/rpc\/get_request_capabilities(?:\?|$)/.test(String(args[0]))) metrics.requestAccessResolvedAt = performance.now();
      if (metrics.moduleAccessResolvedAt && metrics.requestAccessResolvedAt && !metrics.accessResolvedAt) {
        metrics.accessResolvedAt = Math.max(metrics.moduleAccessResolvedAt, metrics.requestAccessResolvedAt);
      }
      return response;
    };
    const observed = new Set<string>();
    const observeCall = (name: string, accept: (args: any[]) => boolean) => {
      const current = (window as any)[name];
      if (observed.has(name) || typeof current !== 'function') return;
      observed.add(name);
      // Observation only: execute the real implementation with its original
      // arguments/receiver and retain its original return value and promise.
      (window as any)[name] = function (...args: any[]) {
        const relevant = accept(args);
        const detailState = () => /^(runDeferredDetailHydration|renderDetailView|refreshDetailInputsFromActiveItem)$/.test(name)
          ? { spec: (document.getElementById('lsn-spec') as HTMLInputElement)?.value,
            disabled: (document.getElementById('lsn-spec') as HTMLInputElement)?.disabled } : undefined;
        if (relevant) metrics.lifecycle.push({ event: `${name}-start`, at: performance.now(), details: detailState() });
        const result = current.apply(this, args);
        if (relevant && result && typeof result.then === 'function') {
          result.then(() => metrics.lifecycle.push({ event: `${name}-settled`, at: performance.now() }), () => {});
        } else if (relevant) metrics.lifecycle.push({ event: `${name}-end`, at: performance.now(), details: detailState() });
        return result;
      };
    };
    const sample = () => {
      observeCall('loadCacheValue', args => String(args[0]).startsWith('verified-dataset:v1:'));
      observeCall('processAndLoadData', args => args[0]?._verifiedLiveSync === true);
      observeCall('scheduleProductionLiveSyncRender', () => true);
      observeCall('renderViewContent', args => args[0] === 'drive');
      for (const name of ['runDeferredDetailHydration', 'renderDetailView', 'refreshDetailInputsFromActiveItem']) {
        observeCall(name, () => true);
      }
      for (const name of ['openAppShellAfterLogin', 'applyRolePermissions', 'refreshProtectedSections',
        'repairAppShellScrollState', 'syncCurrentViewBodyClass', 'showOnlyPrimaryView', 'updateFooterNavState',
        'syncGlobalHeaderChrome', 'syncRoleAccessUi', 'renderHome', 'ensureHomeDashboardReadyAfterLogin',
        'setHomeDashboardModulesReady', 'setMenuOpenState', 'switchView', 'applyCurrentUserMasterInventoryScope',
        'restorePersistedAppFilterStateForCurrentUser', 'initializeCartUi', 'updateGlobalActionBar',
        'renderProductionDataFreshness']) observeCall(name, () => !metrics.savedVisibleAt);
      const drive = document.getElementById('drive-content');
      const home = document.getElementById('view-home');
      if (!metrics.homeVisibleAt && home?.getClientRects().length
        && document.getElementById('home-tile-drive')?.getClientRects().length) metrics.homeVisibleAt = performance.now();
      if (!metrics.savedVisibleAt && drive?.getClientRects().length && drive.textContent?.includes('Verified Cache Fixture')) {
        metrics.savedVisibleAt = performance.now();
      }
      const driveView = document.getElementById('view-drive');
      if (!metrics.verifiedVisibleAt && driveView?.getClientRects().length
        && driveView.dataset.verified === 'current') metrics.verifiedVisibleAt = performance.now();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, { sdkSession: session(USER_A) });
  const open = async () => {
    await page.goto('/?verified-data-cache-fixture=1', { waitUntil: 'load' });
    await home(page);
    expect(state.runtime.length, 'The browser must execute the compiled runtime').toBeGreaterThan(0);
  };
  return { state, gate, open, masterReads: () => state.reads.filter(read => read.table === 'ph_master_inventory' && read.full).length };
}

async function home(page: Page) {
  await expect(page.locator('#view-login')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#home-tile-drive')).toBeVisible();
}

async function drive(page: Page) {
  await page.evaluate(() => (window as any).switchView('drive'));
  await expect(page.locator('#view-drive')).toBeVisible();
}

async function driveAsSoonAsHomeIsVisible(page: Page) {
  // Keep driver round trips out of the access-to-cache budget. This invokes the
  // real tile click only after normal access bootstrap makes Home visible.
  await page.evaluate(() => new Promise<void>(resolve => {
    const enter = () => {
      const home = document.getElementById('view-home');
      const tile = document.getElementById('home-tile-drive');
      if (home?.getClientRects().length && tile?.getClientRects().length) {
        (window as any).__cacheMetrics.driveRequestedAt = performance.now();
        tile.click();
        resolve();
      } else requestAnimationFrame(enter);
    };
    requestAnimationFrame(enter);
  }));
  await expect(page.locator('#view-drive')).toBeVisible();
}

async function verified(page: Page) {
  await expect.poll(() => page.evaluate(() => window.eval(`(() => {
    const coordinator=getProductionLiveSyncCoordinator();
    return !!coordinator?.isVerified(createProductionCoreLiveAdapter('master'));
  })()`))).toBe(true);
  await expect(page.locator('#view-drive')).toHaveAttribute('data-verified', 'current');
}

async function saved(page: Page) {
  await expect(page.locator('#drive-content')).toContainText(SAVED_NAME);
}

async function storedSnapshotCount(page: Page) {
  return page.evaluate(async () => window.eval(`(async () => {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const request=db.transaction('inventory_cache','readonly').objectStore('inventory_cache').getAllKeys();
      request.onsuccess=()=>resolve(request.result.filter(key=>String(key).startsWith('verified-dataset:v1:') && String(key).includes('"core:master"')).length);
      request.onerror=()=>reject(request.error);
    });
  })()`));
}

test('warm reload reuses its persisted verified snapshot without a full inventory download', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  const firstReads = f.masterReads();
  const firstInventoryBytes = f.state.syntheticUncompressedInventoryBodyBytes;
  expect(firstReads).toBeGreaterThan(0);
  await page.reload({ waitUntil: 'load' }); await driveAsSoonAsHomeIsVisible(page);
  await saved(page); await verified(page);
  f.state.warmReloadFullInventoryDownloads = f.masterReads() - firstReads;
  f.state.warmReloadUncompressedInventoryBodyBytes = f.state.syntheticUncompressedInventoryBodyBytes - firstInventoryBytes;
  expect(f.state.warmReloadFullInventoryDownloads).toBe(0);
  expect(f.state.warmReloadUncompressedInventoryBodyBytes).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__cacheMetrics.savedVisibleAt)).toBeGreaterThan(0);
  const metrics = await page.evaluate(() => (window as any).__cacheMetrics);
  expect(metrics.accessResolvedAt).toBeGreaterThan(0);
  expect(metrics.savedVisibleAt - metrics.accessResolvedAt).toBeLessThanOrEqual(1000);
  expect(f.state.forbidden).toEqual([]);
});

test('changed data keeps saved rows visible and unverified until the new snapshot arrives', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  f.state.revision = '2'; f.state.rows = [stock(CURRENT_NAME)];
  const release = f.gate('ph_master_inventory');
  await page.reload({ waitUntil: 'load' }); await home(page); await drive(page);
  await saved(page);
  await expect.poll(() => f.state.held.includes('ph_master_inventory')).toBe(true);
  await expect(page.locator('#view-drive')).toHaveAttribute('data-verified', 'checking');
  expect(await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(false);
  expect(await page.evaluate(async () => window.eval(`(async()=>{
    try {await supabaseFetch('ph_master_inventory','PATCH',{qtyavailable:99},'unique_id=eq.verified-cache-row');return 'WRITE_WAS_NOT_BLOCKED';}
    catch(error){return error.code || error.message;}
  })()`))).toBe('DATA_NOT_VERIFIED');
  await expect(page.locator('#drive-content')).not.toContainText(CURRENT_NAME);
  release(); await verified(page);
  await expect(page.locator('#drive-content')).toContainText(CURRENT_NAME);
  await expect(page.locator('#drive-content')).not.toContainText(SAVED_NAME);
  expect(f.state.forbidden).toEqual([]);
});

test('an unchanged saved master is visible while a changed critical join is held', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  const firstReads = f.masterReads();
  f.state.sourceRevisions.ph_reserves = '2';
  const release = f.gate('ph_reserves');
  await page.reload({ waitUntil: 'load' }); await driveAsSoonAsHomeIsVisible(page);
  await expect.poll(() => f.state.held.includes('ph_reserves')).toBe(true);
  await saved(page);
  await expect(page.locator('#view-drive')).toHaveAttribute('data-verified', 'checking');
  expect(f.masterReads() - firstReads).toBe(0);
  expect(await page.evaluate(() => window.eval(`canUseVerifiedProductionData(['master','reserves'])`))).toBe(false);
  release(); await verified(page);
  await saved(page);
  expect(f.state.forbidden).toEqual([]);
});

test('an unresolved badge cannot block current data on the active inventory view', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  const release = f.gate('ph_sales_credit_requests');
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => f.state.held.includes('ph_sales_credit_requests')).toBe(true);
  expect(await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(true);
  release();
  expect(f.state.forbidden).toEqual([]);
});

test('an open saved detail enables its controls after verification without repopulating the draft', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  f.state.revision = '2';
  const release = f.gate('ph_master_inventory');
  await page.reload({ waitUntil: 'load' }); await home(page); await drive(page); await saved(page);
  await page.evaluate(uid => (window as any).openDetail(uid, 'drive', { preferredTab: 'location' }), ROW_ID);
  await expect(page.locator('#view-detail')).toBeVisible();
  const field = page.locator('#lsn-spec');
  await expect(field).toBeVisible();
  // openDetail binds a fast shell and then hydrates its initial row on a queued
  // frame. An already-restored draft belongs after that initial binding, not in
  // its still-disabled placeholder. Wait the real work; do not force or stub it.
  await expect.poll(() => page.evaluate(() => window.eval(`({
    row: activeItem?.UNIQUE_ID,
    hydrated: !!detailHydrationToken && !pendingDetailHydrationToken && !detailHydrationTimer
      && !uiRenderFrames['detail-hydrate:'+detailHydrationToken],
    verified: getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))
  })`))).toEqual({ row: ROW_ID, hydrated: true, verified: false });
  await expect(field).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  // Represent already-restored local form text without dispatching an autosave.
  await field.evaluate((element: HTMLInputElement) => {
    if (!element.isConnected) throw new Error('The restored draft must bind to the connected Detail input');
    element.value = 'Retained local draft';
    (window as any).__cacheMetrics.lifecycle.push({ event: 'fixture-restored-draft', at: performance.now(),
      details: window.eval(`({row:activeItem?.UNIQUE_ID, token:detailHydrationToken, pendingToken:pendingDetailHydrationToken,
        timer:!!detailHydrationTimer, queuedFrame:!!uiRenderFrames['detail-hydrate:'+detailHydrationToken]})`) });
  });
  await expect(field).toHaveValue('Retained local draft');
  release();
  await expect.poll(() => page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(true);
  await expect(field).toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeEnabled();
  await expect(field).toHaveValue('Retained local draft');
  expect(f.state.forbidden).toEqual([]);
});

test('navigation away during a read retains a completed same-scope snapshot for return', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  const release = f.gate('ph_master_inventory');
  await f.open(); await drive(page);
  await expect.poll(() => f.state.held.includes('ph_master_inventory')).toBe(true);
  const reads = f.masterReads();
  await page.evaluate(() => (window as any).switchView('home'));
  await home(page);
  release();
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  await drive(page); await saved(page); await verified(page);
  expect(f.masterReads()).toBe(reads);
  expect(f.state.forbidden).toEqual([]);
});

test('another account cannot display the previous account snapshot', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  f.state.username = USER_B; f.state.rows = [];
  await page.evaluate(sdkSession => {
    localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(sdkSession));
    sessionStorage.removeItem('gnc_app_session_v1');
  }, session(USER_B));
  const release = f.gate('ph_master_inventory');
  await page.reload({ waitUntil: 'load' }); await home(page); await drive(page);
  await expect.poll(() => f.state.held.includes('ph_master_inventory')).toBe(true);
  await expect(page.locator('#drive-content')).not.toContainText(SAVED_NAME);
  expect(await page.evaluate(() => window.eval(`fullInventory.some(row=>row.UNIQUE_ID==='verified-cache-row')`))).toBe(false);
  release(); await verified(page);
  expect(f.state.forbidden).toEqual([]);
});

test('a denied revision source cannot authorize its old saved rows', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  f.state.permission = 'fixture-permission-denied'; f.state.denied = true;
  await page.reload({ waitUntil: 'load' }); await home(page); await drive(page);
  await expect.poll(() => page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator()?.getStatus().state`))).toBe('Needs attention');
  await expect(page.locator('#drive-content')).not.toContainText(SAVED_NAME);
  expect(await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(false);
  expect(f.state.forbidden).toEqual([]);
});

test('offline resume retains the snapshot and a draft, then verifies on reconnect', async ({ page, context, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await page.evaluate(async () => window.eval(`(async()=>{await putIndexedDbRecord('request_outbox', {
    clientBatchId:'verified-cache-draft', username:currentUser, state:'draft', note:'Unsent synthetic draft'
  });})()`));
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect.poll(() => page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator()?.getStatus().state`))).toBe('Offline');
  await saved(page);
  expect(await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(false);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await verified(page);
  expect(await page.evaluate(async () => window.eval(`(async()=>{
    const db=await openDB();return new Promise(resolve=>{
      const request=db.transaction('request_outbox','readonly').objectStore('request_outbox').get('verified-cache-draft');
      request.onsuccess=()=>resolve(request.result?.note);
    });
  })()`))).toBe('Unsent synthetic draft');
  expect(f.state.forbidden).toEqual([]);
});
