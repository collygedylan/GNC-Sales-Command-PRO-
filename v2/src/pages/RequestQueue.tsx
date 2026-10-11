import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Image as ImageIcon, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { field, isArchived, isCompleted, numberField, requestTab, uniqueId, type RequestRow } from '../services/api';
import { defaultRequestColumnKeys, requestGridColumns, requestTabs, type RequestColumnKey, type RequestDisplayMode, type RequestTabId } from './requestQueueConfig';

export type RequestQueueProps = {
  rows: RequestRow[];
  allRows: RequestRow[];
  activeTab: RequestTabId;
  displayMode: RequestDisplayMode;
  columnKeys: RequestColumnKey[];
  loading: boolean;
  onTab: (tab: RequestTabId) => void;
  onOpen: (row: RequestRow) => void;
  onRemove: (row: RequestRow) => void;
  onRefresh: () => void;
};

const RequestQueue = memo(function RequestQueue(props: RequestQueueProps) {
  const visibleRows = useChunkedRows(props.rows, props.displayMode === 'grid' ? 80 : 24);
  const counts = useMemo(() => {
    const map = new Map<RequestTabId, number>();
    requestTabs.forEach(tab => map.set(tab.id, 0));
    props.allRows.filter(row => !isArchived(row) && !isCompleted(row)).forEach(row => {
      const tab = requestTab(row) as RequestTabId;
      map.set(tab, (map.get(tab) || 0) + 1);
    });
    return map;
  }, [props.allRows]);

  return (
    <section className="request-flow">
      <div className="filter-rail">
        <div className="filter-dropdown-row">
          <label className="filter-select">
            <span>Que View</span>
            <select value={props.activeTab} onChange={event => props.onTab(event.target.value as RequestTabId)}>
              {requestTabs.map(tab => (
                <option key={tab.id} value={tab.id}>{tab.label} ({counts.get(tab.id) || 0})</option>
              ))}
            </select>
            <ChevronDown size={18} />
          </label>
          <div className="request-actions">
            <span>{tabLabel(props.activeTab)} Que</span>
            <button type="button" onClick={props.onRefresh}><RefreshCw size={18} /> Refresh</button>
          </div>
        </div>
      </div>
      {props.loading && !props.rows.length ? <div className="empty-state"><Loader2 className="spin" /> Loading rows...</div> : null}
      {!props.loading && !props.rows.length ? <div className="empty-state">No rows match this view.</div> : null}
      {props.displayMode === 'grid' ? (
        <RequestGrid rows={visibleRows} columnKeys={props.columnKeys} onOpen={props.onOpen} onRemove={props.onRemove} />
      ) : (
        <div className="request-list">
          {visibleRows.map(row => (
            <RequestCard key={String(uniqueId(row))} row={row} onOpen={props.onOpen} onRemove={props.onRemove} />
          ))}
        </div>
      )}
      {props.rows.length > visibleRows.length ? (
        <p className="render-limit-note">
          Showing the first {visibleRows.length.toLocaleString()} of {props.rows.length.toLocaleString()} matching rows. Refine the search or filter to narrow the list.
        </p>
      ) : null}
    </section>
  );
});

type RequestGridColumn = typeof requestGridColumns[number];
type RequestGridRowProps = {
  row: RequestRow;
  columns: RequestGridColumn[];
  onOpen: (row: RequestRow) => void;
  onRemove: (row: RequestRow) => void;
};

function RequestGrid({ rows, columnKeys, onOpen, onRemove }: { rows: RequestRow[]; columnKeys: RequestColumnKey[]; onOpen: (row: RequestRow) => void; onRemove: (row: RequestRow) => void }) {
  const columns = useMemo(() => requestGridColumns.filter(column => columnKeys.includes(column.key)), [columnKeys]);
  return (
    <div className="request-grid-wrap" role="region" aria-label="Request rows grid">
      <table className="request-grid-table">
        <thead>
          <tr>
            {columns.map(column => <th key={column.key}>{column.label}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <RequestGridRow key={String(uniqueId(row))} row={row} columns={columns} onOpen={onOpen} onRemove={onRemove} />)}
        </tbody>
      </table>
    </div>
  );
}

const RequestGridRow = memo(function RequestGridRow({ row, columns, onOpen, onRemove }: RequestGridRowProps) {
  return (
    <tr onDoubleClick={() => onOpen(row)}>
      {columns.map(column => <td className={column.className} key={column.key}>{column.render(row)}</td>)}
      <td>
        <div className="grid-row-actions">
          <button type="button" onClick={() => onOpen(row)}>Open</button>
          <button type="button" className="danger" onClick={() => onRemove(row)}>Remove</button>
        </div>
      </td>
    </tr>
  );
});

const RequestCard = memo(function RequestCard({ row, onOpen, onRemove }: { row: RequestRow; onOpen: (row: RequestRow) => void; onRemove: (row: RequestRow) => void }) {
  const openRow = useCallback(() => onOpen(row), [onOpen, row]);
  const removeRow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRemove(row);
  }, [onRemove, row]);
  return (
    <article className="request-card live-row-card" onClick={openRow}>
      <div className="card-main">
        <div className="card-copy">
          <h2>{field(row, ['COMMONNAME', 'commonname'], 'Unnamed item')}</h2>
          <a>{field(row, ['LOCATIONCODE', 'locationcode'], '-')}</a>
          <div className="card-meta-line">
            {field(row, ['ITEMCODE', 'itemcode'], '-')} | Lot {field(row, ['LOTCODE', 'lotcode'], '-')} | {field(row, ['CONTSIZE', 'contsize'], '-')}
          </div>
          <p>{field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], 'No rep')}</p>
          <p>{field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], 'No customer')}</p>
        </div>
        <div className="card-side">
          <span className="color-chip">{field(row, ['COLOR', 'color', 'DESIGCUST', 'desigcust'], '')}</span>
          <strong>{field(row, ['CONTSIZE', 'contsize'], '')}</strong>
          <span>{field(row, ['SRC', 'src'], '')}</span>
          <RequestPhoto row={row} />
          <em>Open <ChevronRight size={15} /></em>
        </div>
      </div>
      <div className="chip-grid">
        <QueueChip tone="warning" label="Pending" />
        <QueueChip label={`Reserve: ${field(row, ['RESERVE', 'reserve'], 'NO')}`} />
        <QueueChip tone="purple" label={`Qty: ${field(row, ['QTY', 'qty', 'REQ_QTY', 'req_qty'], '0')}`} />
        <QueueChip tone="blue" label={`Loc: ${field(row, ['LOCATIONCODE', 'locationcode'], '-')}`} />
        <QueueChip label={`Lot: ${field(row, ['LOTCODE', 'lotcode'], '-')}`} />
        <QueueChip tone="orange" label={`Pri: ${field(row, ['PRI', 'priority'], '-')}`} />
        <QueueChip tone="green" label={`On hand - ${numberField(row, ['ON_HAND', 'on_hand', 'HAND'])}`} />
        <QueueChip tone="blue" label={`Review - ${numberField(row, ['REVIEW', 'review', 'REV'])}`} />
        <QueueChip tone="blue" label={`Available - ${numberField(row, ['AVAILABLE', 'available', 'AVAIL'])}`} />
        <QueueChip tone="purple" label={`Open stock - ${numberField(row, ['OPEN_STOCK', 'open_stock', 'OPEN'])}`} />
      </div>
      <button className="remove-row-button" type="button" onClick={removeRow}>
        <Trash2 size={18} /> Remove
      </button>
    </article>
  );
});

function RequestPhoto({ row }: { row: RequestRow }) {
  const url = field(row, ['REQ_PHOTO_LINK', 'req_photo_link', 'PHOTO_URL', 'photo_url', 'IMAGE_URL', 'image_url']);
  const name = field(row, ['COMMONNAME', 'commonname'], 'Item');
  return (
    <div className="media-frame">
      {url ? <img src={url} alt="" loading="lazy" /> : <div className="media-placeholder"><ImageIcon size={26} /><span>{mediaInitials(name)}</span></div>}
    </div>
  );
}

function mediaInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'AG';
}

function QueueChip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'blue' | 'purple' | 'orange' | 'warning' }) {
  return <span className={`chip ${tone}`}>{label}</span>;
}

function useChunkedRows<T>(rows: T[], batch = 30, maximum = 96) {
  const [count, setCount] = useState(() => Math.min(rows.length, batch, maximum));
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const target = Math.min(rows.length, maximum);
    const initialCount = Math.min(batch, target);
    setCount(current => current === initialCount ? current : initialCount);
    const pump = () => {
      if (cancelled) return;
      setCount(current => {
        const next = Math.min(current + batch, target);
        if (next < target) frame = window.requestAnimationFrame(pump);
        return next;
      });
    };
    if (target > batch) frame = window.requestAnimationFrame(pump);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rows, batch, maximum]);
  return rows.slice(0, count);
}

function tabLabel(tab: RequestTabId) {
  return requestTabs.find(item => item.id === tab)?.label || 'Request';
}

export { defaultRequestColumnKeys, RequestQueue };
export default RequestQueue;
