(function (global) {
  'use strict';

  const TABLES = Object.freeze([
    { id: 'assigned-items', label: 'Assigned Items', section: 'editable', description: 'Current warehouse rows joined with live inventory and row assignments.' },
    { id: 'company-directory', label: 'Company Directory', section: 'editable', description: 'People, contacts, roles, departments, territories, and active status.', managed: true },
    { id: 'inquiry-coverage', label: 'Inquiry Coverage', section: 'editable', description: 'Location, block, group, primary and backup users.', managed: true },
    { id: 'customer-assignments', label: 'Customer Assignments', section: 'editable', description: 'Versioned customer and consignee sales-rep assignments.' },
    { id: 'user-role-access', label: 'User Role and Access', section: 'editable', description: 'Canonical role and module permissions.' },
    { id: 'historical-drive-mode', label: 'Historical Drive Mode', section: 'archive', description: 'Read-only Drive Around snapshots.' },
    { id: 'historical-soc-open-orders', label: 'Historical SOC Open Orders', section: 'archive', description: 'Read-only SOC Open Orders snapshots.' },
    { id: 'historical-soc-reserves', label: 'Historical SOC Reserves', section: 'archive', description: 'Read-only SOC Reserves snapshots.' },
    { id: 'historical-requests', label: 'Historical Requests', section: 'archive', description: 'Read-only completed request records and archive folders.' },
    { id: 'photo-history', label: 'Photo History', section: 'archive', description: 'Read-only historical plant and location photo gallery.' },
  ]);
  const EDIT_FIELDS = Object.freeze({
    'company-directory': [
      ['name', 'Name', 'text', true], ['username', 'Username', 'text'], ['email', 'Email', 'email'],
      ['phone', 'Phone', 'tel'], ['userrole', 'Role', 'text'], ['department', 'Department', 'text'],
      ['territory', 'Territory', 'text'], ['active', 'Active', 'checkbox'],
    ],
    'inquiry-coverage': [
      ['scope', 'Scope', 'scope', true], ['block', 'Block', 'text'], ['location', 'Location', 'text'],
      ['group_name', 'Group', 'text'], ['primary_user', 'Primary user', 'user', true],
      ['backup_user', 'Backup user', 'user'], ['notes', 'Notes', 'textarea'], ['active', 'Active', 'checkbox'],
    ],
  });
  const COLUMNS = Object.freeze({
    'company-directory': [['name', 'Name'], ['username', 'Username'], ['email', 'Email'], ['phone', 'Phone'], ['userrole', 'Role'], ['department', 'Department'], ['territory', 'Territory'], ['active', 'Active']],
    'inquiry-coverage': [['scope', 'Scope'], ['block', 'Block'], ['location', 'Location'], ['group_name', 'Group'], ['primary_user', 'Primary user'], ['backup_user', 'Backup user'], ['active', 'Active']],
  });

  function text(value) { return String(value == null ? '' : value); }
  function escape(value) { return text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function csv(rows, columns) {
    const quote = value => `"${text(value).replace(/"/g, '""')}"`;
    return [columns.map(([, label]) => quote(label)).join(','), ...rows.map(row => columns.map(([key]) => quote(row[key])).join(','))].join('\r\n');
  }

  function mountManagerTableManagement(root, options = {}) {
    if (!root) throw new TypeError('Table Management root is required.');
    const request = options.request;
    const openTable = options.openTable;
    if (typeof request !== 'function' || typeof openTable !== 'function') throw new TypeError('Table Management requires guarded transport and navigation callbacks.');
    const allowedTables = new Set(Array.isArray(options.tables) ? options.tables.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean) : TABLES.map(item => item.id));
    const state = { selected: '', rows: [], users: [], query: '', page: 0, total: 0, loading: false, saving: false, error: '', editing: null, formOpen: false, generation: 0, commandTokens: new Map() };
    const tableForKey = key => key === 'company-directory' || key === 'inquiry-coverage';
    const inputAttrs = field => field[2] === 'checkbox' ? 'type="checkbox"' : `type="${field[2] === 'user' ? 'select' : field[2]}"`;
    const redraw = () => {
      if (!root.isConnected) return;
      if (!state.selected) {
        const editable = TABLES.filter(item => item.section === 'editable' && allowedTables.has(item.id)).map(item => `<button type="button" data-table-select="${item.id}" class="tm-choice"><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span><em>EDITABLE TABLE</em></button>`).join('');
        const archives = TABLES.filter(item => item.section === 'archive' && allowedTables.has(item.id)).map(item => `<button type="button" data-table-select="${item.id}" class="tm-choice"><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span><em>READ-ONLY ARCHIVE</em></button>`).join('');
        root.innerHTML = `<section class="tm-shell"><header><h2>Table Management</h2><p>Choose a maintained table or browse an archive.</p></header><h3>Editable maintained tables</h3><div class="tm-grid">${editable}</div><h3>Read-only historical and photo archives</h3><div class="tm-grid">${archives}</div></section>`;
        return;
      }
      const selected = TABLES.find(item => item.id === state.selected);
      if (!selected) { state.selected = ''; redraw(); return; }
      if (!tableForKey(state.selected)) {
        openTable(state.selected);
        state.selected = '';
        return;
      }
      const labels = COLUMNS[state.selected];
      const rows = state.rows.map(row => `<tr data-inline-row="${escape(row.id)}">${labels.map(([key]) => `<td>${renderInlineField(state.selected, row, key, state.users)}</td>`).join('')}<td><button type="button" data-save-row="${escape(row.id)}">Save Changes</button><button type="button" data-edit="${escape(row.id)}">More fields</button><button type="button" data-delete="${escape(row.id)}">Delete</button></td></tr>`).join('');
      const form = state.formOpen ? renderForm(state.selected, state.editing, state.users, state.error, state.saving) : '';
      root.innerHTML = `<section class="tm-shell"><header><button type="button" data-back>All tables</button><span class="tm-badge">EDITABLE TABLE</span><h2>${escape(selected.label)}</h2><p>${escape(selected.description)}</p></header>${state.selected === 'inquiry-coverage' && typeof options.legacyCoverage === 'function' ? `<aside class="tm-legacy-coverage">${options.legacyCoverage()}</aside>` : ''}${state.selected === 'company-directory' && options.canOpenLegacyDirectory === true ? '<aside class="tm-legacy-coverage"><p>Open the existing contacts, block capacities, and production code directory.</p><button type="button" data-legacy-directory>Company contacts, blocks &amp; production codes</button></aside>' : ''}<div class="tm-toolbar"><label>Search <input type="search" data-search value="${escape(state.query)}" maxlength="120"></label><button type="button" data-refresh ${state.loading ? 'disabled' : ''}>Refresh</button><button type="button" data-export>Export CSV</button><button type="button" data-add>+ Add Row</button></div>${state.error && !state.formOpen ? `<div role="status" class="tm-error">${escape(state.error)} <button type="button" data-refresh>Retry</button></div>` : ''}${state.loading && !state.rows.length ? '<p role="status">Loading…</p>' : ''}<div class="tm-scroll"><table><thead><tr>${labels.map(([, label]) => `<th>${escape(label)}</th>`).join('')}<th>Actions</th></tr></thead><tbody>${rows || (!state.loading ? `<tr><td colspan="${labels.length + 1}">No rows found.</td></tr>` : '')}</tbody></table></div><footer><button type="button" data-page="prev" ${state.page <= 0 ? 'disabled' : ''}>Previous</button><span>${state.total.toLocaleString()} rows · page ${state.page + 1}</span><button type="button" data-page="next" ${((state.page + 1) * 100 >= state.total) ? 'disabled' : ''}>Next</button></footer>${form}</section>`;
    };
    function renderForm(table, row, users, error, saving) {
      const fields = EDIT_FIELDS[table].map(([key, label, type, required]) => {
        const value = row ? row[key] : key === 'active' ? true : key === 'scope' ? 'location' : '';
        const req = required ? ' required' : '';
        let control = '';
        if (type === 'checkbox') control = `<input name="${key}" ${value === true ? 'checked' : ''} type="checkbox">`;
        else if (type === 'scope') control = `<select name="${key}" required>${['block','location','group','all'].map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
        else if (type === 'user') control = `<select name="${key}"${req}><option value="">Choose user</option>${users.map(user => `<option value="${escape(user.username)}" ${text(value).toLowerCase() === text(user.username).toLowerCase() ? 'selected' : ''}>${escape(user.display_name)} · ${escape(user.username)}${user.email ? ` · ${escape(user.email)}` : ''}</option>`).join('')}</select>`;
        else if (type === 'textarea') control = `<textarea name="${key}" maxlength="2000">${escape(value)}</textarea>`;
        else control = `<input name="${key}" ${inputAttrs([key,label,type])}${req} maxlength="${key === 'email' ? 254 : key === 'name' ? 160 : key === 'username' ? 80 : 120}" value="${escape(value)}">`;
        return `<label>${escape(label)}${control}</label>`;
      }).join('');
      return `<form class="tm-form" data-form><h3>${row ? 'Edit row' : 'Add row'}</h3>${fields}${error ? `<p class="tm-error" role="alert">${escape(error)}</p>` : ''}<div><button type="button" data-cancel>Cancel</button><button type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Save Changes'}</button></div></form>`;
    }
    function renderInlineField(table, row, key, users) {
      const value = row[key];
      if (key === 'active') return `<input type="checkbox" aria-label="Active" data-inline-field="active" ${value === true ? 'checked' : ''}>`;
      if (key === 'scope') return `<select data-inline-field="scope" aria-label="Scope">${['block','location','group','all'].map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
      if (key === 'primary_user' || key === 'backup_user') return `<select data-inline-field="${key}" aria-label="${key}"><option value="">${key === 'primary_user' ? 'Choose user' : 'None'}</option>${users.map(user => `<option value="${escape(user.username)}" ${text(value).toLowerCase() === text(user.username).toLowerCase() ? 'selected' : ''}>${escape(user.display_name)} · ${escape(user.username)}</option>`).join('')}</select>`;
      return `<input data-inline-field="${key}" aria-label="${key}" maxlength="${key === 'name' ? 160 : key === 'email' ? 254 : key === 'userrole' || key === 'phone' ? 64 : 120}" value="${escape(value)}">`;
    }
    function makeCommandId() {
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => { const value = Math.random() * 16 | 0; return (char === 'x' ? value : value & 3 | 8).toString(16); });
    }
    async function mutate(operation, table, payload) {
      const signature = JSON.stringify([operation, table, payload]);
      const commandId = state.commandTokens.get(signature) || makeCommandId();
      state.commandTokens.set(signature, commandId);
      const response = await request({ action: 'manager_table_management', operation, table, payload: { ...payload, command_id: commandId } });
      state.commandTokens.delete(signature);
      return response?.data && typeof response.data === 'object' ? response.data : response;
    }
    async function saveInlineRow(id) {
      const row = state.rows.find(item => String(item.id) === String(id));
      const host = root.querySelector(`[data-inline-row="${CSS.escape(String(id))}"]`);
      if (!row || !host) return;
      const payload = { id: row.id, expectedRevision: String(row.revision) };
      host.querySelectorAll('[data-inline-field]').forEach(input => {
        const field = input.dataset.inlineField;
        payload[field] = input.type === 'checkbox' ? input.checked : text(input.value).trim() || null;
      });
      state.saving = true; state.error = '';
      state.rows = state.rows.map(item => String(item.id) === String(id) ? { ...item, ...Object.fromEntries(Object.entries(payload).filter(([key]) => !['id','expectedRevision'].includes(key))) } : item);
      redraw();
      try {
        const result = await mutate('update', state.selected, payload);
        if (result?.row) state.rows = state.rows.map(item => String(item.id) === String(id) ? result.row : item);
      } catch (error) { state.error = error.message || 'Save failed.'; }
      finally { state.saving = false; redraw(); }
    }
    async function load() {
      if (!tableForKey(state.selected)) return;
      const generation = ++state.generation;
      state.loading = true; state.error = ''; redraw();
      try {
        const response = await request({ action: 'manager_table_management', operation: 'read', table: state.selected, payload: { page: state.page, pageSize: 100, q: state.query } });
        const result = response?.data && typeof response.data === 'object' ? response.data : response;
        if (generation !== state.generation || !root.isConnected) return;
        state.rows = Array.isArray(result.rows) ? result.rows : [];
        state.total = Number(result.total || 0);
        state.error = '';
      } catch (error) { if (generation === state.generation) state.error = error.message || 'Table could not be loaded.'; }
      finally { if (generation === state.generation) { state.loading = false; redraw(); } }
    }
    async function loadUsers() {
      const response = await request({ action: 'manager_table_management', operation: 'users', table: 'inquiry-coverage', payload: {} });
      const result = response?.data && typeof response.data === 'object' ? response.data : response;
      state.users = Array.isArray(result.rows) ? result.rows.filter(user => user?.username && user?.display_name) : [];
    }
    root.addEventListener('click', async event => {
      const button = event.target.closest('button'); if (!button || !root.contains(button)) return;
      if (button.dataset.tableSelect) {
        const item = TABLES.find(value => value.id === button.dataset.tableSelect && allowedTables.has(value.id)); if (!item) return;
        state.selected = item.id;
        if (item.managed) { state.page = 0; state.query = ''; if (item.id === 'inquiry-coverage' && !state.users.length) { try { await loadUsers(); } catch (error) { state.error = error.message || 'User directory unavailable.'; } } await load(); }
        else { redraw(); }
        return;
      }
      if (button.hasAttribute('data-legacy-directory')) { if (options.canOpenLegacyDirectory === true) options.openLegacyDirectory?.(); return; }
      if (button.hasAttribute('data-back')) { state.selected = ''; state.rows = []; state.error = ''; state.formOpen = false; state.generation++; redraw(); return; }
      if (button.hasAttribute('data-refresh')) { await load(); return; }
      if (button.hasAttribute('data-add')) { state.editing = null; state.formOpen = true; state.error = ''; redraw(); return; }
      if (button.dataset.edit) { state.editing = state.rows.find(row => String(row.id) === button.dataset.edit) || null; state.formOpen = !!state.editing; state.error = ''; redraw(); return; }
      if (button.dataset.saveRow) { await saveInlineRow(button.dataset.saveRow); return; }
      if (button.dataset.delete) {
        const row = state.rows.find(value => String(value.id) === button.dataset.delete); if (!row) return;
        if (!global.confirm('Delete this row? This cannot be undone.')) return;
        state.saving = true; redraw();
        try { await mutate('delete', state.selected, { id: row.id, expectedRevision: String(row.revision) }); await load(); }
        catch (error) { state.error = error.message || 'Delete failed.'; }
        finally { state.saving = false; redraw(); }
        return;
      }
      if (button.dataset.page) { state.page = Math.max(0, state.page + (button.dataset.page === 'next' ? 1 : -1)); await load(); return; }
      if (button.hasAttribute('data-export')) {
        const columns = COLUMNS[state.selected];
        if (typeof global.downloadManagerRowsToExcel === 'function') global.downloadManagerRowsToExcel(columns, state.rows, TABLES.find(item => item.id === state.selected)?.label || 'Table Management');
        else { const blob = new Blob([csv(state.rows, columns)], { type: 'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${state.selected}.csv`; link.click(); URL.revokeObjectURL(link.href); }
      }
    });
    root.addEventListener('input', event => {
      if (!event.target.matches('[data-search]')) return;
      state.query = event.target.value; state.page = 0;
      clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { if (state.selected) void load(); }, 250);
    });
    root.addEventListener('submit', async event => {
      if (!event.target.matches('[data-form]')) return;
      event.preventDefault();
      const form = new FormData(event.target); const payload = {};
      EDIT_FIELDS[state.selected].forEach(([key, , type]) => { payload[key] = type === 'checkbox' ? form.get(key) === 'on' : text(form.get(key)).trim() || null; });
      if (state.editing) { payload.id = state.editing.id; payload.expectedRevision = String(state.editing.revision); }
      state.saving = true; state.error = ''; redraw();
      try {
        await mutate(state.editing ? 'update' : 'create', state.selected, payload);
        state.formOpen = false; state.editing = null; await load();
      } catch (error) { state.error = error.message || 'Save failed.'; }
      finally { state.saving = false; redraw(); }
    });
    root.addEventListener('click', event => { if (event.target.closest('[data-cancel]')) { state.formOpen = false; state.editing = null; state.error = ''; redraw(); } });
    const style = document.createElement('style'); style.dataset.managerTableStyle = 'true';
    style.textContent = '#manager-table-management-root .tm-shell{display:grid;gap:16px}.tm-shell header,.tm-shell .tm-toolbar,.tm-shell footer,.tm-form{border:1px solid #d1fae5;border-radius:16px;background:#fff;padding:16px}.tm-shell h2{font-size:24px;font-weight:900;color:#064e3b}.tm-shell h3{font-size:14px;font-weight:900;color:#065f46}.tm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.tm-choice{display:flex;min-height:120px;flex-direction:column;align-items:flex-start;gap:8px;border:1px solid #d1fae5;border-radius:14px;background:#fff;padding:14px;text-align:left}.tm-choice strong{color:#064e3b;font-weight:900}.tm-choice span{font-size:12px;color:#475569}.tm-choice em,.tm-badge{font-size:10px;font-weight:900;font-style:normal;color:#047857}.tm-toolbar{display:flex;flex-wrap:wrap;align-items:end;gap:8px}.tm-toolbar label{flex:1;min-width:200px}.tm-toolbar input,.tm-form input,.tm-form select,.tm-form textarea{display:block;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px}.tm-form input[type=checkbox]{width:auto}.tm-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.tm-form h3,.tm-form p,.tm-form>div{grid-column:1/-1}.tm-form label{display:grid;gap:5px;font-size:12px;font-weight:700}.tm-scroll{overflow:auto;border:1px solid #d1fae5;border-radius:12px;background:#fff}.tm-scroll table{width:100%;border-collapse:collapse;font-size:12px}.tm-scroll th,.tm-scroll td{padding:10px;border-bottom:1px solid #e2e8f0;text-align:left;white-space:nowrap}.tm-scroll th{background:#ecfdf5}.tm-error{color:#b91c1c}.tm-legacy-coverage{border:1px solid #d1fae5;border-radius:14px;padding:12px;background:#fff}.tm-shell button{min-height:40px;border-radius:8px;padding:8px 12px;font-weight:800}.tm-link{color:#047857;text-decoration:underline}';
    document.head.appendChild(style);
    redraw();
    if (options.selected) { const item = TABLES.find(value => value.id === options.selected && allowedTables.has(value.id)); if (item) root.querySelector(`[data-table-select="${CSS.escape(item.id)}"]`)?.click(); }
    return { destroy() { state.generation++; clearTimeout(state.searchTimer); style.remove(); root.replaceChildren(); } };
  }

  global.GncManagerTableManagement = Object.freeze({ mountManagerTableManagement, tables: TABLES });
})(window);
