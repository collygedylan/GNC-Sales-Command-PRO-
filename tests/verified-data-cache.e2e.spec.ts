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
      // Keep schema validation strict without registering 27,264 Playwright
      // assertion steps before navigation. This does not change fixture data.
      if (value === undefined) throw new Error(`Missing explicit synthetic value for ${column.name}`);
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
      let detailState: unknown;
      try {
        detailState = window.eval(`({view:getCurrentVisibleViewId(),
          projection:getDatasetState('master').listProjectionVersion,
          uid:activeItem?.UNIQUE_ID, detailStatus:productionMasterDetailSession?.status,
          detailError:productionMasterDetailSession?.error,
          exact:!!activeItem && hasProductionMasterDetailForItem(activeItem),
          savedDraft:productionMasterDetailSession?.pendingLocalDraft?.SPEC,
          spec:document.getElementById('lsn-spec')?.value,
          specDisabled:document.getElementById('lsn-spec')?.disabled})`);
      } catch (error) { detailState = { unavailable: String(error) }; }
      return {
        measurementScope: 'Latest document navigation; timestamps are milliseconds from navigation start',
        ...measured,
        detailState,
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
  // Notification permission is outside this data fixture. Dismiss the actual
  // help dialog if it interrupts a user click; never force-click through it.
  await page.addLocatorHandler(page.locator('#push-permission-help-modal'), async modal => {
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
  });
  const state = {
    username: USER_A, revision: '1', permission: 'fixture-permission-1', denied: false,
    sourceRevisions: {} as Record<string, string>,
    revisionRequests: [] as { sequence: number; keys: string[]; startedAt: number; responseStartedAt?: number }[],
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
        const observation = { sequence: state.revisions, keys: [...(body.p_dataset_keys || [])], startedAt: Date.now(), responseStartedAt: undefined as number | undefined };
        state.revisionRequests.push(observation);
        await wait('revisions');
        observation.responseStartedAt = Date.now();
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

async function openLocationDetail(page: Page) {
  await page.evaluate(uid => (window as any).openDetail(uid, 'drive', { preferredTab: 'location' }), ROW_ID);
  await expect(page.locator('#view-detail')).toBeVisible();
  await expect(page.locator('#lsn-spec')).toBeVisible();
}

async function exactDetailReady(page: Page) {
  await expect.poll(() => page.evaluate(() => window.eval(`productionMasterDetailSession?.status === 'ready'
    && hasProductionMasterDetailForItem(activeItem)`))).toBe(true);
  await expect(page.locator('#lsn-spec')).toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeEnabled();
}

async function seedSavedDetailDraft(page: Page) {
  // Seed the actual persisted local-edit format, not a disabled placeholder.
  // The real compact -> exact hydration must recover it into the correct form.
  await page.evaluate(uid => window.eval(`(() => {
    const row=fullInventory.find(row=>row.UNIQUE_ID===${JSON.stringify(uid)});
    if(!row) throw new Error('Saved draft requires its exact authorized list identity');
    getPendingEditsCache()[row.UNIQUE_ID]={timestamp:Date.now(), sourceTable:'ph_master_inventory',
      data:{...row, SPEC:'Retained local draft', AV_NOTE:'Retained local note'}};
    flushPendingEditsCache(true);
  })()`), ROW_ID);
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
  // A finite independent foreground recheck may start after the initial
  // current paint. It must finish without releasing the background request.
  await expect.poll(() => page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))`))).toBe(true);
  expect(f.state.gates.has('ph_sales_credit_requests')).toBe(true);
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
  await seedSavedDetailDraft(page);
  await openLocationDetail(page);
  const field = page.locator('#lsn-spec');
  await expect.poll(() => page.evaluate(() => window.eval(`({
    row: activeItem?.UNIQUE_ID,
    saved: productionMasterDetailSession?.pendingLocalDraft?.SPEC,
    verified: getProductionLiveSyncCoordinator().isVerified(createProductionCoreLiveAdapter('master'))
  })`))).toEqual({ row: ROW_ID, saved: 'Retained local draft', verified: false });
  await expect(field).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  release();
  await exactDetailReady(page);
  await expect(field).toHaveValue('Retained local draft');
  await expect(page.locator('#lsn-av-note')).toHaveValue('Retained local note');
  expect(await page.evaluate(() => window.eval(`({server:activeItem.SPEC || '',
    list:fullInventory.find(row=>row.UNIQUE_ID===activeItem.UNIQUE_ID).SPEC || ''})`)))
    .toEqual({ server: '', list: '' });
  expect(f.state.masterResponses.some(response => response.exact && response.select === '*')).toBe(true);
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

test('verified footer badges stay idle and one real revision event causes only a bounded refresh', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!);
  await f.open();
  await page.evaluate(() => {
    const original = (window as any).signalProductionLiveSync;
    (window as any).signalProductionLiveSync = function (...args: any[]) {
      (window as any).__cacheMetrics.lifecycle.push({ event: 'native-check-signal', at: performance.now(),
        details: { reason: args[0], delay: args[1], caller: new Error().stack } });
      return original.apply(this, args);
    };
  });
  await drive(page); await saved(page); await verified(page);
  const badgesReady = () => page.evaluate(() => window.eval(`isProductionBadgeVerified('badge:queue')
    && isProductionBadgeVerified('badge:communications')`));
  await expect.poll(badgesReady).toBe(true);
  // Login deliberately defers its first realtime-subscription check through
  // this real touch-task queue. Start the idle horizon only after that task
  // and its metadata work settle. The old 700ms feedback loop cannot satisfy
  // even this 1s quiet precondition, let alone the following 3.1s assertion.
  let settledReads = f.state.revisions, unchangedSince = performance.now();
  await expect.poll(async () => {
    const startupQueued = await page.evaluate(() => window.eval(`!!runAfterTouchInteractionTasks['current-view-realtime-subscriptions']`));
    if (startupQueued || f.state.revisions !== settledReads) {
      settledReads = f.state.revisions; unchangedSince = performance.now();
    }
    return !startupQueued && performance.now() - unchangedSince >= 1000;
  }).toBe(true);
  const initialReads = f.state.revisions;
  // The observation horizon is the behavior under test: a footer paint must
  // not re-arm the former 450ms + 250ms self-refresh feedback loop.
  await page.waitForTimeout(3100);
  expect(f.state.revisions - initialReads).toBe(0);
  const initialDownloads = f.masterReads();
  const eventSignalsStart = await page.evaluate(() => (window as any).__cacheMetrics.lifecycle.filter((entry: any) => entry.event === 'native-check-signal').length);
  const eventDataReadsStart = f.state.reads.length;
  const eventImageRequests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'image') eventImageRequests.push(new URL(request.url()).pathname); });
  f.state.sourceRevisions.ph_master_inventory = '2'; f.state.rows = [stock(CURRENT_NAME)];
  const dispatched = await page.evaluate(() => window.eval(`(() => {
    const channel=getSupabaseBrowserClient().getChannels().find(channel=>channel.topic.includes('dataset-revisions:'));
    const binding=channel?.bindings?.postgres_changes?.find(binding=>binding.filter?.table==='app_dataset_revisions');
    if(!binding || typeof binding.callback!=='function') throw new Error('The actual production revision subscription is required');
    binding.callback({eventType:'UPDATE',schema:'public',table:'app_dataset_revisions',
      new:{key:'ph_master_inventory'},old:{}});
    return true;
  })()`));
  expect(dispatched).toBe(true);
  await expect(page.locator('#drive-content')).toContainText(CURRENT_NAME);
  await verified(page); await expect.poll(badgesReady).toBe(true);
  const afterEventReads = f.state.revisions;
  expect(afterEventReads - initialReads).toBeGreaterThan(0);
  // Two real lanes each need a before/after vector and may join one in-flight
  // render-triggered check. Those cached joins make six the finite bound;
  // they must not start another download or any subsequent idle feedback.
  expect(afterEventReads - initialReads).toBeLessThanOrEqual(6);
  expect(f.masterReads() - initialDownloads).toBe(1);
  await page.waitForTimeout(3100);
  expect(f.state.revisions).toBe(afterEventReads);
  expect(await page.evaluate(() => (window as any).__cacheMetrics.lifecycle.filter((entry: any) => entry.event === 'native-check-signal').length)).toBe(eventSignalsStart);
  expect(f.state.reads.slice(eventDataReadsStart).filter(read => read.table === 'ph_master_inventory')).toHaveLength(1);
  expect(eventImageRequests).toEqual([]);
  await info.attach('bounded-revision-refresh', { contentType: 'application/json',
    body: JSON.stringify({ idleObservationMs: 3100, idleRevisionReads: 0,
      eventRevisionReads: afterEventReads - initialReads, eventInventoryDownloads: f.masterReads() - initialDownloads,
      finalRevisionReads: f.state.revisions,
      bound: '2 lanes × (before + after + at most one queued cached join) = 6',
      eventDataReads: f.state.reads.slice(eventDataReadsStart), eventImageRequests,
      revisionRpcTimeline: f.state.revisionRequests.filter(request => request.sequence > initialReads) }, null, 2) });
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

test('compact list preserves full-schema list filters and counts with at least 50 percent fewer JSON bytes', async ({ page, baseURL }, info) => {
  const f = await fixture(page, baseURL!);
  const constructionStartedAt = performance.now();
  const fullRows = fullSchemaRows();
  const syntheticFixtureConstructionMs = performance.now() - constructionStartedAt;
  f.state.rows = fullRows;
  await f.open(); await drive(page); await verified(page);
  await expect.poll(() => page.evaluate(() => window.eval('fullInventory.length'))).toBe(fullRows.length);
  await expect(page.locator('#drive-content')).toContainText('Synthetic Plant');
  const readyObservation = await page.evaluate(() => ({ observedAt: performance.now(),
    accessResolvedAt: (window as any).__cacheMetrics.accessResolvedAt,
    verifiedVisibleAt: (window as any).__cacheMetrics.verifiedVisibleAt }));
  const parity = await page.evaluate(rawRows => {
    (window as any).__fullSchemaParityRows = rawRows;
    return window.eval(`(() => {
      const baseline=formatFetchedRows(window.__fullSchemaParityRows,'ph_master_inventory');
      delete window.__fullSchemaParityRows;
      baseline.forEach(buildSearchIndex);
      const ids=rows=>rows.map(row=>row.UNIQUE_ID).sort();
      const searches=['synthetic','TEST.001','A.01.001','27.F1','no-matching-synthetic-row'];
      const searchResults=searches.map(term=>({term, full:ids(filterBySearch(baseline,term,'drive_name')),
        compact:ids(filterBySearch(fullInventory,term,'drive_name'))}));
      const filters=[
        {name:'Synthetic',location:'',lot:'',size:'',mode:'',value:''},
        {name:'',location:'A.01.001',lot:'27.F1',size:'#3',mode:'',value:''},
        {name:'',location:'',lot:'',size:'',mode:'gt',value:'99'},
        {name:'',location:'',lot:'',size:'',mode:'gt',value:'101'}
      ];
      const quickResults=filters.map((filter,index)=>{
        driveQuickFilterName=filter.name; driveQuickFilterLocation=filter.location;
        driveQuickFilterLot=filter.lot; driveQuickFilterSize=filter.size;
        driveQuickFilterLtsMode=filter.mode; driveQuickFilterLtsValue=filter.value;
        return {full:ids(applyDriveQuickFiltersToItems(baseline,'full-parity-'+index)),
          compact:ids(applyDriveQuickFiltersToItems(fullInventory,'compact-parity-'+index))};
      });
      const count=rows=>({rows:rows.length, itemcodes:new Set(rows.map(row=>row.ITEMCODE)).size,
        locations:new Set(rows.map(row=>row.LOCATIONCODE)).size,
        lts:rows.reduce((sum,row)=>sum+(parseFloat(row.S_LTS)||0),0),
        held:rows.filter(isDriveHoldStopCodeRow).length,
        programs:buildDriveItemProgramGroups(rows)});
      return {version:getDatasetState('master').listProjectionVersion,
        allList:fullInventory.every(row=>window.AgMetricInventoryList.isListRow(row)),
        ids:{full:ids(baseline),compact:ids(fullInventory)},
        count:{full:count(baseline),compact:count(fullInventory)},searchResults,quickResults};
    })()`);
  }, fullRows);
  expect(parity.version).toBe('master-list-v1'); expect(parity.allList).toBe(true);
  expect(parity.ids.compact).toEqual(parity.ids.full);
  expect(parity.count.compact).toEqual(parity.count.full);
  for (const result of [...parity.searchResults, ...parity.quickResults]) expect(result.compact).toEqual(result.full);
  const responses = f.state.masterResponses.filter(response => !response.exact);
  expect(responses.length).toBeGreaterThan(0);
  expect(responses.every(response => response.select !== '*' && (response.rowCount === 0 || response.fieldCount === 161))).toBe(true);
  const compactJsonBytes = responses.reduce((sum, response) => sum + response.bodyBytes, 0);
  const fullJsonBytes = Buffer.byteLength(JSON.stringify(fullRows));
  const reductionPercent = 100 * (1 - compactJsonBytes / fullJsonBytes);
  expect(reductionPercent).toBeGreaterThanOrEqual(50);
  await info.attach('compact-list-parity-and-bytes', { contentType: 'application/json',
    body: JSON.stringify({ fullJsonBytes, compactJsonBytes, reductionPercent,
      syntheticFixtureConstructionMs, readyObservation,
      note: 'Identical 213-field synthetic rows. Uncompressed routed JSON bodies, not compressed network egress.', parity }, null, 2) });
  expect(f.state.errors).toEqual([]); expect(f.state.forbidden).toEqual([]);
});

test('list completeness keeps the editor read-only until the exact full row is verified', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  const release = f.gate('master-detail');
  await openLocationDetail(page);
  await expect.poll(() => f.state.held.includes('master-detail')).toBe(true);
  await expect(page.locator('#master-detail-load-state')).toContainText('Checking exact inventory details');
  await expect(page.locator('#lsn-spec')).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  expect(await page.evaluate(() => window.eval(`({
    list:window.AgMetricInventoryList.isListRow(fullInventory[0]),
    fullOnly:Object.hasOwn(fullInventory[0],'UNITPRICE'),
    editable:canEditRowDetails('lsn-',activeItem), exact:hasProductionMasterDetailForItem(activeItem)
  })`))).toEqual({ list: true, fullOnly: false, editable: false, exact: false });
  release(); await exactDetailReady(page);
  expect(await page.evaluate(() => window.eval(`({uid:activeItem.UNIQUE_ID,price:activeItem.UNITPRICE,
    ordered:activeItem.QUANTITYORDERED,note:activeItem.INTERNALINVNOTE,
    full:window.AgMetricInventoryList.isDetailRow(activeItem,{...getProductionMasterDetailContext(),uniqueId:activeItem.UNIQUE_ID}),
    listOnly:window.AgMetricInventoryList.isListRow(fullInventory[0]),
    listHasFullOnly:Object.hasOwn(fullInventory[0],'UNITPRICE'), detached:activeItem!==fullInventory[0]})`)))
    .toEqual({ uid: ROW_ID, price: '45.67', ordered: '987', note: 'Synthetic exact full-only note',
      full: true, listOnly: true, listHasFullOnly: false, detached: true });
  const exactResponses = f.state.masterResponses.filter(response => response.exact);
  expect(exactResponses.length).toBeGreaterThan(0);
  expect(exactResponses.every(response => response.select === '*' && response.fieldCount === 213)).toBe(true);
  expect(f.state.errors).toEqual([]); expect(f.state.forbidden).toEqual([]);
});

test('missing exact details stay read-only and retry restores a real saved local draft separately', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await seedSavedDetailDraft(page);
  f.state.exactDetailUnavailable = true;
  await openLocationDetail(page);
  await expect(page.getByRole('button', { name: 'Retry details', exact: true })).toBeVisible();
  await expect(page.locator('#lsn-spec')).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  expect(await page.evaluate(() => window.eval(`({status:productionMasterDetailSession?.status,
    saved:getPendingEditsCache()[activeItem.UNIQUE_ID]?.data.SPEC,
    local:productionMasterDetailSession?.pendingLocalDraft?.SPEC,
    exact:hasProductionMasterDetailForItem(activeItem)})`)))
    .toEqual({ status: 'error', saved: 'Retained local draft', local: 'Retained local draft', exact: false });
  f.state.exactDetailUnavailable = false;
  await page.getByRole('button', { name: 'Retry details', exact: true }).click();
  await exactDetailReady(page);
  await expect(page.locator('#lsn-spec')).toHaveValue('Retained local draft');
  await expect(page.locator('#lsn-av-note')).toHaveValue('Retained local note');
  expect(await page.evaluate(() => window.eval(`({server:activeItem.SPEC||'',
    canonical:getProductionMasterDetailStore().getVerifiedRows([activeItem.UNIQUE_ID])[0].SPEC||''})`)))
    .toEqual({ server: '', canonical: '' });
  expect(f.state.forbidden).toEqual([]);
});

test('a changed verified revision retains an open editor draft without rebasing it onto a new full row', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await openLocationDetail(page); await exactDetailReady(page);
  // This editor is genuinely ready before the draft is made. Do not trigger
  // autosave while exercising a read-only refresh/retention boundary.
  await page.locator('#lsn-spec').evaluate((element: HTMLInputElement) => {
    element.value = 'Keep my current editor draft';
    element.focus(); element.setSelectionRange(5, 11);
  });
  f.state.revision = '2'; f.state.rows = [{ ...stock(), spec: 'New server spec' }];
  await page.evaluate(() => window.eval(`getProductionLiveSyncCoordinator().check('fixture-revision-change')`));
  await expect.poll(() => page.evaluate(() => window.eval('productionMasterDetailSession?.status'))).toBe('changed');
  await expect(page.locator('#lsn-spec')).toHaveValue('Keep my current editor draft');
  await expect(page.locator('#lsn-spec')).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  await expect(page.locator('#master-detail-load-state')).toContainText('Your draft is retained');
  expect(await page.evaluate(() => window.eval(`activeItem.SPEC||''`))).toBe('');
  expect(f.state.forbidden).toEqual([]);
});

test('a persisted snapshot from a different projection query cannot supply visible rows', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  await f.open(); await drive(page); await saved(page); await verified(page);
  await expect.poll(() => storedSnapshotCount(page)).toBeGreaterThan(0);
  await page.evaluate(async () => window.eval(`(async()=>{
    const adapter=createProductionCoreLiveAdapter('master');
    const key=getProductionDatasetCacheKey(adapter,getProductionDataScope());
    const entry=await loadCacheValue(key);
    if(!entry) throw new Error('Real canonical snapshot must be persisted before corruption fixture');
    entry.cacheKey=JSON.stringify(['master','ph_master_inventory','select=*','obsolete-projection']);
    if(!await saveCacheValue(key,entry)) throw new Error('Failed to persist the mismatched query fixture');
  })()`));
  const release = f.gate('ph_master_inventory');
  await page.reload({ waitUntil: 'load' }); await home(page); await drive(page);
  await expect.poll(() => f.state.held.includes('ph_master_inventory')).toBe(true);
  await expect(page.locator('#drive-content')).not.toContainText(SAVED_NAME);
  expect(await page.evaluate(() => window.eval(`fullInventory.some(row=>row.UNIQUE_ID==='verified-cache-row')`))).toBe(false);
  release(); await verified(page); await saved(page);
  expect(f.state.forbidden).toEqual([]);
});

test('a permission change during an exact read rejects its old full row before the editor becomes ready', async ({ page, baseURL }) => {
  const f = await fixture(page, baseURL!);
  f.state.rows = [{ ...stock(), spec: 'Old permission row' }];
  await f.open(); await drive(page); await saved(page); await verified(page);
  const release = f.gate('master-detail');
  await openLocationDetail(page);
  await expect.poll(() => f.state.held.includes('master-detail')).toBe(true);
  await expect(page.locator('#lsn-spec')).not.toBeEditable();
  const firstExactReads = f.state.reads.filter(read => read.exact).length;
  // The held response has already captured the previous permission's row.
  // The real coordinator's post-read permission fence must discard that value.
  f.state.permission = 'fixture-permission-2';
  f.state.rows = [{ ...stock(), spec: 'Current permission row' }];
  release();
  await expect(page.getByRole('button', { name: 'Retry details', exact: true })).toBeVisible();
  await expect(page.locator('#lsn-spec')).not.toBeEditable();
  await expect(page.locator('#lsn-btn-save-complete')).toBeDisabled();
  expect(await page.evaluate(() => window.eval('hasProductionMasterDetailForItem(activeItem)'))).toBe(false);
  await page.getByRole('button', { name: 'Retry details', exact: true }).click();
  await exactDetailReady(page);
  await expect(page.locator('#lsn-spec')).toHaveValue('Current permission row');
  expect(await page.evaluate(() => window.eval(`({spec:activeItem.SPEC,
    permission:getProductionMasterDetailContext().permissionVersion})`)))
    .toEqual({ spec: 'Current permission row', permission: 'fixture-permission-2' });
  expect(f.state.reads.filter(read => read.exact).length).toBeGreaterThan(firstExactReads);
  expect(f.state.forbidden).toEqual([]);
});
