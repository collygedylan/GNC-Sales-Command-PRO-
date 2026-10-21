(function installRuntimeWatchdogPanel(root, createController) {
    'use strict';
    const api = Object.freeze({ createController });
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgMetricRuntimeWatchdogPanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createController(deps) {
    'use strict';
    let openEvents = [];
    let fixBrief = '';
    let badgeRefresh = null;
    let badgeRefreshOwner = '';
    let badgeCheckedAt = 0;
    let eventsRefresh = null;
    let eventsRefreshOwner = '';
    let panelGeneration = 0;
    let cachedOwner = '';

    const ownerKey = () => JSON.stringify([
        String(deps.getUsername?.() || '').trim().toLowerCase(),
        String(deps.getProfileId?.() || ''),
        Number(deps.getAuthEpoch?.() || 0),
        String(deps.getCacheScope?.() || ''),
    ]);
    function updateBadge(count = 0) {
        const badge = deps.document.getElementById('runtime-watchdog-header-badge');
        if (!badge) return;
        const visible = String(deps.getUsername?.() || '').trim().toLowerCase() === 'dylan_collyge' && count > 0;
        badge.hidden = !visible;
        if (badge.style) badge.style.display = visible ? '' : 'none';
        badge.classList.toggle('hidden', !visible);
        badge.textContent = visible ? String(count) : '';
        badge.title = visible ? `${count} open runtime incident${count === 1 ? '' : 's'}` : '';
    }
    function ensureOwner(owner = ownerKey()) {
        if (owner === cachedOwner) return owner;
        updateBadge(0);
        cachedOwner = owner;
        openEvents = [];
        fixBrief = '';
        badgeCheckedAt = 0;
        badgeRefresh = null;
        badgeRefreshOwner = '';
        eventsRefresh = null;
        eventsRefreshOwner = '';
        panelGeneration++;
        return owner;
    }
    const createViewScope = () => deps.lifecycle?.createScope?.({ lifetime: 'view' })
        || { isCurrent: () => true, dispose() {} };
    const isPanelCurrent = (scope, owner, host) => scope.isCurrent() && owner === ownerKey()
        && deps.getVisibleView?.() === 'managers' && deps.getActiveTab?.() === deps.panelViewId
        && deps.document.getElementById('runtime-watchdog-events') === host;

    async function loadEvents(owner = ownerKey()) {
        ensureOwner();
        if (owner !== cachedOwner) return [];
        if (eventsRefresh && eventsRefreshOwner === owner) return eventsRefresh;
        const task = deps.postJson(deps.apiUrl, { action: 'watchdog_list_events' }, { timeoutMs: 5000, label: 'Runtime Watchdog' })
            .then(result => {
                if (owner !== ownerKey()) return [];
                fixBrief = String(result?.fixBrief || '');
                return Array.isArray(result?.data) ? result.data : [];
            })
            .finally(() => {
                if (eventsRefresh === task) { eventsRefresh = null; eventsRefreshOwner = ''; }
            });
        eventsRefresh = task;
        eventsRefreshOwner = owner;
        return task;
    }

    async function resolveEvents(ids) {
        const result = await deps.postJson(deps.apiUrl, { action: 'watchdog_resolve_events', ids }, { timeoutMs: 5000, label: 'Resolve Runtime Watchdog events' });
        if (!result?.ok) throw new Error('Could not resolve watchdog events.');
        return result;
    }

    function renderPanel() {
        return `<section class="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm" aria-label="Watchdog Monitor">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-black text-slate-900">WATCHDOG MONITOR</h2><p class="text-xs text-slate-500">Open runtime anomalies grouped by role, view and owning skill.</p></div>
            <button type="button" class="rounded-xl bg-[#007a4d] px-4 py-3 text-xs font-black text-white" onclick="return copyRuntimeWatchdogFixBrief()">COPY AI FIX BRIEF</button></div>
            <div id="runtime-watchdog-events" class="mt-4 space-y-3" aria-live="polite">Loading open incidents…</div></section>`;
    }

    async function refreshBadge(force = false) {
        const owner = ensureOwner();
        const badge = deps.document.getElementById('runtime-watchdog-header-badge');
        if (!badge || String(deps.getUsername?.() || '').trim().toLowerCase() !== 'dylan_collyge') { updateBadge(0); return; }
        if (!force && Date.now() - badgeCheckedAt < 30000) return;
        if (badgeRefresh && badgeRefreshOwner === owner) return badgeRefresh;
        const scope = createViewScope();
        const task = loadEvents(owner).then(rows => {
            if (!scope.isCurrent() || owner !== ownerKey() || deps.document.getElementById('runtime-watchdog-header-badge') !== badge) return null;
            badgeCheckedAt = Date.now();
            const count = rows.length;
            updateBadge(count);
            return count;
        }).catch(() => null).finally(() => {
            scope.dispose();
            if (badgeRefresh === task) { badgeRefresh = null; badgeRefreshOwner = ''; }
        });
        badgeRefresh = task;
        badgeRefreshOwner = owner;
        return task;
    }

    async function refreshPanel() {
        const owner = ensureOwner();
        const host = deps.document.getElementById('runtime-watchdog-events');
        if (!host) { panelGeneration++; return; }
        const generation = ++panelGeneration;
        const scope = createViewScope();
        try {
            const rows = await loadEvents(owner);
            if (generation !== panelGeneration || !isPanelCurrent(scope, owner, host)) return;
            openEvents = rows;
            updateBadge(openEvents.length);
            if (String(deps.getUsername?.() || '').trim().toLowerCase() === 'dylan_collyge') {
                badgeCheckedAt = Date.now();
            }
            if (!openEvents.length) { host.innerHTML = '<p class="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">No open runtime incidents.</p>'; return; }
            const groups = new Map();
            for (const row of openEvents) { const key = `${row.normalized_role || 'unknown'} · ${row.view_id || 'unknown'} · ${row.owning_skill || 'unmapped'}`; groups.set(key, [...(groups.get(key) || []), row]); }
            host.innerHTML = [...groups].map(([label, groupRows]) => `<section class="rounded-xl border border-slate-200 p-3"><h3 class="text-xs font-black uppercase text-slate-700">${deps.escape(label)} <span class="text-amber-700">(${groupRows.length})</span></h3><ul class="mt-2 space-y-2">${groupRows.map(row => `<li class="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"><span><b>${deps.escape(row.severity)} · ${deps.escape(row.username)}</b> · ${deps.escape(row.event_type)} · ${Number(row.duration_ms) || 0}ms<br>${deps.escape(row.error_message || '')}<br><span class="text-slate-500">${deps.escape(row.cluster_id)} / ${deps.escape(row.owning_skill)} / ${deps.escape((row.suspected_functions || []).join(', '))}</span></span><button class="rounded-lg border px-2 py-1 font-bold" data-watchdog-resolve="${Number(row.id)}">Resolve</button></li>`).join('')}</ul></section>`).join('');
            host.querySelectorAll('[data-watchdog-resolve]').forEach(button => button.addEventListener('click', async () => {
                const actionScope = createViewScope();
                button.disabled = true;
                try {
                    await resolveEvents([Number(button.dataset.watchdogResolve)]);
                    if (isPanelCurrent(actionScope, owner, host)) await refreshPanel();
                } catch (_) {
                    if (isPanelCurrent(actionScope, owner, host)) { button.disabled = false; button.textContent = 'Retry'; }
                } finally { actionScope.dispose(); }
            }));
        } catch (_) {
            if (generation === panelGeneration && isPanelCurrent(scope, owner, host)) host.innerHTML = '<p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Watchdog events could not refresh. Other Manager views remain available.</p>';
        } finally { scope.dispose(); }
    }

    async function copyFixBrief() {
        const owner = ensureOwner();
        const scope = createViewScope();
        try {
            if (!fixBrief) await loadEvents(owner);
            if (!scope.isCurrent() || owner !== ownerKey()) return false;
            const brief = fixBrief;
            if (!brief) return false;
            try { await deps.clipboard.writeText(brief); deps.showToast('Copied', 'AI Fix Brief copied to clipboard.'); }
            catch (_) { deps.prompt('Copy the AI Fix Brief', brief); }
            return false;
        } finally { scope.dispose(); }
    }

    return Object.freeze({ renderPanel, refreshBadge, refreshPanel, copyFixBrief });
});
