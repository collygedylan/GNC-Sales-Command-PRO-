import { columnName, getScheduleCard, getScheduleRowDetails } from '../../../services/productionScheduleSheets.js';

export function escapeScheduleHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function filterColumns(sheet) {
  const supplied = Array.isArray(sheet?.filterColumns) ? sheet.filterColumns : [];
  if (supplied.length) return supplied;
  const columns = Array.isArray(sheet?.columns) ? sheet.columns : [];
  return [
    sheet?.categoryColumn ? { index: sheet.categoryColumn, header: columns.find((item) => item.index === sheet.categoryColumn)?.header || 'Category', options: sheet.categoryOptions } : null,
    sheet?.statusColumn ? { index: sheet.statusColumn, header: 'Status', options: sheet.statusOptions } : null,
  ].filter(Boolean);
}

export function renderScheduleTabs(sheets, activeId) {
  return `<div class="ps-tabs" role="tablist" aria-label="Production Schedule worksheets">${sheets.map((sheet) => {
    const selected = String(sheet.id) === String(activeId);
    return `<button type="button" role="tab" class="ps-tab" data-ps-tab="${escapeScheduleHtml(sheet.id)}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${escapeScheduleHtml(sheet.title)}<span class="ps-tab-count">${Number(sheet.rowCount || 0).toLocaleString()}</span></button>`;
  }).join('')}</div>`;
}

export function renderScheduleFilters(sheet, selected = {}, open = false) {
  const fields = filterColumns(sheet);
  if (!fields.length) return `<div class="ps-filters" id="ps-filters" ${open ? '' : 'hidden'}><p>No source filters are available on this sheet.</p></div>`;
  return `<div class="ps-filters" id="ps-filters" ${open ? '' : 'hidden'}>${fields.map((field) => {
    const column = Number(field.index);
    const label = sheet.title === 'ContTable' && column === Number(sheet.statusColumn)
      ? 'Status (Stat)' : String(field.header || `Column ${columnName(column)}`).replace(/\s+/g, ' ').trim();
    const options = Array.isArray(field.options) ? field.options : [];
    const current = String(selected[String(column)] || '');
    return `<label class="ps-filter-label">${escapeScheduleHtml(label)}<select data-ps-filter="${column}" aria-label="${escapeScheduleHtml(label)}"><option value="">All</option>${options.map((value) => `<option value="${escapeScheduleHtml(value)}" ${String(value) === current ? 'selected' : ''}>${escapeScheduleHtml(value)}</option>`).join('')}</select></label>`;
  }).join('')}<button type="button" class="ps-clear" data-ps-action="clear-filters">Clear filters</button></div>`;
}

export function renderScheduleCards(sheet, rows) {
  if (!rows.length) return '<div class="ps-empty">No rows match this sheet’s search and filters.</div>';
  return rows.map((row) => {
    const card = getScheduleCard(sheet, row);
    const details = getScheduleRowDetails(sheet, row);
    return `<article class="ps-card"><div class="ps-card-heading"><strong>${escapeScheduleHtml(card.title)}</strong><span class="ps-source-row">Row ${escapeScheduleHtml(card.sourceRow)}</span></div>${card.fields.length ? `<dl class="ps-card-fields">${card.fields.map((field) => `<div><dt>${escapeScheduleHtml(field.label)}</dt><dd>${escapeScheduleHtml(field.value)}</dd></div>`).join('')}</dl>` : ''}<details class="ps-details"><summary>All source fields <span>${details.length}</span></summary><dl>${details.map((field) => `<div><dt>${escapeScheduleHtml(field.label)} <small>${escapeScheduleHtml(columnName(field.index))}</small></dt><dd>${escapeScheduleHtml(field.value)}</dd></div>`).join('')}</dl></details></article>`;
  }).join('');
}

export function renderSchedulePager(page, canPrevious, canNext, total) {
  const shownTotal = Number.isFinite(Number(total)) ? `${Number(total).toLocaleString()} matching rows` : 'Matching rows';
  return `<nav class="ps-pager" aria-label="Schedule pages"><button type="button" data-ps-action="previous" ${canPrevious ? '' : 'disabled'}>Previous</button><span>Page ${page + 1} · ${shownTotal}</span><button type="button" data-ps-action="next" ${canNext ? '' : 'disabled'}>Next</button></nav>`;
}
