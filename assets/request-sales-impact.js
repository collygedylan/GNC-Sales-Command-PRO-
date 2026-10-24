const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function text(value = '') {
  return String(value ?? '').trim();
}

function normalized(value = '') {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

function number(value = 0) {
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value = 0) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value = '') {
  return text(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function firstValue(row = {}, keys = [], fallback = '') {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return fallback;
}

export function effectiveRequestQuantity(value) {
  const parsed = number(value);
  return parsed > 0 ? parsed : 25;
}

export function requestSalesImpactDedupKey(row = {}) {
  const explicitIdentity = text(firstValue(row, ['line_identity_key', 'lineIdentityKey'], ''));
  if (explicitIdentity) return explicitIdentity;
  const uniqueId = normalized(firstValue(row, ['unique_id', 'request_unique_id', 'master_unique_id'], ''));
  if (uniqueId) return `uid:${uniqueId}`;
  const folder = normalized(firstValue(row, ['folder_id', 'request_folder', 'folderId', 'request_key', 'requestKey'], ''));
  const itemcode = normalized(firstValue(row, ['itemcode', 'item_code'], ''));
  const locationcode = normalized(firstValue(row, ['locationcode', 'location_code'], ''));
  const lotcode = normalized(firstValue(row, ['lotcode', 'lot_code'], ''));
  const rowIndex = normalized(firstValue(row, ['row_index', 'rowIndex'], '1')) || '1';
  if (folder) return [`folder:${folder}`, itemcode, locationcode, lotcode, `row:${rowIndex}`].join('|');
  const sourceRowId = normalized(firstValue(row, ['source_row_id', 'sourceRowId'], ''));
  const emailThreadId = normalized(firstValue(row, ['email_thread_id', 'gmail_thread_id', 'thread_id'], ''));
  const requestDate = normalized(firstValue(row, ['request_date', 'requested_at', 'date', 'created_at'], ''));
  return [`source:${sourceRowId || emailThreadId || requestDate || 'unknown'}`, `date:${requestDate}`,
    itemcode, locationcode, lotcode, `row:${rowIndex}`].join('|');
}

function canonicalRequestLine(row = {}) {
  const rawQuantityValue = firstValue(row, ['raw_qty', 'req_qty', 'qty', 'quantity', 'request_qty', 'requested_qty'], null);
  const rawQuantity = number(rawQuantityValue) > 0 ? number(rawQuantityValue) : null;
  const effectiveQuantity = effectiveRequestQuantity(rawQuantity);
  const listPrice = money(firstValue(row, ['list_price', 'unit_list_price', 'listprice', 'price'], 0));
  const status = /complete|fulfilled|done|closed|archiv/i.test(text(firstValue(row, ['status', 'req_status'], 'Pending')))
    ? 'Completed' : 'Pending';
  const customerName = text(firstValue(row, ['customer_name', 'customername'], 'Unknown Customer')) || 'Unknown Customer';
  const consigneeName = text(firstValue(row, ['consignee_name', 'consigneename'], 'N/A')) || 'N/A';
  const requestDate = text(firstValue(row, ['request_date', 'requested_at', 'date', 'created_at'], ''));
  const sourceRowId = text(firstValue(row, ['source_row_id', 'sourceRowId'], ''));
  const folderId = text(firstValue(row, ['folder_id', 'request_folder', 'request_key'], ''));
  return {
    line_identity_key: text(firstValue(row, ['line_identity_key', 'lineIdentityKey'], '')),
    request_identity: text(firstValue(row, ['request_identity', 'requestIdentity'], '')) || folderId || sourceRowId || requestDate || 'Unknown Request',
    unique_id: text(firstValue(row, ['unique_id', 'request_unique_id', 'master_unique_id'], '')),
    folder_id: folderId || sourceRowId || 'Unknown Request',
    source_row_id: sourceRowId,
    source_row_ids: text(firstValue(row, ['source_row_ids', 'sourceRowIds'], sourceRowId)),
    row_index: number(firstValue(row, ['row_index', 'rowIndex'], 1)) || 1,
    email_thread_id: text(firstValue(row, ['email_thread_id', 'gmail_thread_id', 'thread_id'], '')),
    request_date: requestDate,
    status,
    sales_rep: text(firstValue(row, ['sales_rep', 'primary_sales_rep', 'request_selected_rep_display'], 'Unassigned')) || 'Unassigned',
    customer_name: customerName,
    consignee_name: consigneeName,
    customer_consignee_label: text(row.customer_consignee_label) || `${customerName} / ${consigneeName}`,
    itemcode: text(firstValue(row, ['itemcode', 'item_code'], '')),
    commonname: text(firstValue(row, ['commonname', 'common_name'], '')),
    contsize: text(firstValue(row, ['contsize', 'container_size', 'size'], '')),
    lotcode: text(firstValue(row, ['lotcode', 'lot_code'], '')),
    locationcode: text(firstValue(row, ['locationcode', 'location_code'], '')),
    raw_qty: rawQuantity,
    effective_qty: effectiveQuantity,
    is_default_qty: rawQuantity === null,
    list_price: listPrice,
    price_source: text(firstValue(row, ['price_source', 'priceSource'], '')),
    line_dollar_value: money(effectiveQuantity * listPrice),
    source_tables: text(row.source_tables),
  };
}

function preferText(currentValue, candidateValue) {
  return text(currentValue) || text(candidateValue);
}

function mergeCanonicalLines(current, candidate) {
  const merged = { ...current };
  if (candidate.status === 'Completed') merged.status = 'Completed';
  if (current.raw_qty === null && candidate.raw_qty !== null) {
    merged.raw_qty = candidate.raw_qty;
    merged.effective_qty = candidate.raw_qty;
    merged.is_default_qty = false;
  }
  if (!(current.list_price > 0) && candidate.list_price > 0) merged.list_price = candidate.list_price;
  for (const key of ['line_identity_key', 'request_identity', 'unique_id', 'folder_id', 'source_row_id', 'source_row_ids',
    'email_thread_id', 'request_date', 'sales_rep', 'customer_name', 'consignee_name', 'customer_consignee_label',
    'itemcode', 'commonname', 'contsize', 'lotcode', 'locationcode', 'price_source', 'source_tables']) {
    merged[key] = preferText(current[key], candidate[key]);
  }
  merged.line_dollar_value = money(merged.effective_qty * merged.list_price);
  return merged;
}

export function aggregateRequestSalesImpactLines(rows = []) {
  const deduplicated = new Map();
  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const candidate = canonicalRequestLine(rawRow);
    const key = requestSalesImpactDedupKey(candidate);
    deduplicated.set(key, deduplicated.has(key) ? mergeCanonicalLines(deduplicated.get(key), candidate) : candidate);
  }
  const lineItems = [...deduplicated.values()].sort((left, right) =>
    String(right.request_date).localeCompare(String(left.request_date))
    || right.line_dollar_value - left.line_dollar_value
    || left.itemcode.localeCompare(right.itemcode));
  const requestKeys = new Set();
  const salesRepMap = new Map();
  const customerMap = new Map();
  const summary = {
    total_dollar_value: 0,
    completed_dollar_value: 0,
    pending_dollar_value: 0,
    total_requests: 0,
    total_line_items: lineItems.length,
    total_units_requested: 0,
    explicit_qty_line_count: 0,
    default_25_qty_line_count: 0,
  };
  for (const item of lineItems) {
    requestKeys.add(normalized(item.request_identity));
    summary.total_dollar_value += item.line_dollar_value;
    summary.total_units_requested += item.effective_qty;
    summary[item.status === 'Completed' ? 'completed_dollar_value' : 'pending_dollar_value'] += item.line_dollar_value;
    summary[item.is_default_qty ? 'default_25_qty_line_count' : 'explicit_qty_line_count'] += 1;

    const repKey = normalized(item.sales_rep) || 'unassigned';
    const rep = salesRepMap.get(repKey) || {
      sales_rep: item.sales_rep,
      total_dollar_value: 0,
      completed_dollar_value: 0,
      pending_dollar_value: 0,
      requestKeys: new Set(),
      line_item_count: 0,
      total_units: 0,
      customerKeys: new Set(),
    };
    rep.total_dollar_value += item.line_dollar_value;
    rep[item.status === 'Completed' ? 'completed_dollar_value' : 'pending_dollar_value'] += item.line_dollar_value;
    rep.requestKeys.add(normalized(item.request_identity));
    rep.line_item_count += 1;
    rep.total_units += item.effective_qty;
    rep.customerKeys.add(`${normalized(item.customer_name)}|${normalized(item.consignee_name)}`);
    salesRepMap.set(repKey, rep);

    const customerKey = `${normalized(item.customer_name)}|${normalized(item.consignee_name)}|${repKey}`;
    const customer = customerMap.get(customerKey) || {
      key: customerKey,
      customer_name: item.customer_name,
      consignee_name: item.consignee_name,
      customer_consignee_label: item.customer_consignee_label,
      sales_rep: item.sales_rep,
      total_dollar_value: 0,
      completed_dollar_value: 0,
      pending_dollar_value: 0,
      requestKeys: new Set(),
      line_item_count: 0,
      total_units: 0,
      items: [],
    };
    customer.total_dollar_value += item.line_dollar_value;
    customer[item.status === 'Completed' ? 'completed_dollar_value' : 'pending_dollar_value'] += item.line_dollar_value;
    customer.requestKeys.add(normalized(item.request_identity));
    customer.line_item_count += 1;
    customer.total_units += item.effective_qty;
    customer.items.push(item);
    customerMap.set(customerKey, customer);
  }
  summary.total_requests = requestKeys.size;
  for (const key of ['total_dollar_value', 'completed_dollar_value', 'pending_dollar_value']) summary[key] = money(summary[key]);
  const bySalesRep = [...salesRepMap.values()].map(rep => ({
    sales_rep: rep.sales_rep,
    total_dollar_value: money(rep.total_dollar_value),
    completed_dollar_value: money(rep.completed_dollar_value),
    pending_dollar_value: money(rep.pending_dollar_value),
    request_count: rep.requestKeys.size,
    line_item_count: rep.line_item_count,
    total_units: rep.total_units,
    customer_count: rep.customerKeys.size,
    avg_dollar_per_request: money(rep.total_dollar_value / Math.max(rep.requestKeys.size, 1)),
  })).sort((left, right) => right.total_dollar_value - left.total_dollar_value || left.sales_rep.localeCompare(right.sales_rep));
  const byCustomerConsignee = [...customerMap.values()].map(customer => ({
    key: customer.key,
    customer_name: customer.customer_name,
    consignee_name: customer.consignee_name,
    customer_consignee_label: customer.customer_consignee_label,
    sales_rep: customer.sales_rep,
    total_dollar_value: money(customer.total_dollar_value),
    completed_dollar_value: money(customer.completed_dollar_value),
    pending_dollar_value: money(customer.pending_dollar_value),
    request_count: customer.requestKeys.size,
    line_item_count: customer.line_item_count,
    total_units: customer.total_units,
    items: customer.items,
  })).sort((left, right) => right.total_dollar_value - left.total_dollar_value
    || left.customer_consignee_label.localeCompare(right.customer_consignee_label));
  return { summary, by_sales_rep: bySalesRep, by_customer_consignee: byCustomerConsignee, line_items: lineItems };
}

function responsePayload(response = {}) {
  const body = response && typeof response === 'object' ? response : {};
  return body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body;
}

export function normalizeRequestSalesImpactResponse(response = {}) {
  const payload = responsePayload(response);
  const grouped = Array.isArray(payload.by_customer_consignee) ? payload.by_customer_consignee : [];
  const nestedLines = grouped.flatMap(group => (Array.isArray(group.items) ? group.items : []).map(item => ({
    ...item,
    customer_name: firstValue(item, ['customer_name'], group.customer_name),
    consignee_name: firstValue(item, ['consignee_name'], group.consignee_name),
    customer_consignee_label: firstValue(item, ['customer_consignee_label'], group.customer_consignee_label),
    sales_rep: firstValue(item, ['sales_rep'], firstValue(group, ['sales_rep', 'primary_sales_rep'], 'Unassigned')),
  })));
  const lineItems = Array.isArray(payload.line_items) && payload.line_items.length ? payload.line_items : nestedLines;
  const sourceTableAudit = payload.source_table_audit || payload.source_audit || {};
  return {
    visible: payload.visible !== false,
    enabled: payload.enabled !== false,
    source_table_audit: sourceTableAudit,
    source_audit: sourceTableAudit,
    canonical: aggregateRequestSalesImpactLines(lineItems),
  };
}

function lineMatchesFilters(item, filters) {
  const query = normalized(filters.search);
  if (query && ![item.sales_rep, item.customer_name, item.consignee_name, item.commonname, item.itemcode]
    .some(value => normalized(value).includes(query))) return false;
  if (filters.status !== 'All' && item.status !== filters.status) return false;
  if (filters.salesRep && normalized(item.sales_rep) !== normalized(filters.salesRep)) return false;
  const date = text(item.request_date).slice(0, 10);
  if (filters.dateStart && (!date || date < filters.dateStart)) return false;
  if (filters.dateEnd && (!date || date > filters.dateEnd)) return false;
  return true;
}

export function buildRequestSalesImpactViewModel(canonical = {}, filters = {}) {
  const lineItems = Array.isArray(canonical.line_items) ? canonical.line_items : [];
  return aggregateRequestSalesImpactLines(lineItems.filter(item => lineMatchesFilters(item, filters)));
}

export function buildRequestSalesImpactExportSheets(model = {}) {
  const summary = model.summary || {};
  const summaryRows = [
    { metric: 'Total Request Impact', value: money(summary.total_dollar_value) },
    { metric: 'Completed Requests', value: money(summary.completed_dollar_value) },
    { metric: 'Pending Requests', value: money(summary.pending_dollar_value) },
    { metric: 'Requests / Folders', value: number(summary.total_requests) },
    { metric: 'Line Items', value: number(summary.total_line_items) },
    { metric: 'Plants Requested', value: number(summary.total_units_requested) },
    { metric: 'Rows With Populated Qty', value: number(summary.explicit_qty_line_count) },
    { metric: 'Rows Using Default 25', value: number(summary.default_25_qty_line_count) },
  ];
  return [
    { name: 'Summary', title: 'Request Sales Impact Summary', columns: [{ label: 'Metric', key: 'metric' }, { label: 'Value', key: 'value' }], rows: summaryRows },
    { name: 'Sales Rep Rollup', title: 'Request Impact by Sales Rep', columns: [
      ['Sales Rep', 'sales_rep'], ['Total Value', 'total_dollar_value'], ['Completed Value', 'completed_dollar_value'],
      ['Pending Value', 'pending_dollar_value'], ['Requests', 'request_count'], ['Line Items', 'line_item_count'],
      ['Plants', 'total_units'], ['Customers', 'customer_count'], ['Average Per Request', 'avg_dollar_per_request'],
    ].map(([label, key]) => ({ label, key })), rows: model.by_sales_rep || [] },
    { name: 'Customer Consignee', title: 'Request Impact by Customer and Consignee', columns: [
      ['Customer', 'customer_name'], ['Consignee', 'consignee_name'], ['Sales Rep', 'sales_rep'],
      ['Total Value', 'total_dollar_value'], ['Completed Value', 'completed_dollar_value'], ['Pending Value', 'pending_dollar_value'],
      ['Requests', 'request_count'], ['Line Items', 'line_item_count'], ['Plants', 'total_units'],
    ].map(([label, key]) => ({ label, key })), rows: model.by_customer_consignee || [] },
    { name: 'Line Item Detail', title: 'Request Sales Impact Line Items', columns: [
      ['Date', 'request_date'], ['Folder', 'folder_id'], ['Status', 'status'], ['Sales Rep', 'sales_rep'],
      ['Customer', 'customer_name'], ['Consignee', 'consignee_name'], ['Item Code', 'itemcode'], ['Common Name', 'commonname'],
      ['Size', 'contsize'], ['Lot', 'lotcode'], ['Location', 'locationcode'], ['Raw Qty', 'raw_qty'],
      ['Effective Qty', 'effective_qty'], ['Default 25', 'is_default_qty'], ['List Price', 'list_price'], ['Line Value', 'line_dollar_value'],
    ].map(([label, key]) => ({ label, key })), rows: model.line_items || [] },
  ];
}

function downloadCsvFallback(model) {
  const columns = buildRequestSalesImpactExportSheets(model).at(-1).columns;
  const escapeCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.map(column => escapeCell(column.label)).join(',')];
  for (const row of model.line_items || []) lines.push(columns.map(column => escapeCell(row[column.key])).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `request-sales-impact-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 0);
}

const dashboardState = {
  host: null,
  bridge: null,
  scopeKey: '',
  payload: null,
  loading: false,
  error: '',
  tab: 'sales-rep',
  filters: { search: '', status: 'All', dateStart: '', dateEnd: '', salesRep: '' },
  expandedCustomers: new Set(),
  visibleLimits: { 'sales-rep': 100, customer: 100, items: 200 },
};

function formatDate(value = '') {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(parsed) : 'No date';
}

function rememberFocus() {
  const active = document.activeElement;
  if (!dashboardState.host?.contains(active) || !active?.id) return null;
  return { id: active.id, start: active.selectionStart, end: active.selectionEnd };
}

function restoreFocus(focus) {
  if (!focus) return;
  requestAnimationFrame(() => {
    const input = document.getElementById(focus.id);
    if (!input) return;
    input.focus({ preventScroll: true });
    if (typeof input.setSelectionRange === 'function' && Number.isFinite(focus.start)) input.setSelectionRange(focus.start, focus.end);
  });
}

function renderKpis(summary) {
  return `<div class="request-impact-kpis">
    <article class="request-impact-kpi request-impact-kpi-primary"><span>Total App Request Impact</span><strong>${currencyFormatter.format(number(summary.total_dollar_value))}</strong></article>
    <article class="request-impact-kpi"><span>Completed / Pending</span><strong>${currencyFormatter.format(number(summary.completed_dollar_value))}</strong><small>${currencyFormatter.format(number(summary.pending_dollar_value))} pending</small></article>
    <article class="request-impact-kpi"><span>Requests / Line Items</span><strong>${numberFormatter.format(number(summary.total_requests))} / ${numberFormatter.format(number(summary.total_line_items))}</strong><small>folders / requested rows</small></article>
    <article class="request-impact-kpi"><span>Total Plants Requested</span><strong>${numberFormatter.format(number(summary.total_units_requested))}</strong><small>${numberFormatter.format(number(summary.explicit_qty_line_count))} populated Qty Â· ${numberFormatter.format(number(summary.default_25_qty_line_count))} default 25</small></article>
  </div>`;
}

function renderSourceAudit(audit = {}, summary = {}) {
  const tables = Array.isArray(audit.tables) ? audit.tables : [];
  const rows = tables.map(row => `<tr><td><strong>${escapeHtml(`${row.schema_name || 'public'}.${row.table_name || ''}`)}</strong><small>${escapeHtml(row.note || '')}</small></td><td>${row.total_raw_rows === null || row.total_raw_rows === undefined ? 'Not present' : numberFormatter.format(number(row.total_raw_rows))}</td><td>${numberFormatter.format(number(row.request_related_rows))}</td><td>${numberFormatter.format(number(row.extracted_line_items))}</td><td>${numberFormatter.format(number(row.duplicate_rows_merged))}</td></tr>`).join('');
  const revision = audit.revision_46957 || {};
  return `<details class="request-impact-audit"><summary><span><i class="ph-bold ph-database"></i><strong>Source Table & Row Audit</strong></span><small>${numberFormatter.format(number(audit.final_deduplicated_line_items ?? summary.total_line_items))} final lines · ${currencyFormatter.format(number(audit.grand_total_dollar_impact ?? summary.total_dollar_value))}</small></summary><div class="request-impact-audit-body"><div class="request-impact-audit-totals"><span><strong>${numberFormatter.format(number(audit.total_extracted_line_items))}</strong> extracted</span><span><strong>${numberFormatter.format(number(audit.duplicate_source_rows_merged))}</strong> duplicate source rows merged</span><span><strong>${numberFormatter.format(number(audit.duplicate_submitted_completed_pairs_merged))}</strong> submitted/completed pairs</span><span><strong>${numberFormatter.format(number(audit.final_deduplicated_line_items ?? summary.total_line_items))}</strong> deduplicated lines</span></div><div class="request-impact-audit-table-wrap"><table><thead><tr><th>Source table</th><th>Raw rows</th><th>Request rows</th><th>Extracted lines</th><th>Duplicates</th></tr></thead><tbody>${rows}</tbody></table></div><p><strong>Revision 46,957:</strong> ${escapeHtml(revision.relationship || 'A dataset revision marker, not a request row count.')} Current matches: ${numberFormatter.format(number(revision.matching_current_rows))}; current maximum revision: ${numberFormatter.format(number(revision.current_max_revision))}.</p></div></details>`;
}

function renderSalesRepRows(model) {
  const rows = model.by_sales_rep.slice(0, dashboardState.visibleLimits['sales-rep']);
  const cards = rows.map((row, index) => `<button type="button" class="request-impact-rank-card" data-impact-action="select-rep" data-impact-value="${escapeHtml(row.sales_rep)}">
    <span class="request-impact-rank">#${index + 1}</span><span class="request-impact-rank-main"><strong>${escapeHtml(row.sales_rep)}</strong><small>${numberFormatter.format(row.request_count)} requests Â· ${numberFormatter.format(row.line_item_count)} items Â· ${numberFormatter.format(row.total_units)} plants</small></span>
    <span class="request-impact-rank-values"><strong>${currencyFormatter.format(row.total_dollar_value)}</strong><small>${currencyFormatter.format(row.completed_dollar_value)} completed Â· ${currencyFormatter.format(row.pending_dollar_value)} pending</small></span>
  </button>`).join('');
  const more = model.by_sales_rep.length > rows.length ? `<button type="button" class="request-impact-more" data-impact-action="show-more" data-impact-value="sales-rep">Show More (${model.by_sales_rep.length - rows.length})</button>` : '';
  return (cards || '<div class="request-impact-empty">No sales reps match these filters.</div>') + more;
}

function renderItemTable(items = []) {
  return `<div class="request-impact-table-scroll"><table class="request-impact-table"><thead><tr><th>Date</th><th>Status</th><th>Item</th><th>Size</th><th>Lot / Location</th><th>Qty</th><th>List Price</th><th>Line Value</th></tr></thead><tbody>${items.map(item => `<tr>
    <td>${escapeHtml(formatDate(item.request_date))}</td><td><span class="request-impact-status request-impact-status-${item.status.toLowerCase()}">${escapeHtml(item.status)}</span></td>
    <td><strong>${escapeHtml(item.commonname || item.itemcode || 'Unnamed Item')}</strong><small>${escapeHtml(item.itemcode)}</small></td><td>${escapeHtml(item.contsize || 'N/A')}</td>
    <td>${escapeHtml(item.lotcode || 'N/A')}<small>${escapeHtml(item.locationcode || 'N/A')}</small></td>
    <td>${numberFormatter.format(item.effective_qty)}${item.is_default_qty ? '<small class="request-impact-default-qty">25 Default</small>' : ''}</td>
    <td>${currencyFormatter.format(item.list_price)}</td><td><strong>${currencyFormatter.format(item.line_dollar_value)}</strong></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function renderCustomerRows(model) {
  const rows = model.by_customer_consignee.slice(0, dashboardState.visibleLimits.customer);
  const cards = rows.map((row, index) => {
    const expanded = dashboardState.expandedCustomers.has(row.key);
    return `<article class="request-impact-customer-card"><button type="button" class="request-impact-customer-summary" data-impact-action="toggle-customer" data-impact-value="${escapeHtml(row.key)}" aria-expanded="${expanded}">
      <span class="request-impact-rank">#${index + 1}</span><span class="request-impact-rank-main"><strong>${escapeHtml(row.customer_consignee_label)}</strong><small>${escapeHtml(row.sales_rep)} Â· ${numberFormatter.format(row.request_count)} requests Â· ${numberFormatter.format(row.line_item_count)} items Â· ${numberFormatter.format(row.total_units)} plants</small></span>
      <span class="request-impact-rank-values"><strong>${currencyFormatter.format(row.total_dollar_value)}</strong><small>${expanded ? 'Hide item detail' : 'Show item detail'}</small></span>
    </button>${expanded ? renderItemTable(row.items) : ''}</article>`;
  }).join('');
  const more = model.by_customer_consignee.length > rows.length ? `<button type="button" class="request-impact-more" data-impact-action="show-more" data-impact-value="customer">Show More (${model.by_customer_consignee.length - rows.length})</button>` : '';
  return (cards || '<div class="request-impact-empty">No customer / consignee rows match these filters.</div>') + more;
}

function renderAllItems(model) {
  const rows = model.line_items.slice(0, dashboardState.visibleLimits.items);
  const more = model.line_items.length > rows.length ? `<button type="button" class="request-impact-more" data-impact-action="show-more" data-impact-value="items">Show More (${model.line_items.length - rows.length})</button>` : '';
  return (rows.length ? renderItemTable(rows) : '<div class="request-impact-empty">No request line items match these filters.</div>') + more;
}

function renderDashboard() {
  const host = dashboardState.host;
  if (!host) return;
  const focus = rememberFocus();
  if (!dashboardState.payload) {
    host.innerHTML = `<div class="request-impact-loading"><i class="ph-bold ph-chart-line-up"></i><strong>${dashboardState.loading ? 'Calculating Request Sales Impactâ€¦' : 'Request Sales Impact is unavailable.'}</strong>${dashboardState.error ? `<span>${escapeHtml(dashboardState.error)}</span>` : ''}<button type="button" data-impact-action="refresh">Retry</button></div>`;
    restoreFocus(focus);
    return;
  }
  const model = buildRequestSalesImpactViewModel(dashboardState.payload.canonical, dashboardState.filters);
  const activeTab = dashboardState.tab;
  const selectedRep = dashboardState.filters.salesRep;
  const results = activeTab === 'sales-rep' ? renderSalesRepRows(model) : activeTab === 'customer' ? renderCustomerRows(model) : renderAllItems(model);
  host.innerHTML = `<section class="request-impact-shell">
    <header class="request-impact-hero"><div><span>Private Executive Analytics Â· Dylan Collyge Only</span><h1>Request Sales Impact ($)</h1><p>Deduplicated active, completed, historical, and delivery evidence using populated Qty or default 25 Ã— List Price.</p></div><div class="request-impact-hero-actions"><button type="button" data-impact-action="refresh" ${dashboardState.loading ? 'disabled' : ''}><i class="ph-bold ph-arrows-clockwise"></i>${dashboardState.loading ? 'Refreshing' : 'Refresh'}</button><button type="button" data-impact-action="export"><i class="ph-bold ph-download-simple"></i>Export Excel / CSV</button></div></header>
    ${dashboardState.error ? `<div class="request-impact-retained" role="status">Showing retained same-account results. ${escapeHtml(dashboardState.error)}</div>` : ''}
    ${renderSourceAudit(dashboardState.payload.source_table_audit, model.summary)}
    ${renderKpis(model.summary)}
    <div class="request-impact-controls"><label class="request-impact-search"><span>Search</span><input id="request-impact-search" type="search" value="${escapeHtml(dashboardState.filters.search)}" placeholder="Sales rep, customer, consignee, plant, item code" data-impact-filter="search"></label><label><span>Status</span><select data-impact-filter="status"><option${dashboardState.filters.status === 'All' ? ' selected' : ''}>All</option><option${dashboardState.filters.status === 'Completed' ? ' selected' : ''}>Completed</option><option${dashboardState.filters.status === 'Pending' ? ' selected' : ''}>Pending</option></select></label><label><span>From</span><input type="date" value="${escapeHtml(dashboardState.filters.dateStart)}" data-impact-filter="dateStart"></label><label><span>Through</span><input type="date" value="${escapeHtml(dashboardState.filters.dateEnd)}" data-impact-filter="dateEnd"></label>${selectedRep ? `<button type="button" class="request-impact-selected-rep" data-impact-action="clear-rep"><span>Sales Rep</span><strong>${escapeHtml(selectedRep)}</strong><i class="ph-bold ph-x"></i></button>` : ''}<button type="button" class="request-impact-clear" data-impact-action="clear-filters">Clear Filters</button></div>
    <nav class="request-impact-tabs" aria-label="Request impact breakdown"><button type="button" class="${activeTab === 'sales-rep' ? 'active' : ''}" data-impact-action="tab" data-impact-value="sales-rep">By Sales Rep ($)</button><button type="button" class="${activeTab === 'customer' ? 'active' : ''}" data-impact-action="tab" data-impact-value="customer">By Customer / Consignee ($)</button><button type="button" class="${activeTab === 'items' ? 'active' : ''}" data-impact-action="tab" data-impact-value="items">All Request Line Items</button></nav>
    <div class="request-impact-result-meta"><strong>${numberFormatter.format(model.summary.total_line_items)} line items</strong><span>${numberFormatter.format(model.summary.total_requests)} requests Â· ${currencyFormatter.format(model.summary.total_dollar_value)}</span></div>
    <div class="request-impact-results">${results}</div>
  </section>`;
  restoreFocus(focus);
}

async function refreshDashboard() {
  if (dashboardState.loading || !dashboardState.bridge?.transport) return false;
  dashboardState.loading = true;
  dashboardState.error = '';
  renderDashboard();
  try {
    const response = await dashboardState.bridge.transport({ action: 'request_sales_impact' });
    if (response?.visible === false || response?.enabled === false) {
      dashboardState.bridge.onForbidden?.();
      return false;
    }
    if (!response?.ok) throw new Error('Live analytics refresh is temporarily unavailable.');
    dashboardState.payload = normalizeRequestSalesImpactResponse(response);
  } catch (error) {
    dashboardState.error = text(error?.message) || 'Live analytics refresh is temporarily unavailable.';
  } finally {
    dashboardState.loading = false;
    renderDashboard();
  }
  return false;
}

function exportDashboard() {
  if (!dashboardState.payload) return false;
  const model = buildRequestSalesImpactViewModel(dashboardState.payload.canonical, dashboardState.filters);
  const sheets = buildRequestSalesImpactExportSheets(model);
  if (typeof dashboardState.bridge?.exportWorkbook === 'function') dashboardState.bridge.exportWorkbook(sheets, model);
  else downloadCsvFallback(model);
  dashboardState.bridge?.toast?.('Export Ready', `Downloading ${numberFormatter.format(model.line_items.length)} request impact rows.`);
  return false;
}

function handleClick(event) {
  const button = event.target.closest('[data-impact-action]');
  if (!button || !dashboardState.host?.contains(button)) return;
  const action = button.dataset.impactAction;
  const value = text(button.dataset.impactValue);
  if (action === 'refresh') void refreshDashboard();
  else if (action === 'export') exportDashboard();
  else if (action === 'tab') { dashboardState.tab = value || 'sales-rep'; renderDashboard(); }
  else if (action === 'select-rep') { dashboardState.filters.salesRep = value; dashboardState.tab = 'customer'; renderDashboard(); }
  else if (action === 'clear-rep') { dashboardState.filters.salesRep = ''; renderDashboard(); }
  else if (action === 'clear-filters') {
    dashboardState.filters = { search: '', status: 'All', dateStart: '', dateEnd: '', salesRep: '' };
    dashboardState.expandedCustomers.clear();
    renderDashboard();
  } else if (action === 'toggle-customer') {
    if (dashboardState.expandedCustomers.has(value)) dashboardState.expandedCustomers.delete(value);
    else dashboardState.expandedCustomers.add(value);
    renderDashboard();
  } else if (action === 'show-more') {
    dashboardState.visibleLimits[value] = number(dashboardState.visibleLimits[value]) + (value === 'items' ? 200 : 100);
    renderDashboard();
  }
}

function handleFilter(event) {
  const input = event.target.closest('[data-impact-filter]');
  if (!input || !dashboardState.host?.contains(input)) return;
  dashboardState.filters[input.dataset.impactFilter] = input.value;
  dashboardState.expandedCustomers.clear();
  renderDashboard();
}

export function mountRequestSalesImpact(host, bridge = {}) {
  const scopeKey = text(bridge.scopeKey);
  if (!host || !scopeKey) throw new Error('Request Sales Impact requires an authenticated owner.');
  if (dashboardState.scopeKey && dashboardState.scopeKey !== scopeKey) {
    dashboardState.payload = null;
    dashboardState.filters = { search: '', status: 'All', dateStart: '', dateEnd: '', salesRep: '' };
    dashboardState.expandedCustomers.clear();
  }
  if (dashboardState.host && dashboardState.host !== host) {
    dashboardState.host.removeEventListener('click', handleClick);
    dashboardState.host.removeEventListener('input', handleFilter);
    dashboardState.host.removeEventListener('change', handleFilter);
  }
  dashboardState.host = host;
  dashboardState.bridge = bridge;
  dashboardState.scopeKey = scopeKey;
  host.removeEventListener('click', handleClick);
  host.removeEventListener('input', handleFilter);
  host.removeEventListener('change', handleFilter);
  host.addEventListener('click', handleClick);
  host.addEventListener('input', handleFilter);
  host.addEventListener('change', handleFilter);
  renderDashboard();
  if (!dashboardState.payload) void refreshDashboard();
  return {
    refresh: refreshDashboard,
    update(nextBridge = {}) { dashboardState.bridge = nextBridge; renderDashboard(); },
    destroy() {
      host.removeEventListener('click', handleClick);
      host.removeEventListener('input', handleFilter);
      host.removeEventListener('change', handleFilter);
      host.replaceChildren();
      if (dashboardState.host === host) dashboardState.host = null;
    },
  };
}

export function clearRequestSalesImpactAccountState() {
  dashboardState.payload = null;
  dashboardState.scopeKey = '';
  dashboardState.error = '';
  dashboardState.expandedCustomers.clear();
}
