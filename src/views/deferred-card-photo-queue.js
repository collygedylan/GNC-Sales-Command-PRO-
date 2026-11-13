const DEFERRED_CARD_PHOTO_PENDING = 'img[data-deferred-card-photo="1"]:not([data-photo-hydrated="1"]):not([data-photo-observed="1"])';

export function hydrateMountedInventoryCardThumbnail(card) {
    const isAvCard = card.classList.contains('app-av-catalog-card');
    const selector = isAvCard ? '.app-av-photo-slide img' : 'img.app-drive-card-thumbnail';
    const img = card.querySelector(`${selector}[data-deferred-card-photo="1"]`);
    if (!img) return;
    if (isElementNearViewport(img)) {
        img.loading = 'eager';
        hydrateDeferredCardPhoto(img);
    } else {
        const scope = card.closest(isAvCard ? '#av-content' : '#drive-content');
        scheduleDeferredCardPhotoHydration(scope || card);
    }
}

export function refreshInventoryCardWindowPhotos(container, view) {
    tuneNativeImagePerformance(container);
    scheduleDeferredCardPhotoHydration(container);
    if (view === 'av') queueAvCardPhotoHydration(container, 0);
}

export function releaseUnmountedDeferredCardPhotos(card) {
    for (const img of card.querySelectorAll('img[data-photo-observed="1"]')) {
        deferredCardPhotoObserver?.unobserve(img);
        delete img.dataset.photoObserved;
        delete img.dataset.photoObservedSrc;
    }
    deferredCardPhotoHydrationRoots.delete(card);
}

export function scheduleDeferredCardPhotoHydration(root = document) {
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
    const { eager, lazy } = splitDeferredCardPhotoQueue(images);
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

function splitDeferredCardPhotoQueue(images) {
    const driveVisible = typeof getCurrentVisibleViewId === 'function' && getCurrentVisibleViewId() === 'drive';
    let driveBudget = driveVisible ? (isTouchConstrainedDevice() ? 12 : 24) : 0;
    const eager = [];
    const lazy = [];
    for (const img of images) {
        if (wantsImmediateDeferredCardPhoto(img)) {
            eager.push(img);
            continue;
        }
        if (driveBudget > 0 && img.classList?.contains?.('app-drive-card-thumbnail') && isElementNearViewport(img)) {
            eager.push(img);
            driveBudget -= 1;
            continue;
        }
        lazy.push(img);
    }
    return { eager, lazy };
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

function resolveDeferredPhotoSources(img) {
    const source = String(img.dataset.src || '').trim();
    if (!source) return {};
    const src = normalizeStoragePublicUrl(source);
    const detailPreview = img.dataset.localPreviewUrl;
    const original = img.dataset.photoUrl || globalThis.AgDataStorageGuard?.original(source) || source;
    const slot = /^https?:\/\//i.test(original) || detailPreview ? findPendingPhotoPreviewByUrl(original) : null;
    const local = detailPreview || slot?.localPreviewUrl;
    if (/^(?:blob:|data:image\/)/i.test(local || '')) {
        if (slot?.publicPreviewReady && slot.publicUrl) return {src:normalizeStoragePublicUrl(slot.publicUrl),fallbackSrc:local};
        return {src:local};
    }
    return {src,fallbackSrc:getDeferredCardPhotoFallbackSrc(src)};
}

export function getAvCardPhotoHydrationScope(root = document) {
    if (root?.querySelectorAll && root !== document) return root;
    return document.getElementById('av-content') || document;
}

export function isAvCardPhotoHydrationRelevant(root = document) {
    const scope = getAvCardPhotoHydrationScope(root);
    if (scope.isConnected === false) return false;
    const viewId = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
    const owner = scope.closest?.('[id^="view-"]');
    if (viewId && owner && owner.id !== `view-${viewId}`) return false;
    if (scope.id === 'av-content' && viewId === 'av') return true;
    return scope.matches?.('.app-av-catalog-card') || !!scope.querySelector?.('.app-av-catalog-card');
}

export function handleDeferredCardPhotoLoadFailure(img = null) {
    if (!img) return;
    // An img error has no HTTP status: back off, never permanently blacklist a transient outage.
    window.AgDataStorageGuard?.noteFailure(img.src || img.dataset?.src, 0);
    const fallbackSrc = String(img.dataset && img.dataset.photoFallbackSrc || getDeferredCardPhotoFallbackSrc(img.src || (img.dataset && img.dataset.src) || '')).trim();
    if (fallbackSrc && !window.AgDataStorageGuard?.blocked(fallbackSrc) && img.dataset.photoFallbackAttempted !== '1' && String(img.src || '').trim() !== fallbackSrc) {
        img.dataset.photoFallbackAttempted = '1';
        img.hidden = false;
        img.src = fallbackSrc;
        return;
    }
    img.classList.add('app-photo-thumbnail-failed');
    img.alt = '';
    img.hidden = true;
    invalidateCardPhotoMatchOnLoadFailure(img);
    const host = img.parentElement;
    if (!host || host.querySelector('.app-photo-unavailable')) return;
    const placeholder = document.createElement('span');
    placeholder.className = 'app-photo-unavailable';
    placeholder.textContent = 'NO PHOTO';
    host.appendChild(placeholder);
}

export function hydrateDeferredCardPhoto(img = null, expectedSrc = '') {
    if (!img || img.dataset.photoHydrated === '1') return;
    if (img.isConnected === false) {
        delete img.dataset.photoObserved;
        delete img.dataset.photoObservedSrc;
        return;
    }
    if (expectedSrc && img.dataset.src !== expectedSrc) return;
    const {src, fallbackSrc} = resolveDeferredPhotoSources(img);
    if (!src) return;
    delete img.dataset.photoObserved;
    delete img.dataset.photoObservedSrc;
    if (fallbackSrc) img.dataset.photoFallbackSrc = fallbackSrc;
    if (img.dataset.photoRecoveryBound !== '1') {
        img.dataset.photoRecoveryBound = '1';
        img.addEventListener('load', () => {
            delete img.dataset.photoLoadFailed;
            img.classList.remove('app-photo-thumbnail-failed');
            img.hidden = false;
            const placeholder = img.parentElement && img.parentElement.querySelector('.app-photo-unavailable');
            if (placeholder) placeholder.remove();
        });
    }
    img.dataset.photoHydrated = '1';
    img.dataset.photoHydratedSrc = src;
    img.onerror = () => {
        if (!img || !img.dataset) return;
        if (img.dataset.photoHydratedSrc !== src) return;
        img.dataset.photoLoadFailed = '1';
        handleDeferredCardPhotoLoadFailure(img);
    };
    if (window.AgDataStorageGuard?.blocked(src)) handleDeferredCardPhotoLoadFailure(img);
    else img.src = src;
}
