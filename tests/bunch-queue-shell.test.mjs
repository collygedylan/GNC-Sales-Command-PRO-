import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const shellSource = readFileSync(new URL('../assets/bunch-queue-shell.js', import.meta.url), 'utf8');

function createShellContext({ resetRequestScroll = false } = {}) {
  let visibleView = 'request';
  let restoreCalls = 0;
  let interactionHandler;
  const scrollTarget = { scrollTop: 250 };
  const classes = new Set();
  const classList = {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    contains: name => classes.has(name),
  };
  const panels = [{ style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {}, removeProperty() {} } }];
  const detailRoot = {
    children: panels,
    classList,
    appendChild(node) { node.parentElement = this; },
  };
  const document = {
    currentScript: null,
    baseURI: 'http://localhost/',
    activeElement: { isConnected: true, focus() {} },
    createElement: () => ({ dataset: {}, setAttribute() {}, remove() { this.isConnected = false; } }),
    getElementById: id => id === 'view-detail' ? detailRoot : null,
    addEventListener(type, handler) { if (type === 'keydown') interactionHandler = handler; },
    removeEventListener() {},
  };
  const context = {
    window: { addEventListener() {} },
    document,
    localStorage: {},
    console,
    URL,
    Date,
    setTimeout,
    clearTimeout,
    canUseInvBunchNotes: () => true,
    nativeAuthProfile: { id: 'profile-1' },
    getSupabaseReadIdentityScope: () => 'identity-1',
    getCurrentVisibleViewId: () => visibleView,
    renderRequestCategoryToolbar() {},
    updateFooterRequestBadge() {},
    SUPABASE_URL: 'https://example.supabase.co',
    postAppFunctionJson() {},
    APP_API_FUNCTION_URL: 'https://example.invalid',
    activeReqTab: 'bunch-notes',
    getMainAreaScrollTarget: () => scrollTarget,
    setMainAreaScrollTop(value) { restoreCalls += 1; scrollTarget.scrollTop = value; },
    shouldResetIosPhoneMainScrollForView: () => resetRequestScroll,
    showPrimaryViewWithScrollPolicy(view, options) {
      visibleView = view;
      if (options.scrollPolicy === 'reset') scrollTarget.scrollTop = options.scrollTop;
    },
    schedulePrimaryViewChromeRefresh() {},
    clearPendingDetailHydration() {},
    activeItem: null,
    activeDetailSourceView: '',
    lastView: 'request',
  };
  vm.createContext(context);
  vm.runInContext(shellSource, context);
  return { shell: context.window.BunchQueueShell, scrollTarget, get visibleView() { return visibleView; }, get restoreCalls() { return restoreCalls; }, dispatchInteraction: () => interactionHandler?.({ key: 'x' }) };
}

test('Bunch detail return preserves the list position when native Request policy preserves it', () => {
  const fixture = createShellContext();
  fixture.shell.openDetail({ title: 'Bunch Plant', onClose() {} });
  assert.equal(fixture.scrollTarget.scrollTop, 0);
  fixture.shell.closeDetail();
  assert.equal(fixture.visibleView, 'request');
  assert.equal(fixture.scrollTarget.scrollTop, 250);
});

test('Bunch detail return follows native iPhone Request policy and returns to the top', () => {
  const fixture = createShellContext({ resetRequestScroll: true });
  fixture.shell.openDetail({ title: 'Bunch Plant', onClose() {} });
  fixture.shell.closeDetail();
  assert.equal(fixture.visibleView, 'request');
  assert.equal(fixture.scrollTarget.scrollTop, 0);
});
