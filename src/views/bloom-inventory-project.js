const bloomProjectPresets = {
    grading: ['Move to Open Stock Grade', 'Grade the best plants for an Open Stock lot.'],
    discard: ['Cull & Clean Block', 'Record culls and choose how to clear the block.'],
    hauling: ['Haul to Consolidation', 'Move selected inventory to a consolidation location.'],
    maintenance: ['Spacing / Shear TLC', 'Assign spacing, shearing, or other maintenance.'],
    custom: ['Custom Multi-Task', 'Combine tasks and add project-specific questions.']
};

function bloomProjectDefaultName(preset, row) {
    const item = [row.COMMONNAME || row.ITEMCODE, row.CONTSIZE, row.LOCATIONCODE].filter(Boolean).join(' · ');
    return [bloomProjectPresets[preset][0], item].filter(Boolean).join(' — ').slice(0, 160);
}

function renderBloomProjectPresets(preset) {
    const buttons = Object.entries(bloomProjectPresets).map(([id, [label]]) =>
        `<button type="button" data-project-preset="${id}" aria-pressed="${preset === id}">${esc(label)}</button>`).join('');
    return `<div role="group" aria-label="Quick Task Preset" class="project-preset"><strong>Quick Task Preset</strong>
        <div class="project-preset-options">${buttons}</div>
        <p data-project-preset-description aria-live="polite">${esc(bloomProjectPresets[preset][1])}</p></div>`;
}

function selectBloomProjectPreset(modal, preset) {
    const draft = bloomInventoryProjectDraft;
    if (!draft || draft.busy || draft.owner !== getSupabaseReadIdentityScope() || !Object.hasOwn(bloomProjectPresets, preset)) return;
    const name = modal.querySelector('[name="projectName"]');
    const previousDefault = bloomProjectDefaultName(draft.preset, draft.rows[0]);
    if (!name.value.trim() || name.value === previousDefault) name.value = bloomProjectDefaultName(preset, draft.rows[0]);
    if (preset !== 'custom') {
        for (const task of Object.keys(draft.taskTypes)) draft.taskTypes[task] = task === preset;
    } else Object.assign(draft.taskTypes, draft.customTasks);
    draft.preset = preset;
    draft.parameters.count = draft.parameters.spec = !!draft.taskTypes.grading;
    for (const button of modal.querySelectorAll('[data-project-preset]')) {
        button.setAttribute('aria-pressed', String(button.dataset.projectPreset === preset));
    }
    modal.querySelector('[data-project-preset-description]').textContent = bloomProjectPresets[preset][1];
    syncBloomProjectParameters();
}

export function syncBloomProjectParameters() {
    const modal = document.getElementById('bloom-inventory-project-modal');
    const draft = bloomInventoryProjectDraft;
    if (!modal || !draft) return;
    for (const card of modal.querySelectorAll('[data-project-question]')) {
        const key = card.dataset.projectQuestion;
        const task = Object.hasOwn(draft.taskTypes, key);
        const enabled = task ? draft.taskTypes[key] : draft.parameters[key];
        const custom = draft.preset === 'custom';
        const toggle = card.querySelector('[data-question-toggle]');
        card.hidden = task && !custom && !enabled;
        if (toggle) {
            toggle.checked = !!enabled;
            toggle.hidden = task && !custom;
            toggle.disabled = toggle.hidden;
        }
        const body = card.querySelector('[data-question-body]');
        body.hidden = !enabled;
        for (const control of body.querySelectorAll('input,select,textarea,button')) control.disabled = !enabled;
    }
}

export function renderBloomProjectQuestionCard(key, label, body) {
    const draft = bloomInventoryProjectDraft;
    const enabled = Object.hasOwn(draft.taskTypes, key) ? draft.taskTypes[key] : draft.parameters[key];
    return `<section class="project-question-card" data-project-question="${key}">
        <label class="project-question-heading"><input type="checkbox" data-question-toggle ${enabled ? 'checked' : ''}
            onchange="toggleBloomProjectQuestion(this)"><strong>${label}</strong></label>
        <div class="project-question-body" data-question-body ${enabled ? '' : 'hidden'}>${body}</div>
    </section>`;
}

export function toggleBloomProjectQuestion(input) {
    const draft = bloomInventoryProjectDraft;
    if (!draft || draft.busy) return false;
    const key = input.closest('[data-project-question]').dataset.projectQuestion;
    if (Object.hasOwn(draft.taskTypes, key)) {
        if (draft.preset !== 'custom') return false;
        draft.taskTypes[key] = input.checked;
        draft.customTasks[key] = input.checked;
    } else draft.parameters[key] = input.checked;
    draft.parameters.count = draft.parameters.spec = !!draft.taskTypes.grading;
    syncBloomProjectParameters();
    return false;
}

function bloomProjectInput(label, name, value = '', type = 'text') {
    return `<label class="project-work-field">${label}<input name="${name}" type="${type}" value="${esc(value)}"
        ${type === 'number' ? 'min="1" step="1" required' : ''}></label>`;
}

function bloomProjectSelect(label, name, values, attributes = '') {
    return `<label class="project-work-field">${label}<select name="${name}" ${attributes}>${values.map(([value, text]) =>
        `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
}

function bloomProjectChecks(name, values) {
    return `<div class="project-checks">${values.map(value =>
        `<label class="project-check"><input type="checkbox" name="${name}" value="${esc(value)}">${esc(value)}</label>`).join('')}</div>`;
}

function renderBloomProjectGrading(rows) {
    const count = rows.reduce((sum, row) => sum + (Number(String(row.PTRONHAND ?? 0).replaceAll(',', '')) || 0), 0);
    const lots = [['27.F1', '27.F1'], ['27.S1', '27.S1'], ['', 'Keep Current Lot / Count Only']];
    return renderBloomProjectQuestionCard('grading', 'Grade for Open Stock',
        bloomProjectInput('Grade Best N count', 'task-grade-count', count || rows.length, 'number')
        + bloomProjectSelect('Destination Open Stock Lot', 'task-target-lot', lots)
        + bloomProjectInput('Target Spec', 'task-spec', rows[0].SPEC || '')
        + bloomProjectInput('Target Caliper (optional)', 'task-caliper', rows[0].CALIPER || ''));
}

function renderBloomProjectHauling(rows) {
    const source = fullInventory?.length ? fullInventory : masterInventory || [];
    const destinations = [...new Set(source.map(row => row.LOCATIONCODE || row.locationcode).filter(Boolean))].sort();
    const from = [...new Set(rows.map(row => row.LOCATIONCODE))].join(', ');
    return renderBloomProjectQuestionCard('hauling', 'Hauling / Location Move',
        bloomProjectInput('From Location', 'task-from-location', from)
        + `<label class="project-work-field">Destination Location<input name="destinationZone" list="project-destinations" required>
           <datalist id="project-destinations">${destinations.map(value => `<option value="${esc(value)}">`).join('')}</datalist></label>`
        + bloomProjectChecks('task-equipment', ['Wingding', 'Forklift', 'Trailer']));
}

export function renderBloomProjectTaskConfigurator(rows) {
    return renderBloomProjectGrading(rows)
        + renderBloomProjectQuestionCard('discard', 'Discard / Cull Tracking',
            bloomProjectChecks('task-rejection', ['Under-Spec / Small', 'Rootbound', 'Leaf Quality / Blight', 'Winter Damage', 'Dead / Cull'])
            + bloomProjectSelect('Disposal Method', 'task-disposal', ['Dump Pile', 'Row End', 'Compost'].map(value => [value, value])))
        + renderBloomProjectHauling(rows)
        + renderBloomProjectQuestionCard('maintenance', 'Maintenance / TLC Checklist',
            bloomProjectChecks('task-maintenance', ['Space Cans', 'Shear / Trim', 'Fertilize', 'Weed / Clean Bed', 'Stake / Tie', 'Re-Tag', 'Water'])
            + '<label>Maintenance Instructions<textarea name="task-maintenance-notes" maxlength="4000"></textarea></label>');
}

function renderBloomProjectPicker(name, label, initial = '') {
    return `<label class="bloom-project-field"><span>${esc(label)}</span>
        <input name="${name}" value="${esc(initial)}" readonly autocomplete="off">
        <button type="button" class="bloom-project-picker-trigger" onclick="return toggleBloomProjectPicker(this)">${esc(initial || label)} ▾</button>
        <div class="bloom-project-picker-menu" hidden><input type="search" aria-label="Search options"
            oninput="return filterBloomProjectPicker(this)" onkeydown="handleBloomProjectPickerKey(event,this)">
            <div class="bloom-project-picker-options" data-picker="${name}"></div>
        </div>
    </label>`;
}

function formatBloomProjectDate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function renderBloomProjectSchedule(draft) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return `<div class="project-builder-grid">
        <label>Project Name<input name="projectName" required maxlength="160" value="${esc(bloomProjectDefaultName(draft.preset, draft.rows[0]))}"></label>
        ${renderBloomProjectPicker('assignedTo', 'Assigned User', 'QC Team')}
        ${bloomProjectSelect('Priority', 'priority', ['Normal', 'High', 'Critical'].map(value => [value, value]))}
        <div class="project-builder-dates">
            <label>Start Date<input name="startDate" type="date" required value="${formatBloomProjectDate(today)}"></label>
            <label>Finish By Date<input name="finishByDate" type="date" required value="${formatBloomProjectDate(tomorrow)}"></label>
        </div>
    </div>`;
}

function renderBloomProjectOptions() {
    return `<details class="project-builder-section"><summary>Optional project details</summary>
        ${renderBloomProjectQuestionCard('marking', 'What They Are Marked With',
            bloomProjectSelect('Ribbon / Tag / Stake', 'task-ribbon-preset',
                ['N/A', 'Red Ribbon', 'Blue Ribbon', 'White Ribbon', 'Yellow Ribbon', 'Pink Ribbon', 'Orange Ribbon', 'Tag / Stake'].map(value => [value, value]),
                'onchange="this.form.elements[\'task-ribbon\'].value=this.value"')
            + bloomProjectInput('Custom marking', 'task-ribbon', 'N/A'))}
        ${renderBloomProjectQuestionCard('photo', 'Include Photo Proof on Completion', '<p>Worker may upload a photo when completing.</p>')}
        ${renderBloomProjectQuestionCard('sales', 'For a Sales Rep / Customer / Consignee',
            renderBloomProjectPicker('salesrep', 'Sales Rep Name')
            + renderBloomProjectPicker('customername', 'Customer Name', 'N/A')
            + renderBloomProjectPicker('consigneename', 'Consignee Name', 'N/A'))}
        ${renderBloomProjectQuestionCard('notes', 'Project Instructions / Notes for Worker',
            '<label>Instructions / Notes<textarea name="targetNotes" maxlength="2000"></textarea></label>')}
        <div data-project-saved-fields></div><div data-project-custom-fields></div>
        <button type="button" class="project-add-question" onclick="return addBloomProjectCustomVariable()">Add Custom Question / Variable</button>
    </details>`;
}

function renderBloomInventoryProjectForm(draft) {
    return `<form onsubmit="event.preventDefault();return submitBloomInventoryProject(this)">
        <header class="project-builder-header"><div><h2>Create Inventory Project</h2>${buildBloomProjectSummary(draft.rows)}</div>
            <button type="button" aria-label="Close" onclick="this.closest('dialog').close()">×</button></header>
        <div class="project-builder-body">
            ${renderBloomProjectPresets(draft.preset)}
            ${renderBloomProjectTaskConfigurator(draft.rows)}
            ${renderBloomProjectSchedule(draft)}
            ${renderBloomProjectOptions()}
        </div>
        <footer class="project-builder-footer"><p role="status" data-project-status></p><div>
            <button type="button" onclick="this.closest('dialog').close()">Cancel</button>
            <button type="submit" class="bloom-project-submit">✓ Create Project</button></div></footer>
    </form>`;
}

function createBloomProjectDialog(onPartyChange) {
    const modal = document.createElement('dialog');
    modal.id = 'bloom-inventory-project-modal';
    modal.addEventListener('click', event => {
        const trigger = event.target.closest('[data-project-preset]');
        if (trigger) selectBloomProjectPreset(modal, trigger.dataset.projectPreset);
    });
    modal.addEventListener('change', onPartyChange);
    document.body.appendChild(modal);
    return modal;
}

function fillBloomProjectDirectories(draft) {
    if (draft !== bloomInventoryProjectDraft || draft.owner !== getSupabaseReadIdentityScope()) return;
    setBloomProjectPickerOptions('salesrep', getAllRequestModalRepOptions().map(rep => normalizeRepDisplayOrder(rep.label)));
    setBloomProjectPickerOptions('customername', ['N/A']);
    setBloomProjectPickerOptions('consigneename', ['N/A']);
    setBloomProjectPickerOptions('assignedTo', ['QC Team', 'Eval Team', 'Production Team', ...getAssignableAppUserOptions().map(user => user.username)]);
}

export async function openBloomInventoryProject(items, onPartyChange) {
    const rows = (items || []).filter(Boolean);
    if (!rows.length || isRepReadOnlyUser()) return false;
    ensureQueueInventoryProjectsScope();
    const taskTypes = { grading: true, discard: false, hauling: false, maintenance: false };
    const draft = bloomInventoryProjectDraft = {
        id: crypto.randomUUID(), owner: getSupabaseReadIdentityScope(), rows, pairs: [], busy: false,
        displayId: 'PRJ-' + Date.now().toString().slice(-6), taskTypes, customTasks: { ...taskTypes }, preset: 'grading', mode: 'qc',
        parameters: { priority: true, spec: true, dates: true, assignee: true, goal: false, count: true, marking: true, notes: true, photo: false, sales: false },
        customVariables: []
    };
    const modal = document.getElementById('bloom-inventory-project-modal') || createBloomProjectDialog(onPartyChange);
    modal.innerHTML = renderBloomInventoryProjectForm(draft);
    syncBloomProjectParameters();
    if (!modal.open) modal.showModal();
    renderBloomProjectSavedVariables();
    fillBloomProjectDirectories(draft);
    void Promise.all([ensureRequestRepUserOptionsReady(), ensureAssignableAppUsers()]).then(() => fillBloomProjectDirectories(draft)).catch(() => {});
    ensureQueueInventoryProjectsData();
    void queueInventoryProjectsLoad?.then(() => {
        if (draft === bloomInventoryProjectDraft && draft.owner === getSupabaseReadIdentityScope()) renderBloomProjectSavedVariables();
    });
    return false;
}
