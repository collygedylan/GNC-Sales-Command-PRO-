'use strict';
{
    const root = typeof window !== 'undefined' ? window : globalThis;
    const DEFAULT_SHORTCUTS = Object.freeze(['drive', 'eval_reports_2', 'docks', 'request']);
    const ADMIN_SHORTCUTS = Object.freeze(['drive', 'eval_reports_2', 'docks', 'request']);
    const FULL_APP_ADMINISTRATORS = new Set(['dylan_collyge', 'megan_kelly', 'jd_jones']);
    const FIXED_VIEWS = new Set(['menu', 'home', 'communication', 'aura', 'bloom']);
    const ICONS = { aura: 'ph-microphone', drive: 'ph-car', tasks: 'ph-clipboard-text', docks: 'ph-truck', request: 'ph-list-checks', bloom: 'ph-handbag', sales: 'ph-handshake', 'sales-office': 'ph-desktop', 'historical-requests': 'ph-clock-counter-clockwise', 'request-history': 'ph-clock-counter-clockwise', 'sales-credit': 'ph-receipt', 'credit-request': 'ph-check-square', 'sales-inventory': 'ph-storefront', production: 'ph-plant', managers: 'ph-users-three', reports: 'ph-chart-bar', av: 'ph-notebook', 'hl-order': 'ph-truck', 'bunch-note': 'ph-notepad', eval_reports_2: 'ph-chart-line-up', 'manager-eval-reports': 'ph-chart-bar', 'inventory-suggestion': 'ph-lightbulb', 'inv-consolidation': 'ph-arrows-in-line-horizontal', 'request-sales-impact': 'ph-currency-dollar', 'archive-requests': 'ph-clock-counter-clockwise', 'archive-orders': 'ph-package', 'archive-reserves': 'ph-bookmark', 'archive-drive': 'ph-car', 'queue-pending': 'ph-list-checks', 'queue-suspend': 'ph-pause-circle', 'queue-moves': 'ph-map-pin', 'queue-recount': 'ph-counter-clockwise', 'queue-eval-work': 'ph-clipboard-text', 'queue-shear-list': 'ph-scissors', 'queue-bunch-notes': 'ph-notepad', 'queue-bunch-count-review': 'ph-check-circle' };
    const FOOTER_IDS = { aura: 'footer-aura-btn', menu: 'footer-menu-btn', home: 'footer-home-btn', communication: 'footer-communication-btn', drive: 'footer-drive-btn', tasks: 'footer-tasks-btn', managers: 'footer-managers-btn', docks: 'footer-docks-btn', request: 'footer-request-btn', bloom: 'footer-cart-btn' };
    const LABELS = { av:'AV', 'hl-order':'HL Order', 'sales-office':'Sales Office', 'sales-inventory':'Inventory', production:'Production', 'take-back':'Take Back', 'weather-hold':'Weather Hold', 'shear-list':'Shear List', qc:'QC', office:'Office', aura: 'AURA', drive: 'Drive', tasks: 'Tasks', docks: 'Docks', request: 'Que', managers: 'Manager', bloom: 'Bloom', home: 'Home', menu: 'Menu', communication: 'Comm', eval_reports_2: 'Eval Reports #2', 'manager-eval-reports': 'Eval Reports', 'inventory-suggestion': 'Inventory Suggestion', 'inv-consolidation': 'Inv Consolidation', 'request-sales-impact': 'Request Sales Impact ($)', 'archive-requests': 'Historical Requests', 'archive-orders': 'Historical SOC Open Orders', 'archive-reserves': 'Historical SOC Reserves', 'archive-drive': 'Historical Drive Around', 'queue-pending': 'Que · Request', 'queue-suspend': 'Que · Suspend', 'queue-moves': 'Que · Location Moves', 'queue-recount': 'Que · Recount', 'queue-eval-work': 'Que · Eval Work', 'queue-shear-list': 'Que · Shear List', 'queue-bunch-notes': 'Que · Bunch Notes', 'queue-bunch-count-review': 'Que · Bunch Count Review' };
    let hooks = {}, state = null, inflight = null, timer = null, generation = 0, bound = false;
    let footerObserver = null, lastFooter = null;
    let confirmedFooter = null;
    let refreshFailures = 0, retryNotBefore = 0;
    const text = value => String(value == null ? '' : value);
    const esc = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const username = () => text(typeof hooks.username === 'function' ? hooks.username() : hooks.username).trim().toLowerCase();
    const commandId = () => root.crypto.randomUUID();
    const usesAdminShortcuts = () => FULL_APP_ADMINISTRATORS.has(username());
    const fullVisibility = () => typeof hooks.fullVisibility === 'function' && hooks.fullVisibility() === true;
    function normalizedShortcuts(values, permitted = () => true) {
        const result = [];
        (Array.isArray(values) ? values : DEFAULT_SHORTCUTS).forEach(value => {
            const key = text(value).trim();
            if (key && !FIXED_VIEWS.has(key) && !result.includes(key) && permitted(key) && result.length < 4) result.push(key);
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
        if (fullVisibility()) return typeof hooks.canDisplay === 'function' ? hooks.canDisplay(view) === true : true;
        if (typeof hooks.canDisplay === 'function') {
            if (value && (!value.selectable || value.allowed !== true)) return false;
            return hooks.canDisplay(view) === true;
        }
        if (usesAdminShortcuts()) return typeof hooks.canAccess === 'function' ? hooks.canAccess(view) === true : true;
        if (value && (!value.selectable || value.allowed !== true)) return false;
        return typeof hooks.canAccess === 'function' ? hooks.canAccess(view) === true : !!value?.allowed;
    }
    function shortcuts() {
        if (fullVisibility()) return DEFAULT_SHORTCUTS.slice();
        const saved = currentState() ? currentState().shortcuts : confirmedFooter?.user === username() ? confirmedFooter.shortcuts : undefined;
        const staleAdminShortcuts = usesAdminShortcuts() && Array.isArray(saved) && saved.length === 1 && text(saved[0]).trim() === 'tasks';
        const fallbackShortcuts = usesAdminShortcuts() ? ADMIN_SHORTCUTS : saved;
        const chosen = normalizedShortcuts(staleAdminShortcuts || !Array.isArray(saved) || !saved.length ? fallbackShortcuts : saved, permitted);
        const display = typeof hooks.displayChoices === 'function' ? hooks.displayChoices() : [];
        return normalizedShortcuts([...chosen,...DEFAULT_SHORTCUTS,...display,...(currentState()?.views || []).filter(item=>item.selectable).map(item=>item.view)],permitted);
    }
    function adopt(value) {
        if (!value || !Array.isArray(value.views) || text(value.username).toLowerCase() !== username()) return;
        const changed = JSON.stringify(state) !== JSON.stringify(value);
        if (currentState() && Number(value.footerRevision) < Number(state.footerRevision)) {
            value = { ...value, shortcuts: state.shortcuts, footerRevision: state.footerRevision };
        }
        state = value;
        confirmedFooter = {user: username(), shortcuts: value.shortcuts};
        try { root.localStorage?.setItem('gnc-footer-confirmed:' + username(), JSON.stringify(confirmedFooter)); } catch {}
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
        inflight = call('get').then(value => { if (token === generation && user === username()) { adopt(value); refreshFailures = 0; retryNotBefore = 0; } return value; })
            .catch(error => { if (token === generation && user === username()) { refreshFailures += 1; retryNotBefore = Date.now() + Math.min(300000, 30000 * 2 ** Math.min(refreshFailures, 4)); } throw error; })
            .finally(() => { if (token === generation) inflight = null; });
        return inflight;
    }
    function reset() {
        generation++; state = null; inflight = null; confirmedFooter = null; refreshFailures = 0; retryNotBefore = 0;
        if (timer) root.clearInterval(timer);
        timer = null;
    }
    function refreshVisibleNavigationPreferences() {
        if (root.document.hidden || !username() || inflight || Date.now() < retryNotBefore) return;
        void refresh().catch(() => {});
    }
    function restoreConfirmedFooter() {
        if (!username() || confirmedFooter?.user === username()) return;
        try {
            const stored = JSON.parse(root.localStorage?.getItem('gnc-footer-confirmed:' + username()) || 'null');
            if (stored?.user === username()) { confirmedFooter = stored; return; }
            const legacy = JSON.parse(root.localStorage?.getItem('gnc-navigation-shortcuts-v1:' + username()) || 'null');
            if (Array.isArray(legacy)) confirmedFooter = {user: username(), shortcuts: legacy};
        } catch {}
    }
    function bindNavigationPreferenceLifecycle() {
        if (bound || !root.document) return;
        bound = true;
        root.document.addEventListener('visibilitychange', refreshVisibleNavigationPreferences);
        root.addEventListener('online', refreshVisibleNavigationPreferences);
    }
    function configure(options = {}) {
        const oldUser = username(); hooks = { ...hooks, ...options };
        if (oldUser !== username()) reset();
        restoreConfirmedFooter();
        if (!timer && root.document && root.setInterval) timer = root.setInterval(refreshVisibleNavigationPreferences, 30000);
        bindNavigationPreferenceLifecycle();
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
            const available = snapshot.views.filter(item => item.selectable && !FIXED_VIEWS.has(item.view) && permitted(item.view));
            const storageKey = `gnc-navigation-shortcuts-v1:${username()}`;
            let draft = normalizedShortcuts(snapshot.shortcuts, key => available.some(item => item.view === key));
            try { const retained = JSON.parse(root.localStorage?.getItem(storageKey) || 'null'); if (Array.isArray(retained)) draft = normalizedShortcuts(retained, key => available.some(item => item.view === key)); } catch {}
            let selected = Math.min(Math.max(draft.length - 1, 0), 3), saving = false;
            const labelFor = view => available.find(item => item.view === view)?.label || LABELS[view] || view || 'Empty slot';
            const persistLocal = () => { try { root.localStorage?.setItem(storageKey, JSON.stringify(draft)); } catch {} };
            const save = async () => {
                if (saving) return;
                saving = true; markBusy(container, true); status(container, 'Saving shortcuts…');
                try {
                    const saved = await call('save_shortcuts', { shortcuts: draft }, { commandId: commandId(), expectedRevision: snapshot.footerRevision });
                    adopt(saved); snapshot.footerRevision = saved.footerRevision; draft = normalizedShortcuts(saved.shortcuts, key => available.some(item => item.view === key)); persistLocal();
                    renderMarkup(); status(container, 'Shortcuts saved and the dock is updated.');
                } catch (error) { status(container, message(error), true); }
                finally { saving = false; markBusy(container, false); }
            };
            const change = next => { draft = normalizedShortcuts(next, key => available.some(item => item.view === key)); persistLocal(); renderMarkup(); void save(); };
            const renderMarkup = () => {
                container.innerHTML = `<h2>Footer shortcuts</h2><p>Tap or click a slot, then choose its module. Menu, Home, Comm and AURA stay fixed.</p><div class="gnc-navigation-slots">${Array.from({ length: 4 }, (_, i) => `<button type="button" class="gnc-navigation-slot" data-nav-slot="${i}" aria-selected="${selected===i}"><span>Slot ${[3,4,6,7][i]}</span><strong>${esc(labelFor(draft[i]))}</strong></button>`).join('')}</div><div class="gnc-navigation-reorder" aria-label="Selected slot controls"><button type="button" data-nav-left aria-label="Move selected shortcut left">←</button><button type="button" data-nav-remove>× Remove</button><button type="button" data-nav-right aria-label="Move selected shortcut right">→</button></div><button type="button" data-nav-add>+ Add to first empty slot</button><div class="gnc-navigation-modules" aria-label="Available modules">${available.map(item=>`<button type="button" data-nav-module="${esc(item.view)}" aria-pressed="${draft[selected]===item.view}">${esc(item.label)}</button>`).join('')}</div><p data-nav-status role="status"></p><div class="gnc-navigation-actions"><button type="button" data-nav-defaults>Use defaults</button><button type="button" data-nav-reload>Reload saved settings</button></div>`;
                container.querySelectorAll('[data-nav-slot]').forEach(node => { node.onclick=()=>{selected=Number(node.dataset.navSlot);renderMarkup();}; });
                container.querySelectorAll('[data-nav-module]').forEach(node => { node.onclick=()=>{const view=node.dataset.navModule;const next=draft.filter(value=>value!==view);next.splice(Math.min(selected,next.length),0,view);change(next.slice(0,4));}; });
                container.querySelector('[data-nav-left]').onclick=()=>{if(selected<1||selected>=draft.length)return;const next=[...draft];[next[selected-1],next[selected]]=[next[selected],next[selected-1]];selected--;change(next);};
                container.querySelector('[data-nav-right]').onclick=()=>{if(selected<0||selected>=draft.length-1)return;const next=[...draft];[next[selected],next[selected+1]]=[next[selected+1],next[selected]];selected++;change(next);};
                container.querySelector('[data-nav-remove]').onclick=()=>{if(selected>=draft.length)return;const next=[...draft];next.splice(selected,1);selected=Math.min(selected,Math.max(0,next.length-1));change(next);};
                container.querySelector('[data-nav-add]').onclick=()=>{selected=Math.min(draft.length,3);renderMarkup();};
                container.querySelector('[data-nav-defaults]').onclick=()=>{selected=0;change(normalizedShortcuts(null,key=>available.some(item=>item.view===key)));};
                container.querySelector('[data-nav-reload]').onclick=()=>{try{root.localStorage?.removeItem(storageKey);}catch{}renderShortcutEditor(container);};
            };
            renderMarkup();
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
                    detail.innerHTML = `<div class="gnc-navigation-access-list">${snapshot.views.map(row => `<label class="gnc-navigation-access-row"><span><strong>${esc(row.label)}</strong><small>${row.allowed ? 'Currently allowed' : 'Currently unavailable'}${row.protectedReason ? ` · ${esc(row.protectedReason)}` : ''}</small></span><select data-nav-view="${esc(row.view)}"${lockedView(row, snapshot.username) ? ' disabled data-protected="true"' : ''}><option value="true"${row.allowed === true ? ' selected' : ''}>Allow view</option><option value="false"${row.allowed !== true ? ' selected' : ''}>Hide view</option></select></label>`).join('')}</div><label>Reason for change<textarea data-nav-reason maxlength="500" rows="2"></textarea></label><p data-nav-status role="status"></p><div class="gnc-navigation-actions"><button type="button" data-nav-save>Save user access</button><button type="button" data-nav-reload>Reload saved access</button></div>`;
                    let pending = null;
                    detail.oninput = () => { pending = null; };
                    detail.onchange = () => { pending = null; };
                    detail.querySelector('[data-nav-reload]').onclick = () => container.querySelector('[data-nav-user]').onchange();
                    detail.querySelector('[data-nav-save]').onclick = async () => {
                        if (detail.getAttribute('aria-busy') === 'true') return;
                        const reason = detail.querySelector('[data-nav-reason]').value.trim();
                        const changes = Array.from(detail.querySelectorAll('[data-nav-view]')).filter(node => !node.disabled).map(node => ({ view: node.dataset.navView, allowed: node.value === 'true' }))
                            .filter(change => snapshot.views.find(row => row.view === change.view).allowed !== change.allowed);
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
    function mountUnavailableFooterChoice(container, pool, view, index) {
        const destination = ['menu', 'home', 'drive', 'eval_reports_2', 'communication', 'docks', 'request', 'aura'][index];
        const label = LABELS[destination];
        let button = root.document.getElementById(`footer-${view}`);
        if (!button) {
            button = root.document.createElement('button');
            button.id = `footer-${view}`;
            button.type = 'button';
            button.className = 'footer-nav-btn';
            button.dataset.footerView = view;
            button.innerHTML = `<i class="ph ph-lock" aria-hidden="true"></i><span>${esc(label)}</span>`;
        }
        button.disabled = true;
        button.setAttribute('aria-label', label + ' unavailable for this account');
        button.title = label + ' unavailable for this account';
        button.dataset.footerSlot = String(index + 1);
        button.style.gridColumn = String(index + 1);
        button.classList.remove('hidden'); button.hidden = false;
        if (button.parentElement === pool || container.children[index] !== button) container.insertBefore(button, container.children[index] || null);
    }
    function activateFooterChoice(view) {
        if (permitted(view) && typeof hooks.navigate === 'function') hooks.navigate(view);
    }
    function getFooterChoiceButton(container, pool, view) {
    let button = root.document.getElementById(FOOTER_IDS[view] || `footer-personal-${view}`)
        || [...container.querySelectorAll('[data-footer-view]'), ...pool.querySelectorAll('[data-footer-view]')].find(node => node.dataset.footerView === view);
    if (!button) {
        button = root.document.createElement('button'); button.type = 'button'; button.id = FOOTER_IDS[view] || `footer-personal-${view}`;
        button.className = 'footer-nav-btn'; button.dataset.footerView = view;
        button.innerHTML = `<i class="ph ${ICONS[view] || 'ph-squares-four'}" aria-hidden="true"></i><span>${esc(LABELS[view] || entry(view)?.label || view)}</span>`;
        button.onclick = () => activateFooterChoice(view);
    }
        return button;
    }
    function footerButtonView(button) {
        if (button.dataset.footerView) return button.dataset.footerView;
        if (button.id === FOOTER_IDS.menu) return 'menu';
        if (button.id === FOOTER_IDS.aura) return 'aura';
        if (button.id === FOOTER_IDS.bloom) return 'bloom';
        return '';
    }
    function applyFooter(container) {
        if (!container || !root.document) return;
        container.classList.add('gnc-personal-footer');
        let pool = root.document.getElementById('gnc-footer-button-pool');
        if (!pool) { pool = root.document.createElement('div'); pool.id = 'gnc-footer-button-pool'; pool.hidden = true; container.after(pool); }
        // Bloom is a header action; AURA owns its former footer slot without rewriting saved preferences.
        const custom = shortcuts();
        const canCommunicate = fullVisibility() || (typeof hooks.canDisplay === 'function' ? hooks.canDisplay('communication') : !hooks.canAccess || hooks.canAccess('communication'));
        const choices = ['menu','home',custom[0],custom[1],canCommunicate ? 'communication' : null,custom[2],custom[3],'aura']
            .map((view, index) => view || `unavailable-${index + 1}`);
        // Keep unchanged buttons attached during touch/keyboard activation.
        // Only removed shortcuts move into the pool; badges and handlers survive.
        const chosenViews = new Set(choices);
        Array.from(container.querySelectorAll('.footer-nav-btn')).forEach(button => {
            const view = footerButtonView(button);
            if (!chosenViews.has(view)) pool.append(button);
        });
        choices.forEach((view, index) => {
            if (view.startsWith('unavailable-')) { mountUnavailableFooterChoice(container, pool, view, index); return; }
            const button = getFooterChoiceButton(container, pool, view);
            if (!button.id && FOOTER_IDS[view]) button.id = FOOTER_IDS[view];
            button.style.gridColumn = String(index + 1);
            button.dataset.footerSlot = String(index + 1);
            button.classList.remove('hidden'); button.hidden = false;
            const position = choices.slice(0,index).filter(Boolean).length;
            if (container.children[position] !== button) container.insertBefore(button, container.children[position] || null);
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
}
