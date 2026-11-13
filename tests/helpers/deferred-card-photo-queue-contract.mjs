import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeStoragePublicUrlFixture } from './deferred-queue-storage-fixture.mjs';

const queueSource = readFileSync(new URL('../../src/views/deferred-card-photo-queue.js', import.meta.url), 'utf8')
    .replace(/^export /gm, '');
const runtime = readFileSync(new URL('../../assets/app-runtime.js', import.meta.url), 'utf8');
const avTimerStart = runtime.indexOf('        function queueAvCardPhotoHydration(');
const avTimerEnd = runtime.indexOf('        window.queueAvCardPhotoHydration =', avTimerStart);
const avTimerSource = runtime.slice(avTimerStart, avTimerEnd);

export function installDeferredCardPhotoQueue(context, candidate = queueSource) {
    assert.ok(avTimerStart >= 0 && avTimerEnd > avTimerStart);
    vm.runInContext(`${candidate}\n${avTimerSource}`, context);
}

function photo(id, immediate = true) {
    return { id, isConnected: true, dataset: { src: `${id}.jpg`, photoHydrateNow: immediate ? '1' : '' },
        getAttribute: () => null, addEventListener() {}, classList: { add() {}, remove() {} } };
}

function photoRoot(id, photos, avCards = false) {
    return {
        id, isConnected: true,
        querySelectorAll() { return photos.filter(img => img.dataset.photoHydrated !== '1' && img.dataset.photoObserved !== '1'); },
        querySelector(selector) { return selector === '.app-av-catalog-card' ? (avCards ? this : null) : this.querySelectorAll()[0] || null; }
    };
}

function observePhotoSources(root, hydrated) {
    for (const img of root.querySelectorAll()) {
        Object.defineProperty(img,'src',{set() { hydrated.push(img.id); }});
    }
}

function createQueueFixture(candidate) {
    const hydrated = [], observed = [], avPasses = [], frames = [], timers = new Map();
    const av = photoRoot('av-content', [photo('figgy')], true);
    let timerId = 0;
    const context = vm.createContext({
        document: { getElementById: () => av }, getCurrentVisibleViewId: () => 'av',
        deferredCardPhotoHydrationRoots: new Set(), deferredCardPhotoHydrationFrame: 0,
        deferredCardPhotoHydrationIdleTimer: 0, avCardPhotoHydrationTimer: 0,
        getAdaptiveImageHydrationScanLimit: () => 2, isTouchConstrainedDevice: () => false,
        normalizeStoragePublicUrl: normalizeStoragePublicUrlFixture,
        getDeferredCardPhotoFallbackSrc: () => '',
        getDeferredCardPhotoObserver: () => ({ observe: img => observed.push(img.dataset.photoObservedSrc) }),
        hydrateVisibleAvCardPhotos: scope => avPasses.push(scope.id),
        requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
        clearTimeout: id => timers.delete(id),
        window: { setTimeout(callback) { timers.set(++timerId, callback); return timerId; } }
    });
    installDeferredCardPhotoQueue(context, candidate);
    observePhotoSources(av,hydrated);
    return { av, context, hydrated, observed, avPasses, frames, timers };
}

function runQueueTimer(timers) {
    assert.equal(timers.size, 1);
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    callback();
}

export function assertEagerPhotoQueueContinues(candidate) {
    const { av, context, hydrated, frames, timers } = createQueueFixture(candidate);
    const prior = photoRoot('prior-content', ['first', 'second', 'third'].map(id => photo(id)));
    observePhotoSources(prior,hydrated);
    context.scheduleDeferredCardPhotoHydration(prior);
    context.scheduleDeferredCardPhotoHydration(av);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(hydrated, ['figgy', 'first'], 'the newly mounted AV thumbnail reaches the bounded first frame');
    runQueueTimer(timers);
    frames.shift()();
    assert.deepEqual(hydrated, ['figgy', 'first', 'second', 'third'], 'the eager-only scan resumes its remaining connected photos');
    assert.equal(timers.size + frames.length, 0, 'a completed scan does not reschedule itself');
}

export function assertAvPhotoQueueKeepsItsScope(candidate) {
    const { av, context, avPasses, timers } = createQueueFixture(candidate);
    const prior = photoRoot('prior-content', []);
    context.queueAvCardPhotoHydration(av);
    const ownedTimer = timers.keys().next().value;
    context.queueAvCardPhotoHydration(prior);
    assert.equal(timers.keys().next().value, ownedTimer, 'an unrelated render cannot replace the AV timer');
    const reserve = photoRoot('reserve-cards', [], true);
    reserve.closest = () => ({ id: 'view-reserves' });
    context.queueAvCardPhotoHydration(reserve);
    context.queueAvCardPhotoHydration({ ...av, isConnected: false });
    assert.equal(timers.keys().next().value, ownedTimer, 'hidden and detached card scopes cannot replace the AV timer');
    runQueueTimer(timers);
    assert.deepEqual(avPasses, ['av-content']);
    context.getCurrentVisibleViewId = () => 'reserves';
    context.queueAvCardPhotoHydration(reserve);
    runQueueTimer(timers);
    assert.deepEqual(avPasses, ['av-content', 'reserve-cards'], 'a real AV card scope may still use the shared timer');
}

function assertLazyPhotoStillUsesObserver() {
    const { context, hydrated, observed, frames, timers } = createQueueFixture();
    context.scheduleDeferredCardPhotoHydration(photoRoot('drive-content', [photo('drive-card', false)]));
    frames.shift()();
    assert.deepEqual(hydrated, []);
    assert.deepEqual(observed, ['drive-card.jpg']);
    assert.equal(timers.size + frames.length, 0);
}

function assertLazyFallbackUsesBoundedBatches() {
    const { context, hydrated, frames, timers } = createQueueFixture();
    context.getAdaptiveImageHydrationScanLimit = () => 12;
    context.getAdaptivePerformanceLevel = () => 0;
    context.getDeferredCardPhotoObserver = () => null;
    const photos = Array.from({ length: 9 }, (_, index) => photo(`fallback-${index}`, false));
    const drive = photoRoot('drive-content', photos);
    observePhotoSources(drive,hydrated);
    context.scheduleDeferredCardPhotoHydration(drive);
    frames.shift()();
    assert.equal(hydrated.length, 8);
    runQueueTimer(timers);
    frames.shift()();
    assert.equal(hydrated.length, 9);
    assert.equal(timers.size + frames.length, 0);
}

export function assertDeferredCardPhotoQueue() {
    assertEagerPhotoQueueContinues();
    assertAvPhotoQueueKeepsItsScope();
    assertLazyPhotoStillUsesObserver();
    assertLazyFallbackUsesBoundedBatches();
}

export function assertDeferredCardPhotoImagesLoad(runtime, PHOTO) {
    assertDeferredPhotoImageBatch(runtime, PHOTO, 'eager');
    assertDeferredPhotoImageBatch(runtime, PHOTO, 'lazy');
}

function assertDeferredPhotoImageBatch(runtime, PHOTO, loading) {
    let frame = null;
    const images = ['first.webp', 'second.webp'].map(name => deferredFixtureImage(PHOTO.replace('crop.webp', name), loading));
    const host = photoRoot('inventory', images);
    const ctx = runtime(['hydrateDeferredCardPhoto'], {
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
    installDeferredCardPhotoQueue(ctx);
    ctx.scheduleDeferredCardPhotoHydration(host);
    assert.equal(typeof frame, 'function');
    frame();
    assert.deepEqual(images.map(image => image.src), images.map(image => image.dataset.src), `${loading} batch loads each current image URL`);
    assert.deepEqual(images.map(image => image.dataset.photoHydrated), ['1', '1'], `${loading} batch marks each image hydrated`);
}

function deferredFixtureImage(src, loading) {
    const attributes = { loading, fetchpriority: 'low' };
    return {
        isConnected: true, addEventListener() {}, dataset: { src }, src: '',
        classList: { add() {} }, getAttribute: name => attributes[name] ?? null,
        closest: () => null,
    };
}
