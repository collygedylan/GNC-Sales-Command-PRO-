import { createProductionScheduleClient } from '../../services/productionScheduleClient.js';
import { escapeScheduleHtml, renderScheduleCards, renderScheduleFilters, renderSchedulePager, renderScheduleTabs } from '../../components/managers/ProductionSchedule/render.js';

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;
const STATUS_INTERVAL_MS = 10000;
const STATUS_POLL_WINDOW_MS = 30 * 60 * 1000;

function makeSheetState() {
  return { q: '', filters: {}, cursors: [null], page: 0, rows: [], nextCursor: null, total: null,
    loaded: false, loading: false, dirty: false, error: '', filtersOpen: false, read: null };
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
  let statusTimer = null;
  let searchTimer = null;
  let pollStartedAt = 0;
  let snapshot = null;
  let sheets = [];
  let activeSheetId = null;
  let run = null;
  let pageError = '';
  let busy = false;
  const bySheet = new Map();

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
    for (const state of bySheet.values()) { state.read?.abort(); state.read = null; }
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
    const filterCount = state ? Object.values(state.filters).filter(Boolean).length : 0;
    const statusText = describeImportRun(run, sheets)
      || (snapshot ? `Imported ${formatImportedAt(snapshot.importedAt)}` : 'No complete workbook snapshot has been published yet.');
    root.innerHTML = `<section class="ps-page" aria-label="Production Schedule">
      <div class="ps-heading"><div><h2>Production Schedule</h2><p>${escapeScheduleHtml(statusText)}</p></div><div class="ps-heading-actions"><button type="button" data-ps-action="refresh" ${busy || isActiveRun(run) ? 'disabled' : ''}>Refresh workbook</button>${isActiveRun(run) ? '<button type="button" data-ps-action="check-status">Check status</button>' : ''}</div></div>
      ${pageError ? `<div class="ps-error" role="alert">${escapeScheduleHtml(pageError)} <button type="button" data-ps-action="retry">Retry</button></div>` : ''}
      ${sheets.length ? renderScheduleTabs(sheets, activeSheetId) : `<div class="ps-empty">${busy ? 'Loading worksheets…' : 'No worksheets are available yet.'}</div>`}
      ${sheet && state ? `<div class="ps-toolbar"><label class="ps-search-label"><span class="ps-sr-only">Search ${escapeScheduleHtml(sheet.title)}</span><input type="search" data-ps-search placeholder="Search ${escapeScheduleHtml(sheet.title)}…" value="${escapeScheduleHtml(state.q)}" autocomplete="off"></label><button type="button" class="ps-filter-button" data-ps-action="toggle-filters" aria-expanded="${state.filtersOpen}" aria-controls="ps-filters">Filters${filterCount ? ` ${filterCount}` : ''}</button></div>
        ${renderScheduleFilters(sheet, state.filters, state.filtersOpen)}
        <div class="ps-results" aria-live="polite">${state.error ? `<div class="ps-error" role="alert">${escapeScheduleHtml(state.error)} <button type="button" data-ps-action="retry-rows">Retry</button></div>` : ''}${state.loading ? '<div class="ps-progress">Loading rows…</div>' : ''}${state.loaded ? renderScheduleCards(sheet, state.rows) : ''}</div>
        ${state.loaded ? renderSchedulePager(state.page, state.page > 0, Boolean(state.nextCursor), state.total) : ''}` : ''}
    </section>`;
    if (restoreSearch) {
      const replacement = root.querySelector('[data-ps-search]');
      if (replacement) {
        replacement.focus({ preventScroll: true });
        try { replacement.setSelectionRange(restoreSearch.start, restoreSearch.end); } catch (_) { /* search inputs may not support selection */ }
      }
    }
  }

  async function loadRows(id = activeSheetId) {
    const sheet = sheets.find((item) => String(item.id) === String(id));
    if (!root || !sheet || !client) return;
    const state = getState(id);
    state.read?.abort();
    const controller = new AbortController();
    state.read = controller;
    state.loading = true;
    state.error = '';
    render();
    try {
      const result = await client.rows({ sheetId: sheet.id, q: state.q, filters: state.filters,
        cursor: state.cursors[state.page] ?? null, limit: PAGE_SIZE }, controller.signal);
      if (!root || state.read !== controller) return;
      if (snapshot?.id && result.snapshotId && String(result.snapshotId) !== String(snapshot.id)) {
        await loadMetadata();
        return;
      }
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.nextCursor = result.nextCursor || null;
      state.total = result.total;
      state.loaded = true;
      state.dirty = false;
    } catch (error) {
      if (controller.signal.aborted || !root) return;
      state.error = Number(error?.status) === 401 ? 'Sign in again to open this workbook.'
        : Number(error?.status) === 403 ? 'You do not have access to this workbook.'
        : 'Could not load these rows. The last complete page remains visible.';
    } finally {
      if (state.read === controller) { state.read = null; state.loading = false; render(); }
    }
  }

  async function loadMetadata() {
    if (!root || !client) return;
    metadataRead?.abort();
    const controller = new AbortController();
    metadataRead = controller;
    busy = true; pageError = '';
    render();
    try {
      const result = await client.metadata(controller.signal);
      if (!root || metadataRead !== controller) return;
      const nextSnapshot = result.snapshot || null;
      const changed = String(snapshot?.id || '') !== String(nextSnapshot?.id || '');
      snapshot = nextSnapshot;
      sheets = Array.isArray(result.sheets) ? result.sheets.slice().sort((a, b) => Number(a.index) - Number(b.index)) : [];
      if (changed) {
        for (const state of bySheet.values()) {
          state.read?.abort(); state.cursors = [null]; state.page = 0; state.loaded = false;
          state.rows = []; state.nextCursor = null;
        }
      }
      if (!sheets.some((sheet) => String(sheet.id) === String(activeSheetId))) activeSheetId = sheets[0]?.id ?? null;
      if (activeSheetId != null && !getState().loaded) void loadRows();
      void loadStatus(false);
    } catch (error) {
      if (!controller.signal.aborted && root) pageError = Number(error?.status) === 401
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
    statusRead?.abort();
    const controller = new AbortController();
    statusRead = controller;
    try {
      const result = await client.status(controller.signal);
      if (!root || statusRead !== controller) return;
      const wasActive = isActiveRun(run);
      run = result.run || null;
      if (isActiveRun(run) && (!pollStartedAt || !wasActive)) pollStartedAt = Date.now();
      if (run?.status === 'ready' && (!snapshot || String(snapshot.id) !== String(run.id))) await loadMetadata();
      else render();
      if (continuePolling || isActiveRun(run)) scheduleStatusPoll();
    } catch (error) {
      if (!controller.signal.aborted && root) {
        pageError = 'Could not check import status. Use Check status to try again.';
        stopTimer('status'); render();
      }
    } finally { if (statusRead === controller) statusRead = null; }
  }

  async function refresh() {
    if (!root || !client || busy || isActiveRun(run)) return;
    busy = true; pageError = ''; render();
    try {
      const result = await client.refresh();
      if (!root) return;
      run = result.run || { status: 'queued' };
      pollStartedAt = Date.now();
      scheduleStatusPoll();
    } catch (error) {
      if (!root) return;
      pageError = Number(error?.status) === 409 ? 'An import is already running. Check its status.'
        : Number(error?.status) === 403 ? 'You do not have permission to refresh this workbook.'
        : 'Could not start the workbook refresh.';
      if (Number(error?.status) === 409) void loadStatus(false);
    } finally { busy = false; render(); }
  }

  function resetCurrentQuery() {
    const state = getState();
    state.read?.abort(); state.cursors = [null]; state.page = 0; state.nextCursor = null;
    state.error = ''; state.dirty = true;
    const requestedSheetId = activeSheetId;
    stopTimer('search');
    searchTimer = setTimeout(() => { searchTimer = null; if (String(activeSheetId) === String(requestedSheetId)) void loadRows(requestedSheetId); }, SEARCH_DELAY_MS);
  }

  function activateSheet(id) {
    stopTimer('search');
    for (const [key, state] of bySheet) {
      if (key === String(id) || !state.read) continue;
      state.read.abort(); state.read = null; state.loading = false; state.dirty = true;
    }
    activeSheetId = id;
    render();
    const state = getState();
    if (!state.loaded || state.dirty) void loadRows();
  }

  function onClick(event) {
    const tab = event.target.closest('[data-ps-tab]');
    if (tab && root?.contains(tab)) {
      activateSheet(Number(tab.dataset.psTab));
      return;
    }
    const button = event.target.closest('[data-ps-action]');
    if (!button || !root?.contains(button)) return;
    const action = button.dataset.psAction;
    const state = getState();
    if (action === 'toggle-filters') { state.filtersOpen = !state.filtersOpen; render(); }
    else if (action === 'clear-filters') { state.filters = {}; resetCurrentQuery(); render(); }
    else if (action === 'next' && state.nextCursor) {
      state.cursors[state.page + 1] = state.nextCursor; state.page += 1; void loadRows();
    } else if (action === 'previous' && state.page > 0) { state.page -= 1; void loadRows(); }
    else if (action === 'retry-rows') void loadRows();
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

  function mount(element, request) {
    if (!element || typeof request !== 'function') return;
    if (root === element) return;
    unmount();
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
