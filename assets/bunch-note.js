(function (root) {
 'use strict';
 const groups = {
  sequence: ['Early protection','Haul-in space','Small-container crew','Drill shift','LD planting','Shovel shift','Rain-day preparation'],
  grading: ['Grade quantity or percentage','Dump quantity or percentage','Shear before bunching'],
  hauling: ['Grade shift','Row-run shift','Haul to destination','Wait for hauling before bunching'],
  placement: ['Center house','Outside house','Extra spacing','Combine groups','Water control','Won’t-fit stock','Overwinter outside','Countable rows','Field signs at both ends facing the road','Missing tags or signs','Variety mixes','Separate look-alikes','Wide aisles','Group symbols','Flag or ribbon guidance'],
  inventory: ['TA / culls follow-up','Move','Designated-location review','Pull-tag notes','Priority review','Season error review','Obsolete-location review']
 };
 const templates = Object.entries(groups).flatMap(([group, labels]) => labels.map(label => ({ group, label, instructions: label, kind: label === 'TA / culls follow-up' ? 'ta' : label === 'Move' ? 'move' : group === 'hauling' && !label.startsWith('Wait') ? 'hauling' : 'instruction' })));
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
 const shiftEligible = row => /Y|U3/i.test(String(row.season || '')) || /SHFT/i.test(String(row.desigitem || ''));
 function groupItems(rows) {
  const seen = new Set(), items = new Map();
  rows.forEach(row => {
   if (!row.unique_id || seen.has(row.unique_id)) return;
   seen.add(row.unique_id);
   const key = normalize(row.locationcode) + '|' + (normalize(row.itemcode) || '@' + row.unique_id);
   if (!items.has(key)) items.set(key, {key,itemcode:normalize(row.itemcode),commonname:row.commonname,rows:[]});
   items.get(key).rows.push(row);
  });
  return [...items.values()].map(item => ({...item,...Object.fromEntries(['stock','review','available'].map(key => {
   const values=item.rows.map(row=>quantity(row[key]));
   return [key, values.some(v=>v===null) ? null : values.reduce((sum,v)=>sum+v,0)];
  }))}));
 }
 const actionKind = a => a.kind || (String(a.label || a.instructions || '').startsWith('TA / culls') ? 'ta' : a.label === 'Move' ? 'move' : a.group === 'hauling' && !String(a.label || a.instructions || '').startsWith('Wait') ? 'hauling' : 'instruction');
 const reviewText = flags => flags.map(f=>({exceeds_saved_stock:'Quantity exceeds saved stock',saved_stock_unknown:'Saved stock is unknown',exceeds_planned_quantity:'Quantity exceeds the plan',differs_from_planned_quantity:'Quantity differs from the plan'})[f]||f).join('; ');
 const allActions = j => [...j.body.actions,...(j.worker_actions || [])];
 const currentActuals = j => (j.actuals || []).filter(a=>!a.superseded);
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
 const fresh = () => ({ account: '', epoch: 0, jobs: [], loaded: false, loading: false, error: '', blocks: [], rows: [], users: [], drafts: [], draft: null, location: '', panels: new Set(), options: [], destinations: [], targets: {}, choices: {}, pendingActions: {}, custom: {}, workForms: {}, workRows: {}, workRecipients: [], detail: null, preview: null, urls: [], filter: 'available', busy: false, commands: new Map() });
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
   if (/QUANTITY_INVALID|PERCENTAGE|QUANTITY_OR/.test(code)) state.error = 'Use either a positive whole quantity or a percentage greater than zero and no more than 100.';
   if (/BATCH_TOO_LARGE/.test(code)) state.error = 'This PDF batch is too large. Select fewer locations and preview again.';
   if (/RECIPIENT|DYLAN_EMAIL/.test(code)) state.error = 'The email mapping changed or is missing. Review the selected users; Dylan must have a mapped address.';
   if (/PREVIEW_REQUIRED|PREVIEW_EXPIRED/.test(code)) state.error = 'Preview the current PDFs again before publishing.';
   if (/CONFLICT|CLAIMED|NOT_FOUND/.test(code)) { state.detail = null; state.jobs = []; state.loaded = false; await load(); state.error='This work changed in another session. The Queue has refreshed; open the current work before continuing.'; }
   if (/SHIFT_ROWS/.test(code)) state.error='Shift/Hauling can only use lots whose Season contains Y or U3, or DesigItem contains SHFT.';
   if (/ACTUAL_REQUIRED/.test(code)) state.error='Record the actual quantity, lot and size before marking this action Done.';
   if (/DESTINATION_REQUIRED/.test(code)) state.error='Enter where this stock moved.';
   if (/LOT_SIZE_REQUIRED/.test(code)) state.error='This saved row needs a known lot and container size. Ask Dylan to review the source.';
   if (/VARIANCE_REASON/.test(code)) state.error='Explain the quantity difference or stock exception in the review note.';
   if (/OPTION_CHANGED|OPTION_REQUIRED/.test(code)) state.error='This option changed. Refresh the choices before adding it.';
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
   const results = await Promise.all([api('blocks'), api('directory'), api('drafts'),api('catalog')]);
   state.blocks = results[0].blocks; state.users = results[1].users; state.drafts = results[2].drafts; state.options=results[3].options; state.destinations=results[3].locations;
  });
 }
 const button = (label, action, disabled = false, pressed = null, id = '') => `<button type="button" class="bn-button" ${id ? `id="${esc(id)}"` : ''} onclick="${action}" ${disabled ? 'disabled' : ''} ${pressed === null ? '' : `aria-pressed="${pressed}"`}>${esc(label)}</button>`;
 function field(label, value, action, type = 'text') {
  return `<label class="bn-field">${esc(label)}<input type="${type}" value="${esc(value)}" oninput="${action}" /></label>`;
 }
 function textfield(label, value, action) { return `<label class="bn-field">${esc(label)}<textarea rows="3" oninput="${action}">${esc(value)}</textarea></label>`; }
 function userOptions(value, blank = 'Unassigned — available to everyone') { return `<option value="">${esc(blank)}</option>` + state.users.map(u => `<option value="${esc(u.id)}" ${u.id === value ? 'selected' : ''}>${esc(u.display || u.username)}</option>`).join(''); }
 const templateOptions = () => templates.map((t, n) => `<option value="${n}">${esc(t.group + ' — ' + t.label)}</option>`).join('');
 const panelAttrs = key => `${state.panels.has(key) ? 'open' : ''} ontoggle="BunchNote.panel(${arg(key)},this.open)"`;
 function drillCard(label, caption, action, kind) {
  return `<button type="button" class="bn-drill-card" onclick="${action}" aria-label="Open ${esc(kind)} ${esc(label)}" ${state.busy ? 'disabled' : ''}><span class="bn-drill-icon" aria-hidden="true"><i class="ph-bold ${kind === 'block' ? 'ph-squares-four' : 'ph-map-pin'}"></i></span><span class="bn-drill-copy"><span class="bn-eyebrow">${kind === 'block' ? 'Block Alpha' : 'Location Code'}</span><strong>${esc(label)}</strong><span class="bn-muted">${esc(caption)}</span></span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>`;
 }
 const categoryLabels={sequence:'Sequence',grading:'Grading',placement:'Placement',inventory:'Inventory',hauling:'Shift/Hauling'};
 function actionChoices(key, rows, target) {
  state.targets[key]={...target,ids:rows.map(r=>r.unique_id)};
  return `<div class="bn-action-choices">${Object.entries(categoryLabels).filter(([cat])=>cat!=='hauling'||rows.some(shiftEligible)).map(([cat,label])=>{
   const k=key+':'+cat, chosen=state.choices[k]||[], custom=state.custom[k]||{};
   return `<details class="bn-options" ${panelAttrs(k)}><summary>${label} · choose multiple <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${state.options.filter(o=>o.active&&o.category===cat).map(o=>`<label class="bn-choice"><input type="checkbox" ${chosen.includes(o.id)?'checked':''} onchange="BunchNote.chooseOption(${arg(k)},${arg(o.id)},this.checked)"><span>${esc(o.label)}</span></label>`).join('')}
    ${field('New '+label+' option',custom.label||'',`BunchNote.custom(${arg(k)},'label',this.value)`)}<label class="bn-field">Record amounts as<select onchange="BunchNote.custom(${arg(k)},'kind',this.value)">${['instruction','ta','move',...(cat==='hauling'?['hauling']:[])].map(kind=>`<option value="${kind}" ${(custom.kind||'instruction')===kind?'selected':''}>${({instruction:'Checklist only',ta:'TA quantity',move:'Move quantity and destination',hauling:'Hauling quantity and destination'})[kind]}</option>`).join('')}</select></label>
    ${button('Save custom option',`BunchNote.saveOption(${arg(key)},${arg(cat)})`,state.busy)}${button('Add selected '+label+' actions',`BunchNote.addChoices(${arg(key)},${arg(cat)})`,state.busy)}</div></details>`;
  }).join('')}</div>`;
 }
 function plants(rows, selected, index, job=null) {
  return `<div class="bn-plants">${groupItems(rows).map((item,n)=>{
   const key='item:'+index+':'+n, worker=job && job.status==='open' && job.owner_id===nativeAuthProfile?.id;
   const selection=selected || (worker ? (state.workRows[job.id] || rows.map(r=>r.unique_id)) : null);
   const totals=job ? currentActuals(job).filter(a=>item.rows.some(r=>r.unique_id===a.source_snapshot.unique_id)).reduce((out,a)=>{const kind=actionKind(a.action_snapshot);out[kind]=(out[kind]||0)+Number(a.quantity);return out;},{}) : {};
   return `<article class="bn-plant bn-card"><label class="bn-plant-heading">${selection?`<input type="checkbox" aria-label="Select item ${esc(item.itemcode)}" ${item.rows.every(r=>selection.includes(r.unique_id))?'checked':''} onchange="BunchNote.selectItem(${arg(index)},${arg(item.rows.map(r=>r.unique_id))},this.checked,${!!worker})">`:''}<span><span class="bn-eyebrow">${esc(item.itemcode || 'Unknown item code')} · ${item.rows.length} lot rows</span><strong>${esc(item.commonname)}</strong></span></label>
    <div class="bn-stock"><span>LOC On Hand <b>${esc(stock(item.stock))}</b></span><span>LOC Review <b>${esc(stock(item.review))}</b></span><span>LOC Available <b>${esc(stock(item.available))}</b></span></div>
    ${Object.keys(totals).length?`<p class="bn-recorded">Recorded: ${Object.entries(totals).map(([kind,total])=>esc(kind.toUpperCase())+' '+total).join(' · ')}</p>`:''}
    <details class="bn-options" ${panelAttrs(key)}><summary>Lots, sizes and actions <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${item.rows.map(row=>`<section class="bn-lot"><label class="bn-choice">${selection?`<input type="checkbox" aria-label="Select lot ${esc(row.contsize)} ${esc(row.lotcode)} ${esc(row.unique_id)}" ${selection.includes(row.unique_id)?'checked':''} onchange="BunchNote.selectItem(${arg(index)},${arg([row.unique_id])},this.checked,${!!worker})">`:''}<span><b>${esc(row.contsize || 'Unknown size')} · Lot ${esc(row.lotcode || 'Unknown')}</b><small>Season ${esc(row.season || 'Unknown')} · DesigItem ${esc(row.desigitem || '—')}</small></span></label><p>On Hand ${esc(stock(row.stock))} · Review ${esc(stock(row.review))} · Available ${esc(stock(row.available))}</p><p>Flags ${esc(row.flags || '—')} · Hold ${esc(row.hold || '—')} · Warehouse ${esc(row.warehouse || '—')}</p><p>${esc(row.location_notes || 'No location notes')}</p><small>Source ${esc(row.unique_id)} · ${esc(row.locationcode)}</small></section>`).join('')}
    ${selection?actionChoices(key,item.rows,{index,worker,scope:'rows'}):''}</div></details></article>`;
  }).join('')}</div>`;
 }
 function catalogEditor() {
  return `<details class="bn-card bn-options" ${panelAttrs('catalog')}><summary>Manage reusable choices</summary><div class="bn-options-body">${state.options.map(o=>`<div class="bn-lot"><span>${esc(categoryLabels[o.category])} · ${esc(o.kind)} · ${o.active?'Active':'Retired'}</span><label class="bn-field">Option name<input id="bn-option-${esc(o.id)}" value="${esc(o.label)}"></label>${button('Save name',`BunchNote.editOption(${arg(o.id)},${o.active})`,state.busy)}${button(o.active?'Retire':'Restore',`BunchNote.editOption(${arg(o.id)},${!o.active})`,state.busy)}</div>`).join('')}</div></details>`;
 }
 function editor() {
  const draft = state.draft;
  let html = `<h2>Bunch Note</h2><p class="bn-muted">Choose a block, then a location to prepare its work.</p>`;
  if (!draft) return html + `<h3>Block Alpha</h3><div class="bn-drill-grid">${state.blocks.map(b => drillCard(b, 'View locations', `BunchNote.chooseBlock(${arg(b)})`, 'block')).join('') || `<p>${state.busy ? 'Loading blocks…' : 'No blocks available.'}</p>`}</div>${catalogEditor()}<h3>Saved batches</h3><div class="bn-drill-grid">${state.drafts.map(d => drillCard(d.block, `${d.body.locations.length} locations · ${new Date(d.updated_at).toLocaleString()}`, `BunchNote.openDraft(${arg(d.id)})`, 'batch')).join('') || '<p class="bn-muted">No saved batches.</p>'}</div>`;
  html += `<nav class="bn-breadcrumb" aria-label="Bunch Note drill-down">${button(draft.body.locations.length ? 'Save & back to blocks' : 'Back to blocks', 'BunchNote.backEditor()', state.busy)}${state.location ? button('Back to locations', 'BunchNote.backLocations()', state.busy) : ''}<span>${esc(draft.body.block)}${state.location ? ` → ${esc(state.location)}` : ''}</span></nav>`;
  const locations = groupInventory(state.rows).get(draft.body.block) || new Map();
  if (!state.location) {
   const names = [...new Set([...locations.keys(), ...draft.body.locations.map(l => l.location)])].sort((a,b) => a.localeCompare(b,undefined,{numeric:true}));
   html += `<h3>Location Code</h3><p class="bn-muted">Open a location to add it to this batch. Your other locations stay in the batch.</p><div class="bn-drill-grid">${names.map(name => { const saved=draft.body.locations.find(l => l.location === name); return drillCard(name, `${(locations.get(name) || []).length} plant rows${saved ? ` · In batch · ${saved.actions.length} actions` : ''}`, `BunchNote.openLocation(${arg(name)})`, 'location'); }).join('') || '<p>No locations available.</p>'}</div>`;
  } else {
   const i=draft.body.locations.findIndex(l => l.location === state.location), loc=draft.body.locations[i];
   if (loc) html += `<section class="bn-location-editor" aria-label="Location ${esc(loc.location)}"><div class="bn-location-heading"><h3>${esc(loc.location)}${loc.job_id ? ' · Revision' : ''}</h3><span class="bn-badge">In batch</span></div><details class="bn-card bn-options" ${panelAttrs('location:' + loc.location)}><summary>Location instructions <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">`
   + field('Purposes', loc.purposes, `BunchNote.edit(${i},'purposes',this.value)`)
   + field('Priority / work order', loc.priority, `BunchNote.edit(${i},'priority',this.value)`)
   + textfield('General instructions', loc.instructions, `BunchNote.edit(${i},'instructions',this.value)`)
   + textfield('Prerequisites / wait instructions', loc.prerequisites, `BunchNote.edit(${i},'prerequisites',this.value)`)
   + `<label class="bn-field">Assigned user (separate from email recipients)<select ${loc.job_id ? 'disabled' : ''} onchange="BunchNote.edit(${i},'owner_id',this.value)">${userOptions(loc.owner_id)}</select></label>`
   + '</div></details><h3>Items at this location</h3><p class="bn-muted">Open an item for its lots and sizes. Select any combination of actions. Shift/Hauling uses qualifying lots only.</p>'
   + plants(loc.source_all || locations.get(loc.location) || loc.source || [], loc.row_ids, i)
   + `<details class="bn-card bn-options" ${panelAttrs('actions:' + loc.location)}><summary>Action checklist (${loc.actions.length}) <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${loc.actions.map((a, j) => `<div class="bn-action"><b>${esc(a.label || a.group)} · ${esc(a.scope === 'location' ? 'Whole location' : a.row_ids.length + ' selected rows')}</b>`
    + textfield('Instruction', a.instructions, `BunchNote.editAction(${i},${j},'instructions',this.value)`)
    + `<div class="bn-grid">${field('Quantity (or percentage)', a.quantity, `BunchNote.editAction(${i},${j},'quantity',this.value)`, 'number')}${field('Percentage (or quantity)', a.percentage, `BunchNote.editAction(${i},${j},'percentage',this.value)`, 'number')}${field('Crew label', a.crew, `BunchNote.editAction(${i},${j},'crew',this.value)`)}${field('Target flags / shear stage', a.stage, `BunchNote.editAction(${i},${j},'stage',this.value)`)}${destinationField('Destination',a.destination,`BunchNote.editAction(${i},${j},'destination',this.value)`)}${field('Marking / ribbon / symbol', a.marking, `BunchNote.editAction(${i},${j},'marking',this.value)`)}</div>`
    + button('Remove action', `BunchNote.removeAction(${i},${j})`) + '</div>').join('')}`
   + `${actionChoices('location:'+i,loc.source_all || [],{index:i,worker:false,scope:'location'})}</div></details>${button('Remove location from batch', `BunchNote.removeLocation(${arg(loc.location)})`, state.busy || (!!draft.id && draft.body.locations.length === 1))}${draft.id && draft.body.locations.length === 1 ? '<p class="bn-muted">A saved batch must keep at least one location. You can edit its instructions here.</p>' : ''}</section>`;
  }
  html += '<details class="bn-options"><summary>Instruction guidance from Bunch Notes <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body"><p>Use “Center house” for the house over the 4-inch line. Specify quantity or percentage, stage, destination, and whether crews should grade or row-run.</p><p>BOB, QC, SAM, RHETT, SHARON, MATT, BUNCHERS and TA are instruction labels. They do not assign users or select recipients.</p><p>Flags: blue = ship first; white = lesser quality; red = promo / worst quality; green = grow-on. Outside corner ribbons: yellow = water control; pink = overwinter outside; shift = haul for shift; shift + pink = outside for spring shift. Apply only where you explicitly choose.</p></div></details>';
  html += `<details class="bn-card bn-options" ${panelAttrs('recipients')}><summary>Email recipients · Dylan included <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${state.users.filter(u => u.email).map(u => `<label class="bn-choice"><input type="checkbox" ${u.username === 'dylan_collyge' || draft.body.recipient_ids.includes(u.id) ? 'checked' : ''} ${u.username === 'dylan_collyge' ? 'disabled' : ''} onchange="BunchNote.recipient(${arg(u.id)},this.checked)"><span>${esc(u.display || u.username)}<small>${esc(u.email)}</small></span></label>`).join('')}</div></details>`;
  return html + destinationList() + `<p class="bn-muted">${draft.body.locations.length} locations in this batch</p><div class="bn-toolbar">` + button('Refresh source for review', 'BunchNote.refreshSource()', state.busy) + button('Save draft', 'BunchNote.save()', state.busy || !draft.body.locations.length) + button('Preview PDFs and recipients', 'BunchNote.preview()', state.busy || !draft.body.locations.length) + '</div>';
 }
 function previewHtml() {
  const p = state.preview;
  return `<h2>Review ${p.report_kind==='completed_work'?'Completed Work':'Bunch Notes'} PDFs</h2><p>Recipients: ${p.recipients.map(r => esc(r.email)).join(', ')}</p>${state.urls.map((url, i) => `<section class="bn-card"><a href="${url}" target="_blank" rel="noopener">Open ${esc(p.pdfs[i].filename)}</a><iframe title="${esc(p.pdfs[i].filename)}" src="${url}" style="width:100%;height:60vh;border:1px solid #aaa"></iframe></section>`).join('')}`
   + button('Back', 'BunchNote.closePreview()') + (p.report_kind==='completed_work'&&!p.saved ? button('Save completed-work PDF','BunchNote.publishWork(false)',state.busy)+button('Save and email reviewed PDF','BunchNote.publishWork(true)',state.busy) : p.saved ? button('Email reviewed PDFs', 'BunchNote.sendSaved()', state.busy) : button('Publish to Queue', 'BunchNote.publish(false)', state.busy) + button('Publish and email reviewed PDFs', 'BunchNote.publish(true)', state.busy));
 }
 function queue() {
  if (!state.loaded && !state.loading && !state.error) void run(load);
  if (state.detail) return detailHtml();
  let html = '<h2>Bunch Notes</h2><p>Claim available location work. Claimed work is visible to its owner and Dylan.</p>';
  ['available','mine','completed', ...(author() ? ['all','cancelled'] : [])].forEach(filter => { html += button(({available:'Available',mine:'My Work',completed:'Completed',all:'All assignments',cancelled:'Canceled'})[filter], `BunchNote.filter(${arg(filter)})`, state.busy, state.filter === filter); });
  html += button('Refresh', 'BunchNote.refresh()');
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const jobs = state.jobs.filter(j => state.filter === 'all' || (state.filter === 'available' ? j.status === 'open' && !j.owner_id : state.filter === 'mine' ? j.status === 'open' && j.owner_id === uid : j.status === (state.filter === 'completed' ? 'complete' : 'cancelled')));
  return html + (state.loading ? '<p>Loading…</p>' : !jobs.length ? '<p>No work in this filter.</p>' : jobs.map(j => `<article class="bn-card"><h3>${esc(j.block)} → ${esc(j.location)}</h3><p>${esc(j.note_number)} · Revision ${j.instruction_revision} · ${esc(j.body.purposes)}</p><p>Priority: ${esc(j.body.priority || '—')} · ${Object.keys(j.progress).length}/${allActions(j).length} actions</p><p>Work: ${esc(j.status)} · Email: ${esc(j.delivery_status)}</p>${button('Open', `BunchNote.detail(${arg(j.id)})`)}</article>`).join(''));
 }
 function detailHtml() {
  const {job: j, versions, audit} = state.detail;
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const owner = j.owner_id === uid, open = j.status === 'open';
  let html = button('Back', 'BunchNote.backQueue()') + `<h2>${esc(j.block)} → ${esc(j.location)}</h2><p><b>${esc(j.note_number)} · Instruction revision ${j.instruction_revision}</b></p><p>${esc(j.body.purposes)} · Priority ${esc(j.body.priority || '—')}</p><h3>General instructions</h3><p class="bn-pre">${esc(j.body.instructions)}</p><h3>Prerequisites</h3><p class="bn-pre">${esc(j.body.prerequisites || 'None written')}</p>`;
  if (open && !j.owner_id) html += button('Claim work', `BunchNote.command('claim')`, state.busy);
  if (open && owner) html += button('Release to available work', `BunchNote.command('release')`, state.busy);
  if (open && author()) html += `<label class="bn-field">Assign / reassign<select id="bn-owner">${userOptions(j.owner_id)}</select></label>` + button('Apply assignment', `BunchNote.assign()`) + button('Revise instructions', `BunchNote.revise()`) + button('Cancel work', `BunchNote.cancel()`);
  html += plants(j.body.source || [],null,'work',j) + allActions(j).map(a => {
   const done=j.progress[a.id], actuals=currentActuals(j).filter(x=>x.action_id===a.id), key=j.id+':'+a.id, form=state.workForms[key]||{}, kind=actionKind(a);
   const lots=(j.body.source||[]).filter(r=>(a.scope==='location'||(a.row_ids||[]).includes(r.unique_id))&&(a.group!=='hauling'||shiftEligible(r)));
   const mayCorrect=(open&&owner)||(author()&&j.status==='complete');
   return `<article class="bn-card"><h3>${esc(a.label || a.crew || a.group)}${a.worker_added?' · Added by worker':''}</h3><p class="bn-pre">${esc(a.instructions)}</p><p>${esc(a.scope==='location'?'Whole location':(a.row_ids||[]).map(id=>{const r=(j.body.source||[]).find(r=>r.unique_id===id);return r?[r.itemcode,r.contsize,r.lotcode].join(' / '):id;}).join('; '))}</p><p>Planned quantity ${esc(a.quantity || '—')} · % ${esc(a.percentage || '—')} · ${esc(a.stage || '')} · ${esc(a.destination || '')} · ${esc(a.marking || '')}</p>
    <p><b>Recorded ${actuals.length?actuals.reduce((sum,x)=>sum+Number(x.quantity),0):'Not recorded'} ${esc(kind==='instruction'?'':kind.toUpperCase())}</b></p>${actuals.map(x=>`<div class="bn-lot"><b>${esc(x.quantity)} · ${esc(x.source_snapshot.contsize)} · Lot ${esc(x.source_snapshot.lotcode)}</b><p>${esc(x.destination ? 'To '+x.destination : '')}</p><p>${esc(x.explanation)}</p>${x.review_flags.length?'<strong class="bn-review">Review: '+esc(reviewText(x.review_flags))+'</strong>':''}${x.replaces_id?'<small>Audited correction</small>':''}${mayCorrect?button('Correct entry',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</div>`).join('')}
    ${open&&owner&&['ta','move','hauling'].includes(kind)?`<details class="bn-options" ${panelAttrs('actual:'+a.id)}><summary>Record ${esc(kind.toUpperCase())} / partial work</summary><div class="bn-options-body"><label class="bn-field">Container size and lot<select onchange="BunchNote.workField(${arg(key)},'source_id',this.value)"><option value="">Choose size and lot</option>${lots.map(r=>`<option value="${esc(r.unique_id)}" ${form.source_id===r.unique_id?'selected':''}>${esc([r.contsize,r.lotcode,r.season,r.unique_id].join(' · '))}</option>`).join('')}</select></label>${field('Actual quantity',form.quantity||'',`BunchNote.workField(${arg(key)},'quantity',this.value)`,'number')}${kind!=='ta'?destinationField('Moved to',form.destination||'',`BunchNote.workField(${arg(key)},'destination',this.value)`):''}${textfield('Explanation / review note',form.explanation||'',`BunchNote.workField(${arg(key)},'explanation',this.value)`)}${button('Record entry',`BunchNote.recordActual(${arg(a.id)})`,state.busy)}</div></details>`:''}
    <b>${esc(done?.status || 'Pending')}</b><p>${esc(done?.reason || '')}</p>${done?.review_flags?.length?'<p class="bn-review">Review: '+esc(reviewText(done.review_flags))+'</p>':''}${open&&owner?textfield('Completion / variance reason',form.reason||'',`BunchNote.workField(${arg(key)},'reason',this.value)`)+button('Done',`BunchNote.progress(${arg(a.id)},'done')`,state.busy)+button('Not needed',`BunchNote.progress(${arg(a.id)},'not_needed')`,state.busy):''}</article>`;
  }).join('');
  if (open && owner) html += button('Complete location', `BunchNote.command('complete')`, state.busy || allActions(j).some(a=>!j.progress[a.id]));
  if (j.status==='complete' && author()) html += `<details class="bn-card bn-options" ${panelAttrs('work-report')}><summary>Completed-work PDF and recipients</summary><div class="bn-options-body">${state.users.filter(u=>u.email).map(u=>`<label class="bn-choice"><input type="checkbox" ${u.username==='dylan_collyge'||state.workRecipients.includes(u.id)?'checked':''} ${u.username==='dylan_collyge'?'disabled':''} onchange="BunchNote.workRecipient(${arg(u.id)},this.checked)"><span>${esc(u.display || u.username)}<small>${esc(u.email)}</small></span></label>`).join('')}${button('Preview completed-work PDF','BunchNote.previewWork()',state.busy)}</div></details>`;
  html += `<h3>Completed-work PDFs</h3>${(state.detail.work_reports||[]).map(v=>`<p>Work revision ${v.job_revision} · Email ${esc(v.delivery_status)} ${button('Open completed-work PDF',`BunchNote.workPdf(${arg(v.preview_id)})`)}${author()&&['not_sent','failed','unknown','sending'].includes(v.delivery_status)?button(v.delivery_status==='not_sent'?'Review and send':v.delivery_status==='failed'?'Retry delivery':'Reconcile delivery',`BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`):''}</p>`).join('')}`;
  html += `<details class="bn-options"><summary>Actual entry and correction history (${(j.actuals||[]).length})</summary>${(j.actuals||[]).map(x=>`<p>${esc(x.created_at)} · ${esc(x.action_snapshot.label || x.action_snapshot.instructions)} · ${esc(x.source_snapshot.contsize)} / ${esc(x.source_snapshot.lotcode)} · ${esc(x.quantity)} · ${esc(x.destination)} · ${x.superseded?'Replaced by correction':'Current'} · ${esc(x.explanation)}${!x.superseded&&((open&&owner)||(author()&&j.status==='complete'))?button('Amend recorded work',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</p>`).join('')}</details>` + destinationList();
  html += `<h3>PDF revisions</h3>${versions.map(v => `<p>Revision ${v.instruction_revision} · Email ${esc(v.delivery_status)} ${button('Open PDF', `BunchNote.pdf(${v.instruction_revision})`)}${author() && ['not_sent','failed','unknown','sending'].includes(v.delivery_status) ? button(v.delivery_status === 'not_sent' ? 'Review and send' : v.delivery_status === 'failed' ? 'Retry delivery' : 'Reconcile delivery', `BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`) : ''}</p>`).join('')}`;
  return html + `<details><summary>History (${audit.length})</summary>${audit.map(a => `<p>${esc(a.created_at)} · ${esc(a.operation)} · ${esc(JSON.stringify(a.detail))}</p>`).join('')}</details>`;
 }
 const destinationList = () => `<datalist id="bn-destinations">${state.destinations.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`;
 const destinationField = (label,value,action) => `<label class="bn-field">${esc(label)}<input list="bn-destinations" value="${esc(value)}" oninput="${action}" placeholder="Search or type a location"></label>`;
 const actionFromOption = (o,ids,scope='rows') => ({id:crypto.randomUUID(),option_id:o.id,group:o.category,label:o.label,kind:o.kind,instructions:o.label,scope,row_ids:ids,quantity:'',percentage:'',crew:'',stage:'',destination:'',marking:''});
 async function refreshCatalog() { const c=await api('catalog'); state.options=c.options; state.destinations=c.locations; }
 async function preparePdf(p) {
  const owner=state, pdf=await postGoogleScriptJsonPayload({type:'bunch_note_preview',nativeAuthAccessToken,previewId:p.id},REQUEST_EMAIL_SCRIPT_TIMEOUT_MS,'Bunch Note PDF preview');
  if(owner!==state)return;
  if(!pdf?.ok)throw new Error(pdf?.message||'PDF preview failed.');
  state.preview={...p,pdfs:pdf.pdfs}; showPdfs(pdf.pdfs);
 }
 function render() {
  ensureAccount();
  const view = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
  const container = document.getElementById(view === 'bunch-note' ? 'bunch-note-content' : 'request-content');
  if (!container || !account() || (view !== 'bunch-note' && !(view === 'request' && activeReqTab === 'bunch-notes'))) return;
  container.classList.add('bn-root');
  container.innerHTML = (state.error ? `<p role="alert">${esc(state.error)}</p>` : '') + (view === 'bunch-note' && author() ? state.preview ? previewHtml() : editor() : queue());
  container.setAttribute('aria-busy', String(state.busy));
  if (state.busy) container.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
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
  templates, normalize, quantity, groupInventory, groupItems, shiftEligible, actionKind, recipientEmails, api, render, reset, open, author,
  scope: () => { ensureAccount(); return state.detail?.job.id || ''; },
  stage: async ctx => { ensureAccount(); const owner=account(), epoch=state.epoch, id=state.detail?.job.id; const data = await api('list', {}, null, null, ctx.signal); const detail=id&&data.jobs.some(j=>j.id===id)?await api('get',{job_id:id},null,null,ctx.signal):null; return {account:owner,epoch,jobs:data.jobs,detail,id}; },
  commit: value => { ensureAccount(); if (value.account === account() && value.epoch === state.epoch) { state.jobs = value.jobs; state.loaded = true; if (state.detail?.job.id===value.id) state.detail=value.detail; if(getCurrentVisibleViewId()==='request'&&activeReqTab==='bunch-notes')render(); } },
  chooseBlock: block => run(async () => { if (!block) return; state.rows = (await api('inventory',{block})).rows; state.location=''; state.panels.clear(); state.draft = {id:null,revision:null,body:{block,locations:[],recipient_ids:[]}}; }),
  openDraft: id => run(async () => { const d = state.drafts.find(d => d.id === id); const rows=(await api('inventory',{block:d.block})).rows; state.draft = structuredClone(d); state.rows=rows; state.location=''; state.panels.clear(); }),
  backEditor: () => run(async () => { if(state.draft.body.locations.length)await saveDraft(); state.drafts=(await api('drafts')).drafts; invalidate(); state.draft=null; state.location=''; }),
  backLocations: () => { state.location=''; render(); },
  panel: (key, expanded) => { if(expanded)state.panels.add(key); else state.panels.delete(key); },
  openLocation: location => { if(state.busy)return; const d=state.draft.body; if(!d.locations.some(l=>l.location===location)){ const rows=groupInventory(state.rows).get(d.block)?.get(location); if(!rows)return; invalidate(); d.locations.push({location,purposes:'',priority:'',instructions:'',prerequisites:'',owner_id:'',row_ids:rows.map(r=>r.unique_id),source_all:rows,actions:[]}); } state.location=location; state.panels.add('location:'+location); state.panels.add('actions:'+location); render(); },
  removeLocation: location => run(async () => { if(state.draft.id && state.draft.body.locations.length === 1)return; if(!await showAppConfirm('Remove this location and its draft instructions from this batch?',{title:'Bunch Note'}))return; invalidate(); state.draft.body.locations=state.draft.body.locations.filter(l=>l.location!==location); state.location=''; }),
  selectRow: (i,id,on) => { invalidate(); const l=state.draft.body.locations[i]; l.row_ids=on?[...new Set([...l.row_ids,id])]:l.row_ids.filter(v=>v!==id); const add=document.getElementById('bn-add-selected-'+i); if(add)add.disabled=state.busy || !l.row_ids.length; },
  edit: (i,key,value) => { invalidate(); state.draft.body.locations[i][key]=value; },
  editAction: (i,j,key,value) => { invalidate(); state.draft.body.locations[i].actions[j][key]=value; },
  chooseOption: (key,id,on) => {state.choices[key]=on?[...new Set([...(state.choices[key]||[]),id])]:(state.choices[key]||[]).filter(x=>x!==id);},
  custom: (key,field,value) => {state.custom[key]={...state.custom[key],[field]:value};},
  saveOption: (target,category) => run(async()=>{const k=target+':'+category,c=state.custom[k]||{},j=state.detail?.job; if(!c.label?.trim())throw new Error('Type a new option first.'); const response=await api('option_add',{category,label:c.label.trim(),kind:c.kind||'instruction',...(!author()?{job_id:j.id}:{})},author()?null:j.revision,crypto.randomUUID()); await refreshCatalog(); state.choices[k]=[...(state.choices[k]||[]),response.option.id]; state.custom[k]={};}),
  editOption: (id,active) => {const o=state.options.find(o=>o.id===id),label=document.getElementById('bn-option-'+id).value;return run(async()=>{await api('option_edit',{option_id:id,label,active},o.revision,crypto.randomUUID());await refreshCatalog();});},
  selectItem: (index,ids,on,worker) => {if(worker){const j=state.detail.job,current=state.workRows[j.id]||j.body.source.map(r=>r.unique_id);state.workRows[j.id]=on?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id));}else{invalidate();const l=state.draft.body.locations[index];l.row_ids=on?[...new Set([...l.row_ids,...ids])]:l.row_ids.filter(id=>!ids.includes(id));}render();},
  addChoices: (key,category) => run(async()=>{
   const target=state.targets[key],selection=state.choices[key+':'+category]||[],j=state.detail?.job,l=target.worker?null:state.draft.body.locations[target.index];
   const source=target.worker?j.body.source:l.source_all, selected=target.worker?(state.workRows[j.id]||source.map(r=>r.unique_id)):l.row_ids;
   const ids=source.filter(r=>target.ids.includes(r.unique_id)&&(target.scope==='location'||selected.includes(r.unique_id))&&(category!=='hauling'||shiftEligible(r))).map(r=>r.unique_id);
   if(!ids.length)throw new Error('Select at least one eligible lot row.'); if(!selection.length)throw new Error('Choose one or more options.');
   for(const id of selection){const o=state.options.find(o=>o.id===id&&o.active);if(!o)throw new Error('BUNCH_NOTE_OPTION_CHANGED');const pendingKey=key+':'+id;const a=target.worker?(state.pendingActions[pendingKey] ||= actionFromOption(o,ids,category==='hauling'?'rows':target.scope)):actionFromOption(o,ids,category==='hauling'?'rows':target.scope);
    if(target.worker){const current=state.detail.job;await api('add_action',{job_id:current.id,action:a},current.revision,crypto.randomUUID());state.detail=await api('get',{job_id:current.id});delete state.pendingActions[pendingKey];}
    else {invalidate();l.row_ids=[...new Set([...l.row_ids,...ids])];l.actions.push(a);state.panels.add('actions:'+l.location);}
    state.choices[key+':'+category]=(state.choices[key+':'+category]||[]).filter(v=>v!==id);
   }
  }),
  workField: (key,field,value) => {state.workForms[key]={...state.workForms[key],[field]:value};},
  recordActual: id => run(async()=>{const j=state.detail.job,key=j.id+':'+id,form=state.workForms[key]||{};await api('actual',{job_id:j.id,action_id:id,source_id:form.source_id,quantity:form.quantity,destination:form.destination||'',explanation:form.explanation||''},j.revision,crypto.randomUUID());if(state.workForms[key]===form)state.workForms[key]={source_id:form.source_id};state.detail=await api('get',{job_id:j.id});await load();}),
  correctActual: id => {const j=state.detail.job,x=j.actuals.find(x=>x.id===id),amount=prompt('Corrected quantity (0 cancels this entry):',String(x.quantity));if(amount===null)return;const destination=actionKind(x.action_snapshot)==='ta'?'':prompt('Correct destination:',x.destination);if(destination===null)return;const explanation=prompt('Reason for this correction:');if(!explanation?.trim())return;return run(async()=>{await api('actual',{job_id:j.id,action_id:x.action_id,source_id:x.source_snapshot.unique_id,replaces_id:id,quantity:amount,destination,explanation},j.revision,crypto.randomUUID());state.detail=await api('get',{job_id:j.id});await load();});},
  workRecipient: (id,on) => {state.workRecipients=on?[...new Set([...state.workRecipients,id])]:state.workRecipients.filter(x=>x!==id);},
  previewWork: () => run(async()=>{const j=state.detail.job,{preview}=await api('work_preview',{job_id:j.id,recipient_ids:state.workRecipients},j.revision,crypto.randomUUID());await preparePdf(preview);switchView('bunch-note');}),
  publishWork: send_email => run(async()=>{await api('work_publish',{preview_id:state.preview.id,send_email},state.preview.job_revision,crypto.randomUUID());invalidate();state.detail=null;switchView('request');setReqTab('bunch-notes');await load();}),
  workPdf: preview_id => run(async()=>{const result=await api('work_pdf',{job_id:state.detail.job.id,preview_id});showPdfs([result.pdf]);const a=document.createElement('a');a.href=state.urls[0];a.target='_blank';a.rel='noopener';a.download=result.pdf.filename;a.click();}),
  removeAction: (i,j) => { invalidate(); state.draft.body.locations[i].actions.splice(j,1); render(); },
  recipient: (id,on) => { invalidate(); const d=state.draft.body; d.recipient_ids=on?[...new Set([...d.recipient_ids,id])]:d.recipient_ids.filter(v=>v!==id); },
  refreshSource: () => run(async () => { invalidate(); const d=state.draft.body; state.rows=(await api('inventory',{block:d.block})).rows; const locations=groupInventory(state.rows).get(d.block)||new Map(); d.locations.forEach(l=>{l.source_all=locations.get(l.location)||[];}); }),
  save: () => run(saveDraft),
  preview: () => run(async () => { await saveDraft(); const d=state.draft; const {preview:p}=await api('preview',{batch_id:d.id},d.revision,crypto.randomUUID()); const owner=state; const pdf=await postGoogleScriptJsonPayload({type:'bunch_note_preview',nativeAuthAccessToken,previewId:p.id},REQUEST_EMAIL_SCRIPT_TIMEOUT_MS,'Bunch Note PDF preview'); if(owner!==state)return; if(!pdf?.ok)throw new Error(pdf?.message||'PDF preview failed.'); state.preview={...p,pdfs:pdf.pdfs}; showPdfs(pdf.pdfs); }),
  closePreview: () => { const work=state.preview?.report_kind==='completed_work';invalidate();if(work){switchView('request');setReqTab('bunch-notes');}render(); },
  publish: send_email => run(async () => { await api('publish',{preview_id:state.preview.id,send_email},state.draft.revision,crypto.randomUUID()); invalidate(); state.draft=null; state.drafts=(await api('drafts')).drafts; await load(); showToast('Bunch Notes',send_email?'Published. Email queued.':'Published to Queue.'); }),
  refresh: () => run(load), filter: value => { state.filter=value; render(); },
  detail: id => run(async () => { state.detail=await api('get',{job_id:id}); await refreshCatalog(); if(author()&&!state.users.length)state.users=(await api('directory')).users; }),
  backQueue: () => { state.detail=null; render(); },
  command: (operation, extra={}) => run(async () => { const j=state.detail.job; await api(operation,{job_id:j.id,...extra},j.revision,crypto.randomUUID()); state.detail=operation==='progress'?await api('get',{job_id:j.id}):null; await load(); }),
  assign: () => root.BunchNote.command('assign',{owner_id:document.getElementById('bn-owner').value}),
  progress: (id,status) => { const key=state.detail.job.id+':'+id;const reason=state.workForms[key]?.reason || (status==='not_needed'?prompt('Why is this action not needed?'):''); if(status==='not_needed'&&!reason?.trim())return; return root.BunchNote.command('progress',{action_id:id,status,reason}); },
  cancel: () => { const reason=prompt('Reason for canceling this location work:'); if(reason?.trim())return root.BunchNote.command('cancel',{reason}); },
  revise: () => run(async () => { const j=state.detail.job; const data=await api('revise',{job_id:j.id},j.revision,crypto.randomUUID()); state.draft=data.draft; state.rows=(await api('inventory',{block:j.block})).rows; state.users=(await api('directory')).users; state.location=j.location; state.panels.clear(); state.panels.add('location:'+j.location); state.panels.add('actions:'+j.location); state.detail=null; switchView('bunch-note'); }),
  pdf: revision => run(async () => { const result=await api('pdf',{job_id:state.detail.job.id,instruction_revision:revision}); showPdfs([result.pdf]); const a=document.createElement('a'); a.href=state.urls[0]; a.target='_blank'; a.rel='noopener'; a.download=result.pdf.filename; a.click(); }),
  sendSaved: () => run(async () => { await api('send',{preview_id:state.preview.id},null,crypto.randomUUID()); invalidate(); state.detail=null; switchView('request'); setReqTab('bunch-notes'); await load(); }),
  delivery: (preview_id,status) => run(async () => { const p=await api('preview_read',{preview_id}); if(status==='not_sent'){state.preview={...p,saved:true}; showPdfs(p.pdfs); switchView('bunch-note'); return;} if(!await showAppConfirm(status==='failed'?'Retry this failed delivery to the saved recipients?':'Reconcile against Sent mail without sending another copy?',{title:'Bunch Notes delivery'}))return; await api(status==='failed'?'retry':'reconcile',{preview_id},null,crypto.randomUUID()); state.detail=null; await load(); }),
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
