import { expect, test, type Page } from '@playwright/test';
// @test-group: @local-e2e,@release-functional,@request-archive



async function appEval<T = any>(page: Page, script: string): Promise<T> {
  return page.evaluate(source => (window as any).__requestArchiveTestEval(source), script);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') return route.abort();
    if (route.request().resourceType() === 'document') {
      const response = await route.fetch();
      const bridge = '\n;window.__requestArchiveTestEval = (source) => eval(source);\n';
      const html = (await response.text()).replace(/(<script id="app-script-source" type="text\/plain">)([\s\S]*?)(<\/script>)/,
        (_match, start, source, end) => `${start}${source}${bridge}${end}`);
      return route.fulfill({ response, body: html });
    }
    if (/^\/(?:_site\/)?assets\/live-app-runtime-v\d+\.min\.js$/.test(new URL(route.request().url()).pathname)) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n;window.__requestArchiveTestEval = (source) => eval(source);\n` });
    }
    return route.continue();
  });
});

async function prepareArchiveRow(page: Page, uid: string, requestResult: 'success' | 'forbidden' = 'success') {
  await page.evaluate(({ uid }) => {
    document.body.classList.add('ios-device', 'viewport-phone', 'current-view-request');
    document.getElementById('view-request')?.remove();
    const view = document.createElement('section');
    view.id = 'view-request';
    view.className = 'app-view active';
    document.body.appendChild(view);
    const existing = document.getElementById('request-content');
    existing?.remove();
    const container = document.createElement('div');
    container.id = 'request-content';
    container.style.cssText = 'height:320px;overflow-y:auto;position:relative';
    view.appendChild(container);
    const item = {
      UNIQUE_ID: uid, COMMONNAME: 'Test Hosta', CONTSIZE: '#3', LOCATIONCODE: 'A.01', LOTCODE: '27.F1',
      REQ_ARCHIVED: false, REQ_STATUS: 'Pending', REQUEST_HISTORY: false, ROW_VERSION: 1,
      UPDATED_AT: '2026-10-09T12:00:00.000Z',
    };
    (window as any).__archiveItem = item;
    (window as any).__archiveRow = null;
    const row = document.createElement('article');
    row.className = 'item-row';
    row.dataset.requestUid = uid;
    row.innerHTML = '<div class="request-swipe-surface"><strong>Test Hosta</strong></div>';
    (window as any).__archiveRow = row;
    container.appendChild(row);
  }, { uid });
  await appEval(page, `
      window.__archiveConfirm = true;
      window.__archiveCalls = [];
      window.__removeCalls = [];
      window.__archiveConfirmCalls = 0;
      window.__removeConfirmCalls = 0;
      window.__archiveToasts = [];
      currentUser = 'dylan_collyge';
      currentUserDisplay = 'Dylan Collyge';
      activeReqTab = 'pending';
      isMultiSelectMode = false;
      requestsInventory = [window.__archiveItem];
      requestArchiveListState = { rows: [], total: 0, offset: 0, limit: 100, hasMore: false, loading: false, error: '', loaded: true, controller: null };
      getSupabaseReadIdentityScope = () => 'profile:dylan_collyge';
      canCurrentUserArchiveRequestRow = () => true;
      canCurrentUserArchiveRequestRows = () => true;
      confirmArchiveRequestRow = async () => { window.__archiveConfirmCalls++; return window.__archiveConfirm !== false; };
      showAppConfirm = async () => window.__archiveConfirm !== false;
      const originalPostAppFunctionJson = postAppFunctionJson;
      postAppFunctionJson = async (_url, command, options) => {
        if (!command || command.action !== 'request_queue_remove') return originalPostAppFunctionJson(_url, command, options);
        window.__removeCalls.push(command);
        return ${requestResult === 'forbidden'
          ? "{ ok: false, error: { status: 403, code: '42501', message: 'Removal is not allowed.' } }"
          : "{ ok: true, data: { uid: command.uid, state: 'removed', idempotencyKey: command.idempotencyKey, replayed: false } }"};
      };
      const originalShowAppConfirm = showAppConfirm;
      showAppConfirm = async (...args) => { window.__removeConfirmCalls++; return originalShowAppConfirm(...args); };
      requestQueueRemovedByScope.clear();
      requestQueueRemovalInFlight.clear();
      syncRequestArchive = async (requestUid, operation) => {
        window.__archiveCalls.push({ requestUid, operation });
        return ${requestResult === 'forbidden'
          ? "{ ok: false, error: { status: 403, code: '42501', message: 'Archive is not allowed.' } }"
          : "{ ok: true, data: { state: operation === 'restore' ? 'restored' : 'archived' } }"};
      };
      refreshRequestViewAfterArchive = () => {
        const removed = requestQueueRemovedByScope.get(getSupabaseReadIdentityScope());
        if (removed && removed.has(window.__archiveItem.UNIQUE_ID)) window.__archiveRow.remove();
        else if (window.__archiveItem.REQ_ARCHIVED) window.__archiveRow.remove();
        else if (!window.__archiveRow.isConnected) document.getElementById('request-content').appendChild(window.__archiveRow);
      };
      persistCurrentCache = () => {};
      showToast = (...args) => window.__archiveToasts.push(args);
      decorateRequestRows();
    `);
  return page.evaluate((uid) => {
    const row = document.querySelector(`[data-request-uid="${uid}"]`)!;
    const action = row.querySelector('.request-swipe-action') as HTMLButtonElement | null;
    const actionBox = action?.getBoundingClientRect();
    return {
      rowId: uid,
      hasSwipeSurface: !!row.querySelector('.request-swipe-surface'),
      swipeEnhanced: row.dataset.swipeEnhanced === 'true',
      touchAction: getComputedStyle(row).touchAction,
      actionHeight: actionBox?.height ?? 0,
      actionLabel: action?.innerText.trim() ?? '',
      actionAriaLabel: action?.getAttribute('aria-label') ?? '',
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      lookup: (window as any).__requestArchiveTestEval(`({ids: requestsInventory.map(getItemUniqueId), found: !!findRequestInventoryRowByUniqueId('${uid}')})`),
    };
  }, uid);
}

async function swipe(page: Page, uid: string, direction: 'left' | 'right') {
  // Each fixture represents a separate gesture. Let the real duplicate-event
  // guard expire after the previous archive instead of racing it on fast CI.
  await page.waitForFunction(() => (window as any).__requestArchiveTestEval('!shouldIgnoreDuplicateRequestTouchEvent()'));
  const debug = await page.evaluate(({ uid, direction }) => {
    const row = document.querySelector(`[data-request-uid="${uid}"]`)!;
    const endX = direction === 'left' ? 30 : 270;
    const makeTouch = (x: number, y: number) => ({ identifier: 7, target: row, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const dispatchTouch = (type: string, x: number, y: number, ending = false) => {
      const contact = makeTouch(x, y);
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { touches: { value: ending ? [] : [contact] }, changedTouches: { value: [contact] } });
      row.dispatchEvent(event);
    };
    dispatchTouch('touchstart', 150, 120);
    dispatchTouch('touchmove', endX, 122);
    const surface = row.querySelector('.request-swipe-surface') as HTMLElement;
    const afterMove = { transform: surface.style.transform, rowPresent: !!surface };
    dispatchTouch('touchend', endX, 122, true);
    return { afterMove };
  }, { uid, direction });
  await page.waitForTimeout(300);
  return debug;
}

test('Request swipe removes from Que after confirmation, is responsive, and preserves vertical scrolling', {"tag":["@local-e2e","@release-functional","@request-archive"]}, async ({ page }) => {
  for (const width of [320, 390, 430]) {
    for (const direction of ['left', 'right'] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/?e2e=request-archive-005', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof (window as any).decorateRequestRows === 'function');
      const uid = `archive-${width}-${direction}`;
      const layout = await prepareArchiveRow(page, uid);
      expect(layout.swipeEnhanced).toBe(true);
      expect(layout.lookup.found, JSON.stringify(layout.lookup)).toBe(true);
      expect(layout.actionHeight).toBeGreaterThanOrEqual(44);
      expect(layout.actionLabel.toLowerCase()).toContain('remove');
      expect(layout.actionAriaLabel).toBe('Remove request row from Que');
      expect(layout.noHorizontalOverflow).toBe(true);
      const debug = await swipe(page, uid, direction);
      expect(debug.afterMove.rowPresent, JSON.stringify(debug)).toBe(true);
      expect(debug.afterMove.transform, JSON.stringify(debug)).not.toBe('');
      const outcome = await appEval(page, `(() => {
        const row = requestsInventory.find(entry => entry.UNIQUE_ID === '${uid}');
        return { archived: row && row.REQ_ARCHIVED, archiveCalls: window.__archiveCalls.length, removeCalls: window.__removeCalls.length, confirmCalls: window.__removeConfirmCalls, removed: !document.querySelector('[data-request-uid="${uid}"]') };
      })()`);
      expect(outcome, JSON.stringify(outcome)).toMatchObject({ archived: undefined, archiveCalls: 0, removeCalls: 1, removed: true, confirmCalls: 1 });
      expect(await appEval(page, `window.__removeCalls[0]`)).toMatchObject({
        action: 'request_queue_remove', uid, expectedRowVersion: 1, expectedUpdatedAt: '2026-10-09T12:00:00.000Z',
      });
    }
  }
});

test('Legacy archive cancellation and terminal permission failure restore the row', {"tag":["@local-e2e","@release-functional","@request-archive"]}, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=request-archive-005', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).decorateRequestRows === 'function');
  await prepareArchiveRow(page, 'archive-cancel');
  await appEval(page, 'window.__archiveConfirm = false');
  await swipe(page, 'archive-cancel', 'left');
  expect(await appEval(page, `({ calls: window.__removeCalls.length, confirmCalls: window.__removeConfirmCalls, archived: requestsInventory[0].REQ_ARCHIVED, visible: !!document.querySelector('[data-request-uid="archive-cancel"]') })`))
    .toEqual({ calls: 0, confirmCalls: 1, archived: false, visible: true });

  await prepareArchiveRow(page, 'archive-denied', 'forbidden');
  await appEval(page, `(async () => { await archiveRequestRow('archive-denied'); return true; })()`);
  expect(await appEval(page, `({ calls: window.__archiveCalls.length, archived: requestsInventory[0].REQ_ARCHIVED, visible: !!document.querySelector('[data-request-uid="archive-denied"]') })`))
    .toEqual({ calls: 1, archived: false, visible: true });
});

test('Vertical Request gestures remain scroll gestures and do not remove rows', {"tag":["@local-e2e","@release-functional","@request-archive"]}, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=request-archive-005', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).decorateRequestRows === 'function');
  await prepareArchiveRow(page, 'archive-vertical');
  await page.evaluate(() => {
    return true;
  });
  await appEval(page, `(() => {
      const row = document.querySelector('[data-request-uid="archive-vertical"]');
      const touch = (x,y) => ({ identifier: 8, target: row, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
      const dispatch = (type,x,y,ending=false) => { const t=touch(x,y); const e=new Event(type,{bubbles:true,cancelable:true}); Object.defineProperties(e,{touches:{value:ending?[]:[t]},changedTouches:{value:[t]}}); row.dispatchEvent(e); };
      dispatch('touchstart',150,120); dispatch('touchmove',152,180); dispatch('touchend',152,180,true);
    })()`);
  expect(await appEval(page, `({ calls: window.__removeCalls.length, confirms: window.__removeConfirmCalls, archived: requestsInventory[0].REQ_ARCHIVED, visible: !!document.querySelector('[data-request-uid="archive-vertical"]') })`))
    .toEqual({ calls: 0, confirms: 0, archived: false, visible: true });
});

test('Cancelled touch and pointer swipes never remove or prompt', {"tag":["@local-e2e","@release-functional","@request-archive"]}, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=request-archive-005', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).decorateRequestRows === 'function');
  for (const kind of ['touch', 'pointer'] as const) {
    const uid = `archive-${kind}-cancel`;
    await prepareArchiveRow(page, uid);
    await page.evaluate(({ uid, kind }) => {
      const row = document.querySelector(`[data-request-uid="${uid}"]`)!;
      if (kind === 'touch') {
        const touch = (x: number) => ({ identifier: 19, target: row, clientX: x, clientY: 120, pageX: x, pageY: 120, screenX: x, screenY: 120 });
        for (const [type, x, cancelled] of [['touchstart', 150, false], ['touchmove', 30, false], ['touchcancel', 30, true]] as [string, number, boolean][]) {
          const t = touch(x);
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: cancelled ? [] : [t] }, changedTouches: { value: [t] } });
          row.dispatchEvent(event);
        }
      } else {
        for (const [type, x] of [['pointerdown', 150], ['pointermove', 30], ['pointercancel', 30]] as [string, number][]) {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { pointerId: { value: 19 }, pointerType: { value: 'touch' }, button: { value: 0 }, clientX: { value: x }, clientY: { value: 120 } });
          row.dispatchEvent(event);
        }
      }
    }, { uid, kind });
    expect(await appEval(page, `({ calls: window.__removeCalls.length, archived: requestsInventory[0].REQ_ARCHIVED, visible: !!document.querySelector('[data-request-uid="${uid}"]'), confirms: window.__removeConfirmCalls })`))
      .toEqual({ calls: 0, archived: false, visible: true, confirms: 0 });
  }
});
