import { createProductionScheduleClient } from '../../services/productionScheduleClient.js';
import { escapeScheduleHtml, renderScheduleCards, renderScheduleDetails, renderScheduleFilters, renderSchedulePager, renderScheduleTabs } from '../../components/managers/ProductionSchedule/render.js';

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;
const STATUS_INTERVAL_MS = 10000;
const STATUS_POLL_WINDOW_MS = 30 * 60 * 1000;
const ROW_CACHE_TTL_MS = 30 * 1000;
const ROW_CACHE_MAX_ENTRIES = 12;
const DETAIL_CACHE_MAX_ROWS = 8;

function makeSheetState() {
  return { q: '', filters: {}, cursors: [null], page: 0, rows: [], nextCursor: null, total: null,
    loaded: false, loading: false, dirty: false, error: '', filtersOpen: false, read: null, rowsKey: '',
    rowsFetchedAt: 0, expandedRows: new Set() };
}

function formatImportedAt(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not imported';
}

function isActiveRun(run) {
  return ['queued', 'running', 'importing', 'staging'].includes(String(run?.status || '').toLowerCase());
}

function describeImportRun(run, sheets) {
  if (run?.status === 'queued') return 'Workbook refresh queued. The last complete snapshot stays visible.';
  const progress = run?.progress;
  const sheet = sheets.find((entry) => Number(entry.index) === Number(progress?.sheetIndex));
  const processed = Number(progress?.processedRows);
  const total = Number(progress?.totalRows);
  if (isActiveRun(run) && sheet && Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
    return `Importing ${sheet.title}: ${processed.toLocaleString()} of ${total.toLocaleString()} source rows. The last complete snapshot stays visible.`;
  }
  if (isActiveRun(run)) return 'Workbook import in progress. The last complete snapshot stays visible.';
  if (run?.status === 'failed') {
    const code = String(run.errorCode || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80);
    return `The latest import failed${code ? ` (${code})` : ''}. The last complete snapshot stays visible; retry the refresh when ready.`;
  }
  return '';
}

export function createProductionSchedulePage() {
  let root = null;
  let client = null;
  let lifecycle = null;
  let observer = null;
  let metadataRead = null;
  let statusRead = null;
  let refreshRead = null;
  let statusTimer = null;
  let searchTimer = null;
  let pollStartedAt = 0;
  let snapshot = null;
  let identityScope = '';
  let sheets = [];
  let activeSheetId = null;
  let run = null;
  let pageError = '';
  let busy = false;
  const bySheet = new Map();
  const rowsCache = new Map();
  const detailRowsCache = new Map();
  const detailReads = new Map();

  function getRowsKey(sheet, state) {
    return JSON.stringify([identityScope, String(snapshot?.id || ''), String(sheet?.id || ''), state.q,
      Object.entries(state.filters).sort(([a], [b]) => a.localeCompare(b)),
      state.cursors[state.page] ?? null, PAGE_SIZE]);
  }

  function rememberRows(key, result) {
    rowsCache.delete(key);
    rowsCache.set(key, { rows: result.rows.slice(), nextCursor: result.nextCursor || null,
      total: result.total ?? null, savedAt: Date.now() });
    while (rowsCache.size > ROW_CACHE_MAX_ENTRIES) rowsCache.delete(rowsCache.keys().next().value);
  }

  function applyCachedRows(state, key, cached) {
    if (!cached) return false;
    rowsCache.delete(key);
    rowsCache.set(key, cached);
    state.rows = cached.rows.slice();
    state.nextCursor = cached.nextCursor;
    state.total = cached.total;
    state.loaded = true;
    state.rowsKey = key;
    state.rowsFetchedAt = Number(cached.savedAt || 0);
    return true;
  }

  function detailKey(sheet, row) {
    return JSON.stringify([identityScope, String(snapshot?.id || ''), String(sheet?.id || ''), String(row?.sourceRow ?? '')]);
  }

  function abortDetailReads(sheetId = null) {
    for (const [key, entry] of detailReads) {
      if (sheetId != null && String(entry.sheetId) === String(sheetId)) continue;
      entry.controller.abort();
      detailReads.delete(key);
    }
  }

  function rememberDetailedRow(key, row) {
    detailRowsCache.delete(key);
    detailRowsCache.set(key, row);
    while (detailRowsCache.size > DETAIL_CACHE_MAX_ROWS) detailRowsCache.delete(detailRowsCache.keys().next().value);
  }

  const getSheet = () => sheets.find((sheet) => String(sheet.id) === String(activeSheetId));
  const getState = (id = activeSheetId) => {
    const key = String(id);
    if (!bySheet.has(key)) bySheet.set(key, makeSheetState());
    return bySheet.get(key);
  };

  function stopTimer(name) {
    if (name === 'status' && statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    if (name === 'search' && searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  }

  function abortReads() {
    metadataRead?.abort(); metadataRead = null;
    statusRead?.abort(); statusRead = null;
    refreshRead?.abort(); refreshRead = null;
    for (const state of bySheet.values()) { state.read?.abort(); state.read = null; state.loading = false; }
    busy = false;
    abortDetailReads();
  }

  function unmount() {
    stopTimer('status'); stopTimer('search'); abortReads();
    observer?.disconnect(); observer = null;
    lifecycle?.abort(); lifecycle = null;
    root = null; client = null;
  }

  function render() {
    if (!root) return;
    const search = root.querySelector('[data-ps-search]');
    const restoreSearch = document.activeElement === search
      ? { start: search.selectionStart, end: search.selectionEnd } : null;
    const sheet = getSheet();
    const state = sheet ? getState() : null;
    const rowsMatchQuery = Boolean(sheet && state && state.rowsKey === getRowsKey(sheet, state));
    const filterCount = state ? Object.values(state.filters).filter(Boolean).length : 0;
    const statusText = describeImportRun(run, sheets)
      || (snapshot ? `Imported ${formatImportedAt(snapshot.importedAt)}` : 'No complete workbook snapshot has been published yet.');
    root.innerHTML = `<section class="ps-page" aria-label="Production Schedule">
      <div class="ps-heading"><div><h2>Production Schedule</h2><p>${escapeScheduleHtml(statusText)}</p></div><div class="ps-heading-actions"><button type="button" data-ps-action="refresh" ${busy || isActiveRun(run) ? 'disabled' : ''}>Refresh workbook</button>${isActiveRun(run) ? '<button type="button" data-ps-action="check-status">Check status</button>' : ''}</div></div>
      ${pageError ? `<div class="ps-error" role="alert">${escapeScheduleHtml(pageError)} <button type="button" data-ps-action="retry">Retry</button></div>` : ''}
      ${sheets.length ? renderScheduleTabs(sheets, activeSheetId) : `<div class="ps-empty">${busy ? 'Loading worksheets…' : 'No worksheets are available yet.'}</div>`}
      ${sheet && state ? `<div class="ps-toolbar"><label class="ps-search-label"><span class="ps-sr-only">Search ${escapeScheduleHtml(sheet.title)}</span><input type="search" data-ps-search placeholder="Search ${escapeScheduleHtml(sheet.title)}…" value="${escapeScheduleHtml(state.q)}" autocomplete="off"></label><button type="button" class="ps-filter-button" data-ps-action="toggle-filters" aria-expanded="${state.filtersOpen}" aria-controls="ps-filters">Filters${filterCount ? ` ${filterCount}` : ''}</button></div>
        ${renderScheduleFilters(sheet, state.filters, state.filtersOpen)}
        <div class="ps-results" aria-live="polite">${state.error ? `<div class="ps-error" role="alert">${escapeScheduleHtml(state.error)} <button type="button" data-ps-action="retry-rows">Retry</button></div>` : ''}${state.loading ? `<div class="ps-progress">${rowsMatchQuery ? 'Refreshing saved rows…' : 'Loading rows…'}</div>` : ''}${rowsMatchQuery ? renderScheduleCards(sheet, state.rows, state.expandedRows, (row) => detailRowsCache.get(detailKey(sheet, row)) || null) : ''}</div>
        ${rowsMatchQuery ? renderSchedulePager(state.page, state.page > 0, Boolean(state.nextCursor), state.total) : ''}` : ''}
    </section>`;
    if (restoreSearch) {
      const replacement = root.querySelector('[data-ps-search]');
      if (replacement) {
        replacement.focus({ preventScroll: true });
        try { replacement.setSelectionRange(restoreSearch.start, restoreSearch.end); } catch (_) { /* search inputs may not support selection */ }
      }
    }
  }

  async function loadRows(id = activeSheetId, { force = false } = {}) {
    const sheet = sheets.find((item) => String(item.id) === String(id));
    if (!root || !sheet || !client) return;
    const state = getState(id);
    const rowsKey = getRowsKey(sheet, state);
    const readIdentityScope = identityScope;
    state.read?.abort();
    state.read = null;
    state.loading = false;
    const controller = new AbortController();
    state.read = controller;
    const cached = rowsCache.get(rowsKey);
    if (state.rowsKey && state.rowsKey !== rowsKey) {
      state.expandedRows.clear();
      abortDetailReads();
    }
    const hasCached = applyCachedRows(state, rowsKey, cached);
    const cacheAge = cached ? Date.now() - Number(cached.savedAt || 0) : Infinity;
    if (hasCached && cacheAge <= ROW_CACHE_TTL_MS && !force) {
      state.dirty = false;
      state.error = '';
      state.read = null;
      render();
      return;
    }
    if (!hasCached && state.rowsKey !== rowsKey) {
      state.expandedRows.clear();
      state.rows = []; state.nextCursor = null; state.total = null; state.loaded = false; state.rowsKey = '';
    }
    state.loading = true;
    state.error = '';
    state.dirty = !cached || Date.now() - Number(cached.savedAt || 0) > ROW_CACHE_TTL_MS;
    render();
    try {
      const result = await client.rows({ sheet, sheetId: sheet.id, q: state.q, filters: state.filters,
        cursor: state.cursors[state.page] ?? null, limit: PAGE_SIZE }, controller.signal);
      if (!root || state.read !== controller || identityScope !== readIdentityScope) return;
      if (snapshot?.id && result.snapshotId && String(result.snapshotId) !== String(snapshot.id)) {
        await loadMetadata();
        return;
      }
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.nextCursor = result.nextCursor || null;
      state.total = result.total;
      state.loaded = true;
      state.dirty = false;
      state.rowsKey = rowsKey;
      state.rowsFetchedAt = Date.now();
      rememberRows(rowsKey, result);
    } catch (error) {
      if (controller.signal.aborted || !root || state.read !== controller || identityScope !== readIdentityScope) return;
      state.error = Number(error?.status) === 401 ? 'Sign in again to open this workbook.'
        : Number(error?.status) === 403 ? 'You do not have access to this workbook.'
        : 'Could not load these rows. The last complete page remains visible.';
    } finally {
      if (state.read === controller) { state.read = null; state.loading = false; render(); }
    }
  }

  async function loadMetadata() {
    if (!root || !client) return;
    const readIdentityScope = identityScope;
    metadataRead?.abort();
    const controller = new AbortController();
    metadataRead = controller;
    busy = true; pageError = '';
    render();
    try {
      const result = await client.metadata(controller.signal);
      if (!root || metadataRead !== controller || identityScope !== readIdentityScope) return;
      const nextSnapshot = result.snapshot || null;
      const changed = String(snapshot?.id || '') !== String(nextSnapshot?.id || '');
      snapshot = nextSnapshot;
      sheets = Array.isArray(result.sheets) ? result.sheets.slice().sort((a, b) => Number(a.index) - Number(b.index)) : [];
      if (changed) {
        rowsCache.clear(); detailRowsCache.clear(); abortDetailReads();
        for (const state of bySheet.values()) {
          state.read?.abort(); state.cursors = [null]; state.page = 0; state.loaded = false;
          state.rows = []; state.nextCursor = null; state.rowsKey = ''; state.rowsFetchedAt = 0; state.expandedRows.clear();
        }
      }
      if (!sheets.some((sheet) => String(sheet.id) === String(activeSheetId))) activeSheetId = sheets[0]?.id ?? null;
      if (activeSheetId != null && (!getState().loaded || getState().dirty
        || Date.now() - Number(getState().rowsFetchedAt || 0) > ROW_CACHE_TTL_MS)) void loadRows();
      void loadStatus(false);
    } catch (error) {
      if (!controller.signal.aborted && root && metadataRead === controller && identityScope === readIdentityScope) pageError = Number(error?.status) === 401
        ? 'Sign in again to open Production Schedule.'
        : Number(error?.status) === 403 ? 'You do not have access to Production Schedule.'
        : 'Could not load Production Schedule metadata.';
    } finally {
      if (metadataRead === controller) { metadataRead = null; busy = false; render(); }
    }
  }

  function scheduleStatusPoll() {
    stopTimer('status');
    if (!root || document.hidden || !isActiveRun(run) || Date.now() - pollStartedAt > STATUS_POLL_WINDOW_MS) return;
    statusTimer = setTimeout(() => { statusTimer = null; void loadStatus(true); }, STATUS_INTERVAL_MS);
  }

  async function loadStatus(continuePolling = false) {
    if (!root || !client) return;
    const readIdentityScope = identityScope;
    statusRead?.abort();
    const controller = new AbortController();
    statusRead = controller;
    try {
      const result = await client.status(controller.signal);
      if (!root || statusRead !== controller || identityScope !== readIdentityScope) return;
      const wasActive = isActiveRun(run);
      run = result.run || null;
      if (isActiveRun(run) && (!pollStartedAt || !wasActive)) pollStartedAt = Date.now();
      if (run?.status === 'ready' && (!snapshot || String(snapshot.id) !== String(run.id))) await loadMetadata();
      else render();
      if (continuePolling || isActiveRun(run)) scheduleStatusPoll();
    } catch (error) {
      if (!controller.signal.aborted && root && statusRead === controller && identityScope === readIdentityScope) {
        pageError = 'Could not check import status. Use Check status to try again.';
        stopTimer('status'); render();
      }
    } finally { if (statusRead === controller) statusRead = null; }
  }

  async function refresh() {
    if (!root || !client || busy || isActiveRun(run)) return;
    const requestIdentityScope = identityScope;
    refreshRead?.abort();
    const controller = new AbortController();
    refreshRead = controller;
    busy = true; pageError = ''; render();
    try {
      const result = await client.refresh(controller.signal);
      if (!root || refreshRead !== controller || identityScope !== requestIdentityScope) return;
      run = result.run || { status: 'queued' };
      pollStartedAt = Date.now();
      scheduleStatusPoll();
    } catch (error) {
      if (controller.signal.aborted || !root || refreshRead !== controller || identityScope !== requestIdentityScope) return;
      pageError = Number(error?.status) === 409 ? 'An import is already running. Check its status.'
        : Number(error?.status) === 403 ? 'You do not have permission to refresh this workbook.'
        : 'Could not start the workbook refresh.';
      if (Number(error?.status) === 409) void loadStatus(false);
    } finally {
      if (refreshRead === controller) { refreshRead = null; busy = false; render(); }
    }
  }

  function resetCurrentQuery() {
    const state = getState();
    abortDetailReads();
    state.read?.abort(); state.read = null; state.loading = false;
    state.cursors = [null]; state.page = 0; state.nextCursor = null;
    state.error = ''; state.dirty = true;
    const requestedSheetId = activeSheetId;
    stopTimer('search');
    searchTimer = setTimeout(() => { searchTimer = null; if (String(activeSheetId) === String(requestedSheetId)) void loadRows(requestedSheetId); }, SEARCH_DELAY_MS);
  }

  function activateSheet(id) {
    stopTimer('search');
    abortDetailReads(id);
    for (const [key, state] of bySheet) {
      if (key === String(id) || !state.read) continue;
      state.read.abort(); state.read = null; state.loading = false; state.dirty = true;
    }
    activeSheetId = id;
    render();
    const state = getState();
    if (!state.loaded || state.dirty || Date.now() - Number(state.rowsFetchedAt || 0) > ROW_CACHE_TTL_MS) void loadRows();
  }

  async function loadRowDetail(sheet, state, row, rowIndex, body, key) {
    if (!root || !client || !snapshot?.id) return;
    detailReads.get(key)?.controller.abort();
    const controller = new AbortController();
    const readIdentityScope = identityScope;
    const readSnapshotId = String(snapshot.id);
    const readQueryKey = state.rowsKey;
    detailReads.set(key, { controller, sheetId: sheet.id, queryKey: readQueryKey });
    try {
      const result = await client.rowDetail({ snapshotId: readSnapshotId, sheetId: sheet.id, sourceRow: row.sourceRow }, controller.signal);
      if (controller.signal.aborted || identityScope !== readIdentityScope || String(snapshot?.id || '') !== readSnapshotId
        || state.rowsKey !== readQueryKey || state.rows[rowIndex] !== row || !root) return;
      if (String(result.snapshotId || '') !== readSnapshotId || !result.row || typeof result.row !== 'object') {
        throw new Error('The source row changed while it was opening. Refresh the worksheet and try again.');
      }
      rememberDetailedRow(key, result.row);
      if (body.isConnected && state.expandedRows.has(String(row.sourceRow))) render();
    } catch (error) {
      if (!controller.signal.aborted && body.isConnected && root && identityScope === readIdentityScope
        && String(snapshot?.id || '') === readSnapshotId && state.rowsKey === readQueryKey
        && state.rows[rowIndex] === row && detailReads.get(key)?.controller === controller) {
        const message = Number(error?.status) === 403 ? 'You do not have access to these source fields.'
          : Number(error?.status) === 404 || Number(error?.status) === 409 ? 'This source row is no longer in the active snapshot. Refresh the worksheet.'
          : 'Could not load the source fields.';
        body.innerHTML = `<p class="ps-error" role="alert">${escapeScheduleHtml(message)} <button type="button" data-ps-action="retry-detail" data-ps-detail-index="${rowIndex}">Retry</button></p>`;
      }
    } finally {
      if (detailReads.get(key)?.controller === controller) detailReads.delete(key);
    }
  }

  function onClick(event) {
    const summary = event.target.closest('summary');
    const details = summary?.closest('[data-ps-detail]');
    if (details && root?.contains(details)) {
      event.preventDefault();
      const state = getState();
      const rowIndex = Number(details.dataset.psDetail);
      if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= state.rows.length) return;
      const row = state.rows[rowIndex];
      const sourceRow = String(row?.sourceRow ?? rowIndex);
      const sheet = getSheet();
      const key = detailKey(sheet, row);
      if (details.open) {
        state.expandedRows.delete(sourceRow);
        detailReads.get(key)?.controller.abort(); detailReads.delete(key);
        details.open = false;
        const body = details.querySelector('[data-ps-detail-body]');
        body?.replaceChildren();
        return;
      }
      state.expandedRows.add(sourceRow);
      while (state.expandedRows.size > DETAIL_CACHE_MAX_ROWS) {
        const oldest = state.expandedRows.values().next().value;
        state.expandedRows.delete(oldest);
        const oldRowIndex = state.rows.findIndex(candidate => String(candidate?.sourceRow ?? '') === oldest);
        const oldRow = state.rows[oldRowIndex];
        if (oldRow) {
          const oldKey = detailKey(sheet, oldRow);
          detailReads.get(oldKey)?.controller.abort(); detailReads.delete(oldKey);
        }
      }
      render();
      const currentDetails = root?.querySelector(`[data-ps-detail="${rowIndex}"]`);
      if (!currentDetails) return;
      const body = currentDetails.querySelector('[data-ps-detail-body]');
      const cached = detailRowsCache.get(key);
      if (cached) {
        detailRowsCache.delete(key); detailRowsCache.set(key, cached);
        if (body) body.innerHTML = renderScheduleDetails(sheet, cached);
      } else if (body) {
        body.innerHTML = '<p class="ps-progress">Loading source fields…</p>';
        void loadRowDetail(sheet, state, row, rowIndex, body, key);
      }
      return;
    }
    const tab = event.target.closest('[data-ps-tab]');
    if (tab && root?.contains(tab)) {
      activateSheet(Number(tab.dataset.psTab));
      return;
    }
    const button = event.target.closest('[data-ps-action]');
    if (!button || !root?.contains(button)) return;
    const action = button.dataset.psAction;
    const state = getState();
    if (action === 'retry-detail') {
      const rowIndex = Number(button.dataset.psDetailIndex);
      const sheet = getSheet();
      const row = state.rows[rowIndex];
      const body = button.closest('[data-ps-detail]')?.querySelector('[data-ps-detail-body]');
      if (sheet && row && body) void loadRowDetail(sheet, state, row, rowIndex, body, detailKey(sheet, row));
    }
    else if (action === 'toggle-filters') { state.filtersOpen = !state.filtersOpen; render(); }
    else if (action === 'clear-filters') { state.filters = {}; resetCurrentQuery(); render(); }
    else if (action === 'next' && state.nextCursor) {
      state.cursors[state.page + 1] = state.nextCursor; state.page += 1; void loadRows();
    } else if (action === 'previous' && state.page > 0) { state.page -= 1; void loadRows(); }
    else if (action === 'retry-rows') void loadRows(activeSheetId, { force: true });
    else if (action === 'retry') void loadMetadata();
    else if (action === 'check-status') { pollStartedAt = Date.now(); void loadStatus(true); }
    else if (action === 'refresh') void refresh();
  }

  function onInput(event) {
    if (event.target.matches('[data-ps-search]')) {
      getState().q = event.target.value;
      resetCurrentQuery();
    }
  }

  function onChange(event) {
    if (!event.target.matches('[data-ps-filter]')) return;
    const state = getState();
    const key = String(Number(event.target.dataset.psFilter));
    if (event.target.value) state.filters[key] = event.target.value;
    else delete state.filters[key];
    resetCurrentQuery(); render();
  }

  function onKeyDown(event) {
    const tab = event.target.closest('[data-ps-tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = sheets.findIndex((sheet) => String(sheet.id) === String(activeSheetId));
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1
      : (index + (event.key === 'ArrowLeft' ? -1 : 1) + sheets.length) % sheets.length;
    activateSheet(sheets[nextIndex]?.id ?? activeSheetId);
    root.querySelector(`[data-ps-tab="${activeSheetId}"]`)?.focus({ preventScroll: true });
  }

  function mount(element, request, requestedIdentityScope = '') {
    if (!element || typeof request !== 'function') return;
    requestedIdentityScope = String(requestedIdentityScope || '');
    if (root === element && identityScope === requestedIdentityScope) return;
    unmount();
    if (identityScope !== requestedIdentityScope) {
      identityScope = requestedIdentityScope;
      snapshot = null; sheets = []; activeSheetId = null; run = null; pageError = ''; busy = false;
      bySheet.clear(); rowsCache.clear(); detailRowsCache.clear(); abortDetailReads();
    }
    root = element; client = createProductionScheduleClient(request);
    lifecycle = new AbortController();
    root.addEventListener('click', onClick, { signal: lifecycle.signal });
    root.addEventListener('input', onInput, { signal: lifecycle.signal });
    root.addEventListener('change', onChange, { signal: lifecycle.signal });
    root.addEventListener('keydown', onKeyDown, { signal: lifecycle.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopTimer('status');
      else if (isActiveRun(run)) void loadStatus(true);
    }, { signal: lifecycle.signal });
    observer = new MutationObserver(() => { if (root && !root.isConnected) unmount(); });
    if (root.parentElement) observer.observe(root.parentElement, { childList: true });
    render();
    void loadMetadata();
  }

  return { mount, unmount };
}

if (typeof window !== 'undefined') window.GncProductionSchedule = createProductionSchedulePage();
