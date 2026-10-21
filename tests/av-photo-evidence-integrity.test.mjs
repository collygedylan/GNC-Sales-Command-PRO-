import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: photos,av-blanks
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const evalSecurityStart = html.indexOf('        function isEvalSensitiveDataRestricted(');
const evalSecurityEnd = html.indexOf('        function runDedupeSupabaseRead(', evalSecurityStart);
assert.ok(evalSecurityStart >= 0 && evalSecurityEnd > evalSecurityStart, 'Eval security helpers should exist');
const evalSecurityHelpers = html.slice(evalSecurityStart, evalSecurityEnd);
const NOW = Date.parse('2026-09-07T18:00:00Z');
const DAY = 86_400_000;
const PHOTO = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/crop.webp';
function source(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}
const coreNames = ['firstNonEmptyValue', 'parseAppNumber', 'normalizeLocMatchPercentText', 'parseLocMatchPercent',
  'calculateLocMatchQtyValue', 'getLocPhotoEvidenceContext', 'getLocPhotoOwnedValue',
  'parseLocPhotoEvidenceTimestamp', 'getLocPhotoCaptureEvidence', 'getLocPhotoEvidenceState',
  'getPhotoQualifiedLocMatchQtyValue', 'getDisplayLocMatchQtyValue', 'getCurrentCardLocPhotoMatchQtyValue',
  'formatLocPhotoMatchQtyValue', 'getEditorLocMatchQtyValue', 'getManagerLocPhotoMatchQtyValue'];
function runtime(extraNames = [], extra = {}) {
  class FixedDate extends Date { static now() { return NOW; } }
  const context = vm.createContext({ Date: FixedDate, URL,
    shouldPreferFlyerOwnedFields: (row, view) => view === 'flyer' || (view === 'tasks' && row?.selectedFlyer === true),
    ...extra });
  vm.runInContext(`${evalSecurityHelpers}\n${[...coreNames, ...extraNames].map(source).join('\n')}`, context);
  return context;
}
const row = (changes = {}) => ({ SOURCE_TABLE: 'ph_master_inventory', MATCH: '50', INITIAL_PTR: '347',
  PTRAVAILABLE: '347', LOC_MATCH_QTY: '174', PHOTO_LINK: PHOTO,
  PHOTO_NAME: 'crop.webp', AV_RULE_PHOTO_UPDATED_AT: '2026-09-06T18:00:00Z', ...changes });

test('Acoma orphan observations remain raw but are not photo-qualified or falsely zero', () => {
  const ctx = runtime();
  const acoma = row({ PHOTO_LINK: null, PHOTO_NAME: null, AV_RULE_PHOTO_UPDATED_AT: null, DATE_COMPLETED: null });
  const before = JSON.stringify(acoma);
  assert.equal(ctx.calculateLocMatchQtyValue(acoma), 174);
  assert.equal(ctx.getLocPhotoEvidenceState(acoma).state, 'missing');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(acoma), null);
  assert.equal(ctx.getDisplayLocMatchQtyValue(acoma), '');
  assert.equal(ctx.getCurrentCardLocPhotoMatchQtyValue(acoma), '');
  assert.equal(ctx.formatLocPhotoMatchQtyValue(acoma), 'Not verified');
  assert.equal(JSON.stringify(acoma), before);
});

test('Anna current evidence preserves 695 without season, S_LTS or on-hand caps', () => {
  const ctx = runtime();
  const anna = row({ MATCH: '70', PTRAVAILABLE: 993, INITIAL_PTR: 993, LOC_MATCH_QTY: 1, SEASON: 'S1', YEAR: 2027, S_LTS: 0, PTRONHAND: 2 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(anna, 'av'), 695);
  assert.equal(ctx.getCurrentCardLocPhotoMatchQtyValue(anna, 'av'), '695');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, PTRAVAILABLE: 1000, INITIAL_PTR: 2000 }), 700);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, PTRAVAILABLE: 900, INITIAL_PTR: 2000 }), 630);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...anna, INITIAL_PTR: '' }), 695);
});

test('ten-day boundary is inclusive, with missing, undated, future and stale distinct', () => {
  const ctx = runtime();
  const dated = (at) => row({ AV_RULE_PHOTO_UPDATED_AT: new Date(at).toISOString() });
  assert.equal(ctx.getLocPhotoEvidenceState(dated(NOW - 10 * DAY)).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(dated(NOW - 10 * DAY)).expiresAt, NOW + 1);
  for (const [candidate, state] of [[dated(NOW - 10 * DAY - 1), 'stale'], [dated(NOW + 1), 'future'],
    [row({ AV_RULE_PHOTO_UPDATED_AT: '' }), 'undated'], [row({ PHOTO_LINK: '' }), 'missing'], [row({ PHOTO_LINK: 'javascript:alert(1)' }), 'invalid']]) {
    assert.equal(ctx.getLocPhotoEvidenceState(candidate).state, state);
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(candidate), null);
  }
});

test('generic edits and later completion never revive older or invalid photo timestamps', () => {
  const ctx = runtime();
  const edits = { DATE_COMPLETED: '2026-09-07T17:00:00Z', UPDATED_AT: '2026-09-07T17:00:00Z',
    AV_RULE_BUNDLE_UPDATED_AT: '2026-09-07T17:00:00Z', AV_RULE_MATCH_UPDATED_AT: '2026-09-07T17:00:00Z',
    AV_RULE_SPEC_UPDATED_AT: '2026-09-07T17:00:00Z', AV_NOTE: 'Updated note', SPEC: 'Updated spec' };
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' })).state, 'stale');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: 'invalid' })).state, 'undated');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: null })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ ...edits, AV_RULE_PHOTO_UPDATED_AT: null, DATE_COMPLETED: null })).state, 'undated');
});

test('explicit capture dates are paired with their own URLs and never use detached names', () => {
  const ctx = runtime();
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: `${PHOTO},${PHOTO.replace('crop.webp', 'second.webp')}`, PHOTO_NAME: '8.1.26_crop.webp,9.6.26_crop.webp', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: '2026-09-06.jpg', AV_RULE_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' })).state, 'current');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: `,${PHOTO}`, PHOTO_NAME: '9.6.26_crop.webp,unknown.webp', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'undated');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: '', PHOTO_NAME: '9.6.26_crop.webp' })).state, 'missing');
  assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: '2026%2D09%2D06.jpg', AV_RULE_PHOTO_UPDATED_AT: '' })).state, 'current');
  assert.equal(ctx.getLocPhotoCaptureEvidence('2026-09-06T18:23:45.000Z.jpg').at, Date.parse('2026-09-06T12:00:00Z'));
});

test('invalid explicit calendar dates cannot fall back to fresh metadata', () => {
  const ctx = runtime();
  for (const name of ['2026-09-31.jpg', '2026-02-30T12:00:00Z', '2026-09-06T99:99:99Z', '9.31.26_crop.jpg', 'bad%name']) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_NAME: name })).state, 'undated', name);
  }
  for (const stamp of ['now', 'tomorrow', '9/6/26', '2026-09-06', '2026-09-06T12:00:00', '2026-09-31T12:00:00Z']) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ AV_RULE_PHOTO_UPDATED_AT: stamp })).state, 'undated', stamp);
  }
  assert.equal(ctx.parseLocPhotoEvidenceTimestamp('2026-09-06 18:00:00+00'), NOW - DAY);
});

test('known zeros are retained; malformed/missing measurements cannot use stored fallback', () => {
  const ctx = runtime();
  for (const changes of [{ MATCH: 0 }, { PTRAVAILABLE: 0 }]) {
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row(changes)), 0);
    assert.equal(ctx.formatLocPhotoMatchQtyValue(row(changes)), '0');
  }
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row({ INITIAL_PTR: 0 })), 174,
    'initial stock must not replace current Available stock');
  for (const changes of [{ MATCH: '' }, { MATCH: 'review50' }, { MATCH: '101' }, { MATCH: '-2' },
    { PTRAVAILABLE: '' }, { PTRAVAILABLE: 'unknown' }, { PTRAVAILABLE: '0x10' }, { PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false }]) {
    assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row(changes)), null, JSON.stringify(changes));
  }
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(row({ MATCH: '50%' })), 174);
});

test('shared references match production storage paths; only dock context accepts dock photos', () => {
  const ctx = runtime();
  for (const link of ['https://example.com/9.6.26.jpg', PHOTO + '?token=temporary', PHOTO + '#hash',
    PHOTO.replace('crop.webp', '../crop.webp'), PHOTO.replace('crop.webp', '%2e%2e/crop.webp'),
    PHOTO.replace('crop.webp', '%2e%2e%2fcrop.webp'), PHOTO.replace('request_photos', 'dock_photos')]) {
    assert.equal(ctx.getLocPhotoEvidenceState(row({ PHOTO_LINK: link })).state, 'invalid', link);
  }
  const dock = row({ DOCK_PHOTO_LINK: PHOTO.replace('request_photos', 'dock_photos'), DOCK_PHOTO_NAME: '9.6.26_crop.webp' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(dock, 'docks'), 174);
});

test('a queued deferred-photo observer callback never loads an image after its card was detached', () => {
  let observerCallback = null;
  class FakeIntersectionObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const ctx = runtime(['hydrateDeferredCardPhoto', 'getDeferredCardPhotoRootMargin', 'getDeferredCardPhotoObserver'], {
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_MOBILE: '160px 0px 320px 0px',
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_DESKTOP: '320px 0px 480px 0px',
    deferredCardPhotoObserver: null,
    deferredCardPhotoObserverRootMargin: '',
    IntersectionObserver: FakeIntersectionObserver,
    isTouchConstrainedDevice: () => false,
    document: { querySelectorAll: () => [] },
  });
  const image = {
    isConnected: false,
    dataset: { src: PHOTO, photoObserved: '1' },
    src: '',
    classList: { add() {} },
    closest: () => null,
  };
  ctx.getDeferredCardPhotoObserver();
  assert.equal(typeof observerCallback, 'function');
  observerCallback([{ target: image, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(image.src, '', 'detached/replaced card must not trigger a stale image request');
  assert.notEqual(image.dataset.photoHydrated, '1');
});

test('a deferred-photo callback for an obsolete URL requeues the connected current card without loading stale media', () => {
  let observerCallback = null;
  const scheduledRoots = [];
  class FakeIntersectionObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const card = { isConnected: true };
  const image = {
    isConnected: true,
    dataset: { src: PHOTO.replace('crop.webp', 'current.webp'), photoObserved: '1', photoObservedSrc: PHOTO },
    src: '',
    parentElement: card,
    closest: () => card,
    classList: { add() {} },
  };
  const ctx = runtime(['hydrateDeferredCardPhoto', 'getDeferredCardPhotoRootMargin', 'getDeferredCardPhotoObserver'], {
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_MOBILE: '160px 0px 320px 0px',
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_DESKTOP: '320px 0px 480px 0px',
    deferredCardPhotoObserver: null,
    deferredCardPhotoObserverRootMargin: '',
    IntersectionObserver: FakeIntersectionObserver,
    isTouchConstrainedDevice: () => false,
    document: { querySelectorAll: () => [] },
    scheduleDeferredCardPhotoHydration: (root) => scheduledRoots.push(root),
  });
  ctx.getDeferredCardPhotoObserver();
  observerCallback([{ target: image, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(image.src, '', 'an old intersection entry must not load the former URL');
  assert.deepEqual(scheduledRoots, [card], 'the current connected card is rescheduled using its current data-src');
  assert.notEqual(image.dataset.photoObserved, '1');
});

test('a late failure from an old photo URL cannot mark the current card photo as unavailable', () => {
  const failures = [];
  const image = {
    isConnected: true,
    dataset: { src: PHOTO },
    classList: { add: (name) => failures.push(name) },
    closest: () => null,
  };
  const ctx = runtime(['hydrateDeferredCardPhoto']);
  ctx.hydrateDeferredCardPhoto(image);
  assert.equal(image.src, PHOTO);
  image.dataset.src = PHOTO.replace('crop.webp', 'current.webp');
  image.onerror();
  assert.notEqual(image.dataset.photoLoadFailed, '1');
  assert.deepEqual(failures, []);
});

test('deferred-photo batches hydrate every image without treating its array index as an expected URL', () => {
  for (const loading of ['eager', 'lazy']) {
    let frame = null;
    const images = [PHOTO.replace('crop.webp', 'first.webp'), PHOTO.replace('crop.webp', 'second.webp')].map(src => ({
      isConnected: true,
      dataset: { src },
      src: '',
      classList: { add() {} },
      getAttribute(name) { return name === 'loading' ? loading : name === 'fetchpriority' ? 'low' : null; },
      closest: () => null,
    }));
    const host = { isConnected: true, querySelectorAll: () => images };
    const ctx = runtime(['hydrateDeferredCardPhoto', 'scheduleDeferredCardPhotoHydration'], {
      document: {}, window: { setTimeout: () => 1, clearTimeout() {} },
      requestAnimationFrame: callback => { frame = callback; return 1; },
      deferredCardPhotoHydrationRoots: new Set(), deferredCardPhotoHydrationFrame: 0,
      deferredCardPhotoHydrationIdleTimer: 0, deferredCardPhotoObserver: null,
      deferredCardPhotoObserverRootMargin: '',
      getAdaptiveImageHydrationScanLimit: () => 10,
      getAdaptivePerformanceLevel: () => 0,
      isTouchConstrainedDevice: () => false,
      isUserInLiveTouchScrollGesture: () => false,
      getDeferredCardPhotoObserver: () => null,
    });
    ctx.scheduleDeferredCardPhotoHydration(host);
    assert.equal(typeof frame, 'function');
    frame();
    assert.deepEqual(images.map(image => image.src), images.map(image => image.dataset.src), `${loading} batch loads each current image URL`);
    assert.deepEqual(images.map(image => image.dataset.photoHydrated), ['1', '1'], `${loading} batch marks each image hydrated`);
  }
});

test('a callback from a replaced photo observer cannot hydrate media from its old viewport', () => {
  const observers = [];
  let touch = false;
  class FakeIntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; this.disconnected = false; observers.push(this); }
    observe() {}
    unobserve() {}
    disconnect() { this.disconnected = true; }
  }
  const scheduledRoots = [];
  const card = { isConnected: true };
  const image = {
    isConnected: true,
    dataset: { src: PHOTO, photoObserved: '1', photoObservedSrc: PHOTO },
    src: '',
    parentElement: card,
    closest: () => card,
    classList: { add() {} },
  };
  const ctx = runtime(['hydrateDeferredCardPhoto', 'getDeferredCardPhotoRootMargin', 'getDeferredCardPhotoObserver'], {
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_MOBILE: '160px 0px 320px 0px',
    DEFERRED_CARD_PHOTO_ROOT_MARGIN_DESKTOP: '320px 0px 480px 0px',
    deferredCardPhotoObserver: null,
    deferredCardPhotoObserverRootMargin: '',
    IntersectionObserver: FakeIntersectionObserver,
    isTouchConstrainedDevice: () => touch,
    document: { querySelectorAll: () => [] },
    scheduleDeferredCardPhotoHydration: (root) => scheduledRoots.push(root),
  });
  const desktopObserver = ctx.getDeferredCardPhotoObserver();
  touch = true;
  const mobileObserver = ctx.getDeferredCardPhotoObserver();
  assert.notEqual(mobileObserver, desktopObserver);
  assert.equal(desktopObserver.disconnected, true);
  desktopObserver.callback([{ target: image, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(image.src, '', 'callbacks from disconnected observers must not initiate requests');
  assert.deepEqual(scheduledRoots, [card], 'the connected card is scheduled under the active observer policy');
});

test('request and flyer display evidence belongs to the selected owner only', () => {
  const ctx = runtime();
  const shared = row({ REQ_MATCH: 50, FLYER_MATCH: 50, FLYER_LOC_MATCH_QTY: 99 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(shared, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(shared, 'flyer'), null);
  const request = { ...shared, REQ_PHOTO_LINK: PHOTO, REQ_PHOTO_NAME: '9.6.26_crop.webp' };
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, REQ_MATCH: '' }, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, REQ_PHOTO_NAME: '8.1.26_crop.webp' }, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, PHOTO_LINK: '' }, 'av'), null);
  const flyer = { ...shared, FLYER_PHOTO_LINK: PHOTO, FLYER_PHOTO_NAME: '9.6.26_crop.webp', selectedFlyer: true };
  assert.equal(ctx.getDisplayLocMatchQtyValue(flyer, 'tasks'), '174');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, PTRAVAILABLE: 294, FLYER_INITIAL_PTR: 400 }, 'tasks'), '147');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, FLYER_MATCH: 0 }, 'tasks'), '0');
  assert.equal(ctx.getDisplayLocMatchQtyValue({ ...flyer, FLYER_PHOTO_LINK: '' }, 'tasks'), '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...flyer, FLYER_MATCH: '' , MATCH: '' }, 'flyer'), null);
});

test('Request photo resolution preserves request-owned photos and delegates empty rows to the exact inventory resolver', () => {
  const request = { SOURCE_TABLE: 'ph_active_request', UNIQUE_ID: 'request-1', MASTER_ID: 'master-1', REQ_PHOTO_LINK: '' };
  let verifiedInventoryRow = { UNIQUE_ID: 'master-1', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'LOC-1', LOTCODE: 'LOT-1', PHOTO_LINK: PHOTO };
  const helperCalls = [];
  const ctx = runtime(['getRowPhotoLink'], {
    getRequestPhotoLinkCsv: (item) => String(item && item.REQ_PHOTO_LINK || ''),
    getQueueCardInventoryRow: (item, sourceView) => { helperCalls.push([item, sourceView]); return verifiedInventoryRow; },
    getSharedAppPhotoLinkCsv: (item) => String(item && item.PHOTO_LINK || ''),
  });
  assert.equal(ctx.getRowPhotoLink(request, 'request'), PHOTO,
    'a request with no own photo should display its authorized exact linked inventory photo');
  assert.equal(helperCalls.length, 1);
  assert.equal(helperCalls[0][0], request);
  assert.equal(helperCalls[0][1], 'request');

  request.REQ_PHOTO_LINK = PHOTO.replace('crop.webp', 'request-owned.webp');
  helperCalls.length = 0;
  assert.equal(ctx.getRowPhotoLink(request, 'request'), request.REQ_PHOTO_LINK,
    'request-owned photo remains the first choice');
  assert.equal(helperCalls.length, 0, 'linked inventory must not replace a request-owned image');

  request.REQ_PHOTO_LINK = '';
  verifiedInventoryRow = null;
  assert.equal(ctx.getRowPhotoLink(request, 'request'), '',
    'an unresolved inventory lookup must keep the no-photo state rather than guess a row');
});

test('editor preview uses live Available stock without requiring saved photo evidence', () => {
  const elements = new Map();
  const ctx = runtime(['calculateMatchQty'], {
    activeItem: { MATCH: 50, PTRAVAILABLE: 1000 },
    document: { getElementById: (id) => elements.get(id) || null },
    markLocMatchInputValidity: () => false,
  });
  const input = { id: 'ssn-match', value: '50' };
  const output = { innerText: 'Not verified' };
  const display = { classList: { hidden: true, add(name) { if (name === 'hidden') this.hidden = true; }, remove(name) { if (name === 'hidden') this.hidden = false; } } };
  elements.set('ssn-match', input);
  elements.set('ssn-match-qty-val', output);
  elements.set('ssn-match-display', display);

  ctx.calculateMatchQty('ssn-');
  assert.equal(String(output.innerText), '500');
  assert.equal(display.classList.hidden, false);
  assert.equal(ctx.getEditorLocMatchQtyValue({ MATCH: 50, PTRAVAILABLE: 900 }, '50'), 450);
});

test('saved percentage follows changing Available while preserving the percent rule', () => {
  const ctx = runtime();
  const saved = row({ MATCH: '50', PTRAVAILABLE: 1000, INITIAL_PTR: 1000 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved, 'av'), 500);
  saved.PTRAVAILABLE = 900;
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved, 'av'), 450);
  saved.PTRAVAILABLE = 1200;
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved, 'av'), 600);
  assert.equal(saved.MATCH, '50');
});

test('manager percent aliases use the shared photo-qualified live quantity display', () => {
  const ctx = runtime();
  const managerRow = row({ SOURCE_TABLE: 'ph_active_request', MATCH: '', LOC_MATCH_PERCENT: '50',
    REQ_PHOTO_LINK: PHOTO, REQ_PHOTO_NAME: '9.6.26_crop.webp', REQ_PHOTO_UPDATED_AT: '2026-09-06T18:00:00Z',
    PHOTO_LINK: '', PTRAVAILABLE: 1000 });
  assert.equal(ctx.getManagerLocPhotoMatchQtyValue(managerRow, 'request'), '500');
  assert.equal(ctx.getManagerLocPhotoMatchQtyValue({ ...managerRow, PTRAVAILABLE: 900 }, 'request'), '450');
  assert.equal(ctx.getManagerLocPhotoMatchQtyValue({ ...managerRow, REQ_MATCH: '' }, 'request'), 'Not verified');
});

test('live refresh updates preview quantities without normalizing or capturing the eval-work draft', () => {
  const elements = new Map();
  const input = { value: '50.0' };
  const evalDisplay = { classList: { remove() {} } };
  const evalValue = { textContent: 'Not verified' };
  const activeInput = { id: 'ssn-match', value: '50' };
  const activeValue = { innerText: 'Not verified' };
  const activeDisplay = { classList: { add() {}, remove() {} } };
  for (const [id, element] of [
    ['eval-work-loc-match', input], ['eval-work-match-display', evalDisplay], ['eval-work-match-qty-val', evalValue],
    ['ssn-match', activeInput], ['ssn-match-qty-val', activeValue], ['ssn-match-display', activeDisplay],
  ]) elements.set(id, element);
  let captured = false;
  const ctx = runtime(['calculateMatchQty', 'calculateEvalWorkMatchQty', 'refreshLiveLocMatchQuantityPreviews'], {
    document: { hidden: false, getElementById: (id) => elements.get(id) || null, querySelector: () => null },
    activeItem: { MATCH: '50', PTRAVAILABLE: 1000 },
    activeEvalWorkDetailId: 'work-1', evalWorkActiveOriginUid: 'origin-1',
    isViewVisible: () => true,
    getDetailPhotoUpdatePrefixFromTab: () => 'ssn-',
    markLocMatchInputValidity: () => false,
    getEvalWorkById: () => ({ id: 'work-1' }),
    getEvalWorkOriginEntries: () => [{ origin_unique_id: 'origin-1' }],
    getEvalWorkOriginSourceRow: () => ({ MATCH: '50', masterRow: { PTRAVAILABLE: 900 } }),
    findLinkedMasterRow: (item) => item && item.masterRow || null,
    captureEvalWorkPicturesSpecsEditSoon: () => { captured = true; },
  });

  ctx.refreshLiveLocMatchQuantityPreviews();
  assert.equal(String(activeValue.innerText), '500');
  assert.equal(evalValue.textContent, '450');
  assert.equal(input.value, '50.0', 'preview refresh must preserve the draft input text');
  assert.equal(captured, false, 'preview refresh must not capture or persist draft edits');
});

test('percentage calculator keeps zero distinct from invalid, unavailable, or unknown stock', () => {
  const ctx = runtime();
  assert.equal(ctx.calculateLocMatchQtyValue({ PTRAVAILABLE: 900 }, '0'), 0);
  assert.equal(ctx.calculateLocMatchQtyValue({ PTRAVAILABLE: 0 }, '50'), 0);
  assert.equal(ctx.calculateLocMatchQtyValue({ PTRAVAILABLE: 'unknown' }, '50'), null);
  assert.equal(ctx.calculateLocMatchQtyValue({ PTRAVAILABLE: 900 }, '101'), null);
  assert.equal(ctx.calculateLocMatchQtyValue({ PTRAVAILABLE: 900 }, '50%', { useFlyerFields: false }), 450);
});

test('saved view projections use linked live stock while retaining the owning percentage and photo', () => {
  const live = { PTRAVAILABLE: 1000, MATCH: 99, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: true };
  const ctx = runtime([], { findLinkedMasterRow: () => live });
  const saved = row({ PTRAVAILABLE: 1, LOC_MATCH_QTY: 999, INITIAL_PTR: 'unknown',
    REQ_MATCH: '50', REQ_PHOTO_LINK: PHOTO, REQ_PHOTO_NAME: '9.6.26_crop.webp' });
  for (const [available, expected] of [[1000, '500'], [900, '450'], [1200, '600'], [0, '0']]) {
    live.PTRAVAILABLE = available;
    for (const view of ['drive', 'request', 'tasks', 'managers']) {
      assert.equal(ctx.formatLocPhotoMatchQtyValue(saved, view), expected, view);
    }
  }
  assert.equal(saved.MATCH, '50');
  assert.equal(saved.PTRAVAILABLE, 1, 'a projection must not mutate a detached row');
  assert.equal(saved.LOC_MATCH_QTY, 999, 'a stored snapshot must not be rewritten by rendering');
  assert.equal(ctx.formatLocPhotoMatchQtyValue({ ...saved, REQ_PHOTO_LINK: '' }, 'request'), 'Not verified');
});

test('a copied zero-stock row cannot hide a positive live quantity or bypass expiry checks', () => {
  let reasons = ['loc_match_qty_zero'];
  const ctx = runtime(['shouldHideSharedAppPayloadForInvalidAvRules'], {
    findLinkedMasterRow: () => ({ PTRAVAILABLE: 900 }),
    getMasterAvInvalidationReasons: () => reasons,
    getHoldStopBlockTokens: () => new Set(), getHoldStopSnapshotFromItem: () => '',
  });
  const saved = row({ PTRAVAILABLE: 0, LOC_MATCH_QTY: 0 });
  assert.equal(ctx.formatLocPhotoMatchQtyValue(saved, 'drive'), '450');
  reasons = ['loc_match_qty_zero', 'stale_10_day'];
  assert.equal(ctx.formatLocPhotoMatchQtyValue(saved, 'drive'), 'Not verified');
});

test('incremental card painting recalculates stock changes without a timestamp change', () => {
  const current = row({ UNIQUE_ID: 'live-1', PTRAVAILABLE: 1000, LAST_UPDATED: '2026-09-06T18:00:00Z' });
  const replacements = [];
  let focused = false;
  let hydrationSchedules = 0;
  const card = { getAttribute: () => 'card-1', contains: () => focused,
    replaceWith: (replacement) => replacements.push(replacement) };
  const scroller = { scrollTop: 37 };
  const entries = new Map();
  const ctx = runtime(['inventoryStatusCardSignature', 'paintInventoryStatusCards'], {
    inventoryStatusSync: { getDisplayRow: (item) => item }, inventoryStatusRenderedCards: entries,
    scheduleDeferredCardPhotoHydration: () => { hydrationSchedules++; },
    findItemByUniqueId: () => current,
    document: { hidden: false, activeElement: { matches: () => true },
      getElementById: () => scroller,
      querySelectorAll: (selector) => selector === '[data-dom-id]' ? [card] : [],
      createElement: () => ({ content: { firstElementChild: {} }, set innerHTML(value) { this.content.firstElementChild.quantity = value; } }),
    },
  });
  ctx.generateCard = (item) => ctx.formatLocPhotoMatchQtyValue(item, 'drive');
  entries.set('card-1', { uid: 'live-1', row: current, sourceView: 'drive', signature: ctx.inventoryStatusCardSignature(current) });
  current.PTRAVAILABLE = 900;
  ctx.paintInventoryStatusCards();
  assert.equal(replacements[0].quantity, '450');
  assert.equal(hydrationSchedules, 1, 'replacement cards schedule deferred photo hydration');
  assert.equal(current.LAST_UPDATED, '2026-09-06T18:00:00Z');
  assert.equal(scroller.scrollTop, 37);
  focused = true;
  current.PTRAVAILABLE = 1200;
  ctx.paintInventoryStatusCards();
  assert.equal(replacements.length, 1, 'painting must preserve a card containing active input');
});

test('authoritative snapshot and row commits refresh quantity readouts after updating stock', () => {
  assert.match(source('getProductionLiveSyncCoordinator'), /processAndLoadData\(payload\);\s*refreshLiveLocMatchQuantityPreviews\(\)/);
  assert.match(source('applyArgosInventoryTransactionReturnedRow'), /upsertRealtimeRow\(fullInventory,[\s\S]*options\.deferPublication !== true\) publishArgosInventoryTransactionReturnedRows\(\[formatted\]\)/);
  assert.match(source('publishArgosInventoryTransactionReturnedRows'), /rebuildMasterInventoryIndexes\(\)[\s\S]*propagateCommittedEdit\([\s\S]*refreshLiveLocMatchQuantityPreviews\(\)/);
});

test('Manager detail refresh patches its live quantity while preserving the open draft', () => {
  const live = { PTRAVAILABLE: 900 };
  const managerValue = { textContent: '500' };
  const focusedInput = { value: 'unsaved spec', selectionStart: 3 };
  const saved = row({ SOURCE_TABLE: 'ph_active_request', REQ_MATCH: '50', PTRAVAILABLE: 1000,
    REQ_PHOTO_LINK: PHOTO, REQ_PHOTO_NAME: '9.6.26_crop.webp', REQ_SPEC: 'unsaved spec' });
  const ctx = runtime(['refreshLiveLocMatchQuantityPreviews'], {
    activeItem: saved, activeDetailSourceView: 'request', lastView: 'managers',
    document: { hidden: false, activeElement: focusedInput, getElementById: () => null,
      querySelector: () => managerValue },
    isViewVisible: () => true, getDetailPhotoUpdatePrefixFromTab: () => '', findLinkedMasterRow: () => live,
  });
  ctx.refreshLiveLocMatchQuantityPreviews();
  assert.equal(managerValue.textContent, '450');
  assert.equal(saved.REQ_MATCH, '50');
  assert.equal(saved.REQ_SPEC, 'unsaved spec');
  assert.equal(ctx.document.activeElement, focusedInput);
  assert.equal(focusedInput.selectionStart, 3);
});

test('native owner completion is allowed but unrelated master completion is not', () => {
  const ctx = runtime();
  const request = row({ REQ_MATCH: 50, REQ_PHOTO_LINK: PHOTO, DATE_COMPLETED: '2026-09-06T18:00:00Z' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(request, 'request'), null);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_active_request' }), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_request_history' }), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...request, SOURCE_TABLE: 'ph_active_request', REQ_PHOTO_UPDATED_AT: '2026-08-01T12:00:00Z' }), null);
  assert.equal(ctx.getLocPhotoEvidenceContext({ SOURCE_TABLE: 'ph_flyer_folder_rows' }, 'request'), 'request');
  assert.equal(ctx.getLocPhotoEvidenceContext({ SOURCE_TABLE: 'ph_active_request' }, 'docks'), 'dock');
});

test('existing positive-quantity visibility guards do not mutate raw observations or suppress known zero', () => {
  const ctx = runtime([], { shouldHideSharedAppPayloadForInvalidAvRules(copy) { copy.LOC_MATCH_QTY = 1; return true; } });
  const saved = row();
  assert.equal(ctx.getDisplayLocMatchQtyValue(saved, 'av'), '');
  assert.equal(saved.LOC_MATCH_QTY, '174');
  assert.equal(ctx.getDisplayLocMatchQtyValue(row({ MATCH: 0 }), 'av'), '0');
});

test('lowercase source rows and explicit canonical removal have the same qualification', () => {
  const ctx = runtime();
  const lower = Object.fromEntries(Object.entries(row()).map(([key, value]) => [key.toLowerCase(), value]));
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(lower, 'av'), 174);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue({ ...row(), PHOTO_LINK: null, SAVED_PHOTO_LINK: PHOTO, photo_link: PHOTO }), null);
});

test('normalization and remove-photo/keep-data preserve raw measurements and history', () => {
  const ctx = runtime(['normalizeRowPhotoFields', 'getSharedAppPhotoName', 'getProductivitySnapshotLocMatchQty'], {
    normalizeFlyerShadowFields: () => {},
    sortPhotoCsvPairByCaptureOrder: (links, names) => ({ photoCsv: links || '', photoNameCsv: names || '' }),
    mergePhotoCsvList: (values) => values.filter(Boolean).join(','),
  });
  const removed = row({ PHOTO_LINK: null, PHOTO_NAME: null, SAVED_PHOTO_LINK: PHOTO, PHOTOLINK: PHOTO,
    FLYER_PHOTO_LINK: null, flyer_photo_link: PHOTO, FLYERPHOTO_LINK: PHOTO, HISTORY: [{ LOC_MATCH_QTY: 174 }] });
  ctx.normalizeRowPhotoFields(removed);
  assert.equal(removed.MATCH, '50');
  assert.equal(removed.INITIAL_PTR, '347');
  assert.equal(removed.LOC_MATCH_QTY, '174');
  assert.deepEqual(removed.HISTORY, [{ LOC_MATCH_QTY: 174 }]);
  assert.equal(removed.SAVED_PHOTO_LINK, '');
  assert.equal(removed.PHOTOLINK, '');
  assert.equal(removed.FLYERPHOTO_LINK, '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(removed), null);
  assert.equal(ctx.getProductivitySnapshotLocMatchQty(removed), '174');
});

test('real alias-removal helper drops the last photo without clearing observations', () => {
  const ctx = runtime(['getPhotoAliasFieldsForPrefix', 'setPhotoAliasFieldsForPrefix', 'removePhotoFromAliasFields'], {
    parsePhotoCsvValues: (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean),
    mergePhotoCsvList: (values) => [...new Set(values.filter(Boolean).flatMap((value) => value.split(',')))].join(','),
  });
  const saved = row({ SAVED_PHOTO_LINK: PHOTO, SAVED_PHOTO_NAME: 'crop.webp' });
  assert.equal(ctx.removePhotoFromAliasFields(saved, '', PHOTO).removed, true);
  assert.equal(saved.MATCH, '50');
  assert.equal(saved.INITIAL_PTR, '347');
  assert.equal(saved.LOC_MATCH_QTY, '174');
  assert.equal(saved.PHOTO_LINK, '');
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
});

test('fetched rows retain explicit photo clears and distinguish missing stock from known zero', () => {
  const ctx = runtime(['formatFetchedRows', 'normalizeRowPhotoFields', 'getSharedAppPhotoName', 'preserveConfirmedDriveEvidence'], {
    normalizeAppTableName: (value) => value,
    normalizeFlyerShadowFields: () => {}, repairDisplayFieldsOnRow: () => {},
    confirmedDriveEvidenceRows: new Map(),
    getSupabaseReadIdentityScope: () => 'av-photo-evidence-fixture',
    sortPhotoCsvPairByCaptureOrder: (links, names) => ({ photoCsv: links || '', photoNameCsv: names || '' }),
    mergePhotoCsvList: (values) => values.filter(Boolean).join(','),
  });
  const raw = { photo_link: null, saved_photo_link: PHOTO, match: 50, initial_ptr: 347, loc_match_qty: 174 };
  const [formatted] = ctx.formatFetchedRows([raw], 'ph_master_inventory');
  assert.equal(formatted.PHOTO_LINK, '');
  assert.equal(formatted.LOC_MATCH_QTY, 174);
  assert.equal(formatted.PHOTO_MATCH_PTR_AVAILABLE_KNOWN, false);
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(formatted), null);
  assert.equal(ctx.formatFetchedRows([{ ...raw, ptravailable: 0 }], 'ph_master_inventory')[0].PHOTO_MATCH_PTR_AVAILABLE_KNOWN, true);
});

test('known thumbnail failure invalidates only that card display and does not fetch originals', () => {
  const ctx = runtime(['invalidateCardPhotoMatchOnLoadFailure', 'hydrateDeferredCardPhoto']);
  const output = { textContent: '174', setAttribute(name, value) { this[name] = value; } };
  const card = { classList: { contains: () => false }, querySelectorAll: () => [output] };
  const image = { dataset: { src: PHOTO }, classList: { add() {} }, closest: () => card };
  ctx.hydrateDeferredCardPhoto(image);
  assert.equal(image.src, PHOTO);
  image.onerror();
  assert.equal(output.textContent, 'Not verified');
  card.classList.contains = () => true;
  ctx.invalidateCardPhotoMatchOnLoadFailure(image);
  assert.equal(output.textContent, 'N/A', 'Drive uses the compact invalid-match label');
  assert.equal(image.dataset.photoLoadFailed, '1');
  assert.equal(image.src, PHOTO);
  assert.match(output.title, /could not be loaded/);
  assert.doesNotMatch(source('invalidateCardPhotoMatchOnLoadFailure'), /activeItem|LOC_MATCH_QTY\s*=|fetch\(/);
  assert.match(source('renderAvDetailHero'), /onerror="invalidateCardPhotoMatchOnLoadFailure\(this\)"/);
});

test('authoritative stock updates refresh unknown-stock qualification without a reload', () => {
  const ctx = runtime(['applyMasterSyncPayloadToLocalRow'], {
    normalizeRowPhotoFields: (item) => item,
    repairDisplayFieldsOnRow: () => {},
    buildSearchIndex: () => {},
  });
  const saved = row({ PTRAVAILABLE: 0, PHOTO_MATCH_PTR_AVAILABLE_KNOWN: false });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: '347' });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), 174);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: 0 });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), 0);
  ctx.applyMasterSyncPayloadToLocalRow(saved, { ptravailable: null });
  assert.equal(ctx.getPhotoQualifiedLocMatchQtyValue(saved), null);
  assert.equal(saved.LOC_MATCH_QTY, '174');
});

test('public cards, shares, exports and previews use projections; invalidation is not destructive', () => {
  assert.match(source('getAvOpenStockLocPhotoMatch'), /formatLocPhotoMatchQtyValue/);
  assert.match(source('getAVExportColumns'), /label: 'Loc Photo Match', value: \(row\) => formatLocPhotoMatchQtyValue/);
  assert.match(source('getDriveColumnItemValue'), /case 'LOC_MATCH_QTY':\s*return formatLocPhotoMatchQtyValue/);
  assert.match(source('getDockSuspendDcRequestEmailFieldRows'), /formatLocPhotoMatchQtyValue\(row, 'request'\)/);
  assert.match(source('buildNcrEmailItemPayload'), /loc_match_qty: locMatchQty/);
  assert.match(source('buildNcrEmailItemPayload'), /getPhotoQualifiedLocMatchQtyValue/);
  assert.doesNotMatch(source('getMasterAvInvalidationReasons'), /getLocPhotoEvidenceState|getPhotoQualifiedLocMatchQtyValue|photo_missing|photo_date_future/);
  assert.doesNotMatch(source('normalizeRowPhotoFields'), /calculateLocMatchQtyValue|LOC_MATCH_QTY\s*=/);
  assert.match(source('calculateMatchQty'), /getEditorLocMatchQtyValue/);
  assert.match(source('calculateMatchQty'), /Not verified/);
  assert.doesNotMatch(html, /V2026\.09\.06\.02/);
});


test('Docks photo fallback uses the exact authorized inventory identity and never a same-lot first match', () => {
  let linked = null;
  const ctx = runtime(['getDockOwnedPhotoLinkCsv'], {
    window:{AgMetricQueueInventory:{}},
    getQueueCardInventoryRow:()=>linked,
    getLinkedMasterPhotoState:()=>{throw new Error('ambiguous legacy lookup');},
    getSharedAppPhotoLinkCsv:row=>row.PHOTO_LINK||'',
    getSharedAppPhotoLinkCsvRaw:()=>'',getSharedAppPhotoName:()=>'',
    mergePhotoCsvList:values=>values.filter(Boolean).join(','),
    filterPhotoCsvByRetention:value=>value,getDisplayPhotoLinkCsv:value=>value,
  });
  const dock={ITEMCODE:'004380.010.1',LOCATIONCODE:'C.09.000',LOTCODE:'27.F1'};
  assert.equal(ctx.getDockOwnedPhotoLinkCsv(dock),'');
  linked={PHOTO_LINK:PHOTO};assert.equal(ctx.getDockOwnedPhotoLinkCsv(dock),PHOTO);
  linked=null;assert.equal(ctx.getDockOwnedPhotoLinkCsv({...dock,DOCK_PHOTO_LINK:PHOTO}),PHOTO);
});
