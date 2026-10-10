import type { Database } from '../supabase/functions/_shared/database.types';

type SourceRow = Database['public']['Tables']['ph_customer_consignee_sales_reps']['Row'];
export type MappingRow = Pick<SourceRow, 'unique_id' | 'customeridentityid' | 'consigneeid' | 'salesrepid' | 'salesrepname' | 'customername' | 'consigneename' | 'customerstatus' | 'consigneestatus'> & { revision: string };
const columns = ['salesrepid', 'salesrepname', 'customername', 'consigneename'] as const;
type Column = typeof columns[number];
const labels: Record<Column, string> = { salesrepid: 'Sales Rep ID', salesrepname: 'Sales Rep Name', customername: 'Customer Name', consigneename: 'Consignee Name' };
export type MappingTransport = (payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export interface MappingPage { rows: MappingRow[]; total: number; page: number; pageSize: number; revision: string; canEdit: boolean }
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const textFields = ['customeridentityid', 'consigneeid', ...columns, 'customerstatus', 'consigneestatus'] as const;

export function mappingRow(value: unknown): MappingRow {
  if (!isRecord(value) || typeof value.unique_id !== 'string' || !value.unique_id || typeof value.revision !== 'string' || !value.revision) throw new Error('Invalid mapping response. Refresh and try again.');
  for (const key of textFields) if (value[key] !== null && typeof value[key] !== 'string') throw new Error('Invalid mapping field: ' + key);
  return { unique_id: value.unique_id, revision: value.revision,
    customeridentityid: value.customeridentityid as string | null, consigneeid: value.consigneeid as string | null,
    salesrepid: value.salesrepid as string | null, salesrepname: value.salesrepname as string | null,
    customername: value.customername as string | null, consigneename: value.consigneename as string | null,
    customerstatus: value.customerstatus as string | null, consigneestatus: value.consigneestatus as string | null };
}
export function mappingPage(value: unknown): MappingPage {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.rows) || value.rows.length > 100
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Number.isSafeInteger(value.page) || Number(value.page) < 0
    || !Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 100
    || typeof value.revision !== 'string' || typeof value.canEdit !== 'boolean') throw new Error('Mapping directory is unavailable. Refresh and try again.');
  return { rows: value.rows.map(mappingRow), total: Number(value.total), page: Number(value.page), pageSize: Number(value.pageSize), revision: value.revision, canEdit: value.canEdit };
}

/** Server authorization remains authoritative. This view owns no shared application state. */
export function mountCustomerRepMapping(root: HTMLElement, transport: MappingTransport, onSaved: () => void): () => void {
  let page = 0, sort: Column = 'customername', direction = 'asc', generation = 0, disposed = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let editing = false;
  const filters: Record<Column | 'status', string> = { salesrepid: '', salesrepname: '', customername: '', consigneename: '', status: 'all' };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = root.ownerDocument.createElement(tag); node.textContent = text; return node;
  };
  const style = element('style');
  style.textContent = '.customer-rep-map{color:var(--text-primary,#17251c);background:var(--bg-surface,#fff);padding:16px;border-radius:16px}.customer-rep-map table{border-collapse:collapse;width:100%;min-width:760px}.customer-rep-map th,.customer-rep-map td{padding:8px;text-align:left;border-bottom:1px solid var(--border-color,#dbe4dc);vertical-align:top}.customer-rep-map input,.customer-rep-map select,.customer-rep-map button{font:inherit;color:inherit;background:var(--bg-surface,#fff);border:1px solid var(--border-color,#cbd5e1);border-radius:6px;padding:8px;min-height:40px}.customer-rep-map th input{display:block;width:100%;box-sizing:border-box;min-width:110px}.customer-rep-map button{cursor:pointer}.customer-rep-map button:disabled{opacity:.5;cursor:default}.customer-rep-map small{display:block}.customer-rep-map [role=alert]{color:var(--error-text,#b91c1c)}.customer-rep-map .mapping-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.customer-rep-map [data-mapping-editor]{border:1px solid var(--border-color,#cbd5e1);padding:12px;margin:12px 0}.customer-rep-map [data-mapping-editor] label{display:block;margin:8px 0}.customer-rep-map [data-mapping-editor] input{display:block;width:100%;box-sizing:border-box}';
  root.replaceChildren(style); root.classList.add('customer-rep-map');
  root.append(element('h2', 'Sales Rep Customer Mapping'), element('p', 'Manual corrections apply immediately. The next successful master-file import replaces them.'));
  const toolbar = element('div'); toolbar.className = 'mapping-actions';
  const statusSelect = element('select'); statusSelect.setAttribute('aria-label', 'Mapping status');
  for (const [value, label] of [['all','All records'],['active','Active'],['inactive','Inactive'],['unassigned','Unassigned']]) {
    const option = element('option', label); option.value = value; statusSelect.append(option);
  }
  const refresh = element('button', 'Refresh'); refresh.type = 'button';
  toolbar.append(statusSelect, refresh); root.append(toolbar);
  const status = element('p'); status.setAttribute('role', 'status'); root.append(status);
  const error = element('p'); error.setAttribute('role', 'alert'); root.append(error);
  const editorHost = element('div'); root.append(editorHost);
  const scroll = element('div'); scroll.style.overflowX = 'auto'; scroll.tabIndex = 0; scroll.setAttribute('aria-label', 'Customer mappings');
  const table = element('table'); const head = element('thead'); const header = element('tr');
  for (const column of columns) {
    const th = element('th'); th.scope = 'col';
    const sortButton = element('button', labels[column]); sortButton.type = 'button'; sortButton.setAttribute('aria-label', 'Sort by ' + labels[column]);
    sortButton.onclick = () => { if (editing) return; direction = sort === column && direction === 'asc' ? 'desc' : 'asc'; sort = column; page = 0; void load(); };
    const input = element('input'); input.type = 'search'; input.placeholder = 'Filter'; input.setAttribute('aria-label', 'Filter ' + labels[column]);
    input.oninput = () => { filters[column] = input.value; page = 0; clearTimeout(timer); timer = setTimeout(() => { if (!editing) void load(); }, 250); };
    th.append(sortButton, input); header.append(th);
  }
  header.append(element('th', 'Status'), element('th', 'Actions')); head.append(header);
  const body = element('tbody'); table.append(head, body); scroll.append(table); root.append(scroll);
  const footer = element('div'); footer.className = 'mapping-actions'; const previous = element('button', 'Previous'), next = element('button', 'Next');
  previous.type = next.type = 'button'; previous.onclick = () => { page = Math.max(0,page-1); void load(); }; next.onclick = () => { page++; void load(); };
  footer.append(previous, next); root.append(footer);
  function endEdit() { editing = false; editorHost.replaceChildren(); refresh.disabled = false; statusSelect.disabled = false; void load(); }
  function edit(row: MappingRow) {
    editing = true; error.textContent = ''; refresh.disabled = true; statusSelect.disabled = true; previous.disabled = next.disabled = true;
    const form = element('form'); form.dataset.mappingEditor = row.unique_id;
    form.append(element('h3', 'Edit mapping'), element('p', `Customer ID: ${row.customeridentityid || 'Unresolved'} · Consignee ID: ${row.consigneeid || 'Unresolved'}`));
    const inputs = new Map<Column, HTMLInputElement>();
    for (const column of columns) { const label = element('label', labels[column]); const input = element('input'); input.value = row[column] || ''; input.maxLength = 240; input.required = true; label.append(input); form.append(label); inputs.set(column,input); }
    const save = element('button', 'Save mapping'); save.type = 'submit'; const cancel = element('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = endEdit;
    form.append(save,cancel); editorHost.replaceChildren(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      save.disabled = cancel.disabled = true; error.textContent = '';
      const ticket = ++generation; controller?.abort(); controller = new AbortController();
      try {
        const result = await transport({ action: 'customer-rep-map', operation: 'save', id: row.unique_id, expectedRevision: row.revision,
          salesrepId: inputs.get('salesrepid')!.value.trim(), salesrepName: inputs.get('salesrepname')!.value.trim(),
          customerName: inputs.get('customername')!.value.trim(), consigneeName: inputs.get('consigneename')!.value.trim() }, controller.signal);
        if (disposed || ticket !== generation) return;
        if (!isRecord(result) || result.ok !== true) throw new Error('The mapping was not confirmed saved.');
        mappingRow(result.row); onSaved(); endEdit();
      } catch (reason) { if (!disposed && ticket === generation) { error.textContent = reason instanceof Error ? reason.message : 'Save failed. Cancel and refresh before retrying.'; save.disabled = cancel.disabled = false; } }
    };
    inputs.get('salesrepid')?.focus();
  }
  async function load() {
    if (disposed || editing) return;
    const ticket = ++generation; controller?.abort(); controller = new AbortController(); status.textContent = 'Loading mappings…'; error.textContent = ''; previous.disabled = next.disabled = true;
    try {
      const result = mappingPage(await transport({ action: 'customer-rep-map', operation: 'list', page, pageSize: 50, filters: {...filters}, sort, direction },controller.signal));
      if (disposed || ticket !== generation) return;
      body.replaceChildren();
      for (const row of result.rows) {
        const tr = element('tr');
        for (const column of columns) { const td = element('td', row[column] || 'Unassigned'); if (column === 'customername') td.append(element('small', 'ID ' + (row.customeridentityid || 'unresolved'))); if (column === 'consigneename') td.append(element('small','ID ' + (row.consigneeid || 'unresolved'))); tr.append(td); }
        const assigned = !!row.salesrepid?.trim() && !!row.salesrepname?.trim();
        const active = row.customerstatus?.trim().toUpperCase() === 'A' && row.consigneestatus?.trim().toUpperCase() === 'A';
        tr.append(element('td', !assigned ? 'Unassigned' : active ? 'Active' : 'Inactive'));
        const td = element('td'); if (result.canEdit) { const button = element('button','Edit'); button.type = 'button'; button.onclick = () => { if (!editing) edit(row); }; td.append(button); } tr.append(td); body.append(tr);
      }
      page = result.page; status.textContent = result.total ? `${result.total.toLocaleString()} mappings · Page ${page+1} of ${Math.max(1,Math.ceil(result.total/result.pageSize))}` : 'No matching mappings.';
      previous.disabled = page === 0; next.disabled = (page+1)*result.pageSize >= result.total;
    } catch (reason) { if (!disposed && ticket === generation) { status.textContent = ''; error.textContent = reason instanceof Error ? reason.message : 'Mappings unavailable. Select Refresh to retry.'; body.replaceChildren(); } }
  }
  refresh.onclick = () => { void load(); }; statusSelect.onchange = () => { filters.status = statusSelect.value; page = 0; void load(); };
  const changed = () => { if (editing) error.textContent = 'Mappings changed while editing. Saving will verify this row is still current.'; else void load(); };
  root.addEventListener('mapping-revision', changed);
  void load();
  return () => { disposed = true; generation++; clearTimeout(timer); controller?.abort(); root.removeEventListener('mapping-revision', changed); root.replaceChildren(); };
}
