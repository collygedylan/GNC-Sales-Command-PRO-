function managerTableDirectoryItems(items) {
    const order = ['assigned-items','user-role-access','company-directory',
        'customer-assignments','inquiry-coverage','av-note-users','season','season-priority','crop-roll'];
    const schedules = items.filter(item => item.nursery
        || item.section === 'schedule' && !items.some(row => row.id === 'prod-schedule'));
    return [...order.map(key => items.find(item => item.id === key)).filter(Boolean), ...schedules];
}

function renderManagerTableWorkspaceMarkup(content, selected, items, query, escape) {
    const directory = managerTableDirectoryItems(items);
    if (!selected) return renderManagerTableDirectoryMarkup(directory, query, escape);
    const active = items.find(item => item.id === selected);
    const choices = [...directory, ...items.filter(item => item.section === 'archive')];
    const options = choices.map(item => renderManagerTableOption(item,selected,escape)).join('');
    const title = escape(active?.label || selected);
    return `<section id="view-table-management" data-table-directory-mode="table"
        data-selected-table="${escape(selected)}" aria-label="Table Management workspace">
        <nav class="table-management-selector" data-table-selector aria-label="Table navigation">
            <button type="button" data-table-all onclick="return openManagerTableManagement()">← All Tables</button>
            <strong class="table-management-title" title="${title}">${title}</strong>
            <select data-table-switch aria-label="Switch Table" onchange="return openManagerTableManagement(this.value)">
                <option value="" selected disabled>Switch Table ▾</option>${options}
            </select>
        </nav>
        <div class="table-management-workspace" data-table-workspace>${content}</div>
    </section>`;
}

function renderManagerTableOption(item,selected,escape) {
    return `<option value="${escape(item.id)}" data-manager-table-pill="${escape(item.id)}" aria-pressed="${item.id === selected}">${escape(item.label)}</option>`;
}

function renderManagerTableDirectoryMarkup(directory, query, escape) {
    const search = String(query || '').trim().toLowerCase();
    const cards = directory.map(item => renderManagerTableChoice(item,search,escape)).join('');
    return `<section id="view-table-management" data-table-directory-mode="index"
        data-selected-table="" aria-label="Table Management directory">
        <div class="table-management-directory" data-table-directory>${cards}</div>
    </section>`;
}

function renderManagerTableChoice(item,search,escape) {
    const hidden = search && !item.label.toLowerCase().includes(search) ? 'hidden' : '';
    return `<button type="button" class="manager-module-card" data-manager-table-card="${escape(item.id)}" ${hidden}
        onclick="return openManagerTableManagement(this.dataset.managerTableCard)">
        <span class="manager-module-icon" aria-hidden="true"><i class="ph-bold ph-table"></i></span>
        <span class="manager-module-title">${escape(item.label)}</span>
    </button>`;
}
