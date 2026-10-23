/* global canUseInvBunchNotes, nativeAuthProfile, getSupabaseReadIdentityScope, getCurrentVisibleViewId, renderRequestCategoryToolbar, updateFooterRequestBadge, SUPABASE_URL, postAppFunctionJson, APP_API_FUNCTION_URL, activeReqTab, getMainAreaScrollTarget, setMainAreaScrollTop, showPrimaryViewWithScrollPolicy, schedulePrimaryViewChromeRefresh, clearPendingDetailHydration, shouldResetIosPhoneMainScrollForView */
/* global activeItem: writable, activeDetailSourceView: writable, lastView: writable */
/* Que integration; authenticated reads and durable drafts live in the typed client. */
(function () {
    'use strict';
    let modulePromise, client, clientScope = '', mounted, host, detail, generation = 0;
    let counts = { active: 0, review: 0, canReview: false }, lastWarm = 0;
    const isTab = tab => tab === 'bunch-notes' || tab === 'bunch-count-review';
    const scope = () => canUseInvBunchNotes() ? `${nativeAuthProfile.id}:${getSupabaseReadIdentityScope()}` : '';
    function destroy() { closeDetail(); generation++; mounted?.destroy(); mounted = null; host = null; }
    function closeDetail() {
        if (!detail) return false;
        const previous = detail;
        detail = null;
        previous.root.classList.remove('bunch-work-detail-mode');
        if (!previous.hadRequestMode) previous.root.classList.remove('detail-request-mode');
        previous.panels.forEach(({ panel, display, priority }) => {
            if (display) panel.style.setProperty('display', display, priority);
            else panel.style.removeProperty('display');
        });
        previous.host.remove();
        previous.onClose();
        activeDetailSourceView = '';
        if (getCurrentVisibleViewId() === 'detail') {
            showPrimaryViewWithScrollPolicy('request', { scrollPolicy: 'preserve' });
            renderRequestCategoryToolbar();
            setMainAreaScrollTop(shouldResetIosPhoneMainScrollForView('request') ? 0 : previous.scrollTop);
            schedulePrimaryViewChromeRefresh('request', { delay: 0, passive: true });
            const focusTarget = previous.focus?.isConnected ? previous.focus : host?.querySelector('select, [role="button"]');
            focusTarget?.focus({ preventScroll: true });
        }
        return true;
    }
    function openDetail({ title, onClose }) {
        closeDetail();
        const root = document.getElementById('view-detail');
        if (!root) throw new Error('The opened-card view is unavailable. Reload and retry.');
        const detailHost = document.createElement('div');
        detailHost.id = 'bunch-queue-detail-host';
        detailHost.setAttribute('aria-label', title);
        const panels = Array.from(root.children, panel => ({ panel, display: panel.style.getPropertyValue('display'), priority: panel.style.getPropertyPriority('display') }));
        panels.forEach(({ panel }) => panel.style.setProperty('display', 'none', 'important'));
        detail = { root, host: detailHost, panels, onClose, scrollTop: getMainAreaScrollTarget()?.scrollTop || 0,
            focus: document.activeElement, hadRequestMode: root.classList.contains('detail-request-mode') };
        clearPendingDetailHydration();
        activeItem = null;
        activeDetailSourceView = 'bunch-notes';
        lastView = 'request';
        root.classList.add('bunch-work-detail-mode', 'detail-request-mode');
        root.appendChild(detailHost);
        showPrimaryViewWithScrollPolicy('detail', { scrollPolicy: 'reset', scrollTop: 0 });
        schedulePrimaryViewChromeRefresh('detail', { delay: 0, passive: true });
        return detailHost;
    }
    function reset() { destroy(); client?.dispose(); client = null; clientScope = ''; lastWarm = 0; counts = { active: 0, review: 0, canReview: false }; }
    function changed(next) {
        if (JSON.stringify(counts) === JSON.stringify(next)) return;
        counts = next;
        if (getCurrentVisibleViewId() === 'request') renderRequestCategoryToolbar();
        updateFooterRequestBadge();
    }
    async function ensure() {
        const nextScope = scope();
        if (!nextScope) { reset(); throw new Error('Sign in to view assigned Bunch Notes.'); }
        if (clientScope !== nextScope) { if (clientScope) reset(); clientScope = nextScope; }
        if (!modulePromise) {
            const moduleUrl = new URL('./bunch-queue.js', document.currentScript?.src || new URL('./assets/bunch-queue-shell.js', document.baseURI));
            moduleUrl.search = '?v=' + encodeURIComponent(String(window.__APP_SHELL_VERSION__ || ''));
            modulePromise = import(moduleUrl.href).catch(error => { modulePromise = null; throw error; });
        }
        const module = await modulePromise;
        if (scope() !== nextScope || clientScope !== nextScope) throw new Error('The signed-in session changed.');
        if (!client) {
            client = module.createBunchQueueClient({ scopeKey: JSON.stringify([SUPABASE_URL, nativeAuthProfile.id]), cacheScopeKey: nextScope, storage: localStorage,
                transport: (payload, signal) => postAppFunctionJson(APP_API_FUNCTION_URL, payload, { timeoutMs: 45000, label: 'Bunch Notes work', signal, idempotencyKey: payload.commandId || undefined }),
                onCounts: changed });
            const page = client.getSnapshot().page;
            if (page) changed({ active: page.active_count, review: page.review_count, canReview: page.can_review || page.review_count > 0 });
        }
        return { module, client };
    }
    async function warm(force = false) {
        if (!canUseInvBunchNotes() || (!force && Date.now() - lastWarm < 60000)) return;
        lastWarm = Date.now();
        try { const ready = await ensure(); if (!mounted) await ready.client.load('mine', 0); } catch { /* Visible queue supplies retry feedback. */ }
    }
    async function render(container, crumb, reviewMode) {
        if (!container) return;
        if (crumb) crumb.textContent = reviewMode ? 'Count Review' : 'Bunch Notes';
        if (mounted && host?.parentElement === container) { mounted.update(reviewMode); return; }
        if (host?.parentElement === container) return;
        destroy();
        host = document.createElement('div'); host.id = 'bunch-queue-host';
        host.textContent = 'No assigned Bunch Notes loaded yet.'; container.replaceChildren(host);
        const target = host, token = generation;
        try {
            const ready = await ensure();
            if (host !== target || !target.isConnected || getCurrentVisibleViewId() !== 'request' || !isTab(activeReqTab)) return;
            // ensure() may reset an expired account before loading its own scope.
            if (token !== generation && host !== target) return;
            mounted = ready.module.mountBunchQueue(target, ready.client, activeReqTab === 'bunch-count-review');
        } catch (error) {
            if (!target.isConnected) return;
            target.textContent = error instanceof Error ? error.message : 'Unable to load assigned work.';
            const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
            retry.onclick = () => { destroy(); void render(container, crumb, reviewMode); }; target.append(retry);
        }
    }
    window.BunchQueueShell = {
        isTab, reset, destroy, warm, render, openDetail, closeDetail, isDetailOpen: () => !!detail, counts: () => counts,
        scope: () => `${scope()}:${activeReqTab}:${client?.getSnapshot().filter || 'mine'}:${client?.getSnapshot().offset || 0}`,
        stage: async ctx => (await ensure()).client.stage(activeReqTab === 'bunch-count-review', ctx.signal),
        commit: value => client?.commit(value)
    };
    window.addEventListener('gnc:bunch-published', () => { void warm(true); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && detail) { event.preventDefault(); event.stopImmediatePropagation(); closeDetail(); }
    }, true);
})();
