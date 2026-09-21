(function (root) {
    'use strict';
    const DEFAULT_SHORTCUTS = Object.freeze(['drive', 'tasks', 'docks', 'request', 'bloom']);
    const FIXED_VIEWS = new Set(['menu', 'home', 'communication']);
    const ICONS = { drive: 'ph-car', tasks: 'ph-clipboard-text', docks: 'ph-truck', request: 'ph-list-checks', bloom: 'ph-handbag', sales: 'ph-handshake', 'sales-office': 'ph-desktop', 'request-history': 'ph-clock-counter-clockwise', 'sales-credit': 'ph-receipt', 'credit-request': 'ph-check-square', 'sales-inventory': 'ph-storefront', production: 'ph-plant', managers: 'ph-users-three', reports: 'ph-chart-bar', av: 'ph-notebook', 'hl-order': 'ph-truck', 'bunch-note': 'ph-notepad' };
    const FOOTER_IDS = { menu: 'footer-menu-btn', home: 'footer-home-btn', communication: 'footer-communication-btn', drive: 'footer-drive-btn', tasks: 'footer-tasks-btn', docks: 'footer-docks-btn', request: 'footer-request-btn', bloom: 'footer-cart-btn' };
    const LABELS = { drive: 'Drive', tasks: 'Tasks', docks: 'Docks', request: 'Queue', bloom: 'Bloom', home: 'Home', menu: 'Menu', communication: 'Comm' };
    let hooks = {}, state = null, inflight = null, timer = null, generation = 0, bound = false;
    let footerObserver = null, lastFooter = null;
    const text = value => String(value == null ? '' : value);
    const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const username = () => text(typeof hooks.username === 'function' ? hooks.username() : hooks.username).trim().toLowerCase();
    const commandId = () => root.crypto.randomUUID();
    function normalizedShortcuts(values, permitted = () => true) {
        const result = [];
        (Array.isArray(values) ? values : DEFAULT_SHORTCUTS).forEach(value => {
            const key = text(value).trim();
            if (key && !FIXED_VIEWS.has(key) && !result.includes(key) && permitted(key) && result.length < 5) result.push(key);
        });
        return result;
    }
    function currentState() { return state && state.username.toLowerCase() === username() ? state : null; }
    function entry(view) { return (currentState()?.views || []).find(item => item.view === view); }
    function allowed(view, baseline) {
        const value = entry(view);
        if (!value) return !!baseline;
        if (view === 'reports' || ['request-history', 'sales-credit', 'credit-request'].includes(view)) return value.allowed === true;
        // Leave the deployed permission map intact until a Manager explicitly changes a view.
        return typeof value.override === 'boolean' ? value.allowed === true : !!baseline;
    }
    function permitted(view) {
        const value = entry(view);
        if (value && (!value.selectable || value.allowed !== true)) return false;
        return typeof hooks.canAccess === 'function' ? hooks.canAccess(view) === true : !!value?.allowed;
    }
    function shortcuts() { return normalizedShortcuts(currentState()?.shortcuts, permitted); }
    function adopt(value) {
        if (!value || !Array.isArray(value.views) || text(value.username).toLowerCase() !== username()) return;
        const changed = JSON.stringify(state) !== JSON.stringify(value);
        state = value;
        if (changed) {
            if (typeof hooks.onChange === 'function') hooks.onChange(value);
            if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('gnc-navigation-change', { detail: value }));
        }
    }
    async function call(operation, payload = {}, mutation = null) {
        if (typeof hooks.call !== 'function') throw new Error('Navigation settings are unavailable. Sign in and retry.');
        const result = await hooks.call({ action: 'navigation_preferences', operation, payload, ...(mutation || {}) });
        if (result?.ok === false) throw Object.assign(new Error(result.error || result.message || 'Unable to save settings.'), { code: result.code });
        return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
    }
    async function refresh() {
        if (!username()) return null;
        if (inflight) return inflight;
        const token = generation, user = username();
        inflight = call('get').then(value => { if (token === generation && user === username()) adopt(value); return value; })
            .finally(() => { if (token === generation) inflight = null; });
        return inflight;
    }
    function reset() {
        generation++; state = null; inflight = null;
        if (timer) root.clearInterval(timer);
        timer = null;
    }
    function configure(options = {}) {
        const oldUser = username(); hooks = { ...hooks, ...options };
        if (oldUser !== username()) reset();
        if (!timer && root.document && root.setInterval) timer = root.setInterval(() => {
            if (!root.document.hidden && username()) refresh().catch(() => {});
        }, 30000);
        if (!bound && root.document) {
            bound = true;
            root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden && username()) refresh().catch(() => {}); });
            root.addEventListener('online', () => { if (username()) refresh().catch(() => {}); });
        }
        return api;
    }
    function message(error) {
        const code = text(error?.message || error);
        if (/REVISION_CONFLICT/.test(code)) return 'These settings changed on another device. Your choices are retained. Reload the latest settings before saving again.';
        if (/MANAGER_REQUIRED|PROTECTED_CAPABILITY|SHORTCUT_NOT_ALLOWED/.test(code)) return 'Your permissions changed or this capability is protected. Refresh access and review your choices.';
        return 'Could not save. Your entries are retained; retry when connected.';
    }
    function status(container, value, bad = false) {
        const el = container.querySelector('[data-nav-status]');
        if (el) { el.textContent = value; el.setAttribute('role', bad ? 'alert' : 'status'); }
    }
    function markBusy(container, busy) {
        container.querySelectorAll('button,input,select,textarea').forEach(node => { node.disabled = busy || node.dataset.protected === 'true'; });
        container.setAttribute('aria-busy', String(busy));
    }
    async function renderShortcutEditor(container) {
        if (!container) return;
        container.classList.add('gnc-navigation-editor');
        container.innerHTML = '<p role="status">Loading shortcuts…</p>';
        try {
            await refresh();
            const snapshot = currentState(); if (!snapshot) throw new Error('NAVIGATION_AUTH_REQUIRED');
            const available = snapshot.views.filter(item => item.selectable && permitted(item.view));
            const initial = normalizedShortcuts(snapshot.shortcuts, key => available.some(item => item.view === key));
            container.innerHTML = `<h2>Footer shortcuts</h2><p>Menu, Home, and Communication stay fixed. Choose up to five shortcuts in the order you want.</p><div class="gnc-navigation-slots">${Array.from({ length: 5 }, (_, i) => `<label>Shortcut ${i + 1}<select data-nav-slot="${i}"><option value="">No shortcut</option>${available.map(item => `<option value="${esc(item.view)}"${item.view === initial[i] ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>`).join('')}</div><p data-nav-status role="status"></p><div class="gnc-navigation-actions"><button type="button" data-nav-defaults>Use defaults</button><button type="button" data-nav-save>Save shortcuts</button><button type="button" data-nav-reload>Reload saved settings</button></div>`;
            let pending = null;
            container.onchange = () => { pending = null; };
            container.querySelector('[data-nav-defaults]').onclick = () => {
                const defaults = normalizedShortcuts(null, key => available.some(item => item.view === key));
                container.querySelectorAll('[data-nav-slot]').forEach((node, i) => { node.value = defaults[i] || ''; }); pending = null;
            };
            container.querySelector('[data-nav-reload]').onclick = () => renderShortcutEditor(container);
            container.querySelector('[data-nav-save]').onclick = async () => {
                if (container.getAttribute('aria-busy') === 'true') return;
                const raw = Array.from(container.querySelectorAll('[data-nav-slot]')).map(node => node.value).filter(Boolean);
                if (new Set(raw).size !== raw.length) { status(container, 'Choose each shortcut once.', true); return; }
                pending ||= { commandId: commandId(), expectedRevision: snapshot.footerRevision };
                markBusy(container, true);
                try {
                    const saved = await call('save_shortcuts', { shortcuts: raw }, pending); adopt(saved);
                    snapshot.footerRevision = saved.footerRevision; pending = null; status(container, 'Shortcuts saved on your account.');
                } catch (error) { status(container, message(error), true); }
                finally { markBusy(container, false); }
            };
        } catch { container.innerHTML = '<p role="alert">Unable to load shortcuts.</p><button type="button" data-nav-retry>Retry</button>'; container.querySelector('button').onclick = () => renderShortcutEditor(container); }
    }
    function lockedView(row, user) {
        return ['home', 'access-control'].includes(row.view)
            || (['bunch-note', 'hl-order', 'disease-pest', 'pest-management'].includes(row.view) && user !== 'dylan_collyge')
            || (row.view === 'managers' && user === 'brandt_emerson');
    }
    async function renderAccessEditor(container) {
        if (!container) return;
        container.classList.add('gnc-navigation-editor');
        container.innerHTML = '<p role="status">Loading user access…</p>';
        try {
            await refresh();
            if (!currentState()?.manager) throw new Error('NAVIGATION_MANAGER_REQUIRED');
            const users = await call('users');
            container.innerHTML = `<h2>User Access</h2><p>Choose a user, then change module and view access. Approval powers and record ownership remain protected.</p><label>User<select data-nav-user><option value="">Choose a user</option>${users.map(user => `<option value="${esc(user.id)}">${esc(user.displayName || user.username)} — ${esc(user.role)}${user.active ? '' : ' (inactive)'}</option>`).join('')}</select></label><div data-nav-access-detail></div>`;
            let requestNumber = 0;
            container.querySelector('[data-nav-user]').onchange = async function () {
                const detail = container.querySelector('[data-nav-access-detail]'), target = this.value, request = ++requestNumber;
                detail.innerHTML = ''; if (!target) return;
                detail.innerHTML = '<p role="status">Loading permissions…</p>';
                try {
                    const snapshot = await call('user_access', { profileId: target });
                    if (request !== requestNumber) return;
                    detail.innerHTML = `<div class="gnc-navigation-access-list">${snapshot.views.map(row => `<label class="gnc-navigation-access-row"><span><strong>${esc(row.label)}</strong><small>${row.allowed ? 'Currently allowed' : 'Currently unavailable'}${row.protectedReason ? ` · ${esc(row.protectedReason)}` : ''}</small></span><select data-nav-view="${esc(row.view)}"${lockedView(row, snapshot.username) ? ' disabled data-protected="true"' : ''}><option value=""${row.override == null ? ' selected' : ''}>Existing default</option><option value="true"${row.override === true ? ' selected' : ''}>Allow view</option><option value="false"${row.override === false ? ' selected' : ''}>Hide view</option></select></label>`).join('')}</div><label>Reason for change<textarea data-nav-reason maxlength="500" rows="2"></textarea></label><p data-nav-status role="status"></p><div class="gnc-navigation-actions"><button type="button" data-nav-save>Save user access</button><button type="button" data-nav-reload>Reload saved access</button></div>`;
                    let pending = null;
                    detail.oninput = () => { pending = null; };
                    detail.onchange = () => { pending = null; };
                    detail.querySelector('[data-nav-reload]').onclick = () => container.querySelector('[data-nav-user]').onchange();
                    detail.querySelector('[data-nav-save]').onclick = async () => {
                        if (detail.getAttribute('aria-busy') === 'true') return;
                        const reason = detail.querySelector('[data-nav-reason]').value.trim();
                        const changes = Array.from(detail.querySelectorAll('[data-nav-view]')).filter(node => !node.disabled).map(node => ({ view: node.dataset.navView, allowed: node.value === '' ? null : node.value === 'true' }))
                            .filter(change => snapshot.views.find(row => row.view === change.view).override !== change.allowed);
                        if (!changes.length) { status(detail, 'No access changes to save.'); return; }
                        if (reason.length < 4) { status(detail, 'Enter a reason for the access change.', true); return; }
                        pending ||= { commandId: commandId(), expectedRevision: snapshot.accessRevision };
                        markBusy(detail, true); container.querySelector('[data-nav-user]').disabled = true;
                        try {
                            const saved = await call('set_user_access', { profileId: target, changes, reason }, pending);
                            snapshot.accessRevision = saved.accessRevision; snapshot.views = saved.views; pending = null;
                            if (saved.username.toLowerCase() === username()) adopt(saved);
                            status(detail, 'Access saved. Active devices refresh within 30 seconds or when reopened.');
                        } catch (error) { status(detail, message(error), true); }
                        finally { markBusy(detail, false); container.querySelector('[data-nav-user]').disabled = false; }
                    };
                } catch { if (request === requestNumber) detail.innerHTML = '<p role="alert">Unable to load this user. Choose the user again to retry.</p>'; }
            };
        } catch { container.innerHTML = '<p role="alert">User Access requires a current Manager session. Refresh access or sign in again.</p>'; }
    }
    function applyFooter(container) {
        if (!container || !root.document) return;
        container.classList.add('gnc-personal-footer');
        let pool = root.document.getElementById('gnc-footer-button-pool');
        if (!pool) { pool = root.document.createElement('div'); pool.id = 'gnc-footer-button-pool'; pool.hidden = true; container.after(pool); }
        const choices = ['menu', 'home', ...shortcuts()];
        if (!hooks.canAccess || hooks.canAccess('communication')) choices.push('communication');
        // Keep original button nodes, event handlers and badge elements alive.
        Array.from(container.querySelectorAll('.footer-nav-btn')).forEach(button => pool.append(button));
        choices.forEach(view => {
            let button = root.document.getElementById(FOOTER_IDS[view] || `footer-personal-${view}`)
                || Array.from(pool.querySelectorAll('[data-footer-view]')).find(node => node.dataset.footerView === view);
            if (!button) {
                button = root.document.createElement('button'); button.type = 'button'; button.id = FOOTER_IDS[view] || `footer-personal-${view}`;
                button.className = 'footer-nav-btn'; button.dataset.footerView = view;
                button.innerHTML = `<i class="ph ${ICONS[view] || 'ph-squares-four'}" aria-hidden="true"></i><span>${esc(LABELS[view] || entry(view)?.label || view)}</span>`;
                button.onclick = () => { if (permitted(view) && typeof hooks.navigate === 'function') hooks.navigate(view); };
            }
            if (!button.id && FOOTER_IDS[view]) button.id = FOOTER_IDS[view];
            button.classList.remove('hidden'); button.hidden = false; container.append(button);
        });
        container.style.setProperty('--gnc-footer-count', String(choices.length));
        const measure = () => {
            const height = Math.ceil(container.getBoundingClientRect().height);
            if (height > 0) root.document.documentElement.style.setProperty('--gnc-personal-footer-height', `${height}px`);
            if (typeof hooks.onFooterResize === 'function') hooks.onFooterResize(height);
        };
        if (lastFooter !== container && root.ResizeObserver) { footerObserver?.disconnect(); footerObserver = new root.ResizeObserver(measure); footerObserver.observe(container); lastFooter = container; }
        measure();
    }
    const api = { configure, refresh, reset, allowed, shortcuts, applyFooter, renderShortcutEditor, renderAccessEditor,
        get snapshot() { return currentState(); }, normalizedShortcuts, DEFAULT_SHORTCUTS };
    root.GncNavigationPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis);
