import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { startReleaseTestServer } from '../../scripts/serve-release-tests.mjs';
import { installHlOrderFixture } from '../../tests/fixtures/hl-order-state.mjs';

const requestUid = 'REQ-fixture';
const siblingUid = 'REQ-fixture-other';
const requestCard = uid => `#request-content [data-request-uid="${uid}"]`;
const deadlineMs = 50;

async function assertRequestDeliveryTimeoutIsolated(page) {
    const request = page.waitForRequest(candidate => candidate.method() === 'POST'
        && candidate.url().endsWith('/functions/v1/app-api') && candidate.postDataJSON()?.requestDeliveryStatus === true);
    await page.route('**/functions/v1/app-api', route => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON()?.requestDeliveryStatus !== true) return route.fallback();
        return route.fulfill({ status:504, json:{ ok:false, code:'TIMEOUT' }, headers:{ 'access-control-allow-origin':'*' } });
    });
    await page.evaluate(() => {
        switchView('request');
        renderRequest();
        paintFooterRequestBadgeOnly();
    });
    const optional = (await request).postDataJSON();
    const ids = optional.params.filters[0].value;
    assert.deepEqual([...ids].sort(), [requestUid, siblingUid].sort());
    await page.locator(requestCard(requestUid)).waitFor();
    await page.locator(requestCard(siblingUid)).waitFor();
    assert.doesNotMatch(await page.locator('#view-request').innerText(), /Load Failed/);
}

async function seedRequestReads(page, master) {
    const rows = [requestUid, siblingUid].map(uid => ({
        ...master, unique_id: uid, master_id: master.unique_id, req_status: 'Pending', req_qty: '12',
        req_customer: 'Fixture Customer', requested_by: 'dylan_collyge', request_folder: 'Completion fixture',
        date_completed: null, completed: false, completed_at: null
    }));
    const headers = { 'access-control-allow-origin': '*', 'content-range': `0-${rows.length - 1}/${rows.length}` };
    await page.route(url => ['/rest/v1/ph_requests_pending', '/rest/v1/ph_active_request'].includes(url.pathname), route => {
        if (route.request().method() !== 'GET') return route.fallback();
        const uid = new URL(route.request().url()).searchParams.get('unique_id');
        const data = uid?.startsWith('eq.') ? rows.filter(row => row.unique_id === uid.slice(3)) : rows;
        return route.fulfill({ json: data, headers });
    });
    await page.route('**/functions/v1/app-api', route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON();
        if (body?.action !== 'dataset_read' || !['request_queue', 'active_request'].includes(body.dataset)) return route.fallback();
        const { offset, limit } = body.params;
        const data = { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit, hasMore: false };
        return route.fulfill({ json: { ok: true, data }, headers });
    });
}

async function seedPendingRequestCards(page) {
    await page.evaluate(({ uid, sibling }) => {
        const master = fullInventory[0];
        const masterUid = getItemUniqueId(master);
        const pendingRow = id => ({
            ...master, UNIQUE_ID: id, unique_id: id, DOM_ID: id, MASTER_ID: masterUid, master_id: masterUid,
            SOURCE_TABLE: ACTIVE_REQUEST_TABLE, source_table: ACTIVE_REQUEST_TABLE,
            REQUEST_ACTIVE: true, REQUEST_HISTORY: false, REQUEST_HISTORY_ONLY: false,
            REQ_STATUS: 'Pending', req_status: 'Pending', REQ_QTY: '12', REQ_RESERVE: 'YES',
            REQ_CUSTOMER: 'Fixture Customer', REQUESTED_BY: currentUser, REQUEST_FOLDER: 'Completion fixture',
            DATE_COMPLETED: '', date_completed: '', completed: false, completed_at: ''
        });
        requestsInventory = [pendingRow(uid), pendingRow(sibling)];
        activeReqTab = 'pending';
        refreshRealtimeDetailLookupIndexes(ACTIVE_REQUEST_TABLE);
    }, { uid: requestUid, sibling: siblingUid });
}

async function enterRequestEvaluation(page) {
    await page.locator(requestCard(requestUid)).click({ timeout: 7000 });
    await page.locator('#request-summary-dialog[open]').getByRole('button', { name: 'Got It / Start Evaluation' }).click();
    await page.locator('#req-btn-save-complete').waitFor({ state: 'visible' });
}

async function holdPersistence(page) {
    await page.evaluate(({ uid, sibling }) => {
        const originalPersist = persistConfirmedRowEvaluation;
        const originalBegin = beginConfirmedRowEvaluationUi;
        const badge = document.getElementById('footer-request-badge');
        const badgeCount = () => badge.classList.contains('hidden') ? 0 : Number(badge.textContent);
        const card = id => document.querySelector(`#request-content [data-request-uid="${id}"]`);
        const fixture = { calls: [], started: null, removedMs: null, settled: false, badgeBefore: badgeCount() };
        window.requestCompletionFixture = fixture;
        beginConfirmedRowEvaluationUi = (...args) => {
            fixture.beginStartMs = performance.now() - fixture.started;
            try { return originalBegin(...args); }
            finally { fixture.beginEndMs = performance.now() - fixture.started; }
        };
        persistConfirmedRowEvaluation = (...args) => {
            const [complete, prefix, , row, options] = args;
            if (!complete || !options?.markDoneConfirmationAccepted) return originalPersist(...args);
            fixture.persistStartMs = performance.now() - fixture.started;
            fixture.calls.push({ uid: getItemUniqueId(row), prefix });
            const hold = Promise.withResolvers();
            fixture.fail = () => {
                fixture.settled = true;
                hold.reject(new Error('Fixture persistence failure'));
            };
            return hold.promise;
        };
        const ok = [...document.querySelectorAll('#mark-done-confirm-modal button')].find(button => button.textContent.trim() === 'OK');
        ok.addEventListener('pointerdown', () => { fixture.started = performance.now(); }, { capture: true, once: true });
        const observer = new MutationObserver(() => {
            if (fixture.started === null || card(uid)) return;
            fixture.removedMs = performance.now() - fixture.started;
            fixture.badgeAfter = badgeCount();
            fixture.siblingRetained = !!card(sibling);
            fixture.detailClosed = getCurrentVisibleViewId() === 'request';
            fixture.requestAbsent = !requestsInventory.some(row => getItemUniqueId(row) === uid);
            observer.disconnect();
        });
        observer.observe(document.getElementById('request-content'), { childList: true, subtree: true });
    }, { uid: requestUid, sibling: siblingUid });
}

async function measureCompletionPhases(page) {
    await page.evaluate(() => {
        const fixture = window.requestCompletionFixture;
        fixture.phases = [];
        const invoke = (phase, call, ...args) => {
            if (fixture.started === null || fixture.settled) return call(...args);
            const started = performance.now();
            try { return call(...args); }
            finally { fixture.phases.push({ phase, durationMs: performance.now() - started }); }
        };
        const measure = (phase, call) => invoke.bind(null, phase, call);
        globalThis.prunePendingRequestCards = measure('prune cards', globalThis.prunePendingRequestCards);
        returnFromConfirmedEvaluationDetail = measure('return from Detail', returnFromConfirmedEvaluationDetail);
        goBackFromDetail = measure('detail Back', goBackFromDetail);
        teardownDetailPresentation = measure('teardown Detail', teardownDetailPresentation);
        fastBackToView = measure('switch back to Que', fastBackToView);
        repairAppShellScrollState = measure('repair shell scroll', repairAppShellScrollState);
        setMainAreaScrollTop = measure('restore scroll', setMainAreaScrollTop);
        refreshRealtimeDetailLookupIndexes = measure('refresh lookup', refreshRealtimeDetailLookupIndexes);
        beginRowEvaluationMemoryPublication = measure('project evidence', beginRowEvaluationMemoryPublication);
        beginOptimisticCompletedRow = measure('project completion', beginOptimisticCompletedRow);
        backupLocalItem = measure('retain draft', backupLocalItem);
        refreshLocalRequestViewState = measure('refresh queue', refreshLocalRequestViewState);
        updateFooterRequestBadge = measure('update queue badge', updateFooterRequestBadge);
        paintFooterRequestBadgeOnly = measure('paint queue badge', paintFooterRequestBadgeOnly);
        updateFooterNavState = measure('update footer navigation', updateFooterNavState);
    });
}

async function assertPendingTransition(page) {
    await page.waitForFunction(() => window.requestCompletionFixture?.removedMs !== null
        && window.requestCompletionFixture?.calls.length === 1);
    const transition = await page.evaluate(() => ({ ...window.requestCompletionFixture, fail: undefined }));
    assert.deepEqual(transition.calls, [{ uid: requestUid, prefix: 'req-' }]);
    assert.equal(transition.settled, false);
    assert.equal(transition.requestAbsent, true);
    assert.equal(transition.siblingRetained, true);
    assert.equal(transition.detailClosed, true);
    assert.ok(transition.badgeBefore >= 2, JSON.stringify(transition));
    assert.equal(transition.badgeAfter, transition.badgeBefore - 1);
    assert.equal(transition.phases.filter(entry => entry.phase === 'teardown Detail').length, 1, JSON.stringify(transition.phases));
    return transition;
}

async function assertFailureRollback(page, badgeBefore) {
    await page.evaluate(() => window.requestCompletionFixture.fail());
    await page.locator(requestCard(requestUid)).waitFor({ state: 'visible', timeout: 5000 }).catch(async error => {
        const state = await page.evaluate(() => ({
            rows: requestsInventory.map(row => [getItemUniqueId(row), row.REQ_STATUS, isRequestPendingVisible(row)]),
            content: document.getElementById('request-content').innerText.slice(0, 240),
            tab: activeReqTab, view: getCurrentVisibleViewId(),
            badge: document.getElementById('footer-request-badge').textContent,
            action: window.__agdataMarkDoneActions?.size, removedMs: window.requestCompletionFixture.removedMs
        }));
        throw new Error(`Request card failed to return ${JSON.stringify(state)}`, { cause: error });
    });
    const result = await page.evaluate(uid => {
        const row = requestsInventory.find(item => getItemUniqueId(item) === uid);
        const badge = document.getElementById('footer-request-badge');
        return {
            pending: isRequestPendingVisible(row), complete: isRequestComplete(row),
            durableCompletion: hasConfirmedRequestCompletion(row), status: row?.REQ_STATUS,
            badge: badge.classList.contains('hidden') ? 0 : Number(badge.textContent), view: getCurrentVisibleViewId()
        };
    }, requestUid);
    assert.deepEqual(result, { pending: true, complete: false, durableCompletion: false, status: 'Pending', badge: badgeBefore, view: 'request' });
    return result;
}

async function assertNormalBack(page) {
    await enterRequestEvaluation(page);
    await page.locator('#global-header-inline-back').click();
    await page.waitForFunction(() => getCurrentVisibleViewId() === 'request');
    await page.locator(requestCard(requestUid)).waitFor({ state: 'visible' });
    const state = await page.evaluate(uid => {
        const row = requestsInventory.find(item => getItemUniqueId(item) === uid);
        return {
            pending: isRequestPendingVisible(row), persistenceCalls: window.requestCompletionFixture.calls.length,
            status: row?.REQ_STATUS, complete: isRequestComplete(row), optimistic: optimisticCompletedRowIds.has(uid),
            ids: requestsInventory.map(getItemUniqueId)
        };
    }, requestUid);
    assert.ok(state.pending && state.persistenceCalls === 1, JSON.stringify(state));
    return state;
}

async function runViewport(browser, origin, width) {
    const phone = width === 390;
    const page = await browser.newPage({ viewport: { width, height: 850 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
    try {
        const control = await installHlOrderFixture(page, origin, { role: 'SUPER ADMIN', appPermissions: [{ permissionKey: 'module.request.view', kind: 'module', moduleKey: 'request', allowed: true }] });
        await page.waitForFunction(() => typeof fullInventory !== 'undefined' && fullInventory.length > 0);
        await seedRequestReads(page, control.master[0]);
        await seedPendingRequestCards(page);
        await assertRequestDeliveryTimeoutIsolated(page);
        if (process.argv.includes('--delivery-only')) return { width, deliveryTimeoutIsolated: true };
        await enterRequestEvaluation(page);
        await page.locator('#req-btn-save-complete').click();
        const ok = page.locator('#mark-done-confirm-modal').getByRole('button', { name: 'OK', exact: true });
        await ok.waitFor({ state: 'visible' });
        await holdPersistence(page);
        await measureCompletionPhases(page);
        await ok.click();
        const transition = await assertPendingTransition(page);
        const rollback = await assertFailureRollback(page, transition.badgeBefore);
        const normalBack = await assertNormalBack(page).catch(error => {
            throw new Error(`Ordinary Back check failed after the ${width}px completion transition ${JSON.stringify(transition)}`, { cause: error });
        });
        const writes = control.blockedMutations.filter(entry => /request_work|save_drive_evidence|request_work_command|ph_requests_pending/i.test(entry));
        assert.deepEqual(writes, []);
        return { width, transition, rollback, normalBack, writes: writes.length };
    } finally {
        await page.close();
    }
}

async function run() {
        const siteDir = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || '_site');
    const server = await startReleaseTestServer({ siteDir, port: 0 });
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const results = [];
        for (const width of [390, 1440]) results.push(await runViewport(browser, origin, width));
        const pass = results.every(result => result.deliveryTimeoutIsolated || result.transition.removedMs < deadlineMs);
        process.stdout.write(`${JSON.stringify({ pass, browser: `Microsoft Edge ${browser.version()}`, deadlineMs, results })}\n`);
        assert.ok(pass, 'OK pointer activation to Request removal exceeded the 50 ms target');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}

await run();
