const DEFERRED_CARD_PHOTO_PENDING = 'img[data-deferred-card-photo="1"]:not([data-photo-hydrated="1"]):not([data-photo-observed="1"])';

function scheduleDeferredCardPhotoHydration(root = document) {
    const requestedRoot = root?.querySelectorAll ? root : document;
    deferredCardPhotoHydrationRoots.delete(requestedRoot);
    deferredCardPhotoHydrationRoots.add(requestedRoot);
    if (deferredCardPhotoHydrationRoots.size > 8) {
        const liveRoots = [...deferredCardPhotoHydrationRoots].filter(isLiveDeferredPhotoRoot).slice(-4);
        deferredCardPhotoHydrationRoots.clear();
        liveRoots.forEach(candidate => deferredCardPhotoHydrationRoots.add(candidate));
    }
    requestDeferredCardPhotoFrame();
}

function isLiveDeferredPhotoRoot(root) {
    return root === document || root.isConnected !== false;
}

function requestDeferredCardPhotoFrame() {
    if (deferredCardPhotoHydrationFrame || deferredCardPhotoHydrationIdleTimer) return;
    deferredCardPhotoHydrationFrame = requestAnimationFrame(runDeferredCardPhotoFrame);
}

function runDeferredCardPhotoFrame() {
    deferredCardPhotoHydrationFrame = 0;
    const roots = [...deferredCardPhotoHydrationRoots].filter(isLiveDeferredPhotoRoot).slice(-3).reverse();
    deferredCardPhotoHydrationRoots.clear();
    const limit = getAdaptiveImageHydrationScanLimit();
    const images = scanDeferredCardPhotoRoots(roots, limit);
    const eager = [];
    const lazy = [];
    for (const img of images) (wantsImmediateDeferredCardPhoto(img) ? eager : lazy).push(img);
    eager.forEach(img => hydrateDeferredCardPhoto(img));
    if (!lazy.length) {
        if (images.length === limit && eager.some(img => img.dataset.photoHydrated === '1')) continuePendingDeferredCardPhotos(roots);
        return;
    }
    const avPhotoFeedVisible = typeof getCurrentVisibleViewId === 'function'
        && getCurrentVisibleViewId() === 'av'
        && typeof getIsAvPhotoSubview === 'function'
        && getIsAvPhotoSubview();
    if (!avPhotoFeedVisible && isTouchConstrainedDevice() && typeof isUserInLiveTouchScrollGesture === 'function' && isUserInLiveTouchScrollGesture()) {
        deferCardPhotoRoots(roots, 220);
        return;
    }
    const observer = getDeferredCardPhotoObserver();
    if (observer) {
        lazy.forEach(img => observeDeferredCardPhoto(img, observer));
        continuePendingDeferredCardPhotos(roots);
        return;
    }
    hydrateDeferredCardPhotoFallbackBatch(lazy, roots);
}

function scanDeferredCardPhotoRoots(roots, limit) {
    const images = new Set();
    for (const root of roots) {
        for (const img of deferredCardPhotoScanScope(root).querySelectorAll(DEFERRED_CARD_PHOTO_PENDING)) {
            images.add(img);
            if (images.size >= limit) return [...images];
        }
    }
    return [...images];
}

function deferredCardPhotoScanScope(root) {
    if (root !== document) return root;
    const viewId = typeof getCurrentVisibleViewId === 'function' ? String(getCurrentVisibleViewId() || '').trim() : '';
    return (viewId && document.getElementById(`view-${viewId}`)) || document;
}

function wantsImmediateDeferredCardPhoto(img) {
    return String(img.getAttribute('loading') || '').toLowerCase() === 'eager'
        || String(img.getAttribute('fetchpriority') || '').toLowerCase() === 'high'
        || img.dataset.photoHydrateNow === '1';
}

function observeDeferredCardPhoto(img, observer) {
    if (img.isConnected === false) return;
    img.dataset.photoObserved = '1';
    img.dataset.photoObservedSrc = String(img.dataset.src || '').trim();
    observer.observe(img);
}

function continuePendingDeferredCardPhotos(roots, delayMs = 48) {
    const pending = roots.filter(root => isLiveDeferredPhotoRoot(root)
        && deferredCardPhotoScanScope(root).querySelector(DEFERRED_CARD_PHOTO_PENDING));
    deferCardPhotoRoots(pending, delayMs);
}

function deferCardPhotoRoots(roots, delayMs) {
    if (!roots.length) return;
    [...roots].reverse().forEach(root => deferredCardPhotoHydrationRoots.add(root));
    if (deferredCardPhotoHydrationFrame || deferredCardPhotoHydrationIdleTimer) return;
    deferredCardPhotoHydrationIdleTimer = window.setTimeout(() => {
        deferredCardPhotoHydrationIdleTimer = 0;
        requestDeferredCardPhotoFrame();
    }, delayMs);
}

function hydrateDeferredCardPhotoFallbackBatch(images, roots) {
    const level = getAdaptivePerformanceLevel();
    const batchSize = level >= 2 ? 3 : (level === 1 || isTouchConstrainedDevice() ? 4 : 8);
    const delay = level >= 2 ? 160 : (level === 1 ? 120 : 80);
    const batch = images.slice(0, batchSize);
    batch.forEach(img => hydrateDeferredCardPhoto(img));
    if (batch.some(img => img.dataset.photoHydrated === '1')) continuePendingDeferredCardPhotos(roots, delay);
}

function getAvCardPhotoHydrationScope(root = document) {
    if (root?.querySelectorAll && root !== document) return root;
    return document.getElementById('av-content') || document;
}

function isAvCardPhotoHydrationRelevant(root = document) {
    const scope = getAvCardPhotoHydrationScope(root);
    if (scope.isConnected === false) return false;
    const viewId = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
    const owner = scope.closest?.('[id^="view-"]');
    if (viewId && owner && owner.id !== `view-${viewId}`) return false;
    if (scope.id === 'av-content' && viewId === 'av') return true;
    return scope.matches?.('.app-av-catalog-card') || !!scope.querySelector?.('.app-av-catalog-card');
}
