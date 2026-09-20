(function (root) {
 'use strict';
 const groups = {
  sequence: ['Early protection','Haul-in space','Small-container crew','Drill shift','LD planting','Shovel shift','Rain-day preparation'],
  grading: ['Grade quantity or percentage','Dump quantity or percentage','Shear before bunching'],
  hauling: ['Grade shift','Row-run shift','Haul to destination','Wait for hauling before bunching'],
  placement: ['Center house','Outside house','Extra spacing','Combine groups','Water control','Won’t-fit stock','Overwinter outside','Countable rows','Field signs at both ends facing the road'],
  identification: ['Missing tags or signs','Variety mixes','Separate look-alikes','Wide aisles','Group symbols','Flag or ribbon guidance'],
  inventory: ['TA / culls follow-up','Designated-location review','Pull-tag notes','Priority review','Season error review','Obsolete-location review']
 };
 const templates = Object.entries(groups).flatMap(([group, labels]) => labels.map(label => ({ group, label, instructions: label })));
 const normalize = value => String(value ?? '').trim().toUpperCase();
 const quantity = value => value === null || value === undefined || String(value).trim() === '' ? null : /^-?\d+(\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
 function groupInventory(rows) {
  const blocks = new Map(); const seen = new Set();
  rows.forEach(row => {
   if (!row.unique_id || seen.has(row.unique_id)) return;
   seen.add(row.unique_id);
   const block = normalize(row.blockalpha), location = normalize(row.locationcode);
   if (!block || !location) return;
   if (!blocks.has(block)) blocks.set(block, new Map());
   if (!blocks.get(block).has(location)) blocks.get(block).set(location, []);
   blocks.get(block).get(location).push(row);
  });
  return blocks;
 }
 function recipientEmails(directory, ids) {
  const dylan = directory.find(u => u.username === 'dylan_collyge');
  if (!dylan?.email) throw new Error('Dylan’s mapped email is required.');
  const selected = [...new Set([...ids, dylan.id || dylan.profile_id])].map(id => directory.find(u => (u.id || u.profile_id) === id));
  if (selected.some(u => !u?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email))) throw new Error('Choose active users with email addresses.');
  return [...new Set(selected.map(u => u.email.trim().toLowerCase()))];
 }
 const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const arg = value => esc(JSON.stringify(value));
 const stock = value => quantity(value) === null ? 'Unknown' : String(quantity(value));
 const fresh = () => ({ account: '', epoch: 0, jobs: [], loaded: false, loading: false, error: '', blocks: [], rows: [], users: [], drafts: [], draft: null, detail: null, preview: null, urls: [], filter: 'available', busy: false, commands: new Map() });
 let state = fresh();
 const account = () => typeof currentUser === 'undefined' ? '' : String(currentUser || '');
 const author = () => account() === 'dylan_collyge' && typeof nativeAuthSessionActive !== 'undefined' && nativeAuthSessionActive === true && typeof nativeAuthProfile !== 'undefined' && nativeAuthProfile?.username === 'dylan_collyge'
  && !nativeAuthProfile.disabled_at && nativeAuthProfile.must_change_password === false
  && (!nativeAuthProfile.locked_until || Date.parse(nativeAuthProfile.locked_until) <= Date.now());
 function reset() { state.urls.forEach(url => URL.revokeObjectURL(url)); state = fresh(); state.account = account(); }
 function ensureAccount() { if (state.account !== account()) reset(); }
 async function api(operation, payload = {}, revision = null, commandId = null, signal) {
  ensureAccount(); const owner = state.account, ownerState = state;
  const key = JSON.stringify([operation,payload,revision]);
  if (commandId) { commandId = state.commands.get(key) || commandId; state.commands.set(key,commandId); }
  const response = await postAppFunctionJson(APP_API_FUNCTION_URL, { action: 'bunch_note', operation, payload, expectedRevision: revision, commandId }, { timeoutMs: 45000, label: 'Bunch Notes', signal, idempotencyKey: commandId || undefined });
  if (owner !== account() || ownerState !== state) throw new Error('The signed-in session changed.');
  if (!response?.ok) throw new Error(response?.message || response?.code || 'Bunch Notes could not be loaded.');
  if (commandId) state.epoch++;
  state.commands.delete(key);
  return response.data;
 }
 async function run(work) {
  ensureAccount(); if (state.busy) return; state.busy = true; render();
  try { await work(); state.error = ''; } catch (error) {
   const code = String(error.message || error);
   state.error = code;
   if (/SOURCE_CHANGED/.test(state.error)) state.error = 'Inventory changed. Use Refresh source, review the rows, then save and preview again.';
   if (/SOURCE_REFRESH_REQUIRED/.test(code)) state.error = 'The inventory import is still updating. Keep this draft and preview after the update finishes.';
   if (/QUANTITY|PERCENTAGE/.test(code)) state.error = 'Use either a positive whole quantity or a percentage greater than zero and no more than 100.';
   if (/BATCH_TOO_LARGE/.test(code)) state.error = 'This PDF batch is too large. Select fewer locations and preview again.';
   if (/RECIPIENT|DYLAN_EMAIL/.test(code)) state.error = 'The email mapping changed or is missing. Review the selected users; Dylan must have a mapped address.';
   if (/PREVIEW_REQUIRED|PREVIEW_EXPIRED/.test(code)) state.error = 'Preview the current PDFs again before publishing.';
   if (/CONFLICT|CLAIMED|NOT_FOUND/.test(code)) { state.detail = null; state.jobs = []; state.loaded = false; await load(); state.error='This work changed in another session. The Queue has refreshed; open the current work before continuing.'; }
   showToast('Bunch Notes', state.error, true);
  } finally { state.busy = false; render(); }
 }
 async function load() {
  ensureAccount(); if (state.loading) return;
  state.loading = true;
  try { const result = await api('list'); state.jobs = result.jobs; state.loaded = true; state.epoch++; }
  finally { state.loading = false; }
 }
 async function open() {
  ensureAccount(); render();
  return run(async () => {
   const results = await Promise.all([api('blocks'), api('directory'), api('drafts')]);
   state.blocks = results[0].blocks; state.users = results[1].users; state.drafts = results[2].drafts;
  });
 }
 const button = (label, action, disabled = false, pressed = null) => `<button type="button" class="bn-button" onclick="${action}" ${disabled ? 'disabled' : ''} ${pressed === null ? '' : `aria-pressed="${pressed}"`}>${esc(label)}</button>`;
 function field(label, value, action, type = 'text') {
  return `<label class="bn-field">${esc(label)}<input type="${type}" value="${esc(value)}" oninput="${action}" /></label>`;
 }
 function textfield(label, value, action) { return `<label class="bn-field">${esc(label)}<textarea rows="3" oninput="${action}">${esc(value)}</textarea></label>`; }
 function userOptions(value, blank = 'Unassigned — available to everyone') { return `<option value="">${esc(blank)}</option>` + state.users.map(u => `<option value="${esc(u.id)}" ${u.id === value ? 'selected' : ''}>${esc(u.display || u.username)}</option>`).join(''); }
 function plants(rows, selected, index) {
  return `<div class="bn-plants">${rows.map(row => `<label class="bn-plant">${selected ? `<input type="checkbox" ${selected.includes(row.unique_id) ? 'checked' : ''} onchange="BunchNote.selectRow(${index},${arg(row.unique_id)},this.checked)">` : ''}<span><b>${esc(row.commonname)} · ${esc(row.itemcode)} · ${esc(row.contsize)}</b><br>Lot ${esc(row.lotcode)} · Season ${esc(row.season)}<br>Stock ${esc(stock(row.stock))} · Available ${esc(stock(row.available))}<br>Flags ${esc(row.flags || '—')} · Hold ${esc(row.hold || '—')} · Warehouse ${esc(row.warehouse || '—')}<br>${esc(row.location_notes || 'No location notes')}</span></label>`).join('')}</div>`;
 }
 function editor() {
  const draft = state.draft;
  let html = `<h2>Bunch Note</h2><p>Prepare one work item per location. Instructions and completion do not change inventory.</p>`;
  if (!draft) return html + `<label class="bn-field">Block<select onchange="BunchNote.chooseBlock(this.value)"><option value="">Select block</option>${state.blocks.map(b => `<option>${esc(b)}</option>`).join('')}</select></label><h3>Saved batches</h3>${state.drafts.map(d => button(`${d.block} · ${d.body.locations.length} locations · ${new Date(d.updated_at).toLocaleString()}`, `BunchNote.openDraft(${arg(d.id)})`)).join('')}`;
  html += button('Back to batches', 'BunchNote.backEditor()') + `<h3>Block ${esc(draft.body.block)}</h3>`;
  const locations = groupInventory(state.rows).get(draft.body.block) || new Map();
  html += `<fieldset><legend>Locations in batch</legend>${[...locations.keys()].sort().map(loc => `<label class="bn-choice"><input type="checkbox" ${draft.body.locations.some(l => l.location === loc) ? 'checked' : ''} onchange="BunchNote.selectLocation(${arg(loc)},this.checked)">${esc(loc)}</label>`).join('')}</fieldset>`;
  html += draft.body.locations.map((loc, i) => `<section class="bn-card"><h3>${esc(loc.location)}${loc.job_id ? ' · Revision' : ''}</h3>`
   + field('Purposes', loc.purposes, `BunchNote.edit(${i},'purposes',this.value)`)
   + field('Priority / work order', loc.priority, `BunchNote.edit(${i},'priority',this.value)`)
   + textfield('General instructions', loc.instructions, `BunchNote.edit(${i},'instructions',this.value)`)
   + textfield('Prerequisites / wait instructions', loc.prerequisites, `BunchNote.edit(${i},'prerequisites',this.value)`)
   + `<label class="bn-field">Assigned user (separate from email recipients)<select ${loc.job_id ? 'disabled' : ''} onchange="BunchNote.edit(${i},'owner_id',this.value)">${userOptions(loc.owner_id)}</select></label>`
   + plants(loc.source_all || locations.get(loc.location) || [], loc.row_ids, i)
   + `<h4>Action checklist</h4>${loc.actions.map((a, j) => `<div class="bn-action"><b>${esc(a.group)} · ${esc(a.scope === 'location' ? 'Whole location' : a.row_ids.length + ' selected rows')}</b>`
    + textfield('Instruction', a.instructions, `BunchNote.editAction(${i},${j},'instructions',this.value)`)
    + `<div class="bn-grid">${field('Quantity (or percentage)', a.quantity, `BunchNote.editAction(${i},${j},'quantity',this.value)`, 'number')}${field('Percentage (or quantity)', a.percentage, `BunchNote.editAction(${i},${j},'percentage',this.value)`, 'number')}${field('Crew label', a.crew, `BunchNote.editAction(${i},${j},'crew',this.value)`)}${field('Target flags / shear stage', a.stage, `BunchNote.editAction(${i},${j},'stage',this.value)`)}${field('Destination', a.destination, `BunchNote.editAction(${i},${j},'destination',this.value)`)}${field('Marking / ribbon / symbol', a.marking, `BunchNote.editAction(${i},${j},'marking',this.value)`)}</div>`
    + button('Remove action', `BunchNote.removeAction(${i},${j})`) + '</div>').join('')}`
   + `<label class="bn-field">Editable action template<select id="bn-template-${i}">${templates.map((t, n) => `<option value="${n}">${esc(t.group + ' — ' + t.label)}</option>`).join('')}</select></label>`
   + button('Add for selected plant rows', `BunchNote.addAction(${i},'rows')`) + button('Add for whole location', `BunchNote.addAction(${i},'location')`) + '</section>').join('');
  html += '<details><summary>Instruction guidance from Bunch Notes</summary><p>Use “Center house” for the house over the 4-inch line. Specify quantity or percentage, stage, destination, and whether crews should grade or row-run.</p><p>BOB, QC, SAM, RHETT, SHARON, MATT, BUNCHERS and TA are instruction labels. They do not assign users or select recipients.</p><p>Flags: blue = ship first; white = lesser quality; red = promo / worst quality; green = grow-on. Outside corner ribbons: yellow = water control; pink = overwinter outside; shift = haul for shift; shift + pink = outside for spring shift. Apply only where you explicitly choose.</p></details>';
  html += `<fieldset><legend>Email recipients — Dylan is always included</legend>${state.users.filter(u => u.email).map(u => `<label class="bn-choice"><input type="checkbox" ${u.username === 'dylan_collyge' || draft.body.recipient_ids.includes(u.id) ? 'checked' : ''} ${u.username === 'dylan_collyge' ? 'disabled' : ''} onchange="BunchNote.recipient(${arg(u.id)},this.checked)">${esc(u.display || u.username)} · ${esc(u.email)}</label>`).join('')}</fieldset>`;
  return html + button('Refresh source for review', 'BunchNote.refreshSource()', state.busy) + button('Save draft', 'BunchNote.save()', state.busy) + button('Preview PDFs and recipients', 'BunchNote.preview()', state.busy);
 }
 function previewHtml() {
  const p = state.preview;
  return `<h2>Review Bunch Notes PDFs</h2><p>Recipients: ${p.recipients.map(r => esc(r.email)).join(', ')}</p>${state.urls.map((url, i) => `<section class="bn-card"><a href="${url}" target="_blank" rel="noopener">Open ${esc(p.pdfs[i].filename)}</a><iframe title="${esc(p.pdfs[i].filename)}" src="${url}" style="width:100%;height:60vh;border:1px solid #aaa"></iframe></section>`).join('')}`
   + button('Back', 'BunchNote.closePreview()') + (p.saved ? button('Email reviewed PDFs', 'BunchNote.sendSaved()', state.busy) : button('Publish to Queue', 'BunchNote.publish(false)', state.busy) + button('Publish and email reviewed PDFs', 'BunchNote.publish(true)', state.busy));
 }
 function queue() {
  if (!state.loaded && !state.loading && !state.error) void run(load);
  if (state.detail) return detailHtml();
  let html = '<h2>Bunch Notes</h2><p>Claim available location work. Claimed work is visible to its owner and Dylan.</p>';
  ['available','mine','completed', ...(author() ? ['all','cancelled'] : [])].forEach(filter => { html += button(({available:'Available',mine:'My Work',completed:'Completed',all:'All assignments',cancelled:'Canceled'})[filter], `BunchNote.filter(${arg(filter)})`, state.busy, state.filter === filter); });
  html += button('Refresh', 'BunchNote.refresh()');
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const jobs = state.jobs.filter(j => state.filter === 'all' || (state.filter === 'available' ? j.status === 'open' && !j.owner_id : state.filter === 'mine' ? j.status === 'open' && j.owner_id === uid : j.status === (state.filter === 'completed' ? 'complete' : 'cancelled')));
  return html + (state.loading ? '<p>Loading…</p>' : !jobs.length ? '<p>No work in this filter.</p>' : jobs.map(j => `<article class="bn-card"><h3>${esc(j.block)} → ${esc(j.location)}</h3><p>${esc(j.note_number)} · Revision ${j.instruction_revision} · ${esc(j.body.purposes)}</p><p>Priority: ${esc(j.body.priority || '—')} · ${Object.keys(j.progress).length}/${j.body.actions.length} actions</p><p>Work: ${esc(j.status)} · Email: ${esc(j.delivery_status)}</p>${button('Open', `BunchNote.detail(${arg(j.id)})`)}</article>`).join(''));
 }
 function detailHtml() {
  const {job: j, versions, audit} = state.detail;
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const owner = j.owner_id === uid, open = j.status === 'open';
  let html = button('Back', 'BunchNote.backQueue()') + `<h2>${esc(j.block)} → ${esc(j.location)}</h2><p><b>${esc(j.note_number)} · Instruction revision ${j.instruction_revision}</b></p><p>${esc(j.body.purposes)} · Priority ${esc(j.body.priority || '—')}</p><h3>General instructions</h3><p class="bn-pre">${esc(j.body.instructions)}</p><h3>Prerequisites</h3><p class="bn-pre">${esc(j.body.prerequisites || 'None written')}</p>`;
  if (open && !j.owner_id) html += button('Claim work', `BunchNote.command('claim')`, state.busy);
  if (open && owner) html += button('Release to available work', `BunchNote.command('release')`, state.busy);
  if (open && author()) html += `<label class="bn-field">Assign / reassign<select id="bn-owner">${userOptions(j.owner_id)}</select></label>` + button('Apply assignment', `BunchNote.assign()`) + button('Revise instructions', `BunchNote.revise()`) + button('Cancel work', `BunchNote.cancel()`);
  html += plants(j.body.source || []) + j.body.actions.map(a => {
   const done = j.progress[a.id];
   return `<article class="bn-card"><h3>${esc(a.crew || a.group)}</h3><p class="bn-pre">${esc(a.instructions)}</p><p>${esc(a.scope === 'location' ? 'Whole location' : (a.row_ids || []).map(id => { const r=(j.body.source||[]).find(row=>row.unique_id===id); return r ? [r.itemcode,r.contsize,r.lotcode].join(' / ') : id; }).join('; '))}</p><p>Qty ${esc(a.quantity || '—')} · % ${esc(a.percentage || '—')} · ${esc(a.stage || '')} · ${esc(a.destination || '')} · ${esc(a.marking || '')}</p><b>${esc(done?.status || 'Pending')}</b><p>${esc(done?.reason || '')}</p>${open && owner ? button('Done', `BunchNote.progress(${arg(a.id)},'done')`) + button('Not needed', `BunchNote.progress(${arg(a.id)},'not_needed')`) : ''}</article>`;
  }).join('');
  if (open && owner) html += button('Complete location', `BunchNote.command('complete')`, j.body.actions.some(a => !j.progress[a.id]));
  html += `<h3>PDF revisions</h3>${versions.map(v => `<p>Revision ${v.instruction_revision} · Email ${esc(v.delivery_status)} ${button('Open PDF', `BunchNote.pdf(${v.instruction_revision})`)}${author() && ['not_sent','failed','unknown','sending'].includes(v.delivery_status) ? button(v.delivery_status === 'not_sent' ? 'Review and send' : v.delivery_status === 'failed' ? 'Retry delivery' : 'Reconcile delivery', `BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`) : ''}</p>`).join('')}`;
  return html + `<details><summary>History (${audit.length})</summary>${audit.map(a => `<p>${esc(a.created_at)} · ${esc(a.operation)} · ${esc(JSON.stringify(a.detail))}</p>`).join('')}</details>`;
 }
 function render() {
  ensureAccount();
  const view = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
  const container = document.getElementById(view === 'bunch-note' ? 'bunch-note-content' : 'request-content');
  if (!container || !account() || (view !== 'bunch-note' && !(view === 'request' && activeReqTab === 'bunch-notes'))) return;
  container.classList.add('bn-root');
  container.innerHTML = (state.error ? `<p role="alert">${esc(state.error)}</p>` : '') + (view === 'bunch-note' && author() ? state.preview ? previewHtml() : editor() : queue());
 }
 const invalidate = () => { state.preview = null; state.urls.forEach(url => URL.revokeObjectURL(url)); state.urls = []; };
 async function saveDraft() {
  const d = state.draft;
  const result = await api('save', {batch_id: d.id, body: d.body}, d.revision, crypto.randomUUID());
  state.draft = result.draft;
 }
 function showPdfs(pdfs) {
  state.urls.forEach(url => URL.revokeObjectURL(url));
  state.urls = pdfs.map(pdf => {
   const bytes = Uint8Array.from(atob(pdf.base64), c => c.charCodeAt(0));
   if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') throw new Error('Invalid PDF response.');
   return URL.createObjectURL(new Blob([bytes], {type:'application/pdf'}));
  });
 }
 root.BunchNote = {
  templates, normalize, quantity, groupInventory, recipientEmails, api, render, reset, open, author,
  scope: () => { ensureAccount(); return state.detail?.job.id || ''; },
  stage: async ctx => { ensureAccount(); const owner=account(), epoch=state.epoch, id=state.detail?.job.id; const data = await api('list', {}, null, null, ctx.signal); const detail=id&&data.jobs.some(j=>j.id===id)?await api('get',{job_id:id},null,null,ctx.signal):null; return {account:owner,epoch,jobs:data.jobs,detail,id}; },
  commit: value => { ensureAccount(); if (value.account === account() && value.epoch === state.epoch) { state.jobs = value.jobs; state.loaded = true; if (state.detail?.job.id===value.id) state.detail=value.detail; if(getCurrentVisibleViewId()==='request'&&activeReqTab==='bunch-notes')render(); } },
  chooseBlock: block => run(async () => { if (!block) return; state.rows = (await api('inventory',{block})).rows; state.draft = {id:null,revision:null,body:{block,locations:[],recipient_ids:[]}}; }),
  openDraft: id => run(async () => { const d = state.drafts.find(d => d.id === id); state.draft = structuredClone(d); state.rows = (await api('inventory',{block:d.block})).rows; }),
  backEditor: () => { invalidate(); state.draft = null; void open(); },
  selectLocation: (location, selected) => { invalidate(); const d = state.draft.body; if (!selected) d.locations = d.locations.filter(l => l.location !== location); else { const rows = groupInventory(state.rows).get(d.block).get(location); d.locations.push({location,purposes:'',priority:'',instructions:'',prerequisites:'',owner_id:'',row_ids:rows.map(r=>r.unique_id),source_all:rows,actions:[]}); } render(); },
  selectRow: (i,id,on) => { invalidate(); const l=state.draft.body.locations[i]; l.row_ids=on?[...new Set([...l.row_ids,id])]:l.row_ids.filter(v=>v!==id); },
  edit: (i,key,value) => { invalidate(); state.draft.body.locations[i][key]=value; },
  editAction: (i,j,key,value) => { invalidate(); state.draft.body.locations[i].actions[j][key]=value; },
  addAction: (i,scope) => { invalidate(); const l=state.draft.body.locations[i],t=templates[Number(document.getElementById('bn-template-'+i).value)]; l.actions.push({...t,id:crypto.randomUUID(),scope,row_ids:scope==='rows'?[...l.row_ids]:[],quantity:'',percentage:'',crew:'',stage:'',destination:'',marking:''}); render(); },
  removeAction: (i,j) => { invalidate(); state.draft.body.locations[i].actions.splice(j,1); render(); },
  recipient: (id,on) => { invalidate(); const d=state.draft.body; d.recipient_ids=on?[...new Set([...d.recipient_ids,id])]:d.recipient_ids.filter(v=>v!==id); },
  refreshSource: () => run(async () => { invalidate(); const d=state.draft.body; state.rows=(await api('inventory',{block:d.block})).rows; const locations=groupInventory(state.rows).get(d.block)||new Map(); d.locations.forEach(l=>{l.source_all=locations.get(l.location)||[];}); }),
  save: () => run(saveDraft),
  preview: () => run(async () => { await saveDraft(); const d=state.draft; const {preview:p}=await api('preview',{batch_id:d.id},d.revision,crypto.randomUUID()); const owner=state; const pdf=await postGoogleScriptJsonPayload({type:'bunch_note_preview',nativeAuthAccessToken,previewId:p.id},REQUEST_EMAIL_SCRIPT_TIMEOUT_MS,'Bunch Note PDF preview'); if(owner!==state)return; if(!pdf?.ok)throw new Error(pdf?.message||'PDF preview failed.'); state.preview={...p,pdfs:pdf.pdfs}; showPdfs(pdf.pdfs); }),
  closePreview: () => { invalidate(); render(); },
  publish: send_email => run(async () => { await api('publish',{preview_id:state.preview.id,send_email},state.draft.revision,crypto.randomUUID()); invalidate(); state.draft=null; state.drafts=(await api('drafts')).drafts; await load(); showToast('Bunch Notes',send_email?'Published. Email queued.':'Published to Queue.'); }),
  refresh: () => run(load), filter: value => { state.filter=value; render(); },
  detail: id => run(async () => { state.detail=await api('get',{job_id:id}); if(author()&&!state.users.length)state.users=(await api('directory')).users; }),
  backQueue: () => { state.detail=null; render(); },
  command: (operation, extra={}) => run(async () => { const j=state.detail.job; await api(operation,{job_id:j.id,...extra},j.revision,crypto.randomUUID()); state.detail=operation==='progress'?await api('get',{job_id:j.id}):null; await load(); }),
  assign: () => root.BunchNote.command('assign',{owner_id:document.getElementById('bn-owner').value}),
  progress: (id,status) => { const reason=status==='not_needed'?prompt('Why is this action not needed?'):''; if(status==='not_needed'&&!reason?.trim())return; return root.BunchNote.command('progress',{action_id:id,status,reason}); },
  cancel: () => { const reason=prompt('Reason for canceling this location work:'); if(reason?.trim())return root.BunchNote.command('cancel',{reason}); },
  revise: () => run(async () => { const j=state.detail.job; const data=await api('revise',{job_id:j.id},j.revision,crypto.randomUUID()); state.draft=data.draft; state.rows=(await api('inventory',{block:j.block})).rows; state.users=(await api('directory')).users; state.detail=null; switchView('bunch-note'); }),
  pdf: revision => run(async () => { const result=await api('pdf',{job_id:state.detail.job.id,instruction_revision:revision}); showPdfs([result.pdf]); const a=document.createElement('a'); a.href=state.urls[0]; a.target='_blank'; a.rel='noopener'; a.download=result.pdf.filename; a.click(); }),
  sendSaved: () => run(async () => { await api('send',{preview_id:state.preview.id},null,crypto.randomUUID()); invalidate(); state.detail=null; switchView('request'); setReqTab('bunch-notes'); await load(); }),
  delivery: (preview_id,status) => run(async () => { const p=await api('preview_read',{preview_id}); if(status==='not_sent'){state.preview={...p,saved:true}; showPdfs(p.pdfs); switchView('bunch-note'); return;} if(!await showAppConfirm(status==='failed'?'Retry this failed delivery to the saved recipients?':'Reconcile against Sent mail without sending another copy?',{title:'Bunch Notes delivery'}))return; await api(status==='failed'?'retry':'reconcile',{preview_id},null,crypto.randomUUID()); state.detail=null; await load(); }),
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
