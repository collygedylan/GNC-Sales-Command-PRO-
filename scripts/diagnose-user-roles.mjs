import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createReleaseTestServer } from './serve-release-tests.mjs';
import { installHlOrderFixture, hlMaster, hlUserId } from '../tests/fixtures/hl-order-state.mjs';

export const diagnosticRoles = ['ADMIN', 'REP', '\nREP', 'CSR', 'DATA ENTRY', 'DATA ENTRY SUPERVISOR',
  'EVAL', 'FOREMAN', 'GROWER', 'QC', 'QC SUPERVISOR', 'TAKE BACKS'];
export const diagnosticScreens = ['drive', 'sales-inventory', 'request', 'request-history', 'historical-requests'];
export const diagnosticDriveLoadedSelector = '#drive-content .app-smart-card, #drive-content .drive-grid-row[data-dom-id], #drive-content :text-matches("^No Drive Mode (items match these filters|rows are available for .*?)\\\\.$", "i")';
const rolesWithDrive = new Set(diagnosticRoles.filter(role => !['GROWER', 'TAKE BACKS'].includes(role)));
const readActions = new Set(['inventory_read', 'request_history', 'sales_credit', 'historical_requests',
  'request_recipient_directory', 'native_session_bridge', 'navigation_preferences', 'dataset_revisions', 'app_access', 'dataset_read',
  'av_read', 'get_user_preferences', 'live_pilot_bootstrap']);
const readOperations = new Set(['get', 'read', 'list', 'summary', 'customers', 'consignees', 'requests', 'reps', 'months',
  'compatibility', 'search', 'folders', 'master_page', 'master_delta', 'source_freshness', 'schema_capabilities', 'po_detail',
  'recount_queue', 'ncr_queue', 'not_on_inventory_queue', 'scope', 'settings']);
export function diagnosticRequestAllowed(url, method, body) {
  const target = new URL(url);
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (target.pathname === '/auth/v1/token') return target.searchParams.get('grant_type') === 'refresh_token';
  if (target.pathname.startsWith('/rest/v1/rpc/')) return /\/(?:get_|read_|historical_requests_read_v1|inventory_read|app_access_context_v1|navigation_preferences_read_v1)/.test(target.pathname);
  return target.pathname === '/functions/v1/app-api' && readActions.has(body?.action)
    && (!body.operation || readOperations.has(body.operation)) && !body.commandId && !body.command_id;
}

export async function probeRoleBaseline(account, { supabaseURL, key, fetcher = fetch }) {
  assert.ok(account.session?.access_token, 'An authenticated session is required');
  const headers = { apikey: key, authorization: `Bearer ${account.session.access_token}`, 'content-type': 'application/json' };
  const inventory = await fetcher(`${supabaseURL}/functions/v1/app-api`, { method: 'POST', headers,
    body: JSON.stringify({ action: 'inventory_read', operation: 'master_page', params: { dataset: 'master', projection: 'browse', limit: 1, offset: 0 } }) });
  const inventoryBody = await inventory.json();
  const history = await fetcher(`${supabaseURL}/rest/v1/rpc/historical_requests_read_v1`, { method: 'POST', headers,
    body: JSON.stringify({ p_query: { operation: 'customers', pageSize: 1 } }) });
  const historyBody = await history.json();
  const requests = await fetcher(
    `${supabaseURL}/rest/v1/ph_requests_pending?select=unique_id&limit=1`,
    { headers },
  );
  const requestsBody = await requests.json();
  const safeCode = body => /^[A-Z0-9_]+$/.test(body?.code || '') ? body.code : undefined;
  return {
    inventory: { status: inventory.status, total: inventoryBody.data?.total, rows: inventoryBody.data?.rows?.length, code: safeCode(inventoryBody) },
    history: { status: history.status, rows: Array.isArray(historyBody.rows) ? historyBody.rows.length : undefined, code: safeCode(historyBody) },
    requests: { status: requests.status, rows: Array.isArray(requestsBody) ? requestsBody.length : undefined, code: safeCode(requestsBody) },
  };
}

export async function openDiagnosticDriveCards(page) {
  const cardMode = page.locator('#tab-drive-card');
  const mobileMode = page.locator('#drive-mobile-mode');
  if (await mobileMode.isVisible()) await mobileMode.selectOption('card');
  else await cardMode.click();
  await page.locator(diagnosticDriveLoadedSelector).first().waitFor({ state: 'visible', timeout: 90000 });
}

export async function waitForDiagnosticHistory(page, view, screen) {
  await view.locator('.historical-requests').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(id => {
    const host = document.getElementById(id);
    return host && ![...host.querySelectorAll('[role="status"]')].some(element => /^Loading|^Saving/i.test(element.textContent.trim()));
  }, 'view-' + screen, { timeout: 90000 });
  assert.equal(await view.locator('[role="alert"]').count(), 0, 'Authorized Request History could not load');
}

/** Authenticated sessions are supplied in memory. Reports never contain credentials or row contents. */
export async function runRoleDiagnostics({ accounts, baseURL, fixture = false,
  output = 'node_modules/.cache/user-role-diagnostics.json', readBaseline } = {}) {
  assert.ok(Array.isArray(accounts) && accounts.length, 'Diagnostic accounts are required');
  const browser = await chromium.launch();
  const report = { mode: fixture ? 'isolated-browser-fixtures' : 'authenticated-production-read-only', roles: [] };
  try {
    for (const account of accounts) {
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
      const page = await context.newPage();
      const entry = { role: account.role, login: false, screens: [], crashes: 0, blockedWrites: 0 };
      report.roles.push(entry);
      page.on('pageerror', () => { entry.crashes++; });
      try {
        if (fixture) {
          await installHlOrderFixture(page, baseURL, { role: account.role, username: account.username,
            startupMode: 'cold', master: [hlMaster('diagnostic-stock', { priority: '1', assignedto: account.username })],
            appPermissions: diagnosticScreens.map(moduleKey => ({
              permissionKey: `module.${moduleKey}.view`, kind: 'module', moduleKey,
              allowed: moduleKey === 'drive' ? rolesWithDrive.has(account.role)
                : moduleKey === 'historical-requests' ? account.role === 'ADMIN'
                  : ['request', 'request-history'].includes(moduleKey) ? ['ADMIN', 'REP', '\nREP', 'CSR'].includes(account.role) : true,
            })) });
          await page.route('**/functions/v1/app-api', async route => {
            const request = route.request();
            let body;
            try { body = request.postDataJSON(); } catch { return route.fallback(); }
            const payload = body?.payload;
            const historyRead = request.method() === 'POST' && body?.action === 'request_history'
              && ['search', 'folders'].includes(body.operation)
              && Object.keys(body).every(key => ['action', 'operation', 'payload'].includes(key))
              && payload?.status === 'all' && payload?.query === '' && payload?.limit === 50
              && Object.keys(payload).every(key => ['query', 'status', 'limit'].includes(key))
              && request.headers().authorization?.startsWith('Bearer ')
              && !request.headers()['idempotency-key'];
            if (!historyRead) return route.fallback();
            return route.fulfill({ json: { ok: true, data: { rows: [], nextCursor: null } } });
          });
          await page.route('**/rest/v1/rpc/historical_requests_read_v1', async route => {
            const query = route.request().postDataJSON()?.p_query;
            if (route.request().method() !== 'POST' || !route.request().headers().authorization?.startsWith('Bearer ')
              || !['reps','customers','consignees','folders','requests','summary','months'].includes(query?.operation)) return route.fallback();
            const financials = account.role === 'ADMIN' && account.username === 'dylan_collyge';
            const rows = query.operation === 'reps' && !financials ? [{ key: 'rep:' + hlUserId, label: account.username,
              requestCount: 0, totalValue: null, unpricedCount: null, customerKey: null, consigneeKey: null, consigneeName: null }] : [];
            return route.fulfill({ json: { ok: true, scope: financials ? 'all' : 'own', financials,
              recordKind: query.recordKind || 'all', ownRepKey: 'rep:' + hlUserId, revision: 'diagnostic-history-v3',
              generatedAt: new Date().toISOString(), page: query.page || 0, pageSize: query.pageSize || 25, total: rows.length, rows,
              summary: { requestCount: 0, totalValue: financials ? 0 : null, unpricedCount: financials ? 0 : null } } });
          });
        } else {
          assert.ok(account.session?.access_token && account.session?.user?.id === account.id, 'Verified account session required');
          await page.route('**/*', async route => {
            const request = route.request();
            let body;
            try { body = request.postDataJSON(); } catch { /* Read-only gate rejects unrecognized writes. */ }
            if (diagnosticRequestAllowed(request.url(), request.method(), body)) return route.continue();
            entry.blockedWrites++;
            return route.abort('blockedbyclient');
          });
          await page.addInitScript(value => {
            localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(value.session));
            localStorage.setItem('gnc_user_v3', value.username);
            localStorage.setItem('gnc_role_v3', value.role);
            localStorage.setItem('gnc_division_v1', '10');
            delete window.PushManager;
          }, { session: account.session, username: account.username, role: account.role });
          await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
          await page.locator('#view-login').waitFor({ state: 'hidden', timeout: 45000 });
          await page.waitForFunction(() => document.body.classList.contains('role-access-ready'), { timeout: 45000 });
        }
        entry.login = true;
        if (readBaseline) {
          entry.baseline = await readBaseline(account);
          assert.equal(entry.baseline.inventory.status, 200, 'Inventory baseline is unavailable for an active role');
          assert.ok(Number.isInteger(entry.baseline.inventory.rows), 'Inventory baseline has no rows contract');
          if (entry.baseline.inventory.total > 0) assert.ok(entry.baseline.inventory.rows > 0, 'Baseline inventory was over-restricted');
          if (['ADMIN', 'REP', 'SALESREP'].includes(account.role.trim().toUpperCase())) {
            assert.equal(entry.baseline.history.status, 200, 'Authorized Request History baseline is unavailable');
          }
        }
        for (const screen of diagnosticScreens) {
          const tile = page.locator(`#home-tile-${screen},#home-sales-open-${screen}`).filter({ visible: true }).first();
          const tileVisible = await tile.isVisible();
          const allowed = tileVisible || await page.evaluate(screen => window.eval(`canAccessView(${JSON.stringify(screen)})`), screen);
          const item = { screen, allowed, visible: false, cards: 0 };
          entry.screens.push(item);
          if (!allowed) continue;
          if (tileVisible) await tile.click();
          else await page.evaluate(screen => window.eval(`switchView(${JSON.stringify(screen)})`), screen);
          const view = page.locator(`#view-${screen}`);
          await view.waitFor({ state: 'visible', timeout: 20000 });
          if (screen === 'drive') await openDiagnosticDriveCards(page);
          if (['request-history','historical-requests'].includes(screen)) {
            await waitForDiagnosticHistory(page, view, screen);
          }
          item.visible = true;
          item.cards = await view.locator('.app-smart-card,[data-request-id],[data-inventory-card]').count();
          item.gridRows = await view.locator('.drive-grid-row[data-dom-id]').count();
          if (fixture && screen === 'drive') assert.ok(item.cards > 0, 'Assigned fixture inventory was not visible');
          item.headings = await view.locator('h1,h2,h3').allTextContents();
          item.headings = item.headings.map(text => text.trim().slice(0, 80)).slice(0, 8);
          if (screen === 'drive') {
            const inquiry = view.locator('.app-card-bottom-btn--argos-reclass').first();
            const available = await inquiry.isVisible();
            entry.screens.push({ screen: 'reclass-item-inquiry', allowed: available, visible: false });
            if (available) {
              await inquiry.click();
              await page.locator('#argos-inventory-transaction-modal').waitFor({ state: 'visible', timeout: 90000 });
              entry.screens.at(-1).visible = true;
              await page.keyboard.press('Escape');
              await page.evaluate(() => window.eval('closeArgosInventoryTransactionModal()'));
            }
          }
          await page.evaluate(() => window.eval("switchView('home')"));
        }
        assert.equal(entry.crashes, 0, 'A primary screen raised an unhandled browser error');
      } catch (error) {
        entry.failure = error.name;
        if (fixture) console.error(error.message.slice(0, 500));
      } finally {
        await context.close();
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ role: entry.role, login: entry.login, crashes: entry.crashes,
          visible: entry.screens.filter(screen => screen.visible).map(screen => screen.screen), failure: entry.failure }));
      }
    }
  } finally { await browser.close(); }
  assert.ok(report.roles.every(role => role.login && !role.failure && !role.crashes), 'Role diagnostic failures recorded');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv.includes('--fixture')) throw new Error('Use --fixture, or import with explicitly verified account sessions');
  const server = await createReleaseTestServer();
  await new Promise(resolve => server.listen(43169, '127.0.0.1', resolve));
  try {
    await runRoleDiagnostics({ fixture: true, baseURL: 'http://127.0.0.1:43169', accounts: diagnosticRoles.map((role, index) => ({
      role, username: role === 'ADMIN' ? 'dylan_collyge' : `diagnostic_role_${index}`,
    })) });
  } finally { await new Promise(resolve => server.close(resolve)); }
}
