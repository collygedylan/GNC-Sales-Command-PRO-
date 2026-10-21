import { readComposedAppSource } from './composed-app-source.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { chromium, devices, webkit } from '@playwright/test';
import { installHlOrderFixture } from '../tests/fixtures/hl-order-state.mjs';
import { inventoryReadFixture } from '../tests/fixtures/inventory-list-read-fixture.mjs';

// Default mode verifies supplied genuine sessions. Snapshot-fixture mode uses
// synthetic profiles and fully intercepted reads from a saved production
// snapshot; it never claims live authentication or records tokens/row data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = String(process.env.GNC_AV_REP_APP_ORIGIN || 'https://agmetricapp.com').replace(/\/+$/, '');
const sessionFile = String(process.env.GNC_AV_REP_SESSIONS_FILE || '').trim();
const outputFile = path.resolve(process.env.GNC_AV_REP_OUTPUT || path.join(root, '.gnc-local', 'v2310-live-av-e2e.json'));
const envFile = path.resolve(process.env.GNC_SUPABASE_ENV_FILE || 'C:/Users/dylan/Projects/GNC/repo/.env');
const caFile = path.resolve(root, 'scripts/certs/supabase-prod-ca-2021.crt');
const shell = readComposedAppSource();
const supabaseUrl = shell.match(/const SUPABASE_URL = "([^"]+)"/)?.[1] || '';
const publishableKey = shell.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1] || '';
const safeProgress = { failedUsername: null, completedUsers: [] };

function validateSnapshotFixture(fixture) {
  if (fixture?.mode !== 'production_snapshot_fixture' || fixture?.configuration?.currentSeason !== 'F1'
    || Number(fixture?.configuration?.currentSalesYearMax) !== 27 || !Array.isArray(fixture?.master?.rows)
    || fixture.master.rows.length !== Number(fixture?.source?.masterRowCount)
    || !Array.isArray(fixture?.reps) || fixture.reps.length !== 23) {
    fail('The production snapshot fixture does not match the 23-Rep F1/27 contract.');
  }
  const names = new Set();
  for (const rep of fixture.reps) {
    const username = String(rep?.username || '').trim().toLowerCase();
    if (!username || names.has(username) || String(rep?.role || '').trim().toUpperCase() !== 'REP'
      || !Number.isInteger(Number(rep?.expectedRows)) || Number(rep.expectedRows) < 1
      || !Number.isInteger(Number(rep?.expectedItemcodes)) || Number(rep.expectedItemcodes) < 1
      || !Array.isArray(rep?.reserveOwnerRows)) {
      fail('The production snapshot fixture contains an invalid or duplicate Rep contract.');
    }
    names.add(username);
  }
  return fixture;
}

function selectSnapshotReps(fixture) {
  const requestedText = String(process.env.GNC_AV_REP_USERS || '').trim();
  const requestedUsers = requestedText ? requestedText.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) : [];
  const limitText = String(process.env.GNC_AV_REP_LIMIT || '').trim();
  if (requestedUsers.length && limitText) fail('Use either GNC_AV_REP_USERS or GNC_AV_REP_LIMIT, not both.');
  if (requestedUsers.length) {
    const unique = new Set(requestedUsers);
    if (unique.size !== requestedUsers.length) fail('GNC_AV_REP_USERS contains duplicate usernames.');
    const byUsername = new Map(fixture.reps.map(rep => [String(rep.username).trim().toLowerCase(), rep]));
    const missing = requestedUsers.filter(username => !byUsername.has(username));
    if (missing.length) fail('GNC_AV_REP_USERS contains a username outside the validated snapshot directory.');
    return requestedUsers.map(username => byUsername.get(username));
  }
  const requestedLimit = Number(limitText);
  if (limitText && (!Number.isInteger(requestedLimit) || requestedLimit < 1)) fail('GNC_AV_REP_LIMIT must be a positive integer.');
  return fixture.reps.slice(0, requestedLimit || fixture.reps.length);
}

function precomputeMasterPageFixtureResponses(masterRows, firstPageLimit) {
  const startedAt = Date.now();
  const canonicalRows = masterRows.map(row => inventoryReadFixture.fromFixtureShape(row))
    .sort((left, right) => String(left.unique_id).localeCompare(String(right.unique_id)));
  const cache = new Map();
  const continuationOffsets = [];
  for (let offset = firstPageLimit; offset < canonicalRows.length; offset += 500) continuationOffsets.push(offset);
  const offsetsByLimit = new Map([[firstPageLimit, [0]], [500, [0, ...continuationOffsets]]]);
  for (const projection of ['full', 'browse']) {
    for (const [limit, offsets] of offsetsByLimit) {
      for (const offset of offsets) {
        const pageRows = canonicalRows.slice(offset, offset + limit);
        const projected = inventoryReadFixture.readMasterPage(pageRows, { dataset: 'master', projection, offset: 0, limit });
        const body = JSON.stringify({ ok: true, data: { ...projected, total: canonicalRows.length, offset, limit,
          hasMore: offset + projected.rows.length < canonicalRows.length } });
        const payloadBytes = Buffer.from(body);
        const byteLength = payloadBytes.byteLength;
        const sha256 = createHash('sha256').update(payloadBytes).digest('hex');
        cache.set(`${projection}|${offset}|${limit}`, { body, responseRows: projected.rows.length,
          uncompressedByteLength: byteLength, wireByteLength: byteLength, sha256, status: 200 });
      }
    }
  }
  return { cache, rowCount: canonicalRows.length, precomputeMs: Date.now() - startedAt,
    responseCount: cache.size,
    uncompressedResponseBytes: [...cache.values()].reduce((sum, item) => sum + item.uncompressedByteLength, 0),
    wireResponseBytes: [...cache.values()].reduce((sum, item) => sum + item.wireByteLength, 0) };
}

async function mainSnapshotFixture() {
  const fixtureFile = path.resolve(process.env.GNC_AV_REP_SNAPSHOT_FIXTURE || path.join(root, '.gnc-local', 'v2310-live-reps-fixture.json'));
  const fixture = validateSnapshotFixture(JSON.parse(fs.readFileSync(fixtureFile, 'utf8')));
  const fixtureDigest = await import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(fixtureFile)).digest('hex'));
  const firstPageLimit = Number(shell.match(/options\.preview && isAvOpenPreview \? \{ firstPageLimit:\s*(\d+) \}/)?.[1] || 0);
  if (!Number.isInteger(firstPageLimit) || firstPageLimit < 1 || firstPageLimit > 500) {
    fail('Could not derive AV preview first-page limit from the current application source.');
  }
  const masterPageFixture = precomputeMasterPageFixtureResponses(fixture.master.rows, firstPageLimit);
  const appOrigin = String(process.env.GNC_AV_REP_FIXTURE_ORIGIN || 'http://127.0.0.1:43116').replace(/\/+$/, '');
  const deviceName = String(process.env.GNC_AV_REP_DEVICE || 'Pixel 7').trim();
  const device = devices[deviceName];
  if (!device) fail(`Unsupported Playwright device profile: ${deviceName}.`);
  const browserType = /^iPhone/i.test(deviceName) ? webkit : chromium;
  const selectedReps = selectSnapshotReps(fixture);
  const browser = await browserType.launch({ headless: true });
  const output = {
    startedAt: new Date().toISOString(), mode: 'production_snapshot_fixture',
    realAuthenticationVerified: false, syntheticProfileRequestBinding: true,
    fixtureFile: path.relative(root, fixtureFile).replaceAll('\\', '/'), fixtureSha256: fixtureDigest,
    snapshotCapturedAt: fixture.capturedAt, snapshotRevisions: fixture.source?.revisions || null,
    snapshotSource: fixture.oracle?.limitations || 'Sanitized saved production snapshot; no genuine sessions or live API reads.',
    fixtureTransport: { kind: 'precomputed exact master_page responses via inventoryReadFixture contract',
      masterRows: masterPageFixture.rowCount, responseCount: masterPageFixture.responseCount,
      firstPageLimit,
      uncompressedResponseBytes: masterPageFixture.uncompressedResponseBytes,
      wireResponseBytes: masterPageFixture.wireResponseBytes, precomputeMs: masterPageFixture.precomputeMs,
      compression: 'none; raw UTF-8 JSON matches the existing fixture route response envelope' },
    environment: { device: deviceName, browser: /^iPhone/i.test(deviceName) ? 'WebKit' : 'Chromium',
      viewport: device.viewport, trace: 'off', cache: 'fresh browser context; shared OS cache uncontrolled' },
    repCountExpected: selectedReps.length, repCountInSnapshot: fixture.reps.length,
    selectedUsernames: selectedReps.map(rep => String(rep.username).trim().toLowerCase()), reps: [],
  };
  safeProgress.completedUsers = output.reps;
  let currentlyChecking = '';
  try {
    for (const rep of selectedReps) {
      const username = String(rep.username).trim().toLowerCase();
      currentlyChecking = username;
      safeProgress.failedUsername = username;
      safeProgress.currentResult = { username, phase: 'context-create', status: 'in_progress' };
      const context = await browser.newContext({ ...device, serviceWorkers: 'block' });
      const page = await context.newPage();
      const pageErrors = [];
      const consoleDiagnostics = [];
      const readRequests = [];
      const precomputedRequestEvents = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', message => {
        if (!['error', 'warning'].includes(message.type()) || consoleDiagnostics.length >= 40) return;
        consoleDiagnostics.push({ type: message.type(), message: safeDiagnostic({ message: message.text() }).message });
      });
      page.on('request', request => {
        if (!request.url().includes('/functions/v1/app-api') || request.method() !== 'POST') return;
        let body;
        try { body = request.postDataJSON() || {}; } catch { return; }
        const startedAt = Date.now();
        if (body.action !== 'inventory_read') return;
        const params = body.params || {};
        const cachedPage = body.action === 'inventory_read' && body.operation === 'master_page' && params.dataset === 'master'
          ? masterPageFixture.cache.get(`${String(params.projection || 'initial')}|${Math.max(0, Number(params.offset) || 0)}|${Math.min(500, Math.max(1, Number(params.limit) || 250))}`)
          : null;
        const record = { action: String(body.action || '').slice(0, 40), operation: String(body.operation || '').slice(0, 60),
          dataset: String(params.dataset || '').slice(0, 40), offset: Number(params.offset || 0),
          limit: Number(params.limit || 0), projection: String(params.projection || ''), startedAt, responseHeadersAt: null, responseFinishedAt: null,
          durationToHeadersMs: null, durationToFinishMs: null, httpStatus: null,
          responseRows: cachedPage?.responseRows ?? null, precomputed: !!cachedPage,
          responseUncompressedBytes: cachedPage?.uncompressedByteLength ?? null, responseWireBytes: cachedPage?.wireByteLength ?? null,
          authorizationPresent: Boolean(request.headers()['authorization']) };
        readRequests.push(record);
        request.response().then(async response => {
          if (!response) return;
          record.responseHeadersAt = Date.now();
          record.durationToHeadersMs = record.responseHeadersAt - startedAt;
          record.httpStatus = response.status();
          if (!response.ok()) return;
          if (!cachedPage) {
            try {
              const payload = await response.json();
              const rows = Array.isArray(payload) ? payload
                : Array.isArray(payload?.rows) ? payload.rows
                  : Array.isArray(payload?.data?.rows) ? payload.data.rows
                    : Array.isArray(payload?.data) ? payload.data
                      : Array.isArray(payload?.result?.rows) ? payload.result.rows : null;
              record.responseRows = rows?.length ?? null;
            } catch { record.responseRows = null; }
          }
          await response.finished().catch(() => null);
          record.responseFinishedAt = Date.now();
          record.durationToFinishMs = record.responseFinishedAt - startedAt;
        });
      });
      safeProgress.currentResult = { username, phase: 'synthetic-login-bootstrap', status: 'in_progress' };
      let control;
      try {
        control = await installHlOrderFixture(page, appOrigin, {
          username, role: 'REP', startupMode: 'cold', master: fixture.master.rows,
          reserveRows: rep.reserveOwnerRows,
          beforeNavigate: async () => {
            await page.route('**/functions/v1/app-api*', async route => {
              const request = route.request();
              if (request.method() !== 'POST') return route.fallback();
              let body;
              try { body = request.postDataJSON() || {}; } catch { return route.fallback(); }
              if (body.action !== 'inventory_read' || body.operation !== 'master_page'
                || body.params?.dataset !== 'master' || body.params?.season || body.params?.uniqueId
                || body.params?.itemCode || body.params?.locationCode || body.params?.lotCode || body.params?.source) {
                return route.fallback();
              }
              const params = body.params || {};
              const projection = String(params.projection || 'initial');
              const offset = Math.max(0, Number(params.offset) || 0);
              const limit = Math.min(500, Math.max(1, Number(params.limit) || 250));
              const precomputed = masterPageFixture.cache.get(`${projection}|${offset}|${limit}`);
              if (!precomputed) return route.fallback();
              const startedAt = Date.now();
              await route.fulfill({ status: precomputed.status, contentType: 'application/json', headers: {
                'access-control-allow-origin': appOrigin,
                'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
                'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile',
                'access-control-expose-headers': 'content-range', 'access-control-allow-credentials': 'true',
              }, body: precomputed.body });
              precomputedRequestEvents.push({ offset, limit, projection, responseRows: precomputed.responseRows,
                uncompressedResponseBytes: precomputed.uncompressedByteLength, wireResponseBytes: precomputed.wireByteLength,
                sha256: precomputed.sha256, routeFulfillMs: Date.now() - startedAt });
            });
          },
        });
      } catch (error) {
        safeProgress.currentResult = { username, status: 'synthetic_fixture_bootstrap_failed', error: safeDiagnostic(error) };
        throw error;
      }
      safeProgress.currentResult = { username, phase: 'profile-check', status: 'in_progress', fixtureErrors: control.errors.length };
      await page.waitForFunction(expected => {
        const profile = window.eval(`({ username: String(nativeAuthProfile?.username || '').trim().toLowerCase(), role: String(nativeAuthProfile?.role || '').trim().toUpperCase() })`);
        return profile.username === expected && profile.role === 'REP';
      }, username, { timeout: 30_000 });
      const profile = await page.evaluate(() => window.eval(`({ username: String(nativeAuthProfile.username || '').trim().toLowerCase(), role: String(nativeAuthProfile.role || '').trim().toUpperCase() })`));
      if (profile.username !== username || profile.role !== 'REP') fail(`Synthetic profile binding failed for ${username}.`);
      safeProgress.currentResult = { username, phase: 'navigate-av', status: 'in_progress', fixtureErrors: control.errors.length };
      await page.locator('#footer-menu-btn').click();
      const avNav = page.locator('#drawer-av-btn');
      await avNav.waitFor({ state: 'visible', timeout: 10_000 });
      safeProgress.currentResult = { username, phase: 'measure-av-initial-window', status: 'in_progress', fixtureErrors: control.errors.length };
      await page.evaluate(expectedRows => {
        const measurement = window.__gncAvPaint = { startedAt: null, firstCardMs: null, initialWindowMs: null, fullReadyMs: null,
          loadingObserved: false, previewCardCount: 0, lastObservation: null, coordinatorTransitions: [],
          renderWindowTransitions: [] };
        let previousCoordinator = '';
        let previousWindow = '';
        const sampleInternals = (elapsedMs, dataReadiness) => {
          const syncState = window.eval(`String(getProductionLiveSyncCoordinator?.().getStatus?.()?.state||'')`);
          const status = { state: syncState, masterRows: dataReadiness.masterRows, reserveRows: dataReadiness.reserveRows,
            masterFull: dataReadiness.masterFull, reservesFull: dataReadiness.reservesFull };
          const coordinatorKey = JSON.stringify(status);
          if (coordinatorKey !== previousCoordinator && measurement.coordinatorTransitions.length < 160) {
            measurement.coordinatorTransitions.push({ elapsedMs, ...status });
            previousCoordinator = coordinatorKey;
          }
          const win = window.eval(`(() => { const el=document.getElementById('av-content'); const s=el?._avCardWindow||{};
            return { token:Number(typeof avRenderChunkToken==='undefined'?-1:avRenderChunkToken), index:Number(s.index||0),
              total:Number(s.rows?.length||0), loading:!!s.loading, more:!!s.moreButton?.isConnected,
              cards:document.querySelectorAll('#av-content .app-smart-card--inventory[data-dom-id]').length }; })()`);
          const windowKey = JSON.stringify(win);
          if (windowKey !== previousWindow && measurement.renderWindowTransitions.length < 240) {
            measurement.renderWindowTransitions.push({ elapsedMs, ...win });
            previousWindow = windowKey;
          }
        };
        let pendingFrame = false;
        const sample = () => {
          if (measurement.startedAt === null || pendingFrame) return;
          pendingFrame = true;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            pendingFrame = false;
            const cards = document.querySelectorAll('#av-content .app-smart-card--inventory[data-dom-id]');
            const visible = !!cards[0]?.getClientRects().length;
            const elapsed = performance.now() - measurement.startedAt;
            if (visible && measurement.firstCardMs === null) measurement.firstCardMs = elapsed;
            if (visible && cards.length >= 20 && measurement.initialWindowMs === null) measurement.initialWindowMs = elapsed;
            const crumb = document.getElementById('av-crumb')?.textContent || '';
            if (/loading full inventory/i.test(crumb)) {
              measurement.loadingObserved = true;
              measurement.previewCardCount = Math.max(measurement.previewCardCount, cards.length);
            }
            const dataReadiness = window.eval(`({ masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
              reserveRows: Array.isArray(reservesInventory) ? reservesInventory.length : -1,
              masterFull: !!getDatasetState('master')?.fullLoaded, reservesFull: !!getDatasetState('reserves')?.fullLoaded,
              syncState: String(getProductionLiveSyncCoordinator?.().getStatus?.()?.state || ''),
              syncMessage: (() => { const s=getProductionLiveSyncCoordinator?.().getStatus?.()||{}; const v=String(s.message||s.error?.message||'');
                return v.replace(/https?:\\/\\/\\S+/g,'[url]').replace(/Bearer\\s+\\S+/gi,'[authorization]').slice(0,180); })(),
              viewLoadError: (() => { const v=String(productionLiveSyncViewLoad?.error?.message||'');
                return v.replace(/https?:\\/\\/\\S+/g,'[url]').replace(/Bearer\\s+\\S+/gi,'[authorization]').slice(0,180); })() })`);
            sampleInternals(elapsed, dataReadiness);
            measurement.lastObservation = { elapsedMs: elapsed, masterRows: dataReadiness.masterRows,
              reserveRows: dataReadiness.reserveRows, masterFull: dataReadiness.masterFull,
              reservesFull: dataReadiness.reservesFull, syncState: dataReadiness.syncState,
              syncMessage: dataReadiness.syncMessage, viewLoadError: dataReadiness.viewLoadError,
              crumb: crumb.slice(0, 120), mountedCards: cards.length, exportDisabled: !!document.getElementById('av-export-btn')?.disabled };
            const count = Number(crumb.match(/\(([\d,]+) items?\)/i)?.[1]?.replace(/,/g, '') || -1);
            const exportLabel = document.getElementById('av-export-btn-label')?.textContent || '';
            const exportCount = Number(exportLabel.match(/\(([\d,]+)\)\s*$/)?.[1]?.replace(/,/g, '') || -1);
            const ready = window.eval("getDatasetState('master').fullLoaded && getDatasetState('reserves').fullLoaded && !isAvLiveCatalogIncomplete()");
            if (ready && visible && cards.length >= 20 && count === expectedRows && exportCount === expectedRows
              && !/loading full inventory/i.test(crumb) && !document.getElementById('av-export-btn')?.disabled) {
              measurement.fullReadyMs = elapsed;
              observer.disconnect();
            }
          }));
        };
        const observer = new MutationObserver(sample);
        observer.observe(document.getElementById('view-av'), { subtree: true, childList: true, characterData: true, attributes: true });
        document.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('#drawer-av-btn')) {
            measurement.startedAt = performance.now();
            sample();
          }
        }, true);
      }, Number(rep.expectedRows));
      safeProgress.currentResult = { username, phase: 'first-window-and-full-ready', status: 'in_progress', fixtureErrors: control.errors.length };
      await avNav.click();
      try {
        await page.waitForFunction(() => Number.isFinite(window.__gncAvPaint?.fullReadyMs), null, { timeout: 120_000 });
      } catch (error) {
        const diagnostics = await page.evaluate(() => ({ lastObservation: window.__gncAvPaint?.lastObservation || null,
          coordinatorTransitions: window.__gncAvPaint?.coordinatorTransitions || [],
          renderWindowTransitions: window.__gncAvPaint?.renderWindowTransitions || [] })).catch(() => ({}));
        safeProgress.currentResult = { username, phase: 'full-ready-wait', status: 'full_ready_timeout',
        ...diagnostics, apiRequests: readRequests, precomputedMasterPageRequests: precomputedRequestEvents,
        fixtureTransport: { rowCount: masterPageFixture.rowCount, responseCount: masterPageFixture.responseCount, firstPageLimit,
          uncompressedResponseBytes: masterPageFixture.uncompressedResponseBytes,
          wireResponseBytes: masterPageFixture.wireResponseBytes, precomputeMs: masterPageFixture.precomputeMs },
        pageErrors: pageErrors.length, consoleDiagnostics, fixtureErrors: control.errors.length,
          blockedMutations: control.blockedMutations.length, masterPageRequests: readRequests.length,
          error: safeDiagnostic(error) };
        throw error;
      }
      const paint = await page.evaluate(() => window.__gncAvPaint);
      safeProgress.currentResult = { username, phase: 'final-visible-state-snapshot', status: 'in_progress',
        loadingObserved: paint.loadingObserved, previewCardCount: paint.previewCardCount };
      const state = await page.evaluate(() => window.eval(`(() => {
        const resolved = getCurrentAVBaseItems({ usePreparedSalesRows: true }) || {};
        const rows = Array.isArray(resolved.items) ? resolved.items : [];
        const crumb = document.getElementById('av-crumb')?.textContent || '';
        const label = document.getElementById('av-export-btn-label')?.textContent || '';
        return { masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
          reserveRows: Array.isArray(reservesInventory) ? reservesInventory.length : -1,
          renderedRows: rows.length,
          itemcodes: new Set(rows.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()).filter(Boolean)).size,
          exportCount: getAVVisibleExportCount(rows), exportLabel: label,
          exportDisabled: !!document.getElementById('av-export-btn')?.disabled,
          isPartial: !!resolved.isPartial, loading: /loading full inventory/i.test(crumb),
          crumbCount: Number(crumb.match(/\\(([\\d,]+) items?\\)/i)?.[1]?.replace(/,/g, '') || -1),
          mountedCards: document.querySelectorAll('#av-content .app-smart-card--inventory[data-dom-id]').length,
          currentView: getCurrentVisibleViewId() };
      })()`));
      const apiReadCount = readRequests.filter(request => request.dataset === 'master').length;
      const currentResult = { username, expectedRows: Number(rep.expectedRows), expectedItemcodes: Number(rep.expectedItemcodes),
        actualRows: state.renderedRows, actualItemcodes: state.itemcodes, exportCount: state.exportCount,
        mountedCards: state.mountedCards, masterRows: state.masterRows, reserveRows: state.reserveRows,
        firstCardMs: paint.firstCardMs, initialWindowMs: paint.initialWindowMs, fullReadyMs: paint.fullReadyMs,
        loadingObserved: paint.loadingObserved, previewCardCount: paint.previewCardCount,
        loadingCleared: !state.loading, status: 'not_passed' };
      currentResult.apiRequests = readRequests;
      currentResult.precomputedMasterPageRequests = precomputedRequestEvents;
      currentResult.fixtureTransport = { rowCount: masterPageFixture.rowCount, responseCount: masterPageFixture.responseCount,
        uncompressedResponseBytes: masterPageFixture.uncompressedResponseBytes,
        wireResponseBytes: masterPageFixture.wireResponseBytes, precomputeMs: masterPageFixture.precomputeMs };
      currentResult.consoleDiagnostics = consoleDiagnostics;
      currentResult.pageErrorMessages = pageErrors.slice(0, 20).map(message => safeDiagnostic({ message }).message);
      currentResult.coordinatorTransitions = paint.coordinatorTransitions;
      currentResult.renderWindowTransitions = paint.renderWindowTransitions;
      safeProgress.currentResult = currentResult;
      if (state.masterRows !== fixture.master.rows.length || state.reserveRows !== rep.reserveOwnerRows.length
        || state.exportDisabled || state.loading || state.currentView !== 'av' || state.isPartial
        || state.renderedRows !== Number(rep.expectedRows) || state.itemcodes !== Number(rep.expectedItemcodes)
        || state.crumbCount !== state.renderedRows || state.mountedCards < 20
        || state.exportCount !== state.renderedRows || Number(state.exportLabel.match(/\(([\d,]+)\)\s*$/)?.[1]?.replace(/,/g, '') || -1) !== state.exportCount
        || ![paint.firstCardMs, paint.initialWindowMs].every(value => Number.isFinite(value) && value < 1500)
        || !apiReadCount || readRequests.some(request => !request.authorizationPresent)
        || pageErrors.length || control.blockedMutations.length || control.errors.length) {
        fail(`Snapshot fixture AV visibility/readiness/paint gate failed for ${username}.`);
      }
      currentResult.role = profile.role;
      currentResult.syntheticProfileRequestBinding = true;
      currentResult.masterRows = state.masterRows;
      currentResult.reserveRows = state.reserveRows;
      currentResult.masterRevision = fixture.source?.revisions?.ph_master_inventory?.revision ?? null;
      currentResult.reservesRevision = fixture.source?.revisions?.ph_reserves?.revision ?? null;
      currentResult.masterPageRequests = apiReadCount;
      currentResult.requestAuthHeadersPresent = readRequests.filter(request => request.dataset === 'master').every(request => request.authorizationPresent);
      currentResult.pageErrors = pageErrors.length;
      currentResult.blockedMutations = control.blockedMutations.length;
      currentResult.status = 'passed';
      output.reps.push(currentResult);
      safeProgress.failedUsername = null;
      await context.close();
    }
    output.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ output: outputFile, mode: output.mode,
      realAuthenticationVerified: false, repCount: output.reps.length,
      status: 'PASS', results: output.reps.map(rep => ({ username: rep.username, currentSeasonRows: rep.actualRows,
        firstCardMs: rep.firstCardMs, initialWindowMs: rep.initialWindowMs, fullReadyMs: rep.fullReadyMs,
        loadingObserved: rep.loadingObserved, previewCardCount: rep.previewCardCount,
        loadingCleared: rep.loadingCleared, status: rep.status })) }) + '\n');
  } finally { await browser.close().catch(() => {}); }
}

function fail(message) {
  const error = new Error(message);
  error.name = 'SafeVerifierError';
  throw error;
}

function safeDiagnostic(error) {
  const message = String(error?.message || '').replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '[authorization]')
    .replace(/(token|apikey|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240);
  return { name: String(error?.name || 'Error').slice(0, 60), code: String(error?.code || '').slice(0, 60), message };
}

function loadDatabaseUrl() {
  if (!fs.existsSync(envFile)) fail('GNC_SUPABASE_ENV_FILE is unavailable.');
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  const entry = lines.find(line => /^\s*GNC_SUPABASE_DB_URL\s*=/.test(line));
  if (!entry) fail('GNC_SUPABASE_DB_URL is missing from the configured env file.');
  let value = entry.slice(entry.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value) fail('GNC_SUPABASE_DB_URL is empty.');
  return value;
}

function parsePgUrl(value) {
  const url = new URL(value);
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.password) fail('Database URL format is invalid.');
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

const directorySql = `
with cfg as (
  select upper(value->>'seasonCode') season, (value->>'salesYear')::int max_year
  from public.ph_app_settings where key='current_season_salesyear'
), reps as (
  select p.id, lower(p.username) username, upper(regexp_replace(coalesce(p.role,''),'[^A-Za-z]','','g')) role,
    lower(split_part(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),' ',1)) first_name,
    lower((regexp_split_to_array(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),'\\s+'))[
      array_length(regexp_split_to_array(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),'\\s+'),1)]) last_name
  from public.profiles p join public.ph_app_users u on u.id=p.legacy_user_id
  where upper(regexp_replace(coalesce(p.role,''),'[^A-Za-z]','','g')) in ('REP','SALESREP')
    and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not coalesce(p.must_change_password,false)
    and u.disabled_at is null and (u.locked_until is null or u.locked_until<=now()) and not coalesce(u.must_change_password,false)
), reserve_codes as (
  select r.username, upper(trim(rv.itemcode)) itemcode
  from reps r join public.ph_reserves rv on
    lower(coalesce(rv.salesrepname,'')) like '%'||r.first_name||'%'||r.last_name||'%' or
    lower(coalesce(rv.salesrepname,'')) like '%'||r.last_name||'%'||r.first_name||'%'
  where trim(coalesce(rv.itemcode,''))<>''
), mi as (
  select m.unique_id, upper(trim(m.itemcode)) itemcode,
    coalesce(nullif(upper(trim(m.season)),''),(regexp_match(upper(trim(coalesce(m.lotcode,''))),'^([0-9]{2})\\s*\\.\\s*([A-Z0-9]+)$'))[2]) season,
    greatest(
      coalesce(case when replace(regexp_replace(coalesce(m.saleyear,''),'[^0-9.-]','','g'),',','') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        then case when replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric>=2000
          then mod(replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric,100)
          else replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric end end,-1),
      coalesce(((regexp_match(upper(trim(coalesce(m.lotcode,''))),'^([0-9]{2})\\s*\\.\\s*([A-Z0-9]+)$'))[1])::numeric,-1)
    ) year_no,
    case when coalesce(m.s_lts,'') ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)[[:space:]]*$' then m.s_lts::numeric else 0 end open_stock,
    coalesce(m.desigitem,'') desigitem, lower(coalesce(m.app_tab_assignment,'')) app_tab_assignment
  from public.ph_master_inventory m
), season_rows as (
  select m.* from mi m cross join cfg
  where m.itemcode<>'' and m.season=cfg.season and m.year_no between 0 and cfg.max_year
    and upper(m.desigitem) not like '%SHFT%'
    and lower(coalesce(m.app_tab_assignment,'')) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
), positive_keys as (
  select distinct itemcode,season from season_rows where open_stock>0
), eligible as (
  select distinct r.id,r.username,r.role,m.unique_id,m.itemcode
  from reps r cross join season_rows m
  where exists(select 1 from positive_keys p where p.itemcode=m.itemcode and p.season=m.season)
    or exists(select 1 from reserve_codes c where c.username=r.username and c.itemcode=m.itemcode)
)
select jsonb_build_object(
  'capturedAt', now(), 'season',(select season from cfg), 'salesYearMax',(select max_year from cfg),
  'masterRows',(select count(*) from public.ph_master_inventory),
  'reserveRows',(select count(*) from public.ph_reserves),
  'revisions',(select jsonb_object_agg(key,jsonb_build_object('revision',revision,'state',state,'changedAt',changed_at))
    from public.app_dataset_revisions where key in ('ph_master_inventory','ph_reserves','ph_app_settings','ph_av_notes','ph_customer_consignee_sales_reps')),
  'reps',(select jsonb_agg(jsonb_build_object('id',c.id,'username',c.username,'role',c.role,'eligibleRows',c.row_count,'eligibleItemcodes',c.itemcode_count) order by c.username)
    from (select id,username,role,count(distinct unique_id) row_count,count(distinct itemcode) itemcode_count from eligible group by id,username,role) c)
) snapshot`;

function validateSessionFile(value, usernames) {
  if (!Array.isArray(value?.sessions)) fail('Sessions file must contain a sessions array.');
  const sessions = new Map();
  for (const entry of value.sessions) {
    const username = String(entry?.username || '').trim().toLowerCase();
    const session = entry?.session;
    if (!username || sessions.has(username) || !session || typeof session !== 'object'
      || typeof session.access_token !== 'string' || !session.access_token
      || typeof session.refresh_token !== 'string' || !session.refresh_token
      || !session.user || typeof session.user.id !== 'string') {
      fail('Sessions file has a missing, duplicate, or malformed native session.');
    }
    if (Number(session.expires_at || 0) * 1000 < Date.now() + 15 * 60_000) {
      fail(`The supplied session for ${username} expires too soon; renew it through normal sign-in and retry.`);
    }
    sessions.set(username, session);
  }
  const expected = new Set(usernames);
  const missing = [...expected].filter(username => !sessions.has(username));
  const extra = [...sessions.keys()].filter(username => !expected.has(username));
  if (missing.length || extra.length) fail(`Sessions must cover the exact active Rep directory; missing=${missing.length}, extra=${extra.length}.`);
  return sessions;
}

async function main() {
  if (String(process.env.GNC_AV_REP_MODE || '').trim().toLowerCase() === 'snapshot-fixture') {
    return mainSnapshotFixture();
  }
  if (!sessionFile || !fs.existsSync(sessionFile)) fail('Set GNC_AV_REP_SESSIONS_FILE to a protected JSON file of genuine native sessions for every active Rep.');
  if (!supabaseUrl || !publishableKey || !fs.existsSync(caFile)) fail('Live Supabase URL/key or verified CA is unavailable.');
  const rawSessions = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const dbUrl = loadDatabaseUrl();
  const db = new Client({ ...parsePgUrl(dbUrl), ssl: { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 3000 });
  let browser;
  const output = { startedAt: new Date().toISOString(), appOrigin: origin, mode: 'live-read-only', noMocks: true, reps: [] };
  safeProgress.completedUsers = output.reps;
  let currentlyChecking;
  let initialRevisions;
  try {
    await db.connect();
    await db.query('begin read only');
    await db.query("set local statement_timeout = '3000ms'");
    const result = await db.query(directorySql);
    const snapshot = result.rows[0]?.snapshot;
    if (!snapshot || snapshot.season !== 'F1' || Number(snapshot.salesYearMax) !== 27 || !Array.isArray(snapshot.reps)) fail('Live directory/settings query returned an unexpected contract.');
    const reps = snapshot.reps;
    if (!reps.length || !['ben_maschino', 'brian_hatfield', 'wes_lugas'].every(username => reps.some(rep => rep.username === username))) {
      fail('The live directory is missing required Sales Rep accounts; verification cannot pass with partial coverage.');
    }
    initialRevisions = snapshot.revisions;
    const sessions = validateSessionFile(rawSessions, reps.map(rep => String(rep.username)));
    await db.query('commit');
    await db.end();
    for (const rep of reps) {
      currentlyChecking = String(rep.username);
      safeProgress.failedUsername = currentlyChecking;
      const session = sessions.get(String(rep.username));
      if (!session || session.user.id !== String(rep.id)) fail(`Session user does not match the active profile for ${rep.username}.`);
      const authResponse = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        headers: { apikey: publishableKey, authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!authResponse.ok) fail(`Native session validation failed for ${rep.username} (HTTP ${authResponse.status}).`);
      const authUser = await authResponse.json();
      if (String(authUser?.id || '') !== String(rep.id)) fail(`Auth identity does not match the active profile for ${rep.username}.`);
    }
    browser = await chromium.launch({ headless: true });
    for (const rep of reps) {
      const username = String(rep.username);
      currentlyChecking = username;
      safeProgress.failedUsername = username;
      const session = sessions.get(username);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.addInitScript(({ sessionValue }) => {
        localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(sessionValue));
      }, { sessionValue: session });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      const blockedBusinessWrites = [];
      await page.route('**/*', async route => {
        const request = route.request();
        const method = request.method().toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return route.continue();
        let allowReadPost = false;
        let businessWrite = false;
        try {
          const url = new URL(request.url());
          const body = request.postDataJSON() || {};
          if (url.pathname.endsWith('/functions/v1/app-api')) {
            const action = String(body?.action || '');
            allowReadPost = new Set(['inventory_read', 'dataset_read', 'av_read', 'native_session_bridge']).has(action);
            businessWrite = !allowReadPost;
          } else if (url.pathname.startsWith('/auth/v1/token')) {
            allowReadPost = url.searchParams.get('grant_type') === 'refresh_token';
          } else if (url.pathname.startsWith('/rest/v1/rpc/')) {
            const rpc = url.pathname.slice('/rest/v1/rpc/'.length);
            allowReadPost = new Set(['get_request_capabilities', 'get_my_app_permissions_v1', 'get_my_dataset_revisions_v1', 'inventory_location_on_hand_read_v1']).has(rpc);
          }
        } catch { /* Unparsed POSTs are blocked below. */ }
        if (allowReadPost) return route.continue();
        // Record only a generic category and method; never retain request data.
        blockedBusinessWrites.push(businessWrite ? `business-${method}` : `unapproved-${method}`);
        return route.abort('blockedbyclient');
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => window.eval('!!nativeAuthProfile && !!nativeAuthProfile.id'), null, { timeout: 30_000 });
      await page.waitForFunction(() => document.body.classList.contains('role-access-ready')
        && !!document.querySelector('#view-home')?.getClientRects().length, null, { timeout: 30_000 });
      const actualProfile = await page.evaluate(() => window.eval('({ username: String(nativeAuthProfile.username || "").toLowerCase(), role: String(nativeAuthProfile.role || "").trim().toUpperCase() })'));
      if (actualProfile.username !== username || !['REP', 'SALESREP'].includes(actualProfile.role.replace(/[^A-Z]/g, ''))) fail(`App profile mismatch for ${username}.`);
      await page.locator('#footer-menu-btn').click();
      const avNav = page.locator('#drawer-av-btn');
      await avNav.waitFor({ state: 'visible', timeout: 10_000 });
      await page.evaluate(expectedRows => {
        const measurement = window.__gncAvPaint = { startedAt: null, firstCardMs: null, initialWindowMs: null, fullReadyMs: null };
        let pendingFrame = false;
        const sample = () => {
          if (measurement.startedAt === null || pendingFrame) return;
          pendingFrame = true;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            pendingFrame = false;
            const cards = document.querySelectorAll('#av-content .app-av-catalog-card[data-dom-id]');
            const visible = !!cards[0]?.getClientRects().length;
            const elapsed = performance.now() - measurement.startedAt;
            if (visible && measurement.firstCardMs === null) measurement.firstCardMs = elapsed;
            if (visible && cards.length >= 20 && measurement.initialWindowMs === null) measurement.initialWindowMs = elapsed;
            const crumb = document.getElementById('av-crumb')?.textContent || '';
            const count = Number(crumb.match(/\(([\d,]+) items?\)/i)?.[1]?.replace(/,/g, '') || -1);
            const exported = document.getElementById('av-export-btn-label')?.textContent || '';
            const exportCount = Number(exported.match(/\(([\d,]+)\)\s*$/)?.[1]?.replace(/,/g, '') || -1);
            const ready = window.eval("getDatasetState('master').fullLoaded && getDatasetState('reserves').fullLoaded && !isAvLiveCatalogIncomplete()");
            if (ready && visible && cards.length >= 20 && count === expectedRows && exportCount === expectedRows
              && !/loading full inventory/i.test(crumb) && !document.getElementById('av-export-btn')?.disabled) {
              measurement.fullReadyMs = elapsed;
              observer.disconnect();
            }
          }));
        };
        const observer = new MutationObserver(sample);
        observer.observe(document.getElementById('view-av'), { subtree: true, childList: true, characterData: true, attributes: true });
        document.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('#drawer-av-btn')) {
            measurement.startedAt = performance.now();
            sample();
          }
        }, true);
      }, Number(rep.eligibleRows));
      await avNav.click();
      await page.waitForFunction(() => Number.isFinite(window.__gncAvPaint?.fullReadyMs), null, { timeout: 120_000 });
      const { firstCardMs, initialWindowMs, fullReadyMs: fullReadyElapsedMs } = await page.evaluate(() => window.__gncAvPaint);
      const state = await page.evaluate(() => window.eval(`(() => {
        const resolved = getCurrentAVBaseItems({ usePreparedSalesRows: true }) || {};
        const rows = Array.isArray(resolved.items) ? resolved.items : [];
        const crumb = document.getElementById('av-crumb')?.textContent || '';
        const exportButton = document.getElementById('av-export-btn');
        const exportLabel = document.getElementById('av-export-btn-label')?.textContent || '';
        return { masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
          reserveRows: Array.isArray(reservesInventory) ? reservesInventory.length : -1,
          renderedRows: rows.length,
          itemcodes: new Set(rows.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()).filter(Boolean)).size,
          exportCount: getAVVisibleExportCount(rows),
          exportLabel,
          exportDisabled: !!exportButton?.hasAttribute('disabled'),
          isPartial: !!resolved.isPartial,
          loading: /loading full inventory/i.test(crumb),
          crumbCount: Number(crumb.match(/\\(([\\d,]+) items?\\)/i)?.[1]?.replace(/,/g, '') || -1),
          mountedCards: document.querySelectorAll('#av-content .app-av-catalog-card[data-dom-id]').length,
          currentView: getCurrentVisibleViewId() };
      })()`));
      const exportLabelCount = state.exportLabel.match(/\(([^()]*)\)\s*$/)?.[1]?.replace(/,/g, '') || '';
      if (state.masterRows !== Number(snapshot.masterRows) || state.exportDisabled || state.loading || state.currentView !== 'av'
        || state.isPartial || state.renderedRows !== Number(rep.eligibleRows) || state.itemcodes !== Number(rep.eligibleItemcodes)
        || state.crumbCount !== state.renderedRows || state.mountedCards < 20
        || state.exportCount !== state.renderedRows || Number(exportLabelCount) !== state.exportCount
        || ![firstCardMs, initialWindowMs, fullReadyElapsedMs].every(value => Number.isFinite(value) && value < 1500)
        || blockedBusinessWrites.length || pageErrors.length) {
        fail(`Live AV exact readiness or first-card gate failed for ${username}.`);
      }
      output.reps.push({ username, role: actualProfile.role, expectedRows: Number(rep.eligibleRows), expectedItemcodes: Number(rep.eligibleItemcodes),
        actualRows: state.renderedRows, actualItemcodes: state.itemcodes, exportCount: state.exportCount,
        exportLabelCount: Number(exportLabelCount), masterRows: state.masterRows, reserveRows: state.reserveRows, firstCardMs, initialWindowMs, fullReadyElapsedMs,
        blockedBusinessWriteAttempts: blockedBusinessWrites.length, pageErrors: pageErrors.length });
      await context.close();
    }
    const revisionCheck = new Client({ ...parsePgUrl(loadDatabaseUrl()), ssl: { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 3000 });
    try {
      await revisionCheck.connect();
      await revisionCheck.query('begin read only');
      await revisionCheck.query("set local statement_timeout = '3000ms'");
      const latest = await revisionCheck.query("select jsonb_object_agg(key,jsonb_build_object('revision',revision,'state',state,'changedAt',changed_at)) revisions from public.app_dataset_revisions where key in ('ph_master_inventory','ph_reserves','ph_app_settings','ph_av_notes','ph_customer_consignee_sales_reps')");
      await revisionCheck.query('commit');
      if (JSON.stringify(latest.rows[0]?.revisions) !== JSON.stringify(initialRevisions)) fail('AV source revisions changed during the multi-user verification; counts are stale.');
    } finally { await revisionCheck.end().catch(() => {}); }
    output.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ output: outputFile, repCount: output.reps.length, status: 'PASS',
      results: output.reps.map(rep => ({ username: rep.username, currentSeasonRows: rep.actualRows,
        firstCardMs: rep.firstCardMs, initialWindowMs: rep.initialWindowMs, fullReadyMs: rep.fullReadyElapsedMs })) }) + '\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await db.end().catch(() => {});
  }
}

main().catch(error => {
  // Write only a controlled reason and completed count summaries. Unknown
  // errors may embed tokens, URLs, or database connection details.
  const safeMessage = error?.name === 'SafeVerifierError' ? String(error.message) : 'live_av_rep_verification_failed';
  const failurePath = path.join(root, '.gnc-local', `v2310-live-av-e2e-failure-${new Date().toISOString().replace(/[-:.]/g, '')}.json`);
  try {
    fs.mkdirSync(path.dirname(failurePath), { recursive: true });
    fs.writeFileSync(failurePath, JSON.stringify({ failure: safeMessage, diagnostic: safeDiagnostic(error), failedUsername: safeProgress.failedUsername,
      currentResult: safeProgress.currentResult || null, completedUsers: safeProgress.completedUsers }, null, 2) + '\n', { flag: 'wx' });
  } catch { /* Preserve no secret-bearing error output when local evidence cannot be saved. */ }
  process.stderr.write(`${safeMessage}\n`);
  process.exitCode = 1;
});
