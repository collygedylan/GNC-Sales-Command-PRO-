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
    let activePanelTab = 'open';
    const RESOLVED_SKILL_FOLDERS = Object.freeze([
        ['agdata-sync-and-supabase-architect', 'Sync & Supabase AI'],
        ['agdata-queue-and-reclass-specialist', 'Queue & Reclass AI'],
        ['agdata-drive-and-av-specialist', 'Drive & AV AI'],
        ['agdata-field-ops-and-qc', 'Field Ops & QC AI'],
        ['agdata-app-shell-and-navigation', 'App Shell & Navigation AI'],
        ['agdata-docks-and-orders-specialist', 'Docks & Orders AI'],
        ['agdata-aura-assistant', 'AURA Assistant AI'],
        ['agdata-runtime-watchdog', 'Runtime Watchdog AI'],
    ]);

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
        activePanelTab = 'open';
        panelGeneration++;
        return owner;
    }
    const createViewScope = () => deps.lifecycle?.createScope?.({ lifetime: 'view' })
        || { isCurrent: () => true, dispose() {} };
    const isPanelCurrent = (scope, owner, host) => scope.isCurrent() && owner === ownerKey()
        && deps.getVisibleView?.() === 'managers' && deps.getActiveTab?.() === deps.panelViewId
        && deps.document.getElementById('runtime-watchdog-events') === host;

    async function loadEvents(owner = ownerKey(), includeResolved = true) {
        ensureOwner();
        if (owner !== cachedOwner) return [];
        const readOwner = owner + ':' + includeResolved;
        if (eventsRefresh && eventsRefreshOwner === readOwner) return eventsRefresh;
        const task = (async () => {
            const rows = [], briefs = [];
            let offset = 0;
            do {
                const result = await deps.postJson(deps.apiUrl, { action:'watchdog_list_events', ...(includeResolved ? { includeResolved:true, offset } : {}) }, { timeoutMs:5000, label:'Runtime Watchdog' });
                if (owner !== ownerKey()) return [];
                const page = Array.isArray(result?.data) ? result.data : [];
                rows.push(...page);
                if (result?.fixBrief) briefs.push(String(result.fixBrief));
                if (!includeResolved || !result?.hasMore || !page.length) break;
                offset += page.length;
            } while (owner === ownerKey());
            fixBrief = briefs.join('\n\n');
            return rows;
        })().finally(() => {
            if (eventsRefresh === task) { eventsRefresh = null; eventsRefreshOwner = ''; }
        });
        eventsRefresh = task;
        eventsRefreshOwner = readOwner;
        return task;
    }

    async function resolveEvents(ids) {
        const result = await deps.postJson(deps.apiUrl, { action: 'watchdog_resolve_events', ids }, { timeoutMs: 5000, label: 'Resolve Runtime Watchdog events' });
        if (!result?.ok) throw new Error('Could not resolve watchdog events.');
        return result;
    }

    function renderPanel() {
        return `<section class="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm" aria-label="Watchdog Monitor">
            <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="font-black text-slate-900">WATCHDOG MONITOR</h2><p class="text-xs text-slate-500">Open incidents and reviewed resolved fixes remain separated.</p></div>
            <button type="button" class="rounded-xl bg-[#007a4d] px-4 py-3 text-xs font-black text-white" onclick="return copyRuntimeWatchdogFixBrief()">COPY AI FIX BRIEF</button></div>
            <div id="runtime-watchdog-events" class="mt-4 space-y-3" aria-live="polite">Loading incidents…</div></section>`;
    }

    function renderIncidentCard(row, resolved = false) {
        return `<li class="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"><span><b>${deps.escape(row.severity)} · ${deps.escape(row.username)}</b> · ${deps.escape(row.event_type)} · ${Number(row.duration_ms) || 0}ms<br>${deps.escape(row.error_message || '')}<br><span class="text-slate-500">${deps.escape(row.cluster_id)} / ${deps.escape(row.owning_skill)} / ${deps.escape((row.suspected_functions || []).join(', '))}</span></span>${resolved ? '<span class="font-bold text-emerald-700">Resolved</span>' : `<button class="rounded-lg border px-2 py-1 font-bold" data-watchdog-resolve="${Number(row.id)}">Resolve</button>`}</li>`;
    }

    function syncPanelTab(host) {
        host.querySelectorAll('[data-watchdog-tab]').forEach(button => {
            const selected = button.dataset.watchdogTab === activePanelTab;
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.classList.toggle('bg-[#062115]', selected);
            button.classList.toggle('text-white', selected);
        });
        host.querySelectorAll('[data-watchdog-view]').forEach(view => view.classList.toggle('hidden', view.dataset.watchdogView !== activePanelTab));
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
            const count = rows.filter(row => row.status === 'open').length;
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
            const rows = await loadEvents(owner, true);
            if (generation !== panelGeneration || !isPanelCurrent(scope, owner, host)) return;
            openEvents = rows.filter(row => row.status === 'open');
            const resolvedEvents = rows.filter(row => row.status === 'resolved');
            updateBadge(openEvents.length);
            if (String(deps.getUsername?.() || '').trim().toLowerCase() === 'dylan_collyge') {
                badgeCheckedAt = Date.now();
            }
            const groups = new Map();
            for (const row of openEvents) { const key = `${row.normalized_role || 'unknown'} · ${row.view_id || 'unknown'} · ${row.owning_skill || 'unmapped'}`; groups.set(key, [...(groups.get(key) || []), row]); }
            const parityRows = openEvents.filter(row => row.event_type === 'DATA_PARITY_MISMATCH');
            const paritySummary = '<div class="rounded-xl border border-emerald-200 p-3 text-sm" aria-label="Role parity summary">Role parity reports: ' + parityRows.filter(row => row.status !== 'resolved').length + ' active / ' + parityRows.filter(row => row.status === 'resolved').length + ' resolved</div>';
            host.innerHTML = paritySummary + [...groups].map(([label, groupRows]) => `<section class="rounded-xl border border-slate-200 p-3"><h3 class="text-xs font-black uppercase text-slate-700">${deps.escape(label)} <span class="text-amber-700">(${groupRows.length})</span></h3><ul class="mt-2 space-y-2">${groupRows.map(row => `<li class="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"><span><b>${deps.escape(row.severity)} · ${deps.escape(row.username)}</b> · ${deps.escape(row.event_type)} · ${Number(row.duration_ms) || 0}ms<br>${deps.escape(row.error_message || '')}<br><span class="text-slate-500">${deps.escape(row.cluster_id)} / ${deps.escape(row.owning_skill)} / ${deps.escape((row.suspected_functions || []).join(', '))}</span></span>${row.status === 'resolved' ? '<span class="font-bold text-emerald-700">Resolved</span>' : `<button class="rounded-lg border px-2 py-1 font-bold" data-watchdog-resolve="${Number(row.id)}">Resolve</button>`}</li>`).join('')}</ul></section>`).join('');
            const openHtml = openEvents.length
                ? host.innerHTML
                : '<p class="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">No open runtime incidents.</p>';
            const resolvedHtml = RESOLVED_SKILL_FOLDERS.map(([skill, label]) => {
                const folderRows = resolvedEvents.filter(row => String(row.owning_skill || '').trim() === skill);
                return `<details class="rounded-xl border border-slate-200 bg-white p-3"><summary class="cursor-pointer text-xs font-black uppercase text-slate-700">${deps.escape(label)} <span class="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">${folderRows.length}</span></summary>${folderRows.length ? `<ul class="mt-3 space-y-2">${folderRows.map(row => renderIncidentCard(row, true)).join('')}</ul>` : '<p class="mt-3 text-xs text-slate-500">No resolved fixes in this folder.</p>'}</details>`;
            }).join('');
            host.innerHTML = `<div class="flex gap-2" role="tablist" aria-label="Watchdog incident status"><button type="button" class="rounded-xl border px-3 py-2 text-xs font-black" data-watchdog-tab="open" role="tab">OPEN ISSUES <span class="ml-1">${openEvents.length}</span></button><button type="button" class="rounded-xl border px-3 py-2 text-xs font-black" data-watchdog-tab="resolved" role="tab">Resolved Fixes <span class="ml-1">${resolvedEvents.length}</span></button></div><div class="space-y-3" data-watchdog-view="open">${openHtml}</div><div class="space-y-3" data-watchdog-view="resolved">${resolvedHtml}</div>`;
            host.querySelectorAll('[data-watchdog-tab]').forEach(button => button.addEventListener('click', () => {
                activePanelTab = button.dataset.watchdogTab === 'resolved' ? 'resolved' : 'open';
                syncPanelTab(host);
            }));
            syncPanelTab(host);
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
