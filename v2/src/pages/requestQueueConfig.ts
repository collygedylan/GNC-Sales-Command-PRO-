import { field, numberField, uniqueId, type RequestRow } from '../services/api';

export type RequestTabId = 'request' | 'sales' | 'location' | 'recount' | 'av' | 'shear';
export type RequestDisplayMode = 'cards' | 'grid';
export type RequestColumnKey = 'item' | 'common' | 'loc' | 'lot' | 'size' | 'src' | 'pri' | 'qty' | 'hand' | 'review' | 'avail' | 'open' | 'rep' | 'customer';

export const requestTabs: Array<{ id: RequestTabId; label: string }> = [
  { id: 'request', label: 'Request' },
  { id: 'sales', label: 'Sales Reps' },
  { id: 'location', label: 'Location Move' },
  { id: 'recount', label: 'Recount' },
  { id: 'av', label: 'AV Check' },
  { id: 'shear', label: 'Shear List' }
];

export const requestGridColumns: Array<{ key: RequestColumnKey; label: string; className?: string; render: (row: RequestRow) => string | number }> = [
  { key: 'item', label: 'Item', render: row => field(row, ['ITEMCODE', 'itemcode'], String(uniqueId(row) || '-')) },
  { key: 'common', label: 'Common Name', className: 'strong-cell', render: row => field(row, ['COMMONNAME', 'commonname'], 'Unnamed item') },
  { key: 'loc', label: 'Loc', render: row => field(row, ['LOCATIONCODE', 'locationcode'], '-') },
  { key: 'lot', label: 'Lot', render: row => field(row, ['LOTCODE', 'lotcode'], '-') },
  { key: 'size', label: 'Size', render: row => field(row, ['CONTSIZE', 'contsize'], '-') },
  { key: 'src', label: 'Src', render: row => field(row, ['SRC', 'src'], '-') },
  { key: 'pri', label: 'Pri', render: row => field(row, ['PRI', 'priority'], '-') },
  { key: 'qty', label: 'Qty', render: row => field(row, ['QTY', 'qty', 'REQ_QTY', 'req_qty'], '0') },
  { key: 'hand', label: 'Hand', render: row => numberField(row, ['ON_HAND', 'on_hand', 'HAND']) },
  { key: 'review', label: 'Rev', render: row => numberField(row, ['REVIEW', 'review', 'REV']) },
  { key: 'avail', label: 'Avail', render: row => numberField(row, ['AVAILABLE', 'available', 'AVAIL']) },
  { key: 'open', label: 'Open', render: row => numberField(row, ['OPEN_STOCK', 'open_stock', 'OPEN']) },
  { key: 'rep', label: 'Rep', render: row => field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], '-') },
  { key: 'customer', label: 'Customer', render: row => field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], '-') }
];

export const defaultRequestColumnKeys = requestGridColumns.map(column => column.key);
