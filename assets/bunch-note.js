/* global currentUser, nativeAuthSessionActive, nativeAuthProfile, showToast, APP_SHELL_BUILD, postAppFunctionJson, APP_API_FUNCTION_URL, getCurrentVisibleViewId, getMainAreaScrollTop, setMainAreaScrollTop, postGoogleScriptJsonPayload, nativeAuthAccessToken, REQUEST_EMAIL_SCRIPT_TIMEOUT_MS, activeReqTab, showAppConfirm, switchView, setReqTab */
(function (root) {
 'use strict';
 const groups = {
  sequence: ['Early protection','Haul-in space','Small-container crew','Drill shift','LD planting','Shovel shift','Rain-day preparation'],
  grading: ['Grade and Save / Move To','Grade quantity or percentage','Dump quantity or percentage','Shear before bunching'],
  hauling: ['Grade shift','Row-run shift','Haul to destination','Wait for hauling before bunching'],
  placement: ['Center house','Outside house','Extra spacing','Combine groups','Water control','Won’t-fit stock','Overwinter outside','Countable rows','Field signs at both ends facing the road','Missing tags or signs','Variety mixes','Separate look-alikes','Wide aisles','Group symbols','Flag or ribbon guidance'],
  inventory: ['TA / culls follow-up','Move','Designated-location review','Pull-tag notes','Priority review','Season error review','Obsolete-location review']
 };
 const templates = Object.entries(groups).flatMap(([group, labels]) => labels.map(label => ({ group, label, instructions: label, kind: label === 'TA / culls follow-up' ? 'ta' : ['Move','Grade and Save / Move To'].includes(label) ? 'move' : group === 'hauling' && !label.startsWith('Wait') ? 'hauling' : 'instruction' })));
 const renderedQueues = new WeakMap();
 const normalize = value => String(value ?? '').trim().toUpperCase();
 const baseLocation = value => root.LocationCode.base(value);
 const locationGroups = values => root.LocationCode.group(values);
 const salesYear = value => /^\d{2}$/.test(normalize(value)) ? '20'+normalize(value) : /^\d{4}$/.test(normalize(value)) ? normalize(value) : '';
 const sourceGroups = rows => { const groups=new Map(); rows.forEach(r=>{const key=normalize(r.itemcode)+'|'+salesYear(r.salesyear);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});return groups; };
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
 const fresh = () => ({ account: '', epoch: 0, jobs: [], loaded: false, loading: false, error: '', blocks: [], rows: [], users: [], drafts: [], draft: null, location: '', locationStep: 'setup', actionEdit: null, customEdit: null, base: '', item: '', workCard: '', boardState: {}, queueBase: '', queueLocation: '', screen: 'source', destinationBase: '', destinationLocation: '', destinationData: null, destinationNames: [], destinationSearch: '', picker: null, scrolls: new Map(), parked: new Map(), panels: new Set(), options: [], destinations: [], targets: {}, choices: {}, pendingActions: {}, custom: {}, workForms: {}, workRows: {}, workRecipients: [], detail: null, preview: null, urls: [], filter: 'available', busy: false, commands: new Map() });
 let state = fresh();
 const account = () => typeof currentUser === 'undefined' ? '' : String(currentUser || '');
 const author = () => account() === 'dylan_collyge' && typeof nativeAuthSessionActive !== 'undefined' && nativeAuthSessionActive === true && typeof nativeAuthProfile !== 'undefined' && nativeAuthProfile?.username === 'dylan_collyge'
  && !nativeAuthProfile.disabled_at && nativeAuthProfile.must_change_password === false
  && (!nativeAuthProfile.locked_until || Date.parse(nativeAuthProfile.locked_until) <= Date.now());
 const structuredHandles = new Map();
 let structuredModule;
 let structuredGeneration = 0;
 const cardKey = r => [r.location_code || r.locationcode || r.location,r.itemcode,r.commonname,r.contsize].map(v=>String(v??'').trim().replace(/\s+/g,' ').toUpperCase()).join('\u001f');
 function prepareCards(loc, legacy=false) {
  const source=loc.source_all||loc.source||[], groups=new Map();
  for(const row of source){if(!row.unique_id)continue;const key=cardKey(row);if(!groups.has(key))groups.set(key,new Map());groups.get(key).set(row.unique_id,row);}
  if(!Array.isArray(loc.cards))loc.cards=[];
  if(legacy)for(const rowsById of groups.values()){
   const rows=[...rowsById.values()];if(!rows.some(r=>(loc.row_ids||[]).includes(r.unique_id)))continue;
   const first=rows[0];if(loc.cards.some(c=>c.kind==='inventory'&&cardKey(c)===cardKey(first)))continue;loc.cards.push({id:crypto.randomUUID(),kind:'inventory',location_code:loc.location,itemcode:first.itemcode,commonname:first.commonname,contsize:first.contsize,row_ids:rows.map(r=>r.unique_id),owner_id:loc.owner_id||null,house:loc.target_houses||'',direction:loc.direction||''});
  }
  for(const action of loc.actions||[]){
   if(loc.cards.some(c=>c.id===action.card_id))continue;
   let card=action.scope==='rows'&&action.row_ids?.length?loc.cards.find(c=>c.kind==='inventory'&&action.row_ids.every(id=>c.row_ids.includes(id))):null;
   if(!card){card=loc.cards.find(c=>c.kind==='shared');if(!card){card={id:crypto.randomUUID(),kind:'shared',location_code:loc.location,itemcode:'',commonname:'General / Shared Work',contsize:'',row_ids:[],owner_id:loc.owner_id||null,house:'',direction:''};loc.cards.push(card);}card.row_ids=[...new Set([...card.row_ids,...(action.scope==='location'&&!action.freeform?source.map(r=>r.unique_id):action.row_ids||[])])];}
   action.card_id=card.id;
  }
  loc.row_ids=[...new Set(loc.cards.flatMap(c=>c.row_ids))];
 }
 function prepareDraftCards() { const d=state.draft?.body;if(!d)return;for(const loc of d.locations)prepareCards(loc,!Array.isArray(loc.cards));d.format_version=5; }
 function ensureLocation(location) {
  const code=normalize(typeof location==='string'?location:location.location||location.location_code), d=state.draft.body;
  let loc=d.locations.find(l=>normalize(l.location)===code);
  if(!loc){loc={location:code,purposes:'',priority:'',instructions:'',prerequisites:'',owner_id:null,row_ids:[],cards:[],source_all:state.rows.filter(r=>normalize(r.locationcode)===code),actions:[],house_sections:[]};d.locations.push(loc);}
  return loc;
 }
 function changeCard(location, value) {
  if(state.busy||!author())return;
  const loc=ensureLocation(location), existing=loc.cards.find(c=>c.id===value.id);
  if(value.included===false&&(loc.actions||[]).some(a=>a.card_id===value.id))throw new Error('Remove this card’s planned actions before excluding it.');
  invalidate();
  if(value.included===false)loc.cards=loc.cards.filter(c=>c.id!==value.id);
  else{const card={id:existing?.id||(/^[0-9a-f-]{36}$/i.test(value.id||'')?value.id:crypto.randomUUID()),kind:'inventory',location_code:loc.location,itemcode:value.itemcode,commonname:value.commonname,contsize:value.contsize,row_ids:[...new Set(value.row_ids)],owner_id:value.owner_id||null,house:value.house??'',direction:value.direction??''};if(existing)Object.assign(existing,card);else loc.cards.push(card);}
  prepareCards(loc);state.epoch++;
  for(const [host,handle] of structuredHandles)if(host.dataset.bnCards!==undefined)handle.update(cardBoardProps());
 }
 function updateBoard() {for(const [host,handle] of structuredHandles)if(host.dataset.bnCards!==undefined)handle.update(cardBoardProps());}
 function bridgeRevisionKey() { const job=workJob();return `${state.epoch}:${job?.revision??state.draft?.revision??''}:${job?.instruction_revision??''}`; }
 function cardBoardProps() { return {accountKey:state.account,revisionKey:bridgeRevisionKey(),rows:state.rows,locations:state.draft.body.locations.map(l=>({...l,cards:[...l.cards||[]]})),users:state.users,busy:state.busy,viewState:state.boardState,onViewState:next=>{state.boardState=next;updateBoard();},onCardChange:changeCard,onMove:moveCard,onLocationInstructions:location=>root.BunchNote.openLocation(typeof location==='string'?location:location.location||location.location_code),onSave:async()=>{await run(saveDraft);if(state.error)throw new Error(state.error);}}; }
 function moveCard(location,card) {
  if(state.busy)return;changeCard(location,{...card,included:true});const loc=ensureLocation(location), included=loc.cards.find(c=>cardKey(c)===cardKey(card));
  const option=state.options.find(o=>o.active&&o.kind==='move'&&o.label==='Move')||state.options.find(o=>o.active&&o.kind==='move');
  if(!option){showToast('Bunch Notes','The planned Move option is unavailable. Refresh the choices and retry.',true);return;}
  const index=state.draft.body.locations.indexOf(loc),key='card:'+included.id;
  state.targets[key]={index,worker:false,scope:'rows',ids:included.row_ids,card_id:included.id};beginAction(key,option.id);render();restoreScroll();
 }
 function workJob() {
  const job=state.detail?.job, card=job?.cards?.find(c=>c.id===state.workCard);if(!card)return job;
  const actions=allActions(job).filter(a=>a.card_id===card.id),ids=new Set(actions.map(a=>a.id));
  return {...job,card_id:card.id,owner_id:card.owner_id,revision:card.revision,status:job.status==='open'?card.status:job.status,progress:Object.fromEntries(Object.entries(job.progress||{}).filter(([id])=>ids.has(id))),actuals:(job.actuals||[]).filter(a=>ids.has(a.action_id)),worker_actions:(job.worker_actions||[]).filter(a=>a.card_id===card.id),body:{...job.body,source:(job.body.source||[]).filter(r=>card.row_ids.includes(r.unique_id)),actions:(job.body.actions||[]).filter(a=>a.card_id===card.id)}};
 }
 const workScope = job => job?.card_id?{card_id:job.card_id}:{};
 function sharedEditor(loc,index) {
  prepareCards(loc);const card=loc.cards.find(c=>c.kind==='shared');
  return card?`<section class="bn-card"><h3>General / Shared Work</h3><p>Location-wide tasks and actions spanning item cards stay together.</p><label class="bn-field">Shared work assigned user<select ${loc.job_id?'disabled':''} onchange="BunchNote.sharedOwner(${index},this.value)">${userOptions(card.owner_id)}</select></label></section>`:'';
 }
 function workerCards(job) {
  const uid=nativeAuthProfile?.id;
  return `<h2>${esc(job.location)} · ${esc(job.body.purposes)}</h2><p>${esc(job.note_number)} · Instruction revision ${job.instruction_revision}</p><div class="bn-card-board">${job.cards.map(card=>`<article class="bn-card"><span class="bn-eyebrow">${esc(card.kind==='shared'?'General / Shared Work':card.itemcode)}</span><h3>${esc(card.commonname)} ${esc(card.contsize)}</h3><p>Worker: ${esc(card.owner_name||'Unassigned')} · ${esc(card.status)}</p><p>House: ${esc(card.house||'Not specified')} · Direction: ${esc(card.direction||'Not specified')}</p>${button('Open card',`BunchNote.openWorkCard(${arg(card.id)})`,state.busy)}${job.status==='open'&&card.status==='open'&&!card.owner_id?button('Claim card',`BunchNote.cardCommand('claim_card',${arg(card.id)})`,state.busy):''}${job.status==='open'&&card.status==='open'&&card.owner_id===uid?button('Release card',`BunchNote.cardCommand('release_card',${arg(card.id)})`,state.busy):''}${author()&&job.status==='open'&&card.status==='open'?`<label class="bn-field">Assign / reassign card<select id="bn-owner-${esc(card.id)}">${userOptions(card.owner_id)}</select></label>${button('Apply card assignment',`BunchNote.assignCard(${arg(card.id)})`,state.busy)}`:''}</article>`).join('')}</div>`+(author()&&job.status==='open'?button('Revise instructions','BunchNote.revise()',state.busy)+button('Cancel work','BunchNote.cancel()',state.busy):'');
 }
 function disposeView() { structuredGeneration++; structuredHandles.forEach(h => h.destroy()); structuredHandles.clear(); }
 function reset() { disposeView(); state.urls.forEach(url => URL.revokeObjectURL(url)); state = fresh(); state.account = account(); }
 function structuredProps(host) {
  const mode=host.dataset.bnStructured, index=Number(host.dataset.index);
  const j=workJob();
  return {accountKey:state.account,revisionKey:bridgeRevisionKey(),mode,disabled:state.busy,
   value:mode==='read'?{...j.body,location:j.location,actions:allActions(j)}:state.draft.body.locations[index],
   progress:j?.progress||{},
   onChange:value=>{if(state.busy||!author())return;invalidate();const current=state.draft.body.locations[index];state.draft.body.locations[index]={...current,...(mode==='header'?{direction:value.direction,target_houses:value.target_houses}:{house_sections:value.house_sections,actions:value.actions})};prepareCards(state.draft.body.locations[index]);state.epoch++;structuredHandles.get(host)?.update(structuredProps(host));},
   onDetails:id=>root.BunchNote.editPlanned(index,id),
   onWork:id=>{const action=allActions(j).find(a=>a.id===id);const row=j.body.source.find(r=>action?.row_ids?.includes(r.unique_id));state.item=action?.scope==='rows'&&row?groupItems([row])[0].key:'';state.workAction=id;render();document.querySelector('[data-bn-work-action="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'start',behavior:'smooth'});}
  };
 }
 async function mountStructured(container) {
  const hosts=Array.from(container.querySelectorAll('[data-bn-structured],[data-bn-cards]'));
  if(!hosts.length)return;
  const generation=structuredGeneration, owner=state;
  try {
   structuredModule ||= import(new URL('./assets/bunch-note-structured.js?v='+encodeURIComponent(typeof APP_SHELL_BUILD==='undefined'?'dev':APP_SHELL_BUILD),document.baseURI).href);
   const module=await structuredModule;
   if(owner!==state||generation!==structuredGeneration||!account())return;
   for(const host of hosts){if(!host.isConnected)continue;const cards=host.dataset.bnCards!==undefined,props=cards?cardBoardProps():structuredProps(host);if(structuredHandles.has(host))structuredHandles.get(host).update(props);else structuredHandles.set(host,(cards?module.mountBunchNoteCards:module.mountStructuredBunchNote)(host,props));}
  } catch(error){console.error('Bunch Notes worksheet failed to load',error);structuredModule=null;for(const host of hosts)if(host.isConnected)host.textContent='The crew worksheet could not load. Reopen Bunch Notes to retry.';}
 }
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
  ensureAccount(); if (state.busy) return; const cardScreen=state.draft&&!state.location&&!state.actionEdit&&!state.picker;if(cardScreen)rememberScroll();state.busy = true; render();
  try { await work(); state.error = ''; } catch (error) {
   const code = String(error.message || error);
   state.error = code;
   if (/SOURCE_CHANGED/.test(state.error)) state.error = 'Inventory changed. Use Refresh source, review the rows, then save and preview again.';
   if (/SOURCE_REFRESH_REQUIRED/.test(code)) state.error = 'The inventory import is still updating. Keep this draft and preview after the update finishes.';
   if (/QUANTITY_INVALID|PERCENTAGE|QUANTITY_OR/.test(code)) state.error = 'Use either a positive whole quantity or a percentage greater than zero and no more than 100.';
   if (/BATCH_TOO_LARGE/.test(code)) state.error = 'This PDF batch is too large. Select fewer locations and preview again.';
   if (/RECIPIENT|DYLAN_EMAIL/.test(code)) state.error = 'The email mapping changed or is missing. Review the selected users; Dylan must have a mapped address.';
   if (/PREVIEW_REQUIRED|PREVIEW_EXPIRED/.test(code)) state.error = 'Preview the current PDFs again before publishing.';
   if (/CONFLICT|CLAIMED|NOT_FOUND/.test(code)) { if(state.draft){state.error='This draft changed in another session. Your edits are still here. Reopen the saved draft in another view to compare before retrying.';}else{state.detail = null; state.jobs = []; state.loaded = false; await load(); state.error='This work changed in another session. The Queue has refreshed; open the current work before continuing.';} }
   if (/STRUCTURE|SECTIONS|SECTION_NOT_FOUND|LINE_INVALID|FREEFORM_INVALID/.test(code)) state.error='Review the house names and task instructions. Keep crew tags under 80 characters and quantity notes under 200; freeform tasks cannot record inventory quantities. Your edits have been kept.';
   if (/SHIFT_ROWS/.test(code)) state.error='Shift/Hauling can only use lots whose Season contains Y or U3, or DesigItem contains SHFT.';
   if (/ACTUAL_REQUIRED/.test(code)) state.error='Record the actual quantity, lot and size before marking this action Done.';
   if (/DESTINATION_REQUIRED/.test(code)) state.error='Enter where this stock moved.';
   if (/DESTINATION_CHANGED/.test(code)) state.error='This destination no longer matches the selected item and sales year. Choose the location again; your draft is retained.';
   if (/SOURCE_YEAR_REQUIRED/.test(code)) state.error='Select one source item and sales year, or choose All other locations.';
   if (/INSTRUCTIONS_REQUIRED/.test(code)) state.error='Each location needs a purpose and valid card or task instructions before PDF review.';
   if (/CARD_OWNER_INVALID/.test(code)) state.error='Choose an active worker or Unassigned. Your card edits are still here.';
   if (/CARD_SOURCE|CARD_ROWS|CARD_OVERLAP|CARD_GROUP/.test(code)) state.error='The saved lots no longer match this card. Refresh source for review, check the affected lots, then save again. Your instructions and assignments are still here.';
   if (/STALE_CARD_CLIENT/.test(code)) state.error='This note uses per-card assignments. Keep your draft open, update the app in another tab, and reopen the current saved note before making changes.';
   if (/CARDS_REQUIRED/.test(code)) state.error='Include an inventory card or add General / Shared Work before reviewing this note.';
   if (/CARD_(SCOPE|ID|OPERATION|COMMAND)_REQUIRED/.test(code)) state.error='Open the current work card from Que before recording or completing its work.';
   if (/LOT_SIZE_REQUIRED/.test(code)) state.error='This saved row needs a known lot and container size. Ask Dylan to review the source.';
   if (/VARIANCE_REASON/.test(code)) state.error='Explain the quantity difference or stock exception in the review note.';
   if (/OPTION_CHANGED|OPTION_REQUIRED/.test(code)) state.error='This option changed. Refresh the choices before adding it.';
   showToast('Bunch Notes', state.error, true);
  } finally { state.busy = false; render();if(cardScreen)restoreScroll(); }
 }
 async function load(attempt = 0) {
  ensureAccount(); if (state.loading) return;
  state.loading = true;
  try { const result = await api('list'); state.jobs = Array.isArray(result.jobs) ? result.jobs : []; state.loaded = true; state.epoch++; }
  catch (error) {
   state.error = String(error && error.message || error || 'Bunch Notes could not be loaded.');
   if (attempt < 3) {
    const delay = Math.min(4000, 500 * (2 ** attempt));
    await new Promise(resolve => setTimeout(resolve, delay));
    state.loading = false;
    try { return await load(attempt + 1); }
    catch (retryError) { state.error = String(retryError && retryError.message || retryError || 'Bunch Notes could not be loaded.'); throw retryError; }
   }
   throw error;
  }
  finally { state.loading = false; }
 }
 async function open({refresh = true} = {}) {
  ensureAccount(); render();
  // Shell repaints must not start a new busy read while the user navigates.
  if (!refresh && state.metadataLoaded) return;
  return run(async () => {
   const results = await Promise.all([api('blocks'), api('directory'), api('drafts'),api('catalog')]);
   state.blocks = results[0].blocks; state.users = results[1].users; state.drafts = results[2].drafts; state.options=results[3].options; state.destinations=results[3].locations;
   state.metadataLoaded = true;
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
  return `<div class="bn-action-choices"><h3>Add another action</h3>${Object.entries(categoryLabels).filter(([cat])=>cat!=='hauling'||rows.some(shiftEligible)).map(([cat,label])=>{
   return `<details class="bn-options" ${panelAttrs(key+':'+cat)}><summary>${label}<i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${state.options.filter(o=>o.active&&o.category===cat).map(o=>button(o.label,`BunchNote.startAction(${arg(key)},${arg(o.id)})`,state.busy)).join('')}
    ${button('Add custom '+label+' option',`BunchNote.openCustom(${arg(key)},${arg(cat)})`,state.busy)}</div></details>`;
  }).join('')}</div>`;
 }
 function plants(rows, selected, index, job=null) {
  return `<div class="bn-plants">${groupItems(rows).filter(item=>!state.item||item.key===state.item).map((item,n)=>{
   const key='item:'+index+':'+item.key, worker=job && job.status==='open' && job.owner_id===nativeAuthProfile?.id;
   const selection=selected || (worker ? (state.workRows[job.id+':'+(job.card_id||'')] || rows.map(r=>r.unique_id)) : null);
   const totals=job ? currentActuals(job).filter(a=>item.rows.some(r=>r.unique_id===a.source_snapshot.unique_id)).reduce((out,a)=>{const kind=actionKind(a.action_snapshot);out[kind]=(out[kind]||0)+Number(a.quantity);return out;},{}) : {};
   return `<article class="bn-plant bn-card" ${!state.item?`onclick="if(!event.target.closest('button,input')) BunchNote.openItem(${arg(item.key)})"`: ''}><div class="bn-plant-heading">${selection?`<input type="checkbox" aria-label="Select item ${esc(item.itemcode)}" ${item.rows.every(r=>selection.includes(r.unique_id))?'checked':''} onchange="BunchNote.selectItem(${arg(index)},${arg(item.rows.map(r=>r.unique_id))},this.checked,${!!worker})">`:''}<span><span class="bn-eyebrow">${esc(item.itemcode || 'Unknown item code')} · ${item.rows.length} lot rows</span><strong>${esc(item.commonname)}</strong></span></div>
    <div class="bn-stock"><span>LOC On Hand <b>${esc(stock(item.stock))}</b></span><span>LOC Review <b>${esc(stock(item.review))}</b></span><span>LOC Available <b>${esc(stock(item.available))}</b></span></div>
    ${Object.keys(totals).length?`<p class="bn-recorded">Recorded: ${Object.entries(totals).map(([kind,total])=>esc(kind.toUpperCase())+' '+total).join(' · ')}</p>`:''}
    ${state.item ? `<div class="bn-options-body"><details class="bn-options" ${panelAttrs('lots:'+item.key)}><summary>Lots and sizes (${item.rows.length})<i class="ph-bold ph-caret-down"></i></summary>${item.rows.map(row=>`<section class="bn-lot"><label class="bn-choice">${selection?`<input type="checkbox" aria-label="Select lot ${esc(row.contsize)} ${esc(row.lotcode)} ${esc(row.unique_id)}" ${selection.includes(row.unique_id)?'checked':''} onchange="BunchNote.selectItem(${arg(index)},${arg([row.unique_id])},this.checked,${!!worker})">`:''}<span><b>${esc(row.contsize || 'Unknown size')} · Lot ${esc(row.lotcode || 'Unknown')}</b><small>Sales year ${esc(row.salesyear || 'Unknown')} · Season ${esc(row.season || 'Unknown')} · DesigItem ${esc(row.desigitem || '—')}</small></span></label><p>On Hand ${esc(stock(row.stock))} · Review ${esc(stock(row.review))} · Available ${esc(stock(row.available))}</p><p>Flags ${esc(row.flags || '—')} · Hold ${esc(row.hold || '—')} · Warehouse ${esc(row.warehouse || '—')}</p><p>${esc(row.location_notes || 'No location notes')}</p><small>Source ${esc(row.unique_id)} · ${esc(row.locationcode)}</small></section>`).join('')}</details>
    ${!job?draftActions(state.draft.body.locations[index],index,item.rows):''}
    ${selection?actionChoices(key,item.rows,{index,worker,scope:'rows'}):''}</div>` : `<button type="button" class="bn-item-open" aria-label="Open item ${esc(item.itemcode)}" onclick="BunchNote.openItem(${arg(item.key)})"><span>Open lots, actions and recorded work</span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>`}</article>`;
  }).join('')}</div>`;
 }
 function catalogEditor() {
  return `<details class="bn-card bn-options" ${panelAttrs('catalog')}><summary>Manage reusable choices</summary><div class="bn-options-body">${state.options.map(o=>`<div class="bn-lot"><span>${esc(categoryLabels[o.category])} · ${esc(o.kind)} · ${o.active?'Active':'Retired'}</span><label class="bn-field">Option name<input id="bn-option-${esc(o.id)}" value="${esc(o.label)}"></label>${button('Save name',`BunchNote.editOption(${arg(o.id)},${o.active})`,state.busy)}${button(o.active?'Retire':'Restore',`BunchNote.editOption(${arg(o.id)},${!o.active})`,state.busy)}</div>`).join('')}</div></details>`;
 }
 function actionApplies(a, rows) { return a.scope==='location' || rows.some(r=>(a.row_ids||[]).includes(r.unique_id)); }
 function actionProblem(a) {
  if(!String(a.instructions||'').trim())return 'Add instructions';
  if(a.scope==='rows'&&!a.row_ids?.length)return 'Choose source lots';
  if(a.quantity!==''&&a.quantity!=null&&(!/^\d+$/.test(String(a.quantity))||Number(a.quantity)<=0))return 'Enter a positive whole quantity';
  if(a.percentage!==''&&a.percentage!=null&&(!/^\d+(\.\d+)?$/.test(String(a.percentage))||Number(a.percentage)<=0||Number(a.percentage)>100))return 'Enter a percentage from 1 to 100';
  if(a.quantity&&a.percentage)return 'Use quantity or percentage, not both';
  if(['move','hauling'].includes(actionKind(a))&&!String(a.destination||'').trim())return 'Choose a move destination';
  if(a.label==='Grade and Save / Move To'&&!a.quantity)return 'Enter the planned quantity';
  return '';
 }
 function draftActions(loc,i,rows=null) {
  return loc.actions.map((a,j)=>(rows ? a.scope==='location'||!actionApplies(a,rows) : a.scope!=='location') ? '' : `<button type="button" class="bn-action bn-action-summary" onclick="BunchNote.editPlanned(${i},${arg(a.id)})" aria-label="Edit ${esc(a.label||a.group)}"><b>${esc(a.label||a.group)}</b><span>${esc(a.quantity||'')}${a.percentage?esc(a.percentage)+'%':''}${a.destination?' · Move to '+esc(a.destination):''}</span><small>${esc(actionProblem(a)?'Needs details · '+actionProblem(a):a.scope==='location'?'Whole location':a.row_ids.length+' selected lots')}</small></button>`).join('');
 }
 function actionContext() {
  const e=state.actionEdit;if(!e)return null;
  const loc=e.worker?workJob().body:state.draft.body.locations[e.i];
  const a=e.worker?e.action:loc.actions.find(a=>a.id===e.id);
  return {e,loc,a,rows:(loc.source_all||loc.source||[]).filter(r=>e.availableIds.includes(r.unique_id)),j:loc.actions.findIndex(a=>a.id===e.id)};
 }
 function beginAction(key,id) {
  const t=state.targets[key],o=state.options.find(o=>o.id===id&&o.active);if(!t||!o)throw new Error('This option changed. Reopen the item.');
  const loc=t.worker?workJob().body:state.draft.body.locations[t.index],source=loc.source_all||loc.source;
  const selected=t.worker?(state.workRows[state.detail.job.id+':'+(workJob()?.card_id||'')]||source.map(r=>r.unique_id)):loc.row_ids;
  const rows=source.filter(r=>t.ids.includes(r.unique_id)&&(t.scope==='location'||selected.includes(r.unique_id))&&(o.category!=='hauling'||shiftEligible(r)));
  if(!rows.length)throw new Error('Select at least one eligible lot row.');
  const pendingKey=t.worker?state.detail.job.id+':pending:'+key+':'+id:null;
  const a=(pendingKey&&state.pendingActions[pendingKey])||actionFromOption(o,rows.map(r=>r.unique_id),o.category==='hauling'?'rows':t.scope);
  if(t.card_id||(t.worker&&workJob()?.card_id))a.card_id=t.card_id||workJob().card_id;
  if(pendingKey)state.pendingActions[pendingKey]=a;
  rememberScroll();if(!t.worker){invalidate();loc.row_ids=[...new Set([...loc.row_ids,...rows.map(r=>r.unique_id)])];loc.actions.push(a);if(a.scope==='rows')prepareCards(loc,true);else prepareCards(loc);}
  state.actionEdit={i:t.index,id:a.id,worker:t.worker,pendingKey,action:t.worker?a:null,availableIds:rows.map(r=>r.unique_id)};
 }
 function changeActionRows(ids) {
  if(!ids.length){state.error='Keep at least one source lot, or remove this action.';return;}
  const {a,e,loc}=actionContext();invalidate();a.scope='rows';a.row_ids=ids;state.error='';
  if(!e.worker)loc.row_ids=[...new Set([...loc.row_ids,...ids])];
  if(a.destination_mode==='matching'){a.destination='';delete a.destination_mode;}
 }
 function actionEditor() {
  const {e,loc,a,rows}=actionContext(), move=['move','hauling'].includes(actionKind(a));
  const selected=rows.filter(r=>a.scope==='location'||a.row_ids.includes(r.unique_id)), groups=sourceGroups(rows);
  const set=key=>`BunchNote.actionField('${key}',this.value)`;
  return `<h2>${esc(a.label||a.group)}</h2><p>${esc(state.location||state.detail?.job.location)} · ${esc([...new Set(rows.map(r=>r.itemcode))].join(', '))}</p><p class="bn-muted">${e.worker?'Additional work instruction':'Planned work'}</p>
   ${move&&groups.size>1?`<label class="bn-field">Source item and sales year<select onchange="BunchNote.actionSource(this.value)"><option value="">Choose source lots / year</option>${[...groups].map(([key,rs])=>`<option value="${esc(key)}" ${sourceGroups(selected).size===1&&sourceGroups(selected).has(key)?'selected':''}>${esc(rs[0].itemcode)} · ${esc(salesYear(rs[0].salesyear)||'Unknown sales year')}</option>`).join('')}</select></label>`:''}
   <details class="bn-options"><summary>Source lots (${selected.length})<i class="ph-bold ph-caret-down"></i></summary>${rows.map(r=>`<label class="bn-choice"><input type="checkbox" aria-label="Action lot ${esc(r.contsize)} ${esc(r.lotcode)} ${esc(r.unique_id)}" ${selected.some(s=>s.unique_id===r.unique_id)?'checked':''} onchange="BunchNote.actionLot(${arg(r.unique_id)},this.checked)"><span>${esc(r.contsize)} · Lot ${esc(r.lotcode)}<small>Sales year ${esc(r.salesyear||'Unknown')} · Available ${esc(stock(r.available))}</small></span></label>`).join('')}</details>
   ${field('Planned quantity',a.quantity,set('quantity'),'number')}${move?`<div class="bn-destination"><b>Move to${a.destination?': '+esc(a.destination):''}</b>${button(a.destination?'Change location':'Choose location',"BunchNote.chooseActionDestination()",state.busy||!selected.length)}${!selected.length?'<small>Choose source lots first.</small>':''}</div>`:''}
   ${textfield('Instruction',a.instructions,set('instructions'))}<details class="bn-options" ${panelAttrs('more:'+a.id)}><summary>More details<i class="ph-bold ph-caret-down"></i></summary>${a.label!=='Grade and Save / Move To'?field('Planned percentage instead of quantity',a.percentage,set('percentage'),'number'):''}${field('Crew label',a.crew,set('crew'))}${field('Target flags / shear stage',a.stage,set('stage'))}${field('Marking / ribbon / symbol',a.marking,set('marking'))}</details>
   ${button('Remove action','BunchNote.removeEditedAction()',state.busy)}<div class="bn-step-actions">${button('Done','BunchNote.finishAction()',state.busy)}</div>`;
 }
 function customEditor() {
  const {key,category}=state.customEdit,k=key+':'+category,c=state.custom[k]||{};
  return `<h2>Add custom ${esc(categoryLabels[category])} option</h2>${field('Option name',c.label||'',`BunchNote.custom(${arg(k)},'label',this.value)`)}<label class="bn-field">Record amounts as<select onchange="BunchNote.custom(${arg(k)},'kind',this.value)">${['instruction','ta','move',...(category==='hauling'?['hauling']:[])].map(kind=>`<option value="${kind}" ${(c.kind||'instruction')===kind?'selected':''}>${({instruction:'Checklist only',ta:'TA quantity',move:'Move quantity and destination',hauling:'Hauling quantity and destination'})[kind]}</option>`).join('')}</select></label><div class="bn-step-actions">${button('Save custom option and continue','BunchNote.finishCustom()',state.busy)}</div>`;
 }
 function editor() {
  const draft = state.draft;
  let html = `<h2>Bunch Notes</h2>${viewTabs()}<p class="bn-muted">Choose a block. Include and assign each inventory card independently; Move plans work without changing inventory.</p>`;
  if (!draft) return html + `<h3>Block Alpha</h3><div class="bn-drill-grid">${state.blocks.map(b => drillCard(b, 'View locations', `BunchNote.chooseBlock(${arg(b)})`, 'block')).join('') || `<p>${state.busy ? 'Loading blocks…' : 'No blocks available.'}</p>`}</div>${catalogEditor()}<h3>Saved batches</h3><div class="bn-drill-grid">${state.drafts.map(d => drillCard(d.block, `${d.body.locations.length} locations · ${new Date(d.updated_at).toLocaleString()}`, `BunchNote.openDraft(${arg(d.id)})`, 'batch')).join('') || '<p class="bn-muted">No saved batches.</p>'}</div>`;
  html += `<nav class="bn-breadcrumb" aria-label="Bunch Note drill-down"><span>${esc([draft.body.block,state.base,state.location,state.item ? state.item.split('|').slice(1).join('|') : ''].filter(Boolean).join(' → '))}</span></nav>`;
  if (!state.location) {
   html += '<div data-bn-cards></div>';
  } else {
   const i=draft.body.locations.findIndex(l => l.location === state.location), loc=draft.body.locations[i];
   if(loc && state.item) return html+plants(loc.source_all||loc.source||[],loc.row_ids,i)+button('Save draft','BunchNote.save()',state.busy);
   if(loc && state.locationStep==='setup') return html+`<section class="bn-location-editor" aria-label="Location setup"><h3>${esc(loc.location)} · Location Instructions</h3>`
    +field('Purposes',loc.purposes,`BunchNote.edit(${i},'purposes',this.value)`)
    +field('Priority / work order',loc.priority,`BunchNote.edit(${i},'priority',this.value)`)
    +textfield('General instructions',loc.instructions,`BunchNote.edit(${i},'instructions',this.value)`)
    +textfield('Prerequisites / wait instructions',loc.prerequisites,`BunchNote.edit(${i},'prerequisites',this.value)`)
    +`<div data-bn-structured="header" data-index="${i}"></div>`
    +`<div data-bn-structured="edit" data-index="${i}"></div>${sharedEditor(loc,i)}</section><div class="bn-step-actions">${button('Inventory action editor','BunchNote.nextItems()',state.busy)}${button('Save draft','BunchNote.save()',state.busy)}</div>`;
   if(loc) html+=`<section class="bn-location-editor"><div class="bn-location-heading"><h3>${esc(loc.location)}</h3>${button('Edit location setup','BunchNote.editSetup()',state.busy)}</div><p>${esc(loc.purposes)}</p><h3>Items at this location</h3>`
    +`<div data-bn-structured="edit" data-index="${i}"></div>`+plants(loc.source_all||loc.source||[],loc.row_ids,i)
    +`<details class="bn-options" ${panelAttrs('actions:'+loc.location)}><summary>Whole-location actions<i class="ph-bold ph-caret-down"></i></summary>${draftActions(loc,i)}${actionChoices('location:'+i,loc.source_all||[],{index:i,worker:false,scope:'location'})}</details>`
    +button('Remove location from batch',`BunchNote.removeLocation(${arg(loc.location)})`,state.busy||!!draft.id&&draft.body.locations.length===1)+'</section>';
  }
  html += '<details class="bn-options"><summary>Instruction guidance from Bunch Notes <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body"><p>Use “Center house” for the house over the 4-inch line. Specify quantity or percentage, stage, destination, and whether crews should grade or row-run.</p><p>BOB, QC, SAM, RHETT, SHARON, MATT, BUNCHERS and TA are instruction labels. They do not assign users or select recipients.</p><p>Flags: blue = ship first; white = lesser quality; red = promo / worst quality; green = grow-on. Outside corner ribbons: yellow = water control; pink = overwinter outside; shift = haul for shift; shift + pink = outside for spring shift. Apply only where you explicitly choose.</p></div></details>';
  html += `<details class="bn-card bn-options" ${panelAttrs('recipients')}><summary>Email recipients · Dylan included <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${state.users.filter(u => u.email).map(u => `<label class="bn-choice"><input type="checkbox" ${u.username === 'dylan_collyge' || draft.body.recipient_ids.includes(u.id) ? 'checked' : ''} ${u.username === 'dylan_collyge' ? 'disabled' : ''} onchange="BunchNote.recipient(${arg(u.id)},this.checked)"><span>${esc(u.display || u.username)}<small>${esc(u.email)}</small></span></label>`).join('')}</div></details>`;
  return html + destinationList() + `<p class="bn-muted">${draft.body.locations.length} locations in this batch</p><div class="bn-toolbar">` + button('Refresh source for review', 'BunchNote.refreshSource()', state.busy) + button('Save draft', 'BunchNote.save()', state.busy || !draft.body.locations.length) + button('Preview PDFs and recipients', 'BunchNote.preview()', state.busy || !draft.body.locations.length) + '</div>';
 }
 function previewHtml() {
  const p = state.preview;
  return `<h2>Review ${p.report_kind==='completed_work'?'Completed Work':'Bunch Notes'} PDFs</h2><p>Recipients: ${p.recipients.map(r => esc(r.email)).join(', ')}</p>${state.urls.map((url, i) => `<section class="bn-card"><a href="${url}" target="_blank" rel="noopener">Open ${esc(p.pdfs[i].filename)}</a><iframe title="${esc(p.pdfs[i].filename)}" src="${url}" style="width:100%;height:60vh;border:1px solid #aaa"></iframe></section>`).join('')}`
   + (p.report_kind==='completed_work'&&!p.saved ? button('Save completed-work PDF','BunchNote.publishWork(false)',state.busy)+button('Save and email reviewed PDF','BunchNote.publishWork(true)',state.busy) : p.saved ? button('Email reviewed PDFs', 'BunchNote.sendSaved()', state.busy) : button('Publish to Queue', 'BunchNote.publish(false)', state.busy) + button('Publish and email reviewed PDFs', 'BunchNote.publish(true)', state.busy));
 }
 function queue() {
  if (!state.loaded && !state.loading && !state.error) void run(load);
  if (state.detail) return detailHtml();
  let html = '<h2>Bunch Notes</h2>'+viewTabs()+'<p>Claim available cards or legacy location work. Assigned work is visible to its owner and Dylan.</p>';
  ['available','mine','completed', ...(author() ? ['all','cancelled'] : [])].forEach(filter => { html += button(({available:'Available',mine:'My Work',completed:'Completed',all:'All assignments',cancelled:'Canceled'})[filter], `BunchNote.filter(${arg(filter)})`, state.busy, state.filter === filter); });
  html += button('Refresh', 'BunchNote.refresh()');
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const jobs = state.jobs.filter(j => state.filter === 'all' || (state.filter === 'available' ? j.status === 'open' && (j.cards?.length?j.cards.some(c=>c.status==='open'&&!c.owner_id):!j.owner_id) : state.filter === 'mine' ? j.status === 'open' && (j.cards?.length?j.cards.some(c=>c.status==='open'&&c.owner_id===uid):j.owner_id === uid) : state.filter === 'completed'&&j.cards?.length?j.cards.some(c=>c.status==='complete'&&(author()||c.owner_id===uid)):j.status === (state.filter === 'completed' ? 'complete' : 'cancelled')));
  const names=[...new Set(jobs.map(j=>normalize(j.location)))], groups=locationGroups(names);
  if(!state.queueBase)return html+`<div class="bn-drill-grid">${[...groups].map(([base,codes])=>drillCard(base,`${codes.length} full locations`,`BunchNote.queueBase(${arg(base)})`,'location')).join('')||'<p>No work in this filter.</p>'}</div>`;
  if(!state.queueLocation)return html+`<h3>${esc(state.queueBase)}</h3><div class="bn-drill-grid">${(groups.get(state.queueBase)||[]).map(loc=>drillCard(loc,'Open location work',`BunchNote.queueLocation(${arg(loc)})`,'location')).join('')||'<p>No work in this location.</p>'}</div>`;
  return html + (state.loading ? '<p>Loading…</p>' : !jobs.length ? '<p>No work in this filter.</p>' : jobs.filter(j=>normalize(j.location)===state.queueLocation).map(j => `<article class="bn-card"><h3>${esc(j.block)} → ${esc(j.location)}</h3><p>${esc(j.note_number)} · Revision ${j.instruction_revision} · ${esc(j.body.purposes)}</p><p>Priority: ${esc(j.body.priority || '—')} · ${Object.keys(j.progress).length}/${allActions(j).length} actions</p><p>Work: ${esc(j.status)} · Email: ${esc(j.delivery_status)}</p>${button('Open', `BunchNote.detail(${arg(j.id)})`)}</article>`).join(''));
 }
 function detailHtml() {
  const {versions = [], audit = []} = state.detail;
  if(state.detail.job.cards?.length&&!state.detail.job.cards.some(c=>c.id===state.workCard))return workerCards(state.detail.job);
  const j=workJob();
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const owner = j.owner_id === uid, open = j.status === 'open';
  let html = `<h2>${esc(j.block)} → ${esc(j.location)}</h2><p><b>${esc(j.note_number)} · Instruction revision ${j.instruction_revision}</b></p><p>${esc(j.body.purposes)} · Priority ${esc(j.body.priority || '—')}</p>`;
  if(state.item)html=`<h2>${esc(j.location)}</h2><p>${esc(j.note_number)} · ${esc(j.body.purposes)}</p>`;
  if(j.card_id){const card=state.detail.job.cards.find(c=>c.id===j.card_id);html+=`<section class="bn-card"><h3>${esc(card.kind==='shared'?'General / Shared Work':[card.itemcode,card.commonname,card.contsize].filter(Boolean).join(' · '))}</h3><p>Worker: ${esc(card.owner_name||'Unassigned')} · House: ${esc(card.house||'Not specified')} · Direction: ${esc(card.direction||'Not specified')}</p></section>`;}
  if (open && !j.owner_id) html += button(j.card_id?'Claim card':'Claim work', j.card_id?`BunchNote.cardCommand('claim_card',${arg(j.card_id)})`:`BunchNote.command('claim')`, state.busy);
  if (open && owner) html += button('Release to available work', j.card_id?`BunchNote.cardCommand('release_card',${arg(j.card_id)})`:`BunchNote.command('release')`, state.busy);
  if (open && author() && !state.item && !j.card_id) html += `<label class="bn-field">Assign / reassign<select id="bn-owner">${userOptions(j.owner_id)}</select></label>` + button('Apply assignment', `BunchNote.assign()`) + button('Revise instructions', `BunchNote.revise()`) + button('Cancel work', `BunchNote.cancel()`);
  if(!state.item)html += '<div data-bn-structured="read"></div>';
  html += plants(j.body.source || [],null,'work',j) + allActions(j).filter(a=>state.workAction ? a.id===state.workAction : state.item ? a.scope!=='location' && actionApplies(a,(j.body.source||[]).filter(r=>groupItems([r])[0]?.key===state.item)) : j.card_id||a.scope==='location').map(a => {
   const done=j.progress[a.id], actuals=currentActuals(j).filter(x=>x.action_id===a.id), key=j.id+':'+a.id, form=state.workForms[key]||{}, kind=actionKind(a);
   const lots=(j.body.source||[]).filter(r=>(a.scope==='location'||(a.row_ids||[]).includes(r.unique_id))&&(a.group!=='hauling'||shiftEligible(r)));
   const mayCorrect=(open&&owner)||(author()&&j.status==='complete');
   return `<article class="bn-card" data-bn-work-action="${esc(a.id)}"><h3>${esc(a.label || a.crew || a.group)}${a.worker_added?' · Added by worker':''}</h3><p class="bn-pre">${esc(a.instructions)}</p><p>${esc(a.scope==='location'?'Whole location':(a.row_ids||[]).map(id=>{const r=(j.body.source||[]).find(r=>r.unique_id===id);return r?[r.itemcode,r.contsize,r.lotcode].join(' / '):id;}).join('; '))}</p><p>Planned quantity ${esc(a.quantity || '—')} · % ${esc(a.percentage || '—')} · ${esc(a.stage || '')} · ${esc(a.destination || '')} · ${esc(a.marking || '')}</p>
    <p><b>Recorded ${actuals.length?actuals.reduce((sum,x)=>sum+Number(x.quantity),0):'Not recorded'} ${esc(kind==='instruction'?'':kind.toUpperCase())}</b></p>${actuals.map(x=>`<div class="bn-lot"><b>${esc(x.quantity)} · ${esc(x.source_snapshot.contsize)} · Lot ${esc(x.source_snapshot.lotcode)}</b><p>${esc(x.destination ? 'To '+x.destination : '')}</p><p>${esc(x.explanation)}</p>${x.review_flags.length?'<strong class="bn-review">Review: '+esc(reviewText(x.review_flags))+'</strong>':''}${x.replaces_id?'<small>Audited correction</small>':''}${mayCorrect?button('Correct entry',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</div>`).join('')}
    ${open&&owner&&['ta','move','hauling'].includes(kind)?`<details class="bn-options" ${panelAttrs('actual:'+a.id)}><summary>Record ${esc(kind.toUpperCase())} / partial work</summary><div class="bn-options-body"><label class="bn-field">Container size and lot<select onchange="BunchNote.workField(${arg(key)},'source_id',this.value)"><option value="">Choose size and lot</option>${lots.map(r=>`<option value="${esc(r.unique_id)}" ${form.source_id===r.unique_id?'selected':''}>${esc([r.contsize,r.lotcode,r.salesyear||'Unknown sales year',r.season,r.unique_id].join(' · '))}</option>`).join('')}</select></label>${field('Actual quantity',form.quantity||'',`BunchNote.workField(${arg(key)},'quantity',this.value)`,'number')}${kind!=='ta'?field('Moved to',form.destination||'',`BunchNote.workField(${arg(key)},'destination',this.value)`)+button('Choose destination',`BunchNote.chooseDestination('actual',${arg(key)})`,state.busy||!form.source_id):''}${textfield('Explanation / review note',form.explanation||'',`BunchNote.workField(${arg(key)},'explanation',this.value)`)}${button('Record entry',`BunchNote.recordActual(${arg(a.id)})`,state.busy)}</div></details>`:''}
    <b>${esc(done?.status || 'Pending')}</b><p>${esc(done?.reason || '')}</p>${done?.review_flags?.length?'<p class="bn-review">Review: '+esc(reviewText(done.review_flags))+'</p>':''}${open&&owner?textfield('Completion / variance reason',form.reason||'',`BunchNote.workField(${arg(key)},'reason',this.value)`)+button('Done',`BunchNote.progress(${arg(a.id)},'done')`,state.busy)+button('Not needed',`BunchNote.progress(${arg(a.id)},'not_needed')`,state.busy):''}</article>`;
  }).join('');
  if(state.item)return html;
  if (open && owner) html += button(j.card_id?'Complete card':'Complete location', j.card_id?`BunchNote.cardCommand('complete_card',${arg(j.card_id)})`:`BunchNote.command('complete')`, state.busy || allActions(j).some(a=>!j.progress[a.id]));
  if (state.detail.job.status==='complete' && author()) html += `<details class="bn-card bn-options" ${panelAttrs('work-report')}><summary>Completed-work PDF and recipients</summary><div class="bn-options-body">${state.users.filter(u=>u.email).map(u=>`<label class="bn-choice"><input type="checkbox" ${u.username==='dylan_collyge'||state.workRecipients.includes(u.id)?'checked':''} ${u.username==='dylan_collyge'?'disabled':''} onchange="BunchNote.workRecipient(${arg(u.id)},this.checked)"><span>${esc(u.display || u.username)}<small>${esc(u.email)}</small></span></label>`).join('')}${button('Preview completed-work PDF','BunchNote.previewWork()',state.busy)}</div></details>`;
  if(!j.card_id||author())html += `<h3>Completed-work PDFs</h3>${(state.detail.work_reports||[]).map(v=>`<p>Work revision ${v.job_revision} · Email ${esc(v.delivery_status)} ${button('Open completed-work PDF',`BunchNote.workPdf(${arg(v.preview_id)})`)}${author()&&['not_sent','failed','unknown','sending'].includes(v.delivery_status)?button(v.delivery_status==='not_sent'?'Review and send':v.delivery_status==='failed'?'Retry delivery':'Reconcile delivery',`BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`):''}</p>`).join('')}`;
  html += `<details class="bn-options"><summary>Actual entry and correction history (${(j.actuals||[]).length})</summary>${(j.actuals||[]).map(x=>`<p>${esc(x.created_at)} · ${esc(x.action_snapshot.label || x.action_snapshot.instructions)} · ${esc(x.source_snapshot.contsize)} / ${esc(x.source_snapshot.lotcode)} · ${esc(x.quantity)} · ${esc(x.destination)} · ${x.superseded?'Replaced by correction':'Current'} · ${esc(x.explanation)}${!x.superseded&&((open&&owner)||(author()&&j.status==='complete'))?button('Amend recorded work',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</p>`).join('')}</details>` + destinationList();
  if(!j.card_id||author())html += `<h3>PDF revisions</h3>${versions.map(v => `<p>Revision ${v.instruction_revision} · Email ${esc(v.delivery_status)} ${button('Open PDF', `BunchNote.pdf(${v.instruction_revision})`)}${author() && ['not_sent','failed','unknown','sending'].includes(v.delivery_status) ? button(v.delivery_status === 'not_sent' ? 'Review and send' : v.delivery_status === 'failed' ? 'Retry delivery' : 'Reconcile delivery', `BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`) : ''}</p>`).join('')}`;
  return html + `<details><summary>History (${audit.length})</summary>${audit.map(a => `<p>${esc(a.created_at)} · ${esc(a.operation)} · ${esc(JSON.stringify(a.detail))}</p>`).join('')}</details>`;
 }
 function renderSearch(label,value) {render();const input=[...document.querySelectorAll('.bn-field input')].find(el=>el.parentElement.textContent.trim()===label);if(input){input.focus();input.setSelectionRange(value.length,value.length);}}
 function navigationKey() { return JSON.stringify([typeof getCurrentVisibleViewId==='function'?getCurrentVisibleViewId():'',state.screen,state.locationStep,state.actionEdit?.id,state.customEdit?.category,state.draft?.body.block,state.base,state.location,state.queueBase,state.queueLocation,state.detail?.job.id,state.workCard,state.item,state.destinationBase,state.destinationLocation,state.picker?.kind,state.picker?.key,state.picker?.base,state.picker?.tab]); }
 function rememberScroll() { state.scrolls.set(navigationKey(),typeof getMainAreaScrollTop==='function'?getMainAreaScrollTop():(root.scrollY||0)); }
 function restoreScroll() { if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>typeof setMainAreaScrollTop==='function'?setMainAreaScrollTop(state.scrolls.get(navigationKey())||0):root.scrollTo?.(0,state.scrolls.get(navigationKey())||0)); }
 function viewTabs() { return `<div class="bn-toolbar">${button('Source locations',"BunchNote.view('source')",state.busy,state.screen==='source')}${button('By Destination',"BunchNote.view('destinations')",state.busy,state.screen==='destinations')}</div>`; }
 function pickerHtml() {
  const p=state.picker, matching=new Set(p.data.matching.map(r=>normalize(r.locationcode)));
  const names=p.tab==='matching'?[...matching]:p.data.locations.filter(loc=>!matching.has(normalize(loc)));
  const filtered=names.filter(loc=>normalize(loc).includes(normalize(p.search))), groups=locationGroups(filtered), shown=p.base?groups.get(p.base)||[]:[...groups.keys()];
  return `<h2>Choose destination</h2><p>${esc(p.data.itemcode)} · Sales year ${esc(p.data.salesyear||'Unknown')}</p>${!p.matchingAvailable?'<p class="bn-muted">Same-item matching needs one known sales year. Choose another location below, or return to select a source year.</p>':''}<div class="bn-toolbar">${button('Locations with this item',"BunchNote.destinationTab('matching')",!p.matchingAvailable,p.tab==='matching')}${button('All other locations',"BunchNote.destinationTab('other')",false,p.tab==='other')}</div>${field('Search locations',p.search||'',"BunchNote.destinationSearch(this.value)")}<div class="bn-drill-grid">${shown.map(name=>drillCard(name,p.base?'Select this full location':`${groups.get(name).length} full locations`,p.base?`BunchNote.pickDestination(${arg(name)})`:`BunchNote.destinationBase(${arg(name)})`,'location')).join('')||'<p>No matching locations.</p>'}</div>${p.base&&p.tab==='matching'?p.data.matching.filter(r=>baseLocation(r.locationcode)===p.base&&filtered.includes(normalize(r.locationcode))).map(r=>`<section class="bn-card"><b>${esc(r.locationcode)}</b><p>${esc(r.contsize)} · Lot ${esc(r.lotcode)} · Sales year ${esc(r.salesyear)}</p><p>On Hand ${esc(stock(r.stock))} · Review ${esc(stock(r.review))} · Available ${esc(stock(r.available))}</p></section>`).join(''):''}${p.tab==='other'?field('New full destination',p.typed||'',"BunchNote.destinationTyped(this.value)")+button('Use typed destination','BunchNote.pickTypedDestination()',state.busy):''}`;
 }
 function destinationsHtml() {
  let html=`<h2>By Destination</h2>${viewTabs()}`;
  if(!state.destinationLocation){
   const names=state.destinationNames.filter(loc=>normalize(loc).includes(normalize(state.destinationSearch))), groups=locationGroups(names), shown=state.destinationBase?groups.get(state.destinationBase)||[]:[...groups.keys()];
   return html+field('Search destination locations',state.destinationSearch,"BunchNote.overviewSearch(this.value)")+`<div class="bn-drill-grid">${shown.map(name=>drillCard(name,state.destinationBase?'Incoming work and location instructions':`${groups.get(name).length} full locations`,state.destinationBase?`BunchNote.openDestination(${arg(name)})`:`BunchNote.openDestinationBase(${arg(name)})`,'location')).join('')||'<p>No locations found.</p>'}</div>`;
  }
  const d=state.destinationData;
  html+=`<h3>${esc(state.destinationLocation)}</h3><h3>This location’s bunch instructions</h3>`;
  if(!d)return html+'<p>Loading…</p>';
  html+=(d.jobs||[]).map(j=>`<article class="bn-card"><b>${esc(j.note_number)} · ${esc(j.status)}</b><p>${esc(j.body.purposes)} · Priority ${esc(j.body.priority||'—')}</p><p class="bn-pre">${esc(j.body.instructions)}</p><p class="bn-pre">${esc(j.body.prerequisites)}</p>${allActions(j).map(a=>`<p><b>${esc(a.label||a.group)}</b> · ${esc(a.instructions)} · Planned ${esc(a.quantity||'—')} ${a.percentage?' / '+esc(a.percentage)+'%':''} ${a.destination?' · To '+esc(a.destination):''}</p>`).join('')}</article>`).join('')||'<p>No accessible bunch instructions at this location.</p>';
  html+='<h3>Incoming plants and move instructions</h3>';
  const incoming=(d.incoming||[]).map(entry=>`<article class="bn-card"><h3>${esc(entry.source_location)} → ${esc(state.destinationLocation)}</h3><p>${esc(entry.note_number)} · ${esc(entry.status)}</p><b>${esc(entry.action.label||entry.action.group)}</b><p class="bn-pre">${esc(entry.action.instructions)}</p><p>Planned here: ${entry.planned_here?esc(entry.action.quantity||'Not specified')+(entry.action.percentage?' / '+esc(entry.action.percentage)+'%':''):'No planned quantity'}</p><p>Recorded here: ${entry.actuals.length?entry.actuals.reduce((sum,a)=>sum+Number(a.quantity),0):'Not recorded'}</p>${entry.source.map(r=>`<p>${esc(r.itemcode)} · ${esc(r.commonname)} · ${esc(r.contsize)} · Lot ${esc(r.lotcode)} · Sales year ${esc(r.salesyear||'Unknown')}</p>`).join('')}${entry.actuals.map(a=>`<p>Moved ${esc(a.quantity)} · ${esc(a.source_snapshot.contsize)} / ${esc(a.source_snapshot.lotcode)} · ${esc(a.created_at)} ${a.replaces_id?'· Corrected entry':''}</p>`).join('')}</article>`).join('');return html+(incoming||'<p>No incoming work.</p>');
 }
 function back() {
  if(state.busy)return true;
  rememberScroll();
  if(state.picker){if(state.picker.base)state.picker.base='';else state.picker=null;}
  else if(state.preview){root.BunchNote.closePreview();return true;}
  else if(state.screen==='destinations'){if(state.destinationLocation){state.destinationLocation='';state.destinationData=null;}else if(state.destinationBase)state.destinationBase='';else state.screen='source';}
  else if(state.customEdit)state.customEdit=null;
  else if(state.actionEdit)state.actionEdit=null;
  else if(state.item||state.workAction){state.item='';state.workAction='';}
  else if(state.workCard){state.workCard='';state.item='';}
  else if(state.detail)state.detail=null;
  else if(typeof getCurrentVisibleViewId==='function'&&getCurrentVisibleViewId()==='request'){if(state.queueLocation)state.queueLocation='';else if(state.queueBase)state.queueBase='';else return false;}
  else if(state.location&&state.locationStep==='items')state.locationStep='setup';
  else if(state.location)state.location='';
  else if(state.base)state.base='';
  else if(state.draft){void root.BunchNote.backEditor();return true;}
  else return false;
  render();restoreScroll();return true;
 }
 const destinationList = () => '';
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
  if((state.actionEdit?.worker||state.customEdit&&state.targets[state.customEdit.key]?.worker||state.picker?.kind==='actual')&&(!state.detail?.job||state.detail.job.status!=='open'||workJob()?.owner_id!==nativeAuthProfile?.id)){
   state.actionEdit=null;state.customEdit=null;state.picker=null;state.pendingActions={};state.item='';
  }
  const markup = (state.error ? `<p role="alert">${esc(state.error)}</p>` : '') + (state.picker ? pickerHtml() : state.customEdit ? customEditor() : state.actionEdit ? actionEditor() : state.preview && view==='bunch-note' ? previewHtml() : state.screen==='destinations' ? destinationsHtml() : view === 'bunch-note' && author() ? editor() : queue());
  const busy = String(state.busy);
  // A live list commit may land between touchstart and click. Replacing an
  // unchanged queue drops that in-flight tap. Compare intended markup and
  // owned child nodes: shell decoration adds classes and replaces icons.
  const previous = renderedQueues.get(container);
  if (previous?.markup === markup && previous.busy === busy
    && previous.nodes.length === container.childNodes.length
    && previous.nodes.every((node, index) => node === container.childNodes[index])) { void mountStructured(container); return; }
  const boardHost=markup.includes('data-bn-cards')?container.querySelector?.('[data-bn-cards]'):null;
  const boardHandle=boardHost&&structuredHandles.get(boardHost);
  if(boardHandle)structuredHandles.delete(boardHost);
  disposeView();
  container.innerHTML = markup;
  if(boardHandle){container.querySelector('[data-bn-cards]').replaceWith(boardHost);structuredHandles.set(boardHost,boardHandle);boardHandle.update(cardBoardProps());}
  container.setAttribute('aria-busy', busy);
  if (state.busy) container.querySelectorAll('input,select,textarea,button').forEach(control => { if (!control.closest?.('[data-bn-cards]')) control.disabled = true; });
  renderedQueues.set(container, {markup, nodes: Array.from(container.childNodes), busy});
  void mountStructured(container);
}
 const invalidate = () => { state.preview = null; state.urls.forEach(url => URL.revokeObjectURL(url)); state.urls = []; };
 async function saveDraft() {
  prepareDraftCards();const d = state.draft;
  const result = await api('save', {batch_id: d.id, body: d.body}, d.revision, crypto.randomUUID());
  state.draft = result.draft;state.boardState={...state.boardState,cardForms:{},dirtyCardIds:[],cardErrors:{},rejectedCardIds:[]};
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
  prepareCards, cardKey, changeCard, moveCard, workJob, actionProblem, templates, normalize, baseLocation, locationGroups, salesYear, sourceGroups, quantity, groupInventory, groupItems, shiftEligible, actionKind, recipientEmails, api, render, reset, open, author, back, disposeView,
  queueBase: value => {rememberScroll();state.queueBase=value;render();restoreScroll();},
  queueLocation: value => {rememberScroll();state.queueLocation=value;render();restoreScroll();},
  hasBack: () => !!(state.actionEdit||state.customEdit||state.picker||state.preview||state.item||state.detail||state.draft||state.queueBase||state.screen==='destinations'),
  nextItems: () => run(async()=>{const l=state.draft.body.locations.find(l=>l.location===state.location);if(!l.purposes?.trim())throw new Error('Enter a purpose for this location.');await saveDraft();rememberScroll();state.locationStep='items';restoreScroll();}),
  editSetup: () => {rememberScroll();state.locationStep='setup';render();restoreScroll();},
  startAction: (key,id) => {if(state.busy||state.actionEdit)return;try{beginAction(key,id);state.error='';render();restoreScroll();}catch(e){state.error=e.message;render();}},
  editPlanned: (i,id) => {if(state.busy)return;const l=state.draft.body.locations[i],a=l.actions.find(a=>a.id===id),source=l.source_all||l.source,items=new Set(source.filter(r=>a.row_ids?.includes(r.unique_id)).map(r=>normalize(r.itemcode)));rememberScroll();state.actionEdit={i,id,worker:false,availableIds:source.filter(r=>(a.card_id?l.cards.find(c=>c.id===a.card_id)?.row_ids.includes(r.unique_id):(a.scope==='location'||items.has(normalize(r.itemcode))))&&(a.group!=='hauling'||shiftEligible(r))).map(r=>r.unique_id)};render();restoreScroll();},
  actionField: (key,value) => {const {a}=actionContext();invalidate();a[key]=value;if(key==='crew')a.margin_tag=value;if(key==='instructions')a.action_instruction=value;if(key==='quantity'&&value)a.percentage='';if(key==='percentage'&&value)a.quantity='';},
  actionSource: key => {const rows=sourceGroups(actionContext().rows).get(key);if(!rows)return;changeActionRows(rows.map(r=>r.unique_id));render();},
  actionLot: (id,on) => {const {a,rows}=actionContext(),ids=a.scope==='location'?rows.map(r=>r.unique_id):a.row_ids;changeActionRows(on?[...new Set([...ids,id])]:ids.filter(v=>v!==id));render();},
  finishAction: () => run(async()=>{const {e,a}=actionContext(),problem=actionProblem(a);if(problem)throw new Error(problem);if(e.worker){const j=workJob();await api('add_action',{job_id:j.id,...workScope(j),action:a},j.revision,crypto.randomUUID());delete state.pendingActions[e.pendingKey];state.detail=await api('get',{job_id:j.id,...workScope(j)});}else await saveDraft();state.actionEdit=null;restoreScroll();}),
  removeEditedAction: () => run(async()=>{const {e,loc,a}=actionContext();if(!e.worker){const index=loc.actions.indexOf(a);loc.actions.splice(index,1);try{await saveDraft();}catch(error){loc.actions.splice(index,0,a);throw error;}}else delete state.pendingActions[e.pendingKey];state.actionEdit=null;restoreScroll();}),
  openCustom: (key,category) => {if(state.busy)return;rememberScroll();state.customEdit={key,category};render();restoreScroll();},
  finishCustom: () => run(async()=>{const {key,category}=state.customEdit,c=state.custom[key+':'+category]||{},j=workJob();const {option}=await api('option_add',{category,label:c.label||'',kind:c.kind||'instruction',...(!author()?{job_id:j.id,...workScope(j)}:{})},author()?null:j.revision,crypto.randomUUID());await refreshCatalog();state.customEdit=null;beginAction(key,option.id);restoreScroll();}),
  chooseActionDestination: () => root.BunchNote.chooseDestination('editor'),
  openBase: base => {rememberScroll();state.base=base;render();restoreScroll();},
  openItem: key => {rememberScroll();state.workAction='';state.item=key;render();restoreScroll();},
  view: screen => run(async()=>{rememberScroll();state.screen=screen;if(screen==='destinations'){const d=await api('destinations');state.destinationNames=d.locations;}restoreScroll();}),
  openDestinationBase: base => {rememberScroll();state.destinationBase=base;render();restoreScroll();},
  openDestination: location => run(async()=>{rememberScroll();const data=await api('destination_detail',{location});state.destinationLocation=location;state.destinationData=data;restoreScroll();}),
  overviewSearch: value => {state.destinationSearch=value;renderSearch('Search destination locations',value);},
  chooseDestination: (kind,key,j) => run(async()=>{
   let rows,payload;
   if(kind==='actual'){const form=state.workForms[key]||{};const j=workJob();rows=j.body.source.filter(r=>r.unique_id===form.source_id);payload={job_id:j.id,...workScope(j)};}
   else if(kind==='editor'){const c=actionContext();rows=c.rows.filter(r=>c.a.scope==='location'||c.a.row_ids.includes(r.unique_id));payload=c.e.worker?{job_id:state.detail.job.id,...workScope(workJob())}:{};}
   else {const loc=state.draft.body.locations[key],a=loc.actions[j];rows=(loc.source_all||loc.source).filter(r=>a.scope==='location'||a.row_ids.includes(r.unique_id));payload={};}
   if(!rows.length)throw new Error('Choose source lots first.');
   const matchingAvailable=sourceGroups(rows).size===1&&!!salesYear(rows[0].salesyear);
   const data=matchingAvailable?await api('destination_lookup',{...payload,source_ids:rows.map(r=>r.unique_id)}):{itemcode:[...new Set(rows.map(r=>r.itemcode))].join(', '),salesyear:null,matching:[],locations:(await api('catalog')).locations};
   rememberScroll();state.picker={kind,key,j,data,matchingAvailable,tab:matchingAvailable?'matching':'other',base:'',search:'',typed:''};restoreScroll();
  }),
  destinationTab: tab => {if(tab==='matching'&&!state.picker.matchingAvailable)return;state.picker.tab=tab;state.picker.base='';render();},
  destinationBase: base => {rememberScroll();state.picker.base=base;render();restoreScroll();},
  destinationSearch: value => {state.picker.search=value;renderSearch('Search locations',value);},
  destinationTyped: value => {state.picker.typed=value;},
  pickDestination: (value,mode) => {const p=state.picker,destination=normalize(value);if(!destination)return;const target=p.kind==='actual'?(state.workForms[p.key]||={}):p.kind==='editor'?actionContext().a:state.draft.body.locations[p.key].actions[p.j];if(p.kind!=='actual')invalidate();target.destination=destination;target.destination_mode=mode||p.tab;state.picker=null;render();restoreScroll();},
  pickTypedDestination: () => root.BunchNote.pickDestination(state.picker.typed,'typed'),
  scope: () => { ensureAccount(); return state.detail?.job.id || ''; },
  stage: async ctx => { ensureAccount(); const owner=account(), epoch=state.epoch, id=state.detail?.job.id; const data = await api('list', {}, null, null, ctx.signal); const detail=id&&data.jobs.some(j=>j.id===id)?await api('get',{job_id:id},null,null,ctx.signal):null; const destination=state.screen==='destinations'?(await api(state.destinationLocation?'destination_detail':'destinations',state.destinationLocation?{location:state.destinationLocation}:{},null,null,ctx.signal)):null; return {account:owner,epoch,jobs:data.jobs,detail,id,destination,destinationLocation:state.destinationLocation}; },
  // The live-sync coordinator schedules the repaint after typing and taps finish.
  commit: value => { ensureAccount(); if (value.account === account() && value.epoch === state.epoch) { state.jobs = value.jobs; state.loaded = true; if (state.detail?.job.id===value.id) {state.detail=value.detail;if(!value.detail)state.item='';} if(value.destination&&state.screen==='destinations'&&state.destinationLocation===value.destinationLocation){state.destinationNames=value.destination.locations;if(state.destinationLocation)state.destinationData=value.destination;} } },
  chooseBlock: block => run(async () => { if (!block) return; state.rows = (await api('inventory',{block})).rows; state.location='';state.base='';state.item='';state.boardState={}; state.panels.clear(); state.draft = {id:null,revision:null,body:{format_version:5,block,locations:[],recipient_ids:[]}};if(state.parked.has(block))state.draft=state.parked.get(block);state.epoch++; }),
  openDraft: id => run(async () => { const d = state.drafts.find(d => d.id === id); const rows=(await api('inventory',{block:d.block})).rows; state.draft = structuredClone(d); state.rows=rows;prepareDraftCards(); state.location='';state.base='';state.item='';state.boardState={}; state.panels.clear();state.epoch++; }),
  backEditor: () => run(async () => { const d=state.draft;if(d.body.locations.length)await saveDraft();state.parked.set(d.body.block,state.draft); state.drafts=(await api('drafts')).drafts; invalidate(); state.draft=null; state.location=''; }),
  backLocations: () => { state.location=''; render(); },
  panel: (key, expanded) => { if(expanded)state.panels.add(key); else state.panels.delete(key); },
  openLocation: location => { if(state.busy)return;ensureLocation(location);rememberScroll();state.location=normalize(location);state.base='';state.item='';state.locationStep='setup';render();restoreScroll(); },
  removeLocation: location => run(async () => { if(state.draft.id && state.draft.body.locations.length === 1)return; if(!await showAppConfirm('Remove this location and its draft instructions from this batch?',{title:'Bunch Note'}))return; invalidate(); state.draft.body.locations=state.draft.body.locations.filter(l=>l.location!==location); state.location=''; }),
  selectRow: (i,id,on) => { invalidate(); const l=state.draft.body.locations[i]; l.row_ids=on?[...new Set([...l.row_ids,id])]:l.row_ids.filter(v=>v!==id); const add=document.getElementById('bn-add-selected-'+i); if(add)add.disabled=state.busy || !l.row_ids.length; },
  edit: (i,key,value) => { invalidate(); state.draft.body.locations[i][key]=value; },
  editAction: (i,j,key,value) => { invalidate(); const a=state.draft.body.locations[i].actions[j];a[key]=value;if(key==='crew')a.margin_tag=value;if(key==='instructions')a.action_instruction=value;if(key==='destination'){if(value.trim())a.destination_mode='typed';else delete a.destination_mode;} },
  chooseOption: (key,id,on) => {state.choices[key]=on?[...new Set([...(state.choices[key]||[]),id])]:(state.choices[key]||[]).filter(x=>x!==id);},
  custom: (key,field,value) => {state.custom[key]={...state.custom[key],[field]:value};},
  saveOption: (target,category) => run(async()=>{const k=target+':'+category,c=state.custom[k]||{},j=workJob(); if(!c.label?.trim())throw new Error('Type a new option first.'); const response=await api('option_add',{category,label:c.label.trim(),kind:c.kind||'instruction',...(!author()?{job_id:j.id,...workScope(j)}:{})},author()?null:j.revision,crypto.randomUUID()); await refreshCatalog(); state.choices[k]=[...(state.choices[k]||[]),response.option.id]; state.custom[k]={};}),
  editOption: (id,active) => {const o=state.options.find(o=>o.id===id),label=document.getElementById('bn-option-'+id).value;return run(async()=>{await api('option_edit',{option_id:id,label,active},o.revision,crypto.randomUUID());await refreshCatalog();});},
  selectItem: (index,ids,on,worker) => {if(worker){const j=workJob(),key=j.id+':'+(j.card_id||''),current=state.workRows[key]||j.body.source.map(r=>r.unique_id);state.workRows[key]=on?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id));}else{invalidate();const l=state.draft.body.locations[index];l.row_ids=on?[...new Set([...l.row_ids,...ids])]:l.row_ids.filter(id=>!ids.includes(id));if(on)prepareCards(l,true);else l.cards=l.cards.filter(c=>!c.row_ids.some(id=>ids.includes(id))||l.actions.some(a=>a.card_id===c.id));}render();},
  addChoices: (key,category) => run(async()=>{
   const target=state.targets[key],selection=state.choices[key+':'+category]||[],j=workJob(),l=target.worker?null:state.draft.body.locations[target.index];
   const source=target.worker?j.body.source:l.source_all, selected=target.worker?(state.workRows[j.id+':'+(j.card_id||'')]||source.map(r=>r.unique_id)):l.row_ids;
   const ids=source.filter(r=>target.ids.includes(r.unique_id)&&(target.scope==='location'||selected.includes(r.unique_id))&&(category!=='hauling'||shiftEligible(r))).map(r=>r.unique_id);
   if(!ids.length)throw new Error('Select at least one eligible lot row.'); if(!selection.length)throw new Error('Choose one or more options.');
   for(const id of selection){const o=state.options.find(o=>o.id===id&&o.active);if(!o)throw new Error('BUNCH_NOTE_OPTION_CHANGED');const pendingKey=key+':'+id;const a=target.worker?(state.pendingActions[pendingKey] ||= actionFromOption(o,ids,category==='hauling'?'rows':target.scope)):actionFromOption(o,ids,category==='hauling'?'rows':target.scope);
    if(target.worker){const current=workJob();a.card_id=current.card_id;await api('add_action',{job_id:current.id,...workScope(current),action:a},current.revision,crypto.randomUUID());state.detail=await api('get',{job_id:current.id});delete state.pendingActions[pendingKey];}
    else {invalidate();l.row_ids=[...new Set([...l.row_ids,...ids])];l.actions.push(a);state.panels.add('actions:'+l.location);}
    state.choices[key+':'+category]=(state.choices[key+':'+category]||[]).filter(v=>v!==id);
   }
  }),
  workField: (key,field,value) => {state.workForms[key]={...state.workForms[key],[field]:value,...(field==='destination'?{destination_mode:'typed'}:field==='source_id'&&state.workForms[key]?.destination_mode==='matching'?{destination:'',destination_mode:undefined}:{})};if(field==='source_id')render();},
  recordActual: id => run(async()=>{const j=workJob(),key=j.id+':'+id,form=state.workForms[key]||{};await api('actual',{job_id:j.id,...workScope(j),action_id:id,source_id:form.source_id,quantity:form.quantity,destination:form.destination||'',destination_mode:form.destination_mode||'typed',explanation:form.explanation||''},j.revision,crypto.randomUUID());if(state.workForms[key]===form)state.workForms[key]={source_id:form.source_id};state.detail=await api('get',{job_id:j.id,...workScope(j)});await load();}),
  correctActual: id => {const j=workJob(),x=j.actuals.find(x=>x.id===id),amount=prompt('Corrected quantity (0 cancels this entry):',String(x.quantity));if(amount===null)return;const destination=actionKind(x.action_snapshot)==='ta'?'':prompt('Correct destination:',x.destination);if(destination===null)return;const explanation=prompt('Reason for this correction:');if(!explanation?.trim())return;return run(async()=>{await api('actual',{job_id:j.id,...workScope(j),action_id:x.action_id,source_id:x.source_snapshot.unique_id,replaces_id:id,quantity:amount,destination,explanation},j.revision,crypto.randomUUID());state.detail=await api('get',{job_id:j.id,...workScope(j)});await load();});},
  workRecipient: (id,on) => {state.workRecipients=on?[...new Set([...state.workRecipients,id])]:state.workRecipients.filter(x=>x!==id);},
  previewWork: () => run(async()=>{const j=state.detail.job,{preview}=await api('work_preview',{job_id:j.id,recipient_ids:state.workRecipients},j.revision,crypto.randomUUID());await preparePdf(preview);switchView('bunch-note');}),
  publishWork: send_email => run(async()=>{await api('work_publish',{preview_id:state.preview.id,send_email},state.preview.job_revision,crypto.randomUUID());invalidate();state.detail=null;switchView('request');setReqTab('bunch-notes');await load();}),
  workPdf: preview_id => run(async()=>{const result=await api('work_pdf',{job_id:state.detail.job.id,preview_id});showPdfs([result.pdf]);const a=document.createElement('a');a.href=state.urls[0];a.target='_blank';a.rel='noopener';a.download=result.pdf.filename;a.click();}),
  removeAction: (i,j) => { invalidate(); state.draft.body.locations[i].actions.splice(j,1); render(); },
  recipient: (id,on) => { invalidate(); const d=state.draft.body; d.recipient_ids=on?[...new Set([...d.recipient_ids,id])]:d.recipient_ids.filter(v=>v!==id); },
  refreshSource: () => run(async () => { invalidate(); const d=state.draft.body; state.rows=(await api('inventory',{block:d.block})).rows; const locations=groupInventory(state.rows).get(d.block)||new Map(); d.locations.forEach(l=>{l.source_all=locations.get(l.location)||[];for(const card of l.cards||[]){if(card.kind!=='inventory')continue;const matching=l.source_all.filter(r=>cardKey(r)===cardKey(card)),ids=new Set(matching.map(r=>r.unique_id));if(card.row_ids.every(id=>ids.has(id)))card.row_ids=[...ids];}prepareCards(l);});state.epoch++; }),
  save: () => run(saveDraft),
  preview: () => run(async () => { await saveDraft(); const d=state.draft; const {preview:p}=await api('preview',{batch_id:d.id},d.revision,crypto.randomUUID()); const owner=state; const pdf=await postGoogleScriptJsonPayload({type:'bunch_note_preview',nativeAuthAccessToken,previewId:p.id},REQUEST_EMAIL_SCRIPT_TIMEOUT_MS,'Bunch Note PDF preview'); if(owner!==state)return; if(!pdf?.ok)throw new Error(pdf?.message||'PDF preview failed.'); state.preview={...p,pdfs:pdf.pdfs}; showPdfs(pdf.pdfs); }),
  closePreview: () => { const work=state.preview?.report_kind==='completed_work';invalidate();if(work){switchView('request');setReqTab('bunch-notes');}render(); },
  publish: send_email => run(async () => { await api('publish',{preview_id:state.preview.id,send_email},state.draft.revision,crypto.randomUUID()); invalidate(); state.draft=null; state.drafts=(await api('drafts')).drafts; await load(); showToast('Bunch Notes',send_email?'Published. Email queued.':'Published to Queue.'); }),
  refresh: () => run(load), filter: value => { state.filter=value;state.queueBase='';state.queueLocation=''; render(); },
  detail: id => run(async () => { rememberScroll();state.item='';state.workAction='';state.workCard='';state.detail=await api('get',{job_id:id}); await refreshCatalog(); if(author()&&!state.users.length)state.users=(await api('directory')).users;restoreScroll(); }),
  backQueue: () => { state.detail=null;state.item='';state.queueBase='';state.queueLocation='';state.screen='source'; render(); },
  command: (operation, extra={}) => run(async () => { const j=operation==='progress'?workJob():state.detail.job; await api(operation,{job_id:j.id,...workScope(j),...extra},j.revision,crypto.randomUUID()); state.detail=operation==='progress'?await api('get',{job_id:j.id}):null; await load(); }),
  sharedOwner: (index,owner_id) => {if(state.busy||!author())return;const location=state.draft.body.locations[index];if(location.job_id)return;const card=location.cards.find(c=>c.kind==='shared');if(card){invalidate();card.owner_id=owner_id||null;}},
  openWorkCard: id => {rememberScroll();state.workCard=id;state.item='';state.workAction='';render();restoreScroll();},
  cardCommand: (operation,id,extra={}) => run(async()=>{const j=state.detail.job,card=j.cards.find(c=>c.id===id);if(!card)throw new Error('This card changed. Refresh the Queue.');await api(operation,{job_id:j.id,card_id:id,...extra},card.revision,crypto.randomUUID());state.detail=await api('get',{job_id:j.id});await load();}),
  assignCard: id => root.BunchNote.cardCommand('assign_card',id,{owner_id:document.getElementById('bn-owner-'+id).value||null}),
  assign: () => root.BunchNote.command('assign',{owner_id:document.getElementById('bn-owner').value}),
  progress: (id,status) => { const key=state.detail.job.id+':'+id;const reason=state.workForms[key]?.reason || (status==='not_needed'?prompt('Why is this action not needed?'):''); if(status==='not_needed'&&!reason?.trim())return; return root.BunchNote.command('progress',{action_id:id,status,reason}); },
  cancel: () => { const reason=prompt('Reason for canceling this location work:'); if(reason?.trim())return root.BunchNote.command('cancel',{reason}); },
  revise: () => run(async () => { const j=state.detail.job; const data=await api('revise',{job_id:j.id},j.revision,crypto.randomUUID()); state.draft=data.draft;prepareDraftCards();state.workCard=''; state.rows=(await api('inventory',{block:j.block})).rows; state.users=(await api('directory')).users;state.epoch++; state.location='';state.locationStep='setup';state.base='';state.item=''; state.panels.clear(); state.panels.add('location:'+j.location); state.panels.add('actions:'+j.location); state.detail=null; switchView('bunch-note'); }),
  pdf: revision => run(async () => { const result=await api('pdf',{job_id:state.detail.job.id,instruction_revision:revision}); showPdfs([result.pdf]); const a=document.createElement('a'); a.href=state.urls[0]; a.target='_blank'; a.rel='noopener'; a.download=result.pdf.filename; a.click(); }),
  sendSaved: () => run(async () => { await api('send',{preview_id:state.preview.id},null,crypto.randomUUID()); invalidate(); state.detail=null; switchView('request'); setReqTab('bunch-notes'); await load(); }),
  delivery: (preview_id,status) => run(async () => { const p=await api('preview_read',{preview_id}); if(status==='not_sent'){state.preview={...p,saved:true}; showPdfs(p.pdfs); switchView('bunch-note'); return;} if(!await showAppConfirm(status==='failed'?'Retry this failed delivery to the saved recipients?':'Reconcile against Sent mail without sending another copy?',{title:'Bunch Notes delivery'}))return; await api(status==='failed'?'retry':'reconcile',{preview_id},null,crypto.randomUUID()); state.detail=null; await load(); }),
 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
