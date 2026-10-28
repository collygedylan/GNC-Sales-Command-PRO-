import type { Database } from '../supabase/functions/_shared/database.types';
import { createCustomerRepAssignments, type AssignmentPage, type RepOption } from './customerRepAssignments';
export { createCustomerRepAssignments, prefetchCustomerRepOptions, validateMappingPage as mappingPage, validateMappingRow as mappingRow } from './customerRepAssignments';

type SourceRow = Database['public']['Tables']['ph_customer_consignee_sales_reps']['Row'];
export type MappingRow = Pick<SourceRow, 'unique_id' | 'customeridentityid' | 'consigneeid' | 'salesrepid' | 'salesrepname' | 'customername' | 'consigneename' | 'customerstatus' | 'consigneestatus'> & {
  revision: string; hasOverride?: boolean; sourceSalesrepId?: string | null; sourceSalesrepName?: string | null;
};
const columns = ['customername', 'consigneename', 'salesrepid', 'salesrepname'] as const;
type Column = typeof columns[number];
const labels: Record<Column, string> = { salesrepid: 'Sales Rep ID', salesrepname: 'Sales Rep Name', customername: 'Customer Name', consigneename: 'Consignee Name' };
export type MappingTransport = (payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export type MappingPage = AssignmentPage;

/** Server authorization remains authoritative. This view owns no shared application state. */
export function mountCustomerRepMapping(root: HTMLElement, transport: MappingTransport, onSaved: () => void, identityScope = ''): () => void {
  let page = 0, sort: Column = 'customername', direction = 'asc', generation = 0, disposed = false;
  let controller: AbortController | undefined;
  let repController: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let editing = false, reps: RepOption[] = [], listRevision = '', repsRevision = '';
  let displayedPage: MappingPage | undefined;
  const assignments = createCustomerRepAssignments(transport, identityScope);
  const drafts = new Map<string, string>();
  const filters: Record<Column | 'status', string> = { salesrepid: '', salesrepname: '', customername: '', consigneename: '', status: 'all' };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = root.ownerDocument.createElement(tag); node.textContent = text; return node;
  };
  const style = element('style');
  style.textContent = '.customer-rep-map{color:var(--text-primary,#17251c);background:var(--bg-surface,#fff);padding:16px;border-radius:16px}.customer-rep-map table{border-collapse:collapse;width:100%;min-width:760px}.customer-rep-map th,.customer-rep-map td{padding:8px;text-align:left;border-bottom:1px solid var(--border-color,#dbe4dc);vertical-align:top}.customer-rep-map input,.customer-rep-map select,.customer-rep-map button{font:inherit;color:inherit;background:var(--bg-surface,#fff);border:1px solid var(--border-color,#cbd5e1);border-radius:6px;padding:8px;min-height:40px}.customer-rep-map th input{display:block;width:100%;box-sizing:border-box;min-width:110px}.customer-rep-map button{cursor:pointer}.customer-rep-map button:disabled{opacity:.5;cursor:default}.customer-rep-map small{display:block}.customer-rep-map [role=alert]{color:var(--error-text,#b91c1c)}.customer-rep-map .mapping-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.customer-rep-map [data-mapping-editor]{border:1px solid var(--border-color,#cbd5e1);padding:12px;margin:12px 0}.customer-rep-map [data-mapping-editor] label{display:block;margin:8px 0}.customer-rep-map [data-mapping-editor] input{display:block;width:100%;box-sizing:border-box}';
  root.replaceChildren(style); root.classList.add('customer-rep-map');
  root.append(element('h2', 'Customer Assignments'), element('p', 'Manager assignments remain in place across imports. Imported assignments can be restored at any time.'));
  const toolbar = element('div'); toolbar.className = 'mapping-actions';
  const statusSelect = element('select'); statusSelect.setAttribute('aria-label', 'Mapping status');
  for (const [value, label] of [['all','All records'],['active','Active'],['inactive','Inactive'],['unassigned','Unassigned']]) {
    const option = element('option', label); option.value = value; statusSelect.append(option);
  }
  const refresh = element('button', 'Refresh'); refresh.type = 'button';
  const add = element('button', '+ Add Row'); add.type = 'button'; add.hidden = true;
  add.onclick = () => { if (!editing) createMapping(); };
  toolbar.append(statusSelect, refresh, add); root.append(toolbar);
  const status = element('p'); status.setAttribute('role', 'status'); root.append(status);
  const error = element('p'); error.setAttribute('role', 'alert'); root.append(error);
  const repError = element('p'); repError.setAttribute('role', 'alert'); repError.dataset.assignmentError = 'catalog'; root.append(repError);
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
  header.append(element('th', 'Status'), element('th', 'Assignment source'), element('th', 'Actions')); head.append(header);
  const body = element('tbody'); table.append(head, body); scroll.append(table); root.append(scroll);
  const footer = element('div'); footer.className = 'mapping-actions'; const previous = element('button', 'Previous'), next = element('button', 'Next');
  previous.type = next.type = 'button'; previous.onclick = () => { page = Math.max(0,page-1); void load(); }; next.onclick = () => { page++; void load(); };
  footer.append(previous, next); root.append(footer);
  function endEdit(reload = true) { editing = false; editorHost.replaceChildren(); refresh.disabled = false; statusSelect.disabled = false; previous.disabled = next.disabled = false; if (reload) void load(); }
  function createMapping() {
    editing = true; error.textContent = ''; const requestId = crypto.randomUUID();
    const form = element('form'); form.dataset.mappingEditor = 'new'; form.append(element('h3', 'Add customer assignment'));
    const inputs = new Map<string, HTMLInputElement>();
    for (const [key, labelText] of [['customerId','Customer Number'],['customerName','Customer Name'],['consigneeId','Consignee ID'],['consigneeName','Consignee Name'],['territory','Territory']]) {
      const label = element('label', labelText), input = element('input'); input.required = key !== 'territory'; input.maxLength = key === 'territory' ? 120 : 240;
      input.setAttribute('aria-label', labelText); label.append(input); form.append(label); inputs.set(key,input);
    }
    const select = element('select'); select.required = true; select.setAttribute('aria-label','Sales Rep');
    const placeholder = element('option','Choose a sales rep'); placeholder.value = ''; select.append(placeholder);
    for (const rep of reps) { const option = element('option',`${rep.salesrepName} · ${rep.salesrepId}`); option.value=rep.salesrepId; select.append(option); }
    const save = element('button','Save Changes'), cancel = element('button','Cancel'); save.type='submit'; cancel.type='button'; cancel.onclick=()=>endEdit();
    form.append(select,save,cancel); editorHost.replaceChildren(form);
    form.onsubmit=async event=>{
      event.preventDefault(); if(save.disabled)return; save.disabled=cancel.disabled=true; error.textContent='';
      const ticket=++generation; controller?.abort(); controller=new AbortController();
      try {
        const result=await transport({action:'customer-rep-map',operation:'create',requestId,salesrepId:select.value,
          ...Object.fromEntries([...inputs].map(([key,input])=>[key,input.value.trim()]))},controller.signal) as {ok?:boolean;error?:string};
        if(disposed||ticket!==generation)return;
        if(result?.ok!==true)throw new Error(result?.error||'The assignment could not be saved.');
        onSaved(); endEdit();
      }catch(reason){if(!disposed&&ticket===generation){error.textContent=reason instanceof Error?reason.message:'Save failed. Retry to check its status.';save.disabled=cancel.disabled=false;}}
    };
  }
  async function deleteMapping(row: MappingRow, button: HTMLButtonElement) {
    if(button.disabled||!root.ownerDocument.defaultView?.confirm(`Delete the ${row.customername} / ${row.consigneename} assignment? Historical requests remain available.`))return;
    button.disabled=true; error.textContent=''; const requestId=button.dataset.requestId||(button.dataset.requestId=crypto.randomUUID());
    const ticket=++generation; controller?.abort();controller=new AbortController();
    try {
      const result=await transport({action:'customer-rep-map',operation:'delete',id:row.unique_id,expectedRevision:row.revision,requestId},controller.signal) as {ok?:boolean;deleted?:string;error?:string};
      if(disposed||ticket!==generation)return;
      if(result?.ok!==true||result.deleted!==row.unique_id)throw new Error(result?.error||'The assignment could not be deleted.');
      if(displayedPage)paint({...displayedPage,rows:displayedPage.rows.filter(item=>item.unique_id!==row.unique_id),total:Math.max(0,displayedPage.total-1)});
      onSaved();void load();
    }catch(reason){if(!disposed&&ticket===generation){error.textContent=reason instanceof Error?reason.message:'Delete failed. Retry to check its status.';button.disabled=false;}}
  }
  function editNames(row: MappingRow) {
    editing = true; error.textContent = ''; refresh.disabled = true; statusSelect.disabled = true; previous.disabled = next.disabled = true;
    const form = element('form'); form.dataset.mappingEditor = row.unique_id;
    form.append(element('h3', 'Correct customer or consignee names'), element('p', `Customer ID: ${row.customeridentityid || 'Unresolved'} · Consignee ID: ${row.consigneeid || 'Unresolved'}`));
    const inputs = new Map<'customername' | 'consigneename', HTMLInputElement>();
    for (const column of ['customername','consigneename'] as const) { const label = element('label', labels[column]); const input = element('input'); input.value = row[column] || ''; input.maxLength = 240; input.required = true; label.append(input); form.append(label); inputs.set(column,input); }
    const save = element('button', 'Save names'); save.type = 'submit'; const cancel = element('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => endEdit();
    form.append(save,cancel); editorHost.replaceChildren(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      save.disabled = cancel.disabled = true; error.textContent = '';
      const ticket = ++generation; controller?.abort(); controller = new AbortController();
      try {
        const result = await assignments.saveNames(row, inputs.get('customername')!.value.trim(), inputs.get('consigneename')!.value.trim(), controller.signal);
        if (disposed || ticket !== generation) return;
        showUpdated(result.row); onSaved(); endEdit(false); void load();
      } catch (reason) { if (!disposed && ticket === generation) { error.textContent = reason instanceof Error ? reason.message : 'Save failed. Cancel and refresh before retrying.'; save.disabled = cancel.disabled = false; } }
    };
    inputs.get('customername')?.focus();
  }
  function assignmentEditor(row: MappingRow) {
    editing = true; error.textContent = ''; refresh.disabled = true; statusSelect.disabled = true; previous.disabled = next.disabled = true;
    const form = element('form'); form.dataset.assignmentEditor = row.unique_id;
    form.append(element('h3', 'Assign sales rep'), element('p', `Customer: ${row.customername || 'Unresolved'} · Consignee: ${row.consigneename || 'Unresolved'}`));
    const query = element('input'); query.type = 'search'; query.placeholder = 'Search reps by name or ID'; query.setAttribute('aria-label','Search sales reps');
    const select = element('select'); select.setAttribute('aria-label','Select sales rep'); select.required = true;
    let selectedRep = drafts.get(row.unique_id) || '';
    function showOptions() {
      const needle = query.value.trim().toLocaleLowerCase(); const matching = reps.filter(rep => !needle || `${rep.salesrepName} ${rep.salesrepId}`.toLocaleLowerCase().includes(needle));
      if (selectedRep && !matching.some(rep=>rep.salesrepId===selectedRep)) { const kept=reps.find(rep=>rep.salesrepId===selectedRep); if(kept)matching.unshift(kept); }
      select.replaceChildren();
      const placeholder = element('option','Choose a sales rep'); placeholder.value = ''; select.append(placeholder);
      for (const rep of matching) { const option = element('option',`${rep.salesrepName} · ${rep.salesrepId}`); option.value = rep.salesrepId; select.append(option); }
      if (matching.some(rep => rep.salesrepId === selectedRep)) select.value = selectedRep;
    }
    showOptions(); query.oninput = showOptions; select.onchange=()=>{selectedRep=select.value; if(selectedRep)drafts.set(row.unique_id,selectedRep);};
    const actions = element('div'); actions.className = 'mapping-actions';
    const save = element('button','Save assignment'); save.type = 'submit'; save.disabled = !reps.length;
    const cancel = element('button','Cancel'); cancel.type='button'; cancel.onclick=()=>endEdit();
    actions.append(save,cancel);
    const setFormBusy=(busy:boolean)=>{for(const button of Array.from(actions.querySelectorAll('button')))button.disabled=busy||(button===save&&!reps.length);};
    if (row.hasOverride) {
      const reset = element('button','Reset to imported assignment'); reset.type='button';
      reset.onclick = async () => {
        const imported = row.sourceSalesrepName || 'unassigned';
        const confirmReset = root.ownerDocument.defaultView?.confirm(`Reset this assignment to the latest imported rep: ${imported}?`);
        if (!confirmReset) return;
        if(reset.disabled)return; setFormBusy(true); error.textContent = '';
        const mutationController = new AbortController(); controller?.abort(); controller = mutationController; const ticket = ++generation;
        try { const result=await assignments.reset(row, mutationController.signal); if (disposed || ticket !== generation) return; drafts.delete(row.unique_id); showUpdated(result.row); onSaved(); endEdit(false); void load(); }
        catch (reason) { if (!disposed && ticket === generation) { error.textContent=reason instanceof Error?reason.message:'Reset failed. Retry to check its status.'; setFormBusy(false); } }
      };
      actions.append(reset);
    }
    form.append(query,select,actions); editorHost.replaceChildren(form);
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      const chosen = reps.find(rep=>rep.salesrepId===select.value);
      if (!chosen || chosen.salesrepId.toUpperCase()==='S99') { error.textContent='Choose an available First Last sales rep.'; return; }
      drafts.set(row.unique_id,chosen.salesrepId); selectedRep=chosen.salesrepId; setFormBusy(true); error.textContent='';
      const mutationController=new AbortController(); controller?.abort(); controller=mutationController; const ticket=++generation;
      try { const result=await assignments.assign(row,chosen.salesrepId,mutationController.signal); if (disposed || ticket!==generation) return; drafts.delete(row.unique_id); showUpdated(result.row); onSaved(); endEdit(false); void load(); }
      catch(reason) { if (!disposed && ticket===generation) { error.textContent=reason instanceof Error?reason.message:'Assignment failed. Retry to check its status.'; setFormBusy(false); } }
    };
  }
  async function load() {
    if (disposed || editing) return;
    const ticket = ++generation; controller?.abort(); controller = new AbortController(); status.textContent = 'Loading mappings…'; previous.disabled = next.disabled = true;
    const cacheKey = JSON.stringify({ page, filters, sort, direction });
    const cached = assignments.cachedPage(cacheKey);
    if (cached) paint(cached);
    try {
      const result = await assignments.list({ action: 'customer-rep-map', operation: 'list', page, pageSize: 50, filters: {...filters}, sort, direction },controller.signal);
      if (disposed || ticket !== generation) return;
      error.textContent = '';
      assignments.storePage(cacheKey,result); const revisionChanged=!!listRevision&&listRevision!==result.revision; if (revisionChanged) { reps=[]; repsRevision=''; } listRevision=result.revision;
      paint(result); if (revisionChanged||!reps.length||repsRevision!==result.revision) void loadReps();
    } catch (reason) { if (!disposed && ticket === generation) { status.textContent = cached ? 'Showing saved results. Refresh to retry.' : ''; error.textContent = reason instanceof Error ? reason.message : 'Mappings unavailable. Select Refresh to retry.'; } }
  }
  function paint(result: MappingPage) {
    displayedPage = result;
    add.hidden = !result.canEdit;
    add.disabled = !reps.length;
    body.replaceChildren();
    for (const row of result.rows) {
      const tr=element('tr');
      for (const column of columns) { const td=element('td',row[column]||'Unassigned'); if(column==='customername')td.append(element('small','ID '+(row.customeridentityid||'unresolved'))); if(column==='consigneename')td.append(element('small','ID '+(row.consigneeid||'unresolved'))); tr.append(td); }
      const assigned=!!row.salesrepid?.trim()&&!!row.salesrepname?.trim(); const active=row.customerstatus?.trim().toUpperCase()==='A'&&row.consigneestatus?.trim().toUpperCase()==='A';
      tr.append(element('td',!assigned?'Unassigned':active?'Active':'Inactive'));
      tr.append(element('td',row.hasOverride?'Manager override':'Imported'));
      const actions=element('td');
      if(result.canEdit){const assign=element('button','Assign rep');assign.type='button';assign.disabled=!reps.length&&!row.hasOverride;assign.onclick=()=>{if(!editing)assignmentEditor(row);};actions.append(assign);
        const correct=element('button','Edit');correct.type='button';correct.onclick=()=>{if(!editing)editNames(row);};actions.append(correct);
        if(row.customername?.trim().toUpperCase()!=='N/A'&&row.consigneename?.trim().toUpperCase()!=='N/A') { const remove=element('button','Delete Row');remove.type='button';remove.onclick=()=>{if(!editing)void deleteMapping(row,remove);};actions.append(remove); }}
      tr.append(actions); body.append(tr);
    }
    page=result.page; status.textContent=result.total?`${result.total.toLocaleString()} mappings · Page ${page+1} of ${Math.max(1,Math.ceil(result.total/result.pageSize))}`:'No matching mappings.';
    previous.disabled=page===0; next.disabled=(page+1)*result.pageSize>=result.total;
  }
  function showUpdated(updated: MappingRow) {
    if (!displayedPage) return;
    displayedPage={...displayedPage,rows:displayedPage.rows.map(item=>item.unique_id===updated.unique_id?updated:item)};
    paint(displayedPage);
  }
  async function loadReps() {
    repController?.abort(); const repsController=new AbortController(); repController=repsController;
    try { const loaded=await assignments.reps(repsController.signal); if(disposed||repsController.signal.aborted)return; reps=loaded; repsRevision=assignments.getRevision(); repError.textContent=''; add.disabled=!reps.length; if (displayedPage && !editing) paint(displayedPage); }
    catch(reason) { if(!disposed&&!repsController.signal.aborted&&repController===repsController){repError.textContent=reason instanceof Error?reason.message:'Sales rep choices unavailable. Select Retry reps to retry.'; const retry=element('button','Retry reps'); retry.type='button'; retry.onclick=()=>void loadReps(); repError.append(retry);} }
  }
  refresh.onclick = () => { void load(); }; statusSelect.onchange = () => { filters.status = statusSelect.value; page = 0; void load(); };
  const changed = () => { if (editing) error.textContent = 'Mappings changed while editing. Saving will verify this row is still current.'; else void load(); };
  root.addEventListener('mapping-revision', changed);
  void loadReps();
  void load();
  return () => { disposed = true; generation++; clearTimeout(timer); controller?.abort(); repController?.abort(); assignments.dispose(); root.removeEventListener('mapping-revision', changed); root.replaceChildren(); };
}
