import { readActionDiscrepancyRows } from '../core/erp-action-discrepancies.js';

const discrepancyColumns = [
    'Date / Report File', 'Item / Size / Loc / Lot', 'APP UPDATE Action', 'APP Update Row',
    'Report Update Row', 'Discrepancy Diff (What Needs to Change)', 'Learned Rule', 'Status / Actions'
];

function discrepancyCellValues(row) {
    return [
        [row.created_at, row.source_file_name].filter(Boolean).join('\n'),
        [row.itemcode, row.commonname, row.contsize, row.locationcode, row.lotcode].filter(Boolean).join(' · '),
        [row.app_update_action?.summary || row.action_type, JSON.stringify(row.app_update_action)].filter(Boolean).join('\n'),
        JSON.stringify(row.app_update_row), JSON.stringify(row.report_update_row),
        JSON.stringify(row.discrepancy_diff), row.learned_rule ? JSON.stringify(row.learned_rule) : '', row.status
    ];
}

function indexDiscrepancies(rows) {
    return rows.map(row => {
        const cells = discrepancyCellValues(row);
        return {row, cells, text:cells.join(' ').toLowerCase()};
    });
}

function discrepancyShell() {
    return `<section class="tm-shell"><div class="tm-toolbar">
        <label>Search <input type="search" data-query maxlength="160" placeholder="Item, report, or field"></label>
        <label>Action Type <select data-type><option value="">All types</option></select></label>
        <label>Status <select data-status><option value="">All statuses</option><option value="open">Open</option>
        <option value="learned">Learned</option><option value="reviewed">Reviewed</option></select></label>
        <button type="button" data-command="refresh">Refresh</button></div>
        <p role="status" data-message></p><div class="tm-scroll"><table><thead><tr>
        ${discrepancyColumns.map(label => '<th scope="col">' + label + '</th>').join('')}</tr></thead><tbody></tbody></table></div>
        <footer><button type="button" data-command="previous">Previous</button>
        <span data-range></span> <button type="button" data-command="next">Next</button></footer></section>`;
}

function renderDiscrepancy(entry, escape, busy) {
    const {row, cells} = entry;
    const details = (label, value) => value ? `<details><summary>${escape(label)}</summary><pre>${escape(value)}</pre></details>` : '—';
    const summary = row.app_update_action?.summary || row.action_type;
    const changes = Object.keys(row.discrepancy_diff || {}).length;
    const teachable = !!row.learned_rule && row.learned_rule.teachable !== false;
    const rule = row.learned_rule?.auto_apply_enabled ? 'Enabled' : teachable ? 'Proposed' : 'Observation';
    const buttons = row.status === 'open' ? `<button type="button" data-command="review">Review</button>` : '';
    const teach = row.status !== 'learned' && teachable ? `<button type="button" data-command="teach">🧠 Teach / Apply Rule to App</button>` : '';
    return `<tr data-id="${row.id}"><td>${escape(cells[0])}</td><td>${escape(cells[1])}</td>
        <td>${details(summary, cells[2])}</td><td>${details('App row', cells[3])}</td><td>${details('Report row', cells[4])}</td>
        <td>${details(changes + ' field changes', cells[5])}</td><td>${details(rule, cells[6])}</td>
        <td>${escape(row.status)} <fieldset ${busy ? 'disabled' : ''}>${teach}${buttons}</fieldset></td></tr>`;
}

function updateDiscrepancyRows(view, rows) {
    view.entries = indexDiscrepancies(rows);
    const select = view.root.querySelector('[data-type]');
    const previous = select.value;
    const types = [...new Set(rows.map(row => row.action_type).filter(Boolean))].sort();
    select.replaceChildren(new Option('All types', ''), ...types.map(type => new Option(type, type)));
    if (types.includes(previous)) select.value = previous;
    drawDiscrepancies(view);
}

function drawDiscrepancies(view) {
    const {root, state} = view;
    const tokens = root.querySelector('[data-query]').value.toLowerCase().trim().split(/\s+/);
    const type = root.querySelector('[data-type]').value;
    const status = root.querySelector('[data-status]').value;
    const rows = view.entries.filter(({row, text}) => (!type || row.action_type === type)
        && (!status || row.status === status) && tokens.every(token => text.includes(token)));
    state.page = Math.min(state.page, Math.max(0, Math.ceil(rows.length / 25) - 1));
    const start = state.page * 25;
    view.filtered = rows;
    root.querySelector('tbody').innerHTML = rows.slice(start, start + 25).map(entry =>
        renderDiscrepancy(entry, view.escape, state.busy)).join('');
    root.querySelector('[data-range]').textContent = rows.length ? `${start + 1}–${Math.min(start + 25, rows.length)} of ${rows.length}` : '0 rows';
    root.querySelector('[data-command="previous"]').disabled = start === 0;
    root.querySelector('[data-command="next"]').disabled = start + 25 >= rows.length;
    root.querySelector('[data-command="refresh"]').disabled = state.busy;
    root.querySelector('[data-message]').textContent = state.message || (!rows.length && !state.busy ? 'No matching discrepancies.' : '');
}

async function saveDiscrepancyDecision(view, command, id) {
    const receipt = await view.source.request(command, {id}, view.lifetime.signal);
    const expected = command === 'teach' ? 'learned' : 'reviewed';
    if (receipt?.row?.id !== id || receipt.row.status !== expected) throw Error('The change was not confirmed.');
    if (view.current()) updateDiscrepancyRows(view, view.entries.map(entry => entry.row.id === id ? receipt.row : entry.row));
}

async function runDiscrepancyCommand(view, command, id) {
    const {source, state, lifetime} = view;
    if (state.busy || !source.current() || lifetime.signal.aborted) return;
    state.busy = true;
    state.message = command === 'refresh' ? 'Checking reports…' : 'Saving…';
    drawDiscrepancies(view);
    try {
        if (command !== 'refresh') await saveDiscrepancyDecision(view, command, id);
        if (!view.current()) return;
        const showFirst = page => view.current() && !view.entries.length && updateDiscrepancyRows(view, page);
        const rows = await readActionDiscrepancyRows(source, lifetime.signal, showFirst);
        if (!view.current()) return;
        state.complete = true;
        state.message = '';
        updateDiscrepancyRows(view, rows);
    } catch (error) {
        state.complete = false;
        state.message = error?.message || 'Unable to check reports. Retry with Refresh.';
    } finally {
        state.busy = false;
        if (view.current()) drawDiscrepancies(view);
    }
}

function discrepancyClick(view, event) {
    const button = event.target.closest('button[data-command]');
    if (!button || !view.current()) return;
    const command = button.dataset.command;
    if (command === 'previous' || command === 'next') {
        view.state.page = Math.max(0, view.state.page + (command === 'next' ? 1 : -1));
        return drawDiscrepancies(view);
    }
    return runDiscrepancyCommand(view, command, Number(button.closest('tr')?.dataset.id));
}

export function mountActionDiscrepancies(root, source, escape) {
    const lifetime = new AbortController();
    const current = () => !lifetime.signal.aborted && root.isConnected && source.current();
    const state = {page:0, busy:false, complete:false, message:''};
    const view = {root, source, escape, current, lifetime, state, entries:[], filtered:[]};
    root.innerHTML = discrepancyShell();
    const filter = () => { state.page = 0; drawDiscrepancies(view); };
    root.querySelector('[data-query]').addEventListener('input', filter, {signal:lifetime.signal});
    root.querySelector('[data-type]').addEventListener('change', filter, {signal:lifetime.signal});
    root.querySelector('[data-status]').addEventListener('change', filter, {signal:lifetime.signal});
    root.addEventListener('click', event => discrepancyClick(view, event), {signal:lifetime.signal});
    root.agdataExcelProvider = () => {
        if (!current() || !state.complete || state.busy) throw Error('Wait for a complete discrepancy read before exporting.');
        return {title:'Action Discrepancy', rows:view.filtered.map(entry => entry.cells),
            columns:discrepancyColumns.map((label, index) => ({label, value:row => row[index]}))};
    };
    updateDiscrepancyRows(view, source.cached());
    void runDiscrepancyCommand(view, 'refresh');
    return {destroy() { lifetime.abort(); delete root.agdataExcelProvider; }};
}
