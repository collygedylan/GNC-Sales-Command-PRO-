import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ReportPageSessionProvider, useReportPage } from '../../services/reportPages';
import { renderIdentity } from '../../services/renderIdentity.mjs';

const codeOf = row => String(row?.ITEMCODE || '').trim().toUpperCase();
const idOf = row => String(row?.MASTER_UNIQUE_ID || row?.UNIQUE_ID || '');
const textOf = value => value == null || value === '' ? '—' : String(value);
const numberOf = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
const isAssigned = row => !!String(row?.ASSIGNEDTO || '').trim();
const EMPTY_SET = new Set();

function AssignedItemsReportPage({ source, offset, onPage }) {
  const pageSize = Math.max(1, Math.min(100, Number(source.pageSize) || 100));
  const { sourceRevision: queryRevision, ...baseQuery } = source.query;
  const sourceRevision = offset > 0 ? source.sourceRevision || queryRevision : '';
  const query = { ...baseQuery, offset, limit: pageSize, ...(sourceRevision ? { sourceRevision } : {}) };
  const { data, error, isLoading, isValidating } = useReportPage(source.session, query);
  const normalizedData = useMemo(() => data && source.normalizeRow
    ? { ...data, rows: data.rows.map((row, index) => source.normalizeRow(row, offset + index)).filter(Boolean) }
    : data, [data, source.normalizeRow, offset]);
  useLayoutEffect(() => {
    onPage(offset, { data: normalizedData, error, isLoading, isValidating });
    source.onPageState?.(normalizedData, offset, { error, isLoading, isValidating });
  }, [offset, normalizedData, error, isLoading, isValidating, onPage, source.onPageState]);
  return null;
}

function assignmentOverride(row) {
  const reason = String(row?.assignment_reason || row?.ASSIGNMENT_REASON || '');
  if (reason === 'zone_zoe') return 'Zoe';
  if (reason === 'zone_mitch_rose') return 'Mitch';
  return '';
}


const DefaultOwner = memo(function DefaultOwner({ code, rowId, value, options, draft, disabled, pending, override, onChange }) {
  const selectedValue = draft?.assignedto ?? value ?? '';
  const ownerOptions = options.some(option => String(option.value) === String(selectedValue)) || !selectedValue
    ? options : [{ value: selectedValue, label: `${selectedValue} (inactive; review)` }, ...options];
  return <div className="ai-owner-control" aria-busy={pending || undefined}>
    <select className="min-h-[40px] w-full rounded-lg border border-emerald-200 bg-white px-2 py-1 text-xs font-black text-slate-900 disabled:opacity-60" aria-label={`Itemcode Default Owner ${code} row ${rowId}`} data-itemcode={code} value={selectedValue} disabled={disabled || pending} onChange={event => onChange(code, event.target.value)}>
      {ownerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {override && <div className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-900" title={`The location rule sets this row to ${override}. The itemcode default applies outside the override area.`}>Location Override: {override}</div>}
    {draft?.error && <div role="alert" className="mt-1 text-xs text-red-700">{draft.error} Your choice is retained. Refresh and review current ownership before retrying.<button type="button" className="mt-2 min-h-[44px] rounded-lg border border-red-300 bg-white px-3 text-[10px] font-black uppercase text-red-800 disabled:opacity-50" aria-label={`Retry owner save for ${code}`} data-retry-owner-save={code} disabled={disabled || pending} onMouseDown={event => event.preventDefault()} onClick={() => onChange(code, draft.assignedto)}>Retry owner save</button></div>}
  </div>;
});

const LowStock = memo(function LowStock({ code, state, onDraft, onSave, onReset }) {
  const target = state.targets?.get(code) || null;
  const fallback = Number.isFinite(Number(state.fallback)) ? Number(state.fallback) : 150;
  const value = state.drafts?.has(code) ? state.drafts.get(code) : target?.manual_override_qty ?? 150;
  const saving = state.saving?.has(code), canEdit = state.canEdit && state.snapshotCurrent;
  return <div className="manager-item-low-stock-editor ai-low-stock-editor">
    <input type="text" inputMode="numeric" autoComplete="off" aria-label={`Low-stock target ${code}`} data-low-stock-override={code} value={String(value)} disabled={!canEdit || saving} onChange={event => onDraft(code, event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSave(code); } }} />
    {canEdit ? <div className="mt-1 flex flex-wrap gap-1"><button type="button" className="min-h-[44px] rounded-lg bg-[#007a4d] px-3 text-[9px] font-black uppercase text-white disabled:opacity-50" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => onSave(code)}>{saving ? 'Saving' : 'Save'}</button></div> : <div className="mt-1 text-[10px] font-bold text-slate-500">Read only</div>}
    {state.error && <div role="status" className="mt-1 text-[10px] font-bold text-amber-900">{state.error}</div>}
  </div>;
});

const Row = memo(function Row({ row, columns, canManageAssignments, snapshotCurrent, options, ownerDraft, pendingOwner, selected, lowStockState, handlers, getReason, index, measure, historyExpanded, onToggleHistory }) {
  const code = codeOf(row), rowId = idOf(row), override = assignmentOverride(row);
  const ownerDisabled = !canManageAssignments || !snapshotCurrent;
  const cell = field => {
    if (field === 'DEFAULT_ASSIGNEDTO') return <DefaultOwner code={code} rowId={rowId} value={row.DEFAULT_ASSIGNEDTO} options={options} draft={ownerDraft} disabled={ownerDisabled} pending={pendingOwner} override={override} onChange={handlers.onDefaultChange} />;
    if (field === 'AVG_ORDER_QTY') { const target = lowStockState.targets?.get(code) || null; return <div><span data-manager-item-average={code} className="font-black text-slate-900">{numberOf(target?.mean_quantity ?? row.AVG_ORDER_QTY ?? 0)}</span></div>; }
    if (field === 'LOW_STOCK_TARGET') return <LowStock code={code} state={{ ...lowStockState, snapshotCurrent }} onDraft={handlers.onLowStockDraft} onSave={handlers.onLowStockSave} onReset={handlers.onLowStockReset} />;
    if (field === 'ASSIGNMENT_REASON') return <div data-assignment-reason={row.assignment_reason || row.ASSIGNMENT_REASON || ''} className={`text-[10px] font-bold ${row.review_required ? 'text-amber-800' : 'text-emerald-700'}`}>{String(getReason?.(row) || row.assignment_reason || row.ASSIGNMENT_REASON || 'Assignment pending reconciliation')}</div>;
    if (field === 'LOTCODE') return <span>{textOf(row.LOTCODE)}</span>;
    return <span>{field === 'ASSIGNEDTO' ? textOf(ownerDraft && !ownerDraft.error && !override ? ownerDraft.assignedto || 'Unassigned' : row[field] || 'Unassigned') : textOf(row[field])}</span>;
  };
  const checked = selected.has(code);
  return <tr ref={measure} aria-rowindex={index + 2} data-manager-assigned-item-row data-index={index} data-virtual-index={index} data-inventory-id={rowId} className="border-b border-slate-100">
    {canManageAssignments && <td className="px-3 py-2"><input type="checkbox" className="h-5 w-5 rounded border-slate-300 text-[#007a4d]" aria-label={`Select ${code || 'item'} for bulk assignment`} data-itemcode={code} checked={checked} disabled={!snapshotCurrent} onChange={event => handlers.onSelect(code, event.target.checked)} /></td>}
    {columns.map(([field]) => <td key={field} className="px-3 py-2 align-top">{cell(field)}</td>)}
  </tr>;
});

const Card = memo(function Card({ row, columns, canManageAssignments, snapshotCurrent, options, ownerDraft, pendingOwner, selected, lowStockState, handlers, getReason, index, measure, expanded, onToggle, historyExpanded, onToggleHistory }) {
  const code = codeOf(row), rowId = idOf(row), override = assignmentOverride(row);
  const label = `${row.COMMONNAME || 'Item'} · ${row.CONTSIZE || '—'}`;
  return <article ref={measure} data-manager-assigned-item-card data-index={index} data-virtual-index={index} data-inventory-id={rowId} className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
    <div className="flex w-full min-w-0 items-start justify-between gap-3 text-left"><span className="min-w-0"><span className="block break-all text-[12px] font-black text-[#1d4ed8]">{code || '—'}</span><span className="mt-1 block break-words text-base font-black leading-5 text-slate-900">{textOf(row.COMMONNAME)}</span></span><span className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-[#007a4d]">{textOf(row.CONTSIZE)}</span></div>
    <div className="mt-3 grid min-w-0 grid-cols-2 gap-2 text-[11px] font-bold"><Info label="Location" value={row.LOCATIONCODE} /><Info label="Warehouse" value={row.WAREHOUSEI} /></div>
    <div className="mt-3 grid min-w-0 grid-cols-2 gap-2"><div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><div className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Average Order Qty</div><div data-manager-item-average={code} className="mt-0.5 break-all text-slate-800">{numberOf(lowStockState.targets?.get(code)?.mean_quantity)}</div></div><div className="min-w-0 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2"><div className="text-[9px] font-black uppercase tracking-[0.1em] text-emerald-800">Low Stock Qty</div><LowStock code={code} state={{ ...lowStockState, snapshotCurrent }} onDraft={handlers.onLowStockDraft} onSave={handlers.onLowStockSave} onReset={handlers.onLowStockReset} /></div></div>
    <div className="mt-3 min-w-0"><div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">Effective Worker</div><div className="mt-1 break-all text-sm font-black text-slate-900">{textOf(row.ASSIGNEDTO || 'Unassigned')}</div><div data-assignment-reason={row.assignment_reason || row.ASSIGNMENT_REASON || ''} className={`mt-1 text-[10px] font-bold ${row.review_required ? 'text-amber-800' : 'text-emerald-700'}`}>{String(getReason?.(row) || row.assignment_reason || row.ASSIGNMENT_REASON || 'Assignment pending reconciliation')}</div><div className="mt-3"><DefaultOwner code={code} rowId={rowId} value={row.DEFAULT_ASSIGNEDTO} options={options} draft={ownerDraft} disabled={!canManageAssignments || !snapshotCurrent} pending={pendingOwner} override={override} onChange={handlers.onDefaultChange} /></div><div className="mt-2 text-xs text-slate-500">Lot: {textOf(row.LOTCODE)}</div></div>
    {canManageAssignments && <label className="mt-3 flex min-h-[46px] items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700"><input type="checkbox" className="h-6 w-6 shrink-0" data-itemcode={code} checked={selected.has(code)} disabled={!snapshotCurrent} onChange={event => handlers.onSelect(code, event.target.checked)} /><span>Select for bulk assignment</span></label>}
    <button type="button" className="mt-3 min-h-[44px] rounded-lg border border-slate-200 px-3 text-[10px] font-black uppercase text-slate-600" aria-expanded={expanded} onClick={() => onToggle(rowId)}>More item details</button>
    {expanded && <dl className="mt-2 grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-[11px]" aria-label={`Details for ${label}`}><Info label="Genus" value={row.GENUSNAME} /><Info label="Source" value={row.SOURCE} /></dl>}
  </article>;
});

function Info({ label, value }) { return <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><div className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</div><div className="mt-0.5 break-all text-slate-800">{textOf(value)}</div></div>; }

function AssignedItemsView(props) {
  const hostRef = useRef(null), tableScrollRef = useRef(null), propsRef = useRef(props), [layout, setLayout] = useState('desktop'), [scrollMargin, setScrollMargin] = useState(0), [expanded, setExpanded] = useState(() => new Set(props.uiState?.expanded || [])), [pinnedRowId, setPinnedRowId] = useState('');
  const pageSource = props.pageSource || null, pageSize = Math.max(1, Math.min(100, Number(pageSource?.pageSize) || 100));
  const pageQueryKey = pageSource ? pageSource.session.key(pageSource.query) : '';
  const [pageCollection, setPageCollection] = useState(() => ({ key: pageQueryKey, pages: new Map(), total: null, revision: '', error: null }));
  const visiblePageOffsetsRef = useRef(new Set());
  const pageState = pageCollection.key === pageQueryKey ? pageCollection : { key: pageQueryKey, pages: new Map(), total: null, revision: '', error: null };
  const snapshotCurrent = pageSource ? !!pageState.revision && !pageState.error : !!props.snapshotCurrent;
  const pageRows = pageState.pages;
  const pageError = pageState.error;
  const onPage = useCallback((offset, result) => {
    setPageCollection(current => {
      const base = current.key === pageQueryKey ? current : { key: pageQueryKey, pages: new Map(), total: null, revision: '', error: null };
      const incoming = result.data;
      if (incoming?.sourceRevision && base.revision && incoming.sourceRevision !== base.revision && offset !== 0) return base;
      const pages = incoming?.sourceRevision && base.revision && incoming.sourceRevision !== base.revision ? new Map() : new Map(base.pages);
      const prior = pages.get(offset);
      const next = { key: pageQueryKey, pages, total: incoming?.total ?? base.total, revision: offset === 0 && incoming?.sourceRevision ? incoming.sourceRevision : base.revision || incoming?.sourceRevision || '', error: result.error || null };
      if (incoming) pages.set(offset, incoming);
      else if (result.error && !prior) next.error = result.error;
      if (pages.size > 8) {
        const visibleOffsets = visiblePageOffsetsRef.current;
        for (const key of pages.keys()) if (pages.size > 8 && !visibleOffsets.has(key) && key !== offset) pages.delete(key);
        while (pages.size > 8) pages.delete(pages.keys().next().value);
      }
      if (prior === incoming && next.total === base.total && next.revision === base.revision && next.error === base.error) return current;
      return next;
    });
  }, [pageQueryKey]);
  const anchorRef = useRef(props.uiState?.anchor || null), priorEntriesRef = useRef(null);
  const entriesRef = useRef([]), virtualizerRef = useRef(null), rowIndexByIdRef = useRef(new Map()), anchorFrameRef = useRef(0), scrollRevisionRef = useRef(0);
  propsRef.current = props;
  const rows = props.rows || [], columns = props.columns || [], grouped = !!props.grouped && !pageSource;
  const mobile = layout === 'mobile';
  const entries = useMemo(() => {
    if (pageSource) {
      const count = Math.max(0, Math.min(2_000_000, Number(pageState.total ?? props.totalRows ?? pageSize)));
      const output = new Array(count);
      pageRows.forEach((page, offset) => page.rows.forEach((row, index) => {
        const absolute = offset + index;
        if (absolute < count) output[absolute] = { type: 'row', row, key: renderIdentity(row, idOf(row)) };
      }));
      return output;
    }
    const output = [];
    let previous = null;
    rows.forEach(row => {
      const assigned = isAssigned(row);
      const key = renderIdentity(row, idOf(row));
      if (grouped && (previous === null || assigned !== previous)) output.push({ type: 'group', assigned, key: `group:${assigned ? 'assigned' : 'unassigned'}:${key}` });
      output.push({ type: 'row', row, key });
      previous = assigned;
    });
    return output;
  }, [rows, grouped, !!pageSource, pageQueryKey, pageState.total, pageRows, props.totalRows, pageSize]);
  const rowIndexById = useMemo(() => {
    const output = new Map();
    entries.forEach((entry, index) => { if (entry.type === 'row') output.set(idOf(entry.row), index); });
    return output;
  }, [entries]);
  // Empty server-page slots have no record yet; their query/offset identity is
  // deliberately different from the database identity used when a row arrives.
  const getItemKey = useCallback(index => entries[index]?.key || `page-slot:${pageQueryKey}:${index}`, [entries, pageQueryKey]);
  const getScrollElement = useCallback(() => mobile ? props.scrollElement || document.getElementById('main-scroll-area') : tableScrollRef.current, [mobile, props.scrollElement]);
  const estimateSize = useCallback(index => entries[index]?.type === 'group' ? 42 : mobile ? 360 : 64, [entries, mobile]);
  const virtualizer = useVirtualizer({ count: entries.length, getItemKey, getScrollElement, estimateSize, overscan: 2, gap: mobile ? 12 : 0, scrollMargin });
  entriesRef.current = entries; virtualizerRef.current = virtualizer; rowIndexByIdRef.current = rowIndexById;
  const measuredVisible = virtualizer.getVirtualItems();
  const firstLoadedIndex = entries.findIndex(Boolean);
  const visible = measuredVisible.length ? measuredVisible : firstLoadedIndex >= 0 ? [{ index: firstLoadedIndex }] : pageSource && entries.length ? [{ index: 0 }] : [];
  const pageOffsets = pageSource ? [...new Set((visible.length ? visible : [{ index: 0 }]).map(item => Math.floor(item.index / pageSize) * pageSize))].slice(0, 8) : [];
  useLayoutEffect(() => {
    if (!pageSource) return;
    visiblePageOffsetsRef.current = new Set(pageOffsets);
    pageOffsets.forEach(offset => pageSource.session.pin({ ...pageSource.query, offset, limit: pageSize }, true));
    for (const offset of pageRows.keys()) if (!pageOffsets.includes(offset)) pageSource.session.pin({ ...pageSource.query, offset, limit: pageSize }, false);
    setPageCollection(current => {
      if (current.key !== pageQueryKey) return current;
      const retained = new Map([...current.pages.entries()].filter(([offset]) => pageOffsets.includes(offset)));
      return retained.size === current.pages.size ? current : { ...current, pages: retained };
    });
    return () => pageOffsets.forEach(offset => pageSource.session.pin({ ...pageSource.query, offset, limit: pageSize }, false));
  }, [pageSource?.session, pageQueryKey, pageSize, pageOffsets.join(','), pageRows]);
  const pinnedIndex = pinnedRowId ? rowIndexById.get(pinnedRowId) ?? -1 : -1;
  const activePinned = pinnedIndex >= 0 && !visible.some(item => item.index === pinnedIndex) ? pinnedIndex : null;
  const indexSet = new Set(visible.map(item => item.index));
  if (activePinned != null) indexSet.add(activePinned);
  const indexes = [...indexSet].sort((a, b) => a - b);
  const options = props.options || [], lowStock = props.lowStock || {};
  const handlers = useMemo(() => ({
    onDefaultChange: (...args) => propsRef.current.onDefaultChange?.(...args),
    onSelect: (...args) => propsRef.current.onSelect?.(...args),
    onLowStockDraft: (...args) => propsRef.current.onLowStockDraft?.(...args),
    onLowStockSave: (...args) => propsRef.current.onLowStockSave?.(...args),
    onLowStockReset: (...args) => propsRef.current.onLowStockReset?.(...args),
    onColumnFilter: (...args) => propsRef.current.onColumnFilter?.(...args)
  }), []);
  const measure = useCallback(element => { if (element) virtualizer.measureElement(element); }, [virtualizer]);
  const onToggle = useCallback((id, open = undefined) => setExpanded(current => { const next = new Set(current); const shouldOpen = open === undefined ? !current.has(id) : open; shouldOpen ? next.add(id) : next.delete(id); if (propsRef.current.uiState) propsRef.current.uiState.expanded = next; return next; }), []);
  useLayoutEffect(() => {
    const scroll = getScrollElement();
    const root = hostRef.current;
    if (!scroll || !root) return undefined;
    const update = () => {
      const width = window.innerWidth || document.documentElement.clientWidth;
      setLayout(width < 768 ? 'mobile' : 'desktop');
      const scrollTop = scroll.scrollTop || 0;
      const tableHead = root.querySelector('thead');
      const margin = mobile
        ? root.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scrollTop
        : tableHead?.getBoundingClientRect().height || 0;
      setScrollMargin(Math.max(0, margin));
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(scroll); observer?.observe(root);
    // A change to controls above this list can move the host while keeping its
    // own dimensions unchanged. Observe intervening layout boxes so their size
    // changes refresh the virtualizer's scroll margin.
    if (mobile) {
      let ancestor = root.parentElement;
      while (ancestor && ancestor !== scroll) {
        observer?.observe(ancestor);
        ancestor = ancestor.parentElement;
      }
    }
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [getScrollElement, mobile]);
  useLayoutEffect(() => {
    const root = hostRef.current;
    if (!root) return undefined;
    const frames = new Set();
    const schedule = callback => {
      const id = requestAnimationFrame(() => { frames.delete(id); callback(); });
      frames.add(id);
      return id;
    };
    const focusIn = event => { const node = event.target.closest?.('[data-inventory-id]'); if (node) setPinnedRowId(node.dataset.inventoryId || ''); };
    const focusOut = () => schedule(() => { const node = document.activeElement?.closest?.('[data-inventory-id]'); setPinnedRowId(node?.dataset.inventoryId || ''); });
    const keydown = event => {
      if (event.key !== 'Tab') return;
      const current = event.target.closest?.('[data-inventory-id]');
      if (!current) return;
      const currentEntries = entriesRef.current, rowId = current.dataset.inventoryId, rowIndex = rowIndexByIdRef.current.get(rowId);
      if (rowIndex == null) return;
      const controls = [...current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')];
      const controlIndex = controls.indexOf(event.target);
      if (controlIndex < 0) return;
      const forward = !event.shiftKey;
      if ((forward && controlIndex !== controls.length - 1) || (!forward && controlIndex !== 0)) return;
      const direction = forward ? 1 : -1;
      const targetIndex = rowIndex + direction;
      if (targetIndex < 0 || targetIndex >= currentEntries.length) return;
      let next = targetIndex;
      while (next >= 0 && next < currentEntries.length && currentEntries[next]?.type !== 'row') next += direction;
      if (next < 0 || next >= currentEntries.length) return;
      event.preventDefault();
      const targetId = idOf(currentEntries[next].row);
      virtualizerRef.current?.scrollToIndex(next, { align: 'auto', behavior: 'auto' });
      let attempts = 0;
      const focusMounted = () => {
        const targetRow = [...root.querySelectorAll('[data-inventory-id]')].find(element => element.dataset.inventoryId === targetId);
        if (targetRow) {
          const targetControls = [...targetRow.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')];
          const focusTarget = forward ? targetControls[0] : targetControls.at(-1);
          if (focusTarget) focusTarget.focus();
          else propsRef.current.onError?.(new Error('The next Assigned Items row has no keyboard focus target.'));
        } else if (++attempts < 6) schedule(focusMounted);
        else propsRef.current.onError?.(new Error('The next Assigned Items row did not mount for keyboard navigation.'));
      };
      schedule(focusMounted);
    };
    root.addEventListener('focusin', focusIn); root.addEventListener('focusout', focusOut); root.addEventListener('keydown', keydown);
    return () => { root.removeEventListener('focusin', focusIn); root.removeEventListener('focusout', focusOut); root.removeEventListener('keydown', keydown); for (const id of frames) cancelAnimationFrame(id); };
  }, []);
  useLayoutEffect(() => {
    const scroll = getScrollElement();
    if (!scroll) return undefined;
    const capture = () => {
      scrollRevisionRef.current += 1;
      const currentEntries = entriesRef.current, currentVirtualizer = virtualizerRef.current;
      if (!currentVirtualizer) return;
      const first = currentVirtualizer.getVirtualItems().find(item => currentEntries[item.index]?.type === 'row');
      if (first) {
        anchorRef.current = { id: idOf(currentEntries[first.index].row), viewportOffset: first.start - (scroll.scrollTop || 0) };
        if (propsRef.current.uiState) propsRef.current.uiState.anchor = anchorRef.current;
      }
    };
    scroll.addEventListener('scroll', capture, { passive: true });
    return () => scroll.removeEventListener('scroll', capture);
  }, [getScrollElement]);
  useLayoutEffect(() => {
    const previous = priorEntriesRef.current;
    priorEntriesRef.current = entries;
    if (previous === entries) return;
    const scroll = getScrollElement();
    if (!scroll) return;
    const anchor = previous ? anchorRef.current : props.uiState?.anchor || anchorRef.current;
    if (!anchor && !previous) return;
    const index = anchor?.id ? rowIndexById.get(anchor.id) ?? -1 : -1;
    const scheduledScrollTop = scroll.scrollTop || 0;
    const scheduledScrollRevision = scrollRevisionRef.current;
    const frame = requestAnimationFrame(() => {
      anchorFrameRef.current = 0;
      restoreAssignedItemsAnchor({ scroll, scheduledScrollTop, scheduledScrollRevision, currentScrollRevision: scrollRevisionRef.current, index, anchor, virtualizer: virtualizerRef.current });
    });
    anchorFrameRef.current = frame;
    return () => { if (anchorFrameRef.current) cancelAnimationFrame(anchorFrameRef.current); anchorFrameRef.current = 0; };
  }, [entries, virtualizer, rowIndexById, getScrollElement, props.uiState]);
  const groupCount = canManageGroupColumn(props) ? 1 : 0;
  const colSpan = columns.length + groupCount;
  const renderEntry = index => {
    const entry = entries[index];
    if (!entry) return null;
    if (entry.type === 'group') return mobile ? <div key={entry.key} ref={measure} data-index={index} data-virtual-index={index} data-manager-assigned-group={entry.assigned ? 'assigned' : 'unassigned'} className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${entry.assigned ? 'border-blue-100 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{entry.assigned ? 'Assigned' : 'Unassigned'}</div> : <tr key={entry.key} ref={measure} data-index={index} data-virtual-index={index} data-manager-assigned-group={entry.assigned ? 'assigned' : 'unassigned'}><td colSpan={colSpan} className={`border-y px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] ${entry.assigned ? 'border-blue-100 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{entry.assigned ? 'Assigned' : 'Unassigned'}</td></tr>;
    const code = codeOf(entry.row);
    const rowId = idOf(entry.row), rowProps = { row: entry.row, columns, canManageAssignments: props.canManageAssignments, snapshotCurrent, options, ownerDraft: props.ownerDrafts?.[code], pendingOwner: props.pendingCodes?.has(code), selected: props.selectedCodes || EMPTY_SET, lowStockState: lowStock, handlers, getReason: props.getReason, index, measure, historyExpanded: expanded.has(`history:${rowId}`), onToggleHistory: onToggle };
    return mobile ? <Card key={entry.key} {...rowProps} expanded={expanded.has(rowId)} onToggle={onToggle} /> : <Row key={entry.key} {...rowProps} />;
  };
  const measurements = virtualizer.getMeasurements();
  const gaps = indexes.map((index, position) => {
    const current = measurements[index];
    const previous = position ? measurements[indexes[position - 1]] : null;
    return Math.max(0, position ? current.start - previous.end : current.start - scrollMargin);
  });
  const lastMeasurement = indexes.length ? measurements[indexes[indexes.length - 1]] : null;
  const tailGap = lastMeasurement ? Math.max(0, virtualizer.getTotalSize() + scrollMargin - lastMeasurement.end) : 0;
  useLayoutEffect(() => {
    const table = hostRef.current?.querySelector('table');
    if (!table) return;
    table.setAttribute('aria-rowcount', String(entries.length + 1));
    table.querySelectorAll('tbody tr[data-virtual-index]').forEach(row => row.setAttribute('aria-rowindex', String(Number(row.dataset.virtualIndex) + 2)));
  }, [entries, indexes, mobile]);
  return <div ref={hostRef} className="ai-virtual-root" data-manager-assigned-layout={mobile ? 'mobile' : 'desktop'}>
    {pageSource && pageOffsets.map(offset => <AssignedItemsReportPage key={`${pageQueryKey}:${offset}`} source={{ ...pageSource, sourceRevision: pageState.revision }} offset={offset} onPage={onPage} />)}
    {pageError && !pageRows.size && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{pageError.message || 'Assigned Items could not be loaded.'}</div>}
    <div className="sr-only" aria-live="polite">Showing {pageSource ? [...pageRows.values()].reduce((sum, page) => sum + page.rows.length, 0) : rows.length} matching rows from {pageState.total ?? props.totalRows ?? rows.length} rows.</div>
    {mobile ? <>
      <div data-manager-assigned-mobile-filter-header role="region" aria-label="Assigned Items column filters" tabIndex="0" className="ai-mobile-filter-header">
        <div className="ai-mobile-filter-track">{columns.map(([field, label]) => { const filter = props.columnFilters?.[field] || {}, sorted = props.sort?.field === field, active = filter.active || sorted; return <button key={field} type="button" data-assigned-filter-trigger={field} aria-label={`Filter and sort ${label}`} aria-expanded={!!filter.open} aria-sort={sorted ? props.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'} className={`assigned-column-trigger min-h-[44px] px-3 py-1.5 text-left ${active ? 'is-filtered' : ''}`} onClick={event => handlers.onColumnFilter(field, event)}><span>{label}</span><span className={`assigned-filter-value ${filter.active ? '' : 'is-inactive'}`}>{filter.label || 'All'}</span><span aria-hidden="true" className="assigned-filter-icon">⏷</span>{sorted && <span aria-hidden="true" className="assigned-sort-icon">{props.sort.direction === 'asc' ? '↑' : '↓'}</span>}</button>; })}</div>
      </div>
      <div data-manager-assigned-mobile-list className="ai-mobile-list">{indexes.length ? indexes.map((index, position) => <React.Fragment key={getItemKey(index)}>{gaps[position] > 0 && <div aria-hidden="true" style={{ height: `${gaps[position]}px` }} />}{renderEntry(index)}</React.Fragment>) : <p>No rows match. Change or clear filters above.</p>}{tailGap > 0 && <div aria-hidden="true" style={{ height: `${tailGap}px` }} />}</div>
    </> : <div ref={tableScrollRef} data-manager-assigned-desktop-table data-manager-assigned-table-scroll className="ai-desktop-scroll rounded-2xl border border-emerald-100 bg-white shadow-sm" tabIndex="0" role="region" aria-label="Scrollable Warehouse Assigned Items table"><table className="min-w-full text-left text-xs font-bold text-slate-600"><thead className="text-[10px] font-black uppercase tracking-[0.14em]"><tr>{groupCount > 0 && <th className="px-3 py-2"><input type="checkbox" data-assigned-select-all-visible aria-label="Select all filtered items" checked={rows.length > 0 && rows.every(row => props.selectedCodes?.has(codeOf(row)))} disabled={!snapshotCurrent} onChange={event => props.onSelectAll?.(event.target.checked)} /></th>}{columns.map(([field, label]) => { const filter = props.columnFilters?.[field] || {}, sorted = props.sort?.field === field, active = filter.active || sorted; return <th key={field} aria-sort={sorted ? props.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" data-assigned-filter-trigger={field} aria-label={`Filter and sort ${label}`} aria-expanded={!!filter.open} className={`assigned-column-trigger min-h-[40px] px-3 py-1.5 text-left ${active ? 'is-filtered' : ''}`} onClick={event => handlers.onColumnFilter(field, event)}><span>{label}</span><span className={`assigned-filter-value ${filter.active ? '' : 'is-inactive'}`}>{filter.label || 'All'}</span><span aria-hidden="true" className="assigned-filter-icon">⏷</span>{sorted && <span aria-hidden="true" className="assigned-sort-icon">{props.sort.direction === 'asc' ? '↑' : '↓'}</span>}</button></th>; })}</tr></thead><tbody>{indexes.length ? <>{indexes.map((index, position) => <React.Fragment key={getItemKey(index)}>{gaps[position] > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: `${gaps[position]}px`, padding: 0 }} /></tr>}{renderEntry(index)}</React.Fragment>)}{tailGap > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: `${tailGap}px`, padding: 0 }} /></tr>}</> : <tr><td colSpan={colSpan} className="p-4">No rows match. Change or clear filters above.</td></tr>}</tbody></table></div>}
    <div data-manager-assigned-full-list-status className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-800">Showing {pageSource ? pageState.total ?? props.totalRows ?? rows.length : rows.length} matching row{(pageState.total ?? rows.length) === 1 ? '' : 's'}. Search checks the complete {pageState.total ?? props.totalRows ?? rows.length}-row list.</div>
  </div>;
}

function canManageGroupColumn(props) { return !!props.canManageAssignments; }

export function restoreAssignedItemsAnchor({ scroll, scheduledScrollTop, scheduledScrollRevision, currentScrollRevision, index, anchor, virtualizer }) {
  if (!scroll?.isConnected) return false;
  // A newly requested/user scroll always wins over a stale anchor restore.
  // The position check also covers programmatic scrollTop writes whose native
  // scroll event has not been delivered before this animation frame.
  if (currentScrollRevision !== scheduledScrollRevision || Math.abs((scroll.scrollTop || 0) - scheduledScrollTop) > 1) return false;
  if (index >= 0) {
    const start = virtualizer?.getMeasurements()[index]?.start;
    if (Number.isFinite(start)) virtualizer.scrollToOffset(Math.max(0, start - anchor.viewportOffset), { behavior: 'auto' });
  } else {
    const maximum = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    if (scroll.scrollTop > maximum) scroll.scrollTop = maximum;
  }
  return true;
}

class AssignedItemsErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"><div>Assigned Items could not be displayed. Your saved data is unchanged.</div><button type="button" className="mt-3 min-h-[44px] rounded-lg bg-[#007a4d] px-4 text-xs font-black uppercase text-white" onClick={() => { this.setState({ error: null }); this.props.onRetry?.(); }}>Retry Assigned Items</button></div>;
  }
}

export function mountAssignedItems(host, props) {
  if (!host) throw new TypeError('Assigned Items host is required.');
  const root = createRoot(host);
  let destroyed = false;
  const update = next => {
    if (destroyed) return;
    const value = next || {};
    host.dataset.logicalRowCount = String(value.rows?.length || 0);
    host.dataset.totalRowCount = String(value.totalRows ?? value.rows?.length ?? 0);
    const view = <AssignedItemsErrorBoundary onError={value.onError} onRetry={value.onRetry}><AssignedItemsView {...value} /></AssignedItemsErrorBoundary>;
    root.render(value.pageSource ? <ReportPageSessionProvider session={value.pageSource.session}>{view}</ReportPageSessionProvider> : view);
  };
  update(props || {});
  return { update, destroy() { if (destroyed) return; destroyed = true; root.unmount(); } };
}
