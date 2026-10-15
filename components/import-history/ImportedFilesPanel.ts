import type { ImportHistoryDataset, ImportHistoryRow, ImportHistorySnapshot } from '../../services/importHistory';

export type ImportedFilesPanelState = {
  dataset: ImportHistoryDataset;
  files: ImportHistorySnapshot[];
  hasMoreFiles: boolean;
  hasPreviousFiles: boolean;
  filePageNumber: number;
  filesLoading: boolean;
  rows: ImportHistoryRow[];
  rowsLoading: boolean;
  rowsRefreshing: boolean;
  rowsError: string;
  filesError: string;
  selectedSnapshotId: string;
  selectedSnapshot: ImportHistorySnapshot | null;
  selectedColumnIndexes: number[];
  columnError: string;
  columnSearch: string;
  rowCount: number;
  pageNumber: number;
  pageCount: number;
  hasPrevious: boolean;
  hasMoreRows: boolean;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[value]'; }
  }
  return String(value);
}

export function renderImportedFilesPanel(state: ImportedFilesPanelState): string {
  const selectedSnapshot = state.files.find(file => file.snapshotId === state.selectedSnapshotId) || state.selectedSnapshot;
  const selected = new Set(state.selectedColumnIndexes);
  const columns = selectedSnapshot?.columns || [];
  const displayColumn = (column: string, index: number) => column.trim() ? column : `Column ${index + 1}`;
  const selectedColumns = columns.map((_, index) => index).filter(index => selected.has(index));
  const visibleColumnChoices = columns.map((column, index) => ({ column, index, label: displayColumn(column, index) }))
    .filter(item => !state.columnSearch || item.label.toLowerCase().includes(state.columnSearch.trim().toLowerCase()));
  const options = visibleColumnChoices.slice(0, 32).map(({ column, index, label }) => `<label data-import-column="${escapeHtml(label.toLowerCase())}" data-column-index="${index}" class="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border ${selected.has(index) ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'} px-3 py-2 text-[10px] font-bold text-slate-700"><input type="checkbox" class="h-4 w-4 accent-emerald-600" ${selected.has(index) ? 'checked' : ''} onchange="return toggleManagerImportedHistoryColumn(Number(this.closest('label').getAttribute('data-column-index')), this.checked)"><span class="truncate">${escapeHtml(label)}</span></label>`).join('');
  const positions = selectedColumns.length ? selectedColumns : columns.map((_, index) => index).slice(0, 8);
  const table = state.rows.length && selectedSnapshot
    ? `<div class="max-h-[65vh] overflow-auto rounded-xl border border-emerald-100 bg-white"><table class="min-w-full border-collapse text-left"><thead class="sticky top-0 z-10 bg-emerald-50"><tr>${positions.map(index => `<th class="whitespace-nowrap border-b border-emerald-100 px-3 py-2 text-[10px] font-black uppercase text-emerald-800">${escapeHtml(displayColumn(columns[index], index))}</th>`).join('')}</tr></thead><tbody>${state.rows.map(row => `<tr class="border-b border-slate-100">${positions.map(position => `<td class="max-w-[360px] break-words px-3 py-2 text-xs font-semibold text-slate-700">${escapeHtml(displayValue(row.values[position]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '';
  const empty = !selectedSnapshot ? 'Choose a source and snapshot to inspect imported rows.'
    : state.rowsLoading && !state.rows.length ? 'Loading imported rows…'
      : state.rows.length ? '' : 'This snapshot has no rows.';
  const fileOptions = state.files.slice();
  if (selectedSnapshot && !fileOptions.some(file => file.snapshotId === selectedSnapshot.snapshotId)) fileOptions.unshift(selectedSnapshot);
  const filesOptions = fileOptions.map(file => `<option value="${escapeHtml(file.snapshotId)}" ${file.snapshotId === state.selectedSnapshotId ? 'selected' : ''}>${escapeHtml(file.displayLabel)} · ${Number(file.rowCount).toLocaleString()} rows</option>`).join('');
  const filesError = state.filesError ? `<div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><span>${escapeHtml(state.filesError)}</span><button type="button" class="ml-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase" onclick="return loadManagerImportedHistoryFiles(true)">Retry</button></div>` : '';
  const rowsError = state.rowsError ? `<div role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"><span>${escapeHtml(state.rowsError)}</span><button type="button" class="ml-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase" onclick="return loadManagerImportedHistoryRows(true)">Retry</button></div>` : '';
  const columnChooser = selectedSnapshot ? `<details class="rounded-xl border border-slate-200 bg-white p-3"><summary class="cursor-pointer text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">Columns (${selectedColumns.length || Math.min(8, columns.length)} shown)</summary><div class="mt-3"><input type="search" class="mb-3 min-h-[40px] w-full rounded-lg border border-slate-200 px-3 text-sm" placeholder="Find a source column" value="${escapeHtml(state.columnSearch)}" oninput="return setManagerImportedHistoryColumnSearch(this.value)"><div class="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">${options}</div>${visibleColumnChoices.length > 32 ? `<div class="mt-2 text-[10px] font-semibold text-slate-500">Showing 32 of ${visibleColumnChoices.length}. Search to find another column.</div>` : ''}${state.columnError ? `<div role="alert" class="mt-2 text-xs font-bold text-red-700">${escapeHtml(state.columnError)}</div>` : ''}</div></details>` : '';
  const rowRange = state.rowCount ? `Rows ${((state.pageNumber - 1) * 50 + 1).toLocaleString()}–${Math.min(state.pageNumber * 50, state.rowCount).toLocaleString()} of ${state.rowCount.toLocaleString()}` : '0 rows';

  return `<section class="space-y-4" aria-label="Imported files history">
    <div class="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div class="text-[10px] font-black uppercase tracking-[0.14em] text-[#007a4d]">Imported Files</div><div class="mt-1 text-xs font-semibold text-slate-500">Browse immutable Drive, Docks, and Reserves snapshots.</div></div><button type="button" class="min-h-[40px] rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-black uppercase text-emerald-800 ${state.filesLoading ? 'pointer-events-none opacity-60' : ''}" onclick="return loadManagerImportedHistoryFiles(true)" ${state.filesLoading ? 'disabled' : ''}>${state.filesLoading ? 'Refreshing…' : 'Refresh'}</button></div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2"><label class="text-[10px] font-black uppercase text-slate-500">Source<select class="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800" onchange="return setManagerImportedHistoryDataset(this.value)"><option value="drive" ${state.dataset === 'drive' ? 'selected' : ''}>Drive</option><option value="soc" ${state.dataset === 'soc' ? 'selected' : ''}>Docks (SOC)</option><option value="reserves" ${state.dataset === 'reserves' ? 'selected' : ''}>Reserves</option></select></label><label class="text-[10px] font-black uppercase text-slate-500">Snapshot<select class="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800" onchange="return selectManagerImportedHistorySnapshot(this.value)" ${state.filesLoading && !state.files.length ? 'disabled' : ''}><option value="">Select snapshot…</option>${filesOptions}</select></label></div>
      ${state.hasPreviousFiles || state.hasMoreFiles ? `<div class="mt-3 flex items-center justify-between gap-2"><button type="button" class="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase text-slate-600 ${!state.hasPreviousFiles || state.filesLoading ? 'pointer-events-none opacity-50' : ''}" onclick="return loadManagerImportedHistoryPreviousFiles()" ${!state.hasPreviousFiles || state.filesLoading ? 'disabled' : ''}>Newer</button><span class="text-xs font-bold text-slate-500">Snapshot page ${state.filePageNumber}</span><button type="button" class="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase text-slate-600 ${!state.hasMoreFiles || state.filesLoading ? 'pointer-events-none opacity-50' : ''}" onclick="return loadManagerImportedHistoryFiles(false)" ${!state.hasMoreFiles || state.filesLoading ? 'disabled' : ''}>${state.filesLoading ? 'Loading…' : 'Older snapshots'}</button></div>` : ''}
    </div>
    ${filesError}${rowsError}
    ${selectedSnapshot ? `<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase text-emerald-800"><span>${escapeHtml(selectedSnapshot.displayLabel)} · ${selectedSnapshot.rowCount.toLocaleString()} source rows</span><span>${escapeHtml(rowRange)}${state.rowsRefreshing ? ' · Refreshing' : ''}</span></div>` : ''}
    ${columnChooser}
    ${table ? `<div class="space-y-3">${table}<div class="flex items-center justify-between gap-3"><button type="button" class="min-h-[42px] rounded-lg border border-slate-200 bg-white px-4 text-[10px] font-black uppercase text-slate-600 ${!state.hasPrevious || state.rowsLoading ? 'pointer-events-none opacity-50' : ''}" onclick="return loadManagerImportedHistoryPreviousPage()" ${!state.hasPrevious || state.rowsLoading ? 'disabled' : ''}>Previous</button><span class="text-xs font-bold text-slate-500">Page ${state.pageNumber} of ${state.pageCount}</span><button type="button" class="min-h-[42px] rounded-lg border border-slate-200 bg-white px-4 text-[10px] font-black uppercase text-slate-600 ${!state.hasMoreRows || state.rowsLoading ? 'pointer-events-none opacity-50' : ''}" onclick="return loadManagerImportedHistoryNextPage()" ${!state.hasMoreRows || state.rowsLoading ? 'disabled' : ''}>${state.rowsLoading ? 'Loading…' : 'Next'}</button></div></div>` : `<div class="rounded-2xl border border-dashed border-slate-200 bg-white p-7 text-center text-sm font-bold text-slate-500">${escapeHtml(empty)}</div>`}
  </section>`;
}
