/* global currentUser, nativeAuthSessionActive, nativeAuthProfile, showToast, APP_SHELL_BUILD, postAppFunctionJson, APP_API_FUNCTION_URL, getCurrentVisibleViewId, getMainAreaScrollTop, setMainAreaScrollTop, postGoogleScriptJsonPayload, nativeAuthAccessToken, REQUEST_EMAIL_SCRIPT_TIMEOUT_MS, showAppConfirm, switchView */
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
 let pickerPortalHost = null;
 function focusKeyFor(element) {
  if(!element)return null;
  if(element.dataset?.bnFocusKey)return ['data-bn-focus-key',element.dataset.bnFocusKey];
  if(element.id)return ['id',element.id];
  const label=element.getAttribute?.('aria-label');if(label)return ['aria-label',label];
  if(element.name)return ['name',element.name];
  return null;
 }
 function findFocusByKey(roots,key) {
  if(!key)return null;
  const [attribute,value]=key;
  for(const rootNode of roots){
   if(!rootNode?.querySelectorAll)continue;
   const nodes=[...rootNode.querySelectorAll(`[${attribute}]`)];
   const match=nodes.find(node=>attribute==='id'?node.id===value:attribute==='aria-label'?node.getAttribute('aria-label')===value:attribute==='name'?node.name===value:node.dataset?.bnFocusKey===value);
   if(match)return match;
  }
  return null;
 }
 function captureUiPosition(container,portal=pickerPortalHost) {
  const active=typeof document!=='undefined'?document.activeElement:null;
  const focusRoot=active&&(container?.contains?.(active)||portal?.contains?.(active))?active:null;
  const roots=[container,portal].filter(Boolean),scrolls=[];
  for(const rootNode of roots){
   if(rootNode.dataset?.bnScrollKey)scrolls.push({key:rootNode.dataset.bnScrollKey,top:rootNode.scrollTop||0,left:rootNode.scrollLeft||0});
   for(const node of rootNode.querySelectorAll?.('[data-bn-scroll-key]')||[])scrolls.push({key:node.dataset.bnScrollKey,top:node.scrollTop||0,left:node.scrollLeft||0});
  }
  const mainTop=typeof getMainAreaScrollTop==='function'?getMainAreaScrollTop():(typeof document!=='undefined'?document.getElementById?.('main-scroll-area')?.scrollTop:undefined);
  return {mainTop,scrolls,focus:focusKeyFor(focusRoot),selectionStart:focusRoot?.selectionStart,selectionEnd:focusRoot?.selectionEnd,selectionDirection:focusRoot?.selectionDirection};
 }
 function restoreUiPosition(snapshot,container,portal=pickerPortalHost) {
  if(!snapshot)return;
  if(Number.isFinite(snapshot.mainTop)){
   if(typeof setMainAreaScrollTop==='function')setMainAreaScrollTop(snapshot.mainTop);
   else if(typeof document!=='undefined'){const main=document.getElementById?.('main-scroll-area');if(main)main.scrollTop=snapshot.mainTop;}
  }
  const roots=[container,portal].filter(Boolean);
  for(const saved of snapshot.scrolls||[]){
   for(const rootNode of roots){
    const nodes=[];if(rootNode.dataset?.bnScrollKey===saved.key)nodes.push(rootNode);
    for(const node of rootNode.querySelectorAll?.('[data-bn-scroll-key]')||[])if(node.dataset.bnScrollKey===saved.key)nodes.push(node);
    if(nodes.length){nodes[0].scrollTop=saved.top;nodes[0].scrollLeft=saved.left;break;}
   }
  }
  const target=findFocusByKey(roots,snapshot.focus);
  if(target){try{target.focus({preventScroll:true});}catch(error){target.focus?.({preventScroll:true});}
   if(Number.isInteger(snapshot.selectionStart)&&Number.isInteger(snapshot.selectionEnd))try{target.setSelectionRange(snapshot.selectionStart,snapshot.selectionEnd,snapshot.selectionDirection||'none');}catch(error){}
  }
 }
 function renderPickerPortal(markup,retainedPosition=null) {
  if(typeof document==='undefined'||typeof document.createElement!=='function'||!document.body?.appendChild)return;
  if(!markup){pickerPortalHost?.remove();pickerPortalHost=null;return;}
  if(!pickerPortalHost||!pickerPortalHost.isConnected){pickerPortalHost=document.createElement('div');pickerPortalHost.className='bn-picker-portal-host';pickerPortalHost.dataset.bnPickerPortal='true';document.body.appendChild(pickerPortalHost);}
  if(pickerPortalHost.innerHTML!==markup){const position=retainedPosition||captureUiPosition(null,pickerPortalHost);pickerPortalHost.innerHTML=markup;restoreUiPosition(position,null,pickerPortalHost);}
  syncPickerSelectionControls();
 }
 const normalize = value => String(value ?? '').trim().toUpperCase();
 const cleanText = (value,limit) => String(value ?? '').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim().slice(0,limit);
 const normalizeBunchNoteLocationKey = value => cleanText(value,200).toUpperCase().replace(/\s+/g,'').replace(/\.+$/,'').replace(/\.000$/,'');
 const canonicalLocation = value => {const text=normalizeBunchNoteLocationKey(value);return /^[A-Z0-9]+\.[A-Z0-9]+$/.test(text)?`${text}.000`:text;};
 const displayLocation = value => canonicalLocation(value).replace(/\.000$/, '');
 const BUNCH_HOUSES = ['South House','North House','Center House','South & Center House','North & Center House','East House','West House','East & Center House','West & Center House'];
 const PURPOSE_THREADS = ['Early Winter Protect','Haul-In Space','Small Container Cover','Overwinter Bunch & Cover','Consolidate & Space','Freeze Prep','Fall Drill Shift Canfilling','LD Canfilling/Planting','Shovel Shift','Rain Days'];
 const CREW_DIRECTIONS = ['South → North','North → South','East → West','West → East','Center Out','Outside In'];
 const DEFAULT_HOUSE_PLANS = ['Bunch West & Center','Bunch North & Center','Spread Space','Bunch South & Center','Bunch East & Center','Jam & Poly'];
 const SCHEDULE_PRESETS = ['Before first hard freeze','After hauling is complete','After irrigation check','Before poly installation','Rain-day priority','Next available crew shift'];
 const HEADER_RULE_CHIPS = [
  'Keep countable rows, leave aisles between varieties, risers, & doors',
  'Leave out rows at house edges for drape plastic',
  'Keep shear stages separate',
  'Put field signs at ends of varieties',
  'Put flags in all four corners',
  'Bunch each variety in only 1 house; flagged in back ½'
 ];
 const CARD_MARGIN_TAGS = ['Bob','Brandt','Brandt + Bob','Rhett','Sam','Sharon','QC','Zayne/QC','Todd','Matt','Bunchers','TA','Grade','Save','SORT','+','*','**','***','^','@','#'];
 const CARD_ACTION_PHRASES = ['set out 100% as won’t fit','TA','no report','bunch in 1 house','bunch in both houses','stake corners w/ shift tape','stake corners w/ Pink tape','keep white flags separate and in the back'];
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
   const block = normalize(row.blockalpha), location = canonicalLocation(row.locationcode);
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
 const cardOwnerIds = card => [...new Set([...(card?.owner_id ? [card.owner_id] : []),...(Array.isArray(card?.owner_ids) ? card.owner_ids.filter(Boolean) : [])])];
 const isCardAssignedTo = (card,userId) => !!userId && cardOwnerIds(card).includes(userId);
 const cardAssigneeLabel = card => {const names=card?.owner_names||card?.assignee_names||[];return cardOwnerIds(card).map((id,index)=>state.users.find(user=>user.id===id)?.display||state.users.find(user=>user.id===id)?.username||names[index]||(id===card.owner_id?card.owner_name:'')||id).join(', ')||'Unassigned';};
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
 function requiredBunchRecipientIds(body=state.draft?.body) {
  const ids=new Set();
  for(const user of state.users||[])if(['dylan_collyge','megan_kelly','sharon_combs'].includes(user.username))ids.add(user.id||user.profile_id);
  for(const location of body?.locations||[])for(const card of location.cards||[])if(card.kind!=='divider'){
   if(card.owner_id)ids.add(card.owner_id);
   for(const id of Array.isArray(card.owner_ids)?card.owner_ids:[])if(id)ids.add(id);
  }
   for(const location of body?.locations||[])if(location.owner_id)ids.add(location.owner_id);
  return ids;
 }
 function requiredBunchRecipientLabels(body=state.draft?.body) {
  const byId=new Map((state.users||[]).map(user=>[user.id||user.profile_id,user.display||user.username]));
  const labels=['Dylan Collyge','Megan Kelly','Sharon Combs'];
   const defaults=new Set((state.users||[]).filter(user=>['dylan_collyge','megan_kelly','sharon_combs'].includes(user.username)).map(user=>user.id||user.profile_id));
   for(const id of requiredBunchRecipientIds(body))if(byId.has(id)&&!defaults.has(id))labels.push(byId.get(id));
  return [...new Set(labels)];
 }
 const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const arg = value => esc(JSON.stringify(value));
 const stock = value => quantity(value) === null ? 'Unknown' : String(quantity(value));
 const fresh = () => ({ account: '', epoch: 0, jobs: [], loaded: false, loading: false, error: '', blocks: [], rows: [], users: [], drafts: [], draft: null, location: '', locationStep: 'setup', suggestionMenu: '', customSuggestion: '', cardPicker: null, actionEdit: null, customEdit: null, base: '', item: '', workCard: '', boardState: {}, queueBase: '', queueLocation: '', queueMode: 'create', screen: 'source', destinationBase: '', destinationLocation: '', destinationData: null, destinationNames: [], destinationSearch: '', picker: null, scrolls: new Map(), parked: new Map(), panels: new Set(), options: [], destinations: [], targets: {}, choices: {}, choiceSnapshots: {}, pendingActions: {}, custom: {}, workForms: {}, workRows: {}, workRecipients: [], bulkSelection: [], bulkOwnerIds: [], bulkOwnersTouched:false, bulkActionTouched:false, cardDestinationSearch:{}, bulkAction: '', bulkDestination:'', bulkDestinationSearch:'', bulkQualifier:'', bulkHouse:'', bulkMargin: '', bulkAppend: '', detail: null, preview: null, urls: [], filter: 'available', busy: false, metadataLoaded: false, metadataLoading: false, commands: new Map() });
 let state = fresh();
 const LOCAL_DRAFT_STORE_KEY = 'gnc_bunch_note_drafts_v1';
 const LEGACY_LOCAL_DRAFT_KEYS = ['gnc_bunch_note_draft_v1','gnc_bunch_note_drafts','bunchNoteDrafts'];
 let draftAutoSaveTimer = null;
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
  loc.row_ids=[...new Set(loc.cards.flatMap(c=>Array.isArray(c.row_ids)?c.row_ids:[]))];
 }
 function normalizeDraftBody(d) {
  if(!d)return d;d.format_version=5;if(!Array.isArray(d.locations))d.locations=[];
  for(const loc of d.locations){const code=canonicalLocation(loc.location||loc.source_location);loc.location=code;loc.source_location=code;loc.format_version=5;
   loc.work_type=cleanText(loc.work_type||loc.title||loc.purposes||`${displayLocation(code)} Bunch Notes`,500);loc.purposes=cleanText(loc.purposes||loc.work_type,500);if('title' in loc)loc.title=cleanText(loc.title,500);
   loc.purpose_thread=cleanText(loc.purpose_thread,500);loc.default_house_plan=cleanText(loc.default_house_plan,800);loc.schedule_banner=cleanText(loc.schedule_banner,2000);loc.direction=cleanText(loc.direction,200);
   loc.instructions=cleanText(loc.instructions,8000);loc.prerequisites=cleanText(loc.prerequisites,8000);loc.rule_chips=(Array.isArray(loc.rule_chips)?loc.rule_chips:[]).map(chip=>cleanText(chip,500)).filter(Boolean).slice(0,20);
   for(const card of Array.isArray(loc.cards)?loc.cards:[])if(card&&typeof card==='object'&&card.kind!=='divider')card.location_code=code;
  }
  const firstBlock=d.locations.map(loc=>canonicalLocation(loc.location).split('.')[0]).find(Boolean)||'';d.block=cleanText(d.block,100).toUpperCase().replace(/\.+$/,'')||firstBlock;return d;
 }
 function readLocalDraftStore() {
  let store={version:1,accounts:{}};
  try{const parsed=JSON.parse(localStorage.getItem(LOCAL_DRAFT_STORE_KEY)||'null');if(parsed&&parsed.version===1&&parsed.accounts&&typeof parsed.accounts==='object')store=parsed;}catch(_){}
  for(const key of LEGACY_LOCAL_DRAFT_KEYS){try{const legacy=JSON.parse(localStorage.getItem(key)||'null');const values=Array.isArray(legacy)?legacy:legacy?.body?[legacy]:[];if(values.length){store.accounts[account()]=[...(store.accounts[account()]||[]),...values];localStorage.removeItem(key);}}catch(_){}}
  return store;
 }
 function localDraftIdentity(draft) {return String(draft?.id||draft?.local_id||`local:${account()}:${draft?.body?.block||''}`);}
 function persistLocalDraft(draft=state.draft) {
  if(!draft?.body||!account())return;
  const copy=structuredClone(draft);normalizeDraftBody(copy.body);copy.local_id=localDraftIdentity(copy);copy.local_saved_at=new Date().toISOString();
  try{const store=readLocalDraftStore(),items=Array.isArray(store.accounts[account()])?store.accounts[account()]:[],id=localDraftIdentity(copy),block=copy.body.block;store.accounts[account()]=[copy,...items.filter(item=>localDraftIdentity(item)!==id&&!(copy.id==null&&item?.id==null&&item?.body?.block===block))].slice(0,100);localStorage.setItem(LOCAL_DRAFT_STORE_KEY,JSON.stringify(store));}catch(_){}
 }
 function removeLocalDraft(draft) {try{const store=readLocalDraftStore(),id=localDraftIdentity(draft);store.accounts[account()]=(store.accounts[account()]||[]).filter(item=>localDraftIdentity(item)!==id);localStorage.setItem(LOCAL_DRAFT_STORE_KEY,JSON.stringify(store));}catch(_) {}}
 function mergePersistedDrafts(serverDrafts=[]) {
  const store=readLocalDraftStore(),local=Array.isArray(store.accounts[account()])?store.accounts[account()]:[],merged=new Map();
  for(const draft of serverDrafts){if(!draft?.body)continue;normalizeDraftBody(draft.body);merged.set(localDraftIdentity(draft),draft);}
  for(const draft of local){if(!draft?.body)continue;normalizeDraftBody(draft.body);const key=localDraftIdentity(draft),server=merged.get(key),localTime=Date.parse(draft.local_saved_at||0),serverTime=Date.parse(server?.updated_at||0);if(!server||localTime>serverTime)merged.set(key,draft);}
  return [...merged.values()].sort((a,b)=>Date.parse(b.local_saved_at||b.updated_at||0)-Date.parse(a.local_saved_at||a.updated_at||0));
 }
 function scheduleDraftAutoSave() {
  persistLocalDraft();clearTimeout(draftAutoSaveTimer);if(!state.draft||!author())return;
  draftAutoSaveTimer=setTimeout(()=>{draftAutoSaveTimer=null;if(state.draft&&!state.busy&&author())void run(saveDraft);},1400);
 }
 function prepareDraftCards() { const d=normalizeDraftBody(state.draft?.body);if(!d)return;for(const loc of d.locations)prepareCards(loc,!Array.isArray(loc.cards)); }
 function ensureLocation(location) {
  const code=canonicalLocation(typeof location==='string'?location:location.location||location.location_code), d=state.draft.body;
  let loc=d.locations.find(l=>canonicalLocation(l.location||l.source_location)===code);
  if(!loc){const workType=`${displayLocation(code)} Bunch Notes`;loc={location:code,source_location:code,format_version:5,work_type:workType,purposes:workType,purpose_thread:'',priority:'',direction:'',instructions:'',prerequisites:'',default_house_plan:'',schedule_banner:'',rule_chips:[],owner_id:null,row_ids:[],cards:[],source_all:state.rows.filter(r=>canonicalLocation(r.locationcode)===code),actions:[],house_sections:[]};d.locations.push(loc);}
  else {loc.location=code;loc.source_location=code;if(!String(loc.work_type||'').trim())loc.work_type=String(loc.purposes||'').trim()||`${displayLocation(code)} Bunch Notes`;if(!String(loc.purposes||'').trim())loc.purposes=loc.work_type;}
  return loc;
 }
 function changeCard(location, value) {
  if(state.busy||!author())return;
  const loc=ensureLocation(location), existing=loc.cards.find(c=>c.id===value.id);
  if(value.included===false&&(loc.actions||[]).some(a=>a.card_id===value.id))throw new Error('Remove this card’s planned actions before excluding it.');
  invalidate();
  if(value.included===false)loc.cards=loc.cards.filter(c=>c.id!==value.id);
  else{const ownerIds=Array.isArray(value.owner_ids)?value.owner_ids.filter(id=>state.users.some(user=>user.id===id)):value.owner_id?[value.owner_id]:[];const card={id:existing?.id||(/^[0-9a-f-]{36}$/i.test(value.id||'')?value.id:crypto.randomUUID()),kind:'inventory',location_code:loc.location,itemcode:value.itemcode,commonname:value.commonname,contsize:value.contsize,row_ids:[...new Set(value.row_ids)],owner_id:ownerIds[0]||null,owner_ids:ownerIds,group_id:value.group_id||null,house:value.house??'',direction:value.direction??'',workflow_action:value.workflow_action??'',destination_location:value.destination_location??null,destination_qualifier:value.destination_qualifier??'',destination_house:value.destination_house??null,notes:value.notes??'',workflow_instructions:value.workflow_instructions??''};if(existing)Object.assign(existing,card);else loc.cards.push(card);}
  prepareCards(loc);state.epoch++;
  for(const [host,handle] of structuredHandles)if(host.dataset.bnCards!==undefined)handle.update(cardBoardProps());
 }
 function updateBoard() {for(const [host,handle] of structuredHandles)if(host.dataset.bnCards!==undefined)handle.update(cardBoardProps());}
 function bridgeRevisionKey() { const job=workJob();return `${state.epoch}:${job?.revision??state.draft?.revision??''}:${job?.instruction_revision??''}`; }
 function mergeStructuredHeaderValue(current, baseline, incoming) {
  const next={...current};
  for(const key of ['direction','target_houses'])if(!Object.is(incoming?.[key],baseline?.[key]))next[key]=incoming[key];
  return next;
 }
 function setCardGroup(location,ids,grouped) {
  if(state.busy||!author())return;const loc=ensureLocation(location),selected=new Set(ids||[]),cards=loc.cards.filter(card=>card.kind==='inventory'&&selected.has(card.id));if(!cards.length)return;const groupId=grouped&&cards.length>1?crypto.randomUUID():null;for(const card of cards)card.group_id=groupId;invalidate();updateBoard();
 }
 function cardBoardProps() { return {accountKey:state.account,revisionKey:bridgeRevisionKey(),rows:state.rows,locations:state.draft.body.locations.map(l=>({...l,cards:[...l.cards||[]]})),users:state.users,busy:state.busy,viewState:state.boardState,onViewState:next=>{state.boardState=next;updateBoard();},onCardChange:changeCard,onMove:moveCard,onGroup:(location,ids)=>setCardGroup(location,ids,true),onUngroup:(location,ids)=>setCardGroup(location,ids,false),onLocationInstructions:location=>root.BunchNote.openLocation(typeof location==='string'?location:location.location||location.location_code),onSave:async()=>{await run(saveDraft);if(state.error)throw new Error(state.error);}}; }
 function moveCard(location,card) {
  if(state.busy)return;changeCard(location,{...card,included:true});const loc=ensureLocation(location), included=loc.cards.find(c=>cardKey(c)===cardKey(card));
  const option=state.options.find(o=>o.active&&o.kind==='move'&&o.label==='Move')||state.options.find(o=>o.active&&o.kind==='move');
  if(!option){showToast('Inv Bunch Notes','The planned Move option is unavailable. Refresh the choices and retry.',true);return;}
  const index=state.draft.body.locations.indexOf(loc),key='card:'+included.id;
  state.targets[key]={index,worker:false,scope:'rows',ids:included.row_ids,card_id:included.id};beginAction(key,option.id);render();restoreScroll();
 }
 function workJob() {
  const job=state.detail?.job, card=job?.cards?.find(c=>c.id===state.workCard);if(!card)return job;
  const actions=allActions(job).filter(a=>a.card_id===card.id),ids=new Set(actions.map(a=>a.id));
  const uid=typeof nativeAuthProfile==='undefined'?'':nativeAuthProfile?.id||'';
  return {...job,card_id:card.id,owner_id:isCardAssignedTo(card,uid)?uid:card.owner_id,owner_ids:cardOwnerIds(card),revision:card.revision,status:job.status==='open'?card.status:job.status,progress:Object.fromEntries(Object.entries(job.progress||{}).filter(([id])=>ids.has(id))),actuals:(job.actuals||[]).filter(a=>ids.has(a.action_id)),worker_actions:(job.worker_actions||[]).filter(a=>a.card_id===card.id),body:{...job.body,source:(job.body.source||[]).filter(r=>card.row_ids.includes(r.unique_id)),actions:(job.body.actions||[]).filter(a=>a.card_id===card.id)}};
 }
 const workScope = job => job?.card_id?{card_id:job.card_id}:{};
 function sharedEditor(loc,index) {
  prepareCards(loc);const card=loc.cards.find(c=>c.kind==='shared');
  return card?`<section class="bn-card"><h3>General / Shared Work</h3><p>Location-wide tasks and actions spanning item cards stay together.</p><label class="bn-field">Shared work assigned user<select aria-label="Shared work assigned user" data-bn-focus-key="shared-owner:${esc(card.id)}" ${loc.job_id?'disabled':''} onchange="BunchNote.sharedOwner(${index},this.value)">${userOptions(card.owner_id)}</select></label></section>`:'';
 }
 function workerCards(job) {
  const uid=nativeAuthProfile?.id;
  const visibleCards=author()?job.cards:job.cards.filter(card=>isCardAssignedTo(card,uid)||(!cardOwnerIds(card).length&&card.status==='open'&&job.status==='open'));
   return `<h2>${esc(job.location)} · ${esc(job.body.purposes)}</h2><p>${esc(job.note_number)} · Instruction revision ${job.instruction_revision}</p><div class="bn-card-board">${visibleCards.map(card=>{const note=(job.body.actions||[]).find(action=>action.card_id===card.id&&action.kind==='instruction'&&action.label==='Card notes'),owners=cardOwnerIds(card),workflow=card.workflow_action==='ta'?'TA (Throw Away)':card.workflow_action==='move'?'Move':card.workflow_action==='bunch'?'Bunch':'';return `<article class="bn-card"><span class="bn-eyebrow">${esc(card.kind==='shared'?'General / Shared Work':card.itemcode)}</span><h3>${esc(card.commonname)} ${esc(card.contsize)}</h3><p>Assigned: ${esc(cardAssigneeLabel(card))} · ${esc(card.status)}</p><p>House: ${esc(card.house||'Not specified')} · Direction: ${esc(card.direction||'Not specified')}</p>${workflow?`<p><b>Action:</b> ${esc(workflow)}${card.workflow_action==='move'?' · To '+esc(card.destination_location):card.workflow_action==='bunch'?' · '+esc(card.destination_house):''}</p>`:''}${card.notes?`<p class="bn-pre"><b>Card notes:</b> ${esc(card.notes)}</p>`:''}${note?`<p class="bn-pre"><b>Additional notes:</b> ${esc(note.instructions)}</p>`:''}${button('Open card',`BunchNote.openWorkCard(${arg(card.id)})`,state.busy)}${job.status==='open'&&card.status==='open'&&!owners.length?button('Claim card',`BunchNote.cardCommand('claim_card',${arg(card.id)})`,state.busy):''}${job.status==='open'&&card.status==='open'&&isCardAssignedTo(card,uid)?button('Release card',`BunchNote.cardCommand('release_card',${arg(card.id)})`,state.busy):''}${author()&&job.status==='open'&&card.status==='open'?`<fieldset class="bn-picker-lots"><legend>Assign / reassign card</legend>${state.users.map(user=>`<label class="bn-choice"><input type="checkbox" data-bn-focus-key="assigned-card-owner:${esc(card.id)}:${esc(user.id)}" aria-label="Assign ${esc(user.display||user.username)} to ${esc(card.itemcode||'shared work')}" data-card-owner="${esc(card.id)}" value="${esc(user.id)}" ${owners.includes(user.id)?'checked':''}><span>${esc(user.display||user.username)}</span></label>`).join('')}</fieldset>${button('Apply card assignment',`BunchNote.assignCard(${arg(card.id)})`,state.busy)}`:''}</article>`}).join('')||'<p class="bn-muted">No cards are assigned to this account.</p>'}</div>`+(author()&&job.status==='open'?button('Revise instructions','BunchNote.revise()',state.busy)+button('Cancel work','BunchNote.cancel()',state.busy):'');
 }
 function disposeView(options = {}) { structuredGeneration++; structuredHandles.forEach(h => h.destroy()); structuredHandles.clear();renderPickerPortal('');if(!options.preservePicker)state.cardPicker=null; }
 function reset() { persistLocalDraft();clearTimeout(draftAutoSaveTimer);draftAutoSaveTimer=null;disposeView(); state.urls.forEach(url => URL.revokeObjectURL(url)); state = fresh(); state.account = account(); }
 function structuredProps(host) {
  const mode=host.dataset.bnStructured, index=Number(host.dataset.index);
  const j=workJob();
  const value=mode==='read'?{...j.body,location:j.location,actions:allActions(j)}:state.draft.body.locations[index];
  const headerBaseline=mode==='header'?{direction:value.direction,target_houses:value.target_houses}:null;
  return {accountKey:state.account,revisionKey:bridgeRevisionKey(),mode,disabled:state.busy,
   value,
   progress:j?.progress||{},
   onChange:nextValue=>{if(state.busy||!author())return;invalidate();const current=state.draft.body.locations[index];state.draft.body.locations[index]={...current,...(mode==='header'?mergeStructuredHeaderValue(current,headerBaseline,nextValue):{house_sections:nextValue.house_sections,actions:nextValue.actions})};prepareCards(state.draft.body.locations[index]);state.epoch++;structuredHandles.get(host)?.update(structuredProps(host));},
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
  ensureAccount(); if (state.busy) return; const cardScreen=state.draft&&!state.location&&!state.actionEdit&&!state.picker;if(cardScreen)rememberScroll();clearError();state.busy = true; render();
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
   if (/OPTION_CHANGED|OPTION_REQUIRED/.test(code)) state.error='The saved instruction could not be applied. Your draft is retained; review the instruction and try again.';
   showToast('Inv Bunch Notes', state.error, true);
  } finally { state.busy = false; render();if(cardScreen)restoreScroll(); }
 }
 function clearError() {state.error='';if(typeof document==='undefined')return;const container=document.getElementById?.('bunch-note-content'),alert=container?.querySelector?.(':scope > [role="alert"]');if(alert){alert.remove();renderedQueues.delete(container);}}
 async function load(attempt = 0) {
  ensureAccount(); if (state.loading) return;
  state.loading = true;
  try { const result = await api('list'); if (result?.retained !== true) state.jobs = Array.isArray(result.jobs) ? result.jobs : []; state.loaded = true; state.epoch++; }
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
  ensureAccount();
  if (!author()) {
   state.queueMode = 'assigned';
   state.metadataLoaded = true;
   if ((!refresh && state.loaded) || state.loading) { render(); return; }
   return run(load);
  }
  // Shell repaints must not start a new busy read while the user navigates.
  if ((!refresh && state.metadataLoaded) || state.metadataLoading) { render(); return; }
  state.metadataLoading = true;
  render();
  try {
   return await run(async () => {
    const results = await Promise.all([api('blocks'), api('directory'), api('drafts'),api('catalog')]);
    state.blocks = results[0].blocks; state.users = results[1].users; state.drafts = mergePersistedDrafts(results[2].drafts); state.options=results[3].options; state.destinations=results[3].locations;
    state.metadataLoaded = true;
   });
  } finally { state.metadataLoading = false; render(); }
 }
 const button = (label, action, disabled = false, pressed = null, id = '') => `<button type="button" class="bn-button" ${id ? `id="${esc(id)}"` : ''} onclick="${action}" ${disabled ? 'disabled' : ''} ${pressed === null ? '' : `aria-pressed="${pressed}"`}>${esc(label)}</button>`;
 function hybridField(label,value,options,action,placeholder='Type or choose an option',focusKey=`field:${label}`) {
  const listId=`bn-${normalize(label).toLowerCase().replace(/[^a-z0-9]+/g,'-')}-options`;
  return `<label class="bn-field" data-bn-field="${esc(label)}">${esc(label)}<input data-bn-focus-key="${esc(focusKey)}" aria-label="${esc(label)}" list="${esc(listId)}" value="${esc(value||'')}" placeholder="${esc(placeholder)}" oninput="${action}"><datalist id="${esc(listId)}">${options.map(option=>{const optionValue=Array.isArray(option)?option[0]:option,optionLabel=Array.isArray(option)?option[1]:option;return `<option value="${esc(optionValue)}" label="${esc(optionLabel)}"></option>`;}).join('')}</datalist></label>`;
 }
 function suggestionField(label,key,value,options,placeholder='Choose an option') {
  const open=state.suggestionMenu===key,custom=state.customSuggestion===key;
  return `<div class="bn-field bn-suggestion-field" data-bn-field="${esc(label)}"><span>${esc(label)}</span><button type="button" class="bn-suggestion-trigger" aria-label="${esc(label)}" aria-expanded="${open}" onclick="BunchNote.toggleSuggestion(${arg(key)})"><span>${esc(value||placeholder)}</span><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button>${open?`<div class="bn-suggestion-menu" role="listbox" aria-label="${esc(label)} options">${options.map(option=>`<button type="button" role="option" onclick="BunchNote.selectSuggestion(${arg(key)},${arg(option)})">${esc(option)}</button>`).join('')}<button type="button" role="option" onclick="BunchNote.openCustomSuggestion(${arg(key)})">Type custom…</button></div>`:''}${custom?`<input data-bn-focus-key="suggestion:${esc(key)}" aria-label="Custom ${esc(label)}" value="${esc(value||'')}" placeholder="Type custom value" oninput="BunchNote.suggestionInput(${arg(key)},this.value)">`:''}</div>`;
 }
 function locationSetupHtml(loc,index) {
  const chips=Array.isArray(loc.rule_chips)?loc.rule_chips:[];
  return `<section class="bn-location-editor" aria-label="Location setup"><h3>Plan work · ${esc(state.draft.body.block)} · ${esc(displayLocation(loc.location))}</h3>`
   +hybridField('Work type',loc.work_type||loc.purposes,templates.map(template=>template.label),`BunchNote.wizardField('workType',this.value)`,'Type or choose a work type')
   +suggestionField('Purpose / Sequence Thread','purpose_thread',loc.purpose_thread||'',PURPOSE_THREADS,'Choose a purpose')
   +suggestionField('Direction','direction',loc.direction||'',CREW_DIRECTIONS,'Choose a direction')
   +suggestionField('Default House Plan','default_house_plan',loc.default_house_plan||'',DEFAULT_HOUSE_PLANS,'Choose a house plan')
   +suggestionField('Schedule / Prerequisite Alert','schedule_banner',loc.schedule_banner||'',SCHEDULE_PRESETS,'Choose a schedule')
   +`<fieldset class="bn-rule-chips"><legend>Quick crew rules</legend><div class="bn-chip-list">${HEADER_RULE_CHIPS.map(chip=>`<button type="button" class="bn-chip" data-bn-focus-key="rule:${esc(chip)}" aria-pressed="${chips.includes(chip)}" onclick="BunchNote.insertRuleChip(${arg(chip)})">${esc(chip)}</button>`).join('')}</div></fieldset>`
   +textfield('Extra notes',loc.instructions||'',`BunchNote.wizardField('notes',this.value)`)
   +`<details class="bn-options"><summary>Advanced location controls</summary><div class="bn-options-body">${field('Priority / work order',loc.priority,`BunchNote.edit(${index},'priority',this.value)`)}${textfield('Additional prerequisites',loc.prerequisites,`BunchNote.edit(${index},'prerequisites',this.value)`)}<div data-bn-structured="header" data-index="${index}"></div><div data-bn-structured="edit" data-index="${index}"></div>${sharedEditor(loc,index)}</div></details></section><div class="bn-step-actions">${button('Next','BunchNote.nextItems()',state.busy)}${button('Save draft','BunchNote.save()',state.busy)}</div>`;
 }
 function field(label, value, action, type = 'text', disabled = false) {
  return `<label class="bn-field" data-bn-field="${esc(label)}">${esc(label)}<input data-bn-focus-key="field:${esc(label)}" type="${type}" value="${esc(value)}" oninput="${action}" ${disabled?'disabled':''} /></label>`;
 }
 function textfield(label, value, action, disabled = false) { return `<label class="bn-field" data-bn-field="${esc(label)}">${esc(label)}<textarea data-bn-focus-key="field:${esc(label)}" rows="3" oninput="${action}" ${disabled?'disabled':''}>${esc(value)}</textarea></label>`; }
 function userOptions(value, blank = 'Unassigned — available to everyone') { return `<option value="">${esc(blank)}</option>` + state.users.map(u => `<option value="${esc(u.id)}" ${u.id === value ? 'selected' : ''}>${esc(u.display || u.username)}</option>`).join(''); }
 const templateOptions = () => templates.map((t, n) => `<option value="${n}">${esc(t.group + ' — ' + t.label)}</option>`).join('');
 const panelAttrs = key => `${state.panels.has(key) ? 'open' : ''} ontoggle="BunchNote.panel(${arg(key)},this.open)"`;
 function savedDraftLocations() {return state.drafts.flatMap(d=>(d?.body?.locations||[]).map(loc=>({id:d.id||d.local_id||localDraftIdentity(d),block:d.body.block,location:canonicalLocation(loc.location||loc.source_location)})));}
 function drillCard(label, caption, action, kind, badge='') {
  return `<button type="button" class="bn-drill-card" onclick="${action}" aria-label="Open ${esc(kind)} ${esc(label)}" ${state.busy ? 'disabled' : ''}><span class="bn-drill-icon" aria-hidden="true"><i class="ph-bold ${kind === 'block' ? 'ph-squares-four' : 'ph-map-pin'}"></i></span><span class="bn-drill-copy"><span class="bn-eyebrow">${kind === 'block' ? 'Block Alpha' : 'Location Code'}${badge?` <b class="bn-draft-badge">${esc(badge)}</b>`:''}</span><strong>${esc(label)}</strong><span class="bn-muted">${esc(caption)}</span></span><i class="ph-bold ph-caret-right" aria-hidden="true"></i></button>`;
 }
 function locationDrillCard(location, caption) {
  const label = displayLocation(location);
  const saved=savedDraftLocations().some(item=>normalizeBunchNoteLocationKey(item.location)===normalizeBunchNoteLocationKey(location));
  return drillCard(label, caption, `BunchNote.openLocation(${arg(location)})`, 'location', saved?'DRAFT':'');
 }
 const categoryLabels={sequence:'Sequence',grading:'Grading',placement:'Placement',inventory:'Inventory',hauling:'Shift/Hauling'};
 function actionChoices(key, rows, target) {
  state.targets[key]={...target,ids:rows.map(r=>r.unique_id)};
  return `<div class="bn-action-choices"><h3>Add another action</h3>${Object.entries(categoryLabels).filter(([cat])=>cat!=='hauling'||rows.some(shiftEligible)).map(([cat,label])=>{
    return `<details class="bn-options" ${panelAttrs(key+':'+cat)}><summary>${label}<i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body">${state.options.filter(o=>o.active&&o.category===cat).map(o=>{state.choiceSnapshots[key+':'+o.id] ||= structuredClone(o);return button(o.label,`BunchNote.startAction(${arg(key)},${arg(o.id)})`,state.busy);}).join('')}
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
 function cardWizardGroups(location,sortBy='commonname') {
  const grouped=new Map();
  for(const row of location.source_all||[]){
   if(!row?.unique_id)continue;
   const key=cardKey(row);if(!grouped.has(key))grouped.set(key,{key,itemcode:row.itemcode||'',commonname:row.commonname||'',contsize:row.contsize||'',rows:[]});
   const group=grouped.get(key);if(!group.rows.some(existing=>existing.unique_id===row.unique_id))group.rows.push(row);
  }
  const sortValue=group=>sortBy==='itemcode'?`${group.itemcode} ${group.commonname} ${group.contsize}`:`${group.commonname} ${group.itemcode} ${group.contsize}`;
  return [...grouped.values()].sort((a,b)=>sortValue(a).localeCompare(sortValue(b),undefined,{numeric:true,sensitivity:'base'}));
 }
 function cardPickerGroups(location,sortBy='commonname') {
  return cardWizardGroups(location,sortBy).map(group=>({...group,searchText:normalize([group.itemcode,group.commonname,group.contsize,...group.rows.map(row=>row.lotcode)].join(' '))}));
 }
 function cardNotesAction(location, cardId) {
  return (location.actions||[]).find(action=>action.card_id===cardId&&action.kind==='instruction'&&action.label==='Card notes')||null;
 }
 function pickerDefaultOwnerIds(location,picker) {
  const selected=(picker.groups||[]).filter(group=>(picker.selectedKeys||[]).includes(group.key));
  if(!selected.length)return [];
  const cards=selected.map(group=>location.cards.find(card=>card.kind==='inventory'&&cardKey(card)===group.key));
  if(cards.some(card=>!card))return [];
  const owners=cardOwnerIds(cards[0]);
  return owners.filter(id=>cards.every(card=>cardOwnerIds(card).includes(id)));
 }
 const workflowOptions=[['','Use header default'],['move','Move'],['bunch','Bunch'],['ta','TA (Throw Away)'],['haul','Haul'],['set_out','Set Out'],['custom','Custom'],['compound','Compound']];
 const workflowInstructions=()=>[...new Set([...CARD_ACTION_PHRASES,...templates.map(template=>template.instructions)])];
 function pickerMatches(picker) {const query=normalize(picker.search);return (picker.groups||[]).filter(group=>!query||group.searchText.includes(query));}
 function pickerCardDraft(location,picker,group) {
  picker.cardDrafts||={};if(picker.cardDrafts[group.key])return picker.cardDrafts[group.key];
  const existing=location.cards.find(card=>card.kind==='inventory'&&cardKey(card)===group.key),owners=existing?cardOwnerIds(existing):[];
  return picker.cardDrafts[group.key]={workflow_action:existing?.workflow_action||picker.workflow_action||'',destination_location:existing?.destination_location||picker.destination_location||'',destination_qualifier:existing?.destination_qualifier||picker.destination_qualifier||'',destination_house:existing?.destination_house||picker.destination_house||'',direction:existing?.direction||picker.direction||location.direction||'',ownerIds:owners.length?owners:[...(picker.ownerIds||[])],notes:existing?.notes||cardNotesAction(location,existing?.id)?.instructions||picker.notes||'',workflow_instructions:existing?.workflow_instructions||picker.workflow_instructions||''};
 }
 function pickerAssignmentMarkup(location,picker,groups) {
  return groups.map(group=>{const draft=picker.groupMode==='individual'?pickerCardDraft(location,picker,group):null,owners=draft?.ownerIds||(Array.isArray(picker.ownerIds)?picker.ownerIds:cardOwnerIds(location.cards.find(card=>card.kind==='inventory'&&cardKey(card)===group.key)));const names=owners.map(id=>state.users.find(user=>user.id===id)).filter(Boolean).map(user=>user.username||user.display).join(', ');return `<li><b>${esc(group.itemcode)}:</b> ${esc(names||'Unassigned (new card)')}</li>`;}).join('');
 }
 function destinationChoices() {
  const unique=new Map();
  for(const entry of state.destinations||[]){const full=normalize(typeof entry==='string'?entry:entry.location||entry.location_code);if(!full)continue;const base=baseLocation(full),display=base!==full?base+'.':displayLocation(full);if(!unique.has(display))unique.set(display,new Set());unique.get(display).add(full);}
  return [...unique].sort(([a],[b])=>a.localeCompare(b)).map(([display,set])=>{const codes=[...set].sort((a,b)=>a.localeCompare(b)),preferred=codes.includes(display+'000')?display+'000':codes.length===1?codes[0]:'';return {display,full:preferred,codes,requiresExplicit:!preferred};});
 }
 function resolveDestination(display, selectedFull='') {
  const raw=normalize(display),choice=destinationChoices().find(item=>item.display===raw||item.codes.includes(raw));
  if(!choice)return '';
  if(choice.codes.includes(raw))return raw;
  if(choice.codes.includes(normalize(selectedFull)))return normalize(selectedFull);
  return choice.full;
 }
 function exactDestinationField(display,selectedFull,focusKey,onchange,label='Full destination location') {
  const choice=destinationChoices().find(item=>item.display===normalize(display));
  if(!choice?.requiresExplicit)return '';
  return `<label class="bn-field">${esc(label)}<select aria-label="${esc(label)}" data-bn-focus-key="${esc(focusKey)}" onchange="${onchange}"><option value="">Choose full location</option>${choice.codes.map(code=>`<option value="${esc(code)}" ${code===selectedFull?'selected':''}>${esc(code)}</option>`).join('')}</select></label>`;
 }
 function sequenceSummaryMarkup(location,card) {
  const action=card.workflow_action||'',destinationSearch=state.cardDestinationSearch?.[card.id]||'';
  const route=action==='move'?`Move to ${card.destination_location||destinationSearch||'destination not selected'}${card.destination_qualifier?' · '+card.destination_qualifier:''}`:action==='bunch'?`Bunch · ${card.destination_house||'house not selected'}`:action==='ta'?'TA (Throw Away)':action?workflowOptions.find(([value])=>value===action)?.[1]||action:(location.default_house_plan?`Header default · ${location.default_house_plan}`:'Header default');
  const legacyNote=cardNotesAction(location,card.id),summaryText=[card.notes||legacyNote?.instructions,card.workflow_instructions].filter(value=>String(value||'').trim()).join(' · ');
  const margin=card.left_margin||'No margin',size=card.contsize||'Size not specified',variety=card.variety||card.commonname||card.itemcode||'Variety not specified';
  return `<span>[${esc(margin)}]</span><span>[${esc(size)}]</span><span>[${esc(variety)}]</span><span>— ${esc(route)}${summaryText?` · ${esc(summaryText)}`:''}</span>`;
 }
 function sequenceRouteFields(location,card) {
  const action=card.workflow_action||'',display=destinationChoices().find(choice=>choice.codes.includes(card.destination_location)||choice.display===state.cardDestinationSearch?.[card.id]);
  return `${action==='move'?`<label class="bn-field">Move destination<input aria-label="Move destination for ${esc(card.itemcode)}" list="bn-card-destinations" data-bn-focus-key="card-destination:${esc(card.id)}" value="${esc(state.cardDestinationSearch?.[card.id]??display?.display??card.destination_location??'')}" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'destination_search',this.value)" onchange="BunchNote.setCardDestination(${arg(location.location)},${arg(card.id)},this.value)"></label><div data-bn-destination-choice="card:${esc(card.id)}" style="display:contents">${exactDestinationField(state.cardDestinationSearch?.[card.id]||display?.display||displayLocation(card.destination_location||''),card.destination_location,`card-destination-full:${card.id}`,`BunchNote.setCardDestinationFull(${arg(location.location)},${arg(card.id)},this.value,this)`)}</div><label class="bn-field">Destination qualifier<input data-bn-focus-key="card-qualifier:${esc(card.id)}" value="${esc(card.destination_qualifier||'')}" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'destination_qualifier',this.value)"></label>`:''}${action==='bunch'?hybridField('Bunch house',card.destination_house||'',BUNCH_HOUSES,`BunchNote.editCard(${arg(location.location)},${arg(card.id)},'destination_house',this.value)`,'Type or choose a house',`card-house:${card.id}`):''}`;
 }
 function pickerCommitDisabled(picker) {
  if(state.busy||(!picker.rowIds.length&&!picker.committedId))return true;
  const drafts=picker.groupMode==='individual'?Object.values(picker.cardDrafts||{}):[picker];
  return drafts.some(draft=>draft.workflow_action==='move'&&!String(draft.destination_location||draft.destination_search||'').trim()||draft.workflow_action==='bunch'&&!String(draft.destination_house||'').trim());
 }
 function updatePickerSelectionUi() {
  const portal=pickerPortalHost,picker=state.cardPicker;if(!portal||!picker)return;
  const selectedCount=(picker.selectedKeys||[]).length,heading=portal.querySelector('[data-bn-picker-title]'),continueButton=portal.querySelector('[data-bn-picker-continue]');
  if(heading)heading.textContent=selectedCount?'Card routing and notes':'Search inventory';
  if(continueButton){continueButton.disabled=state.busy||selectedCount===0;continueButton.setAttribute('aria-disabled',String(continueButton.disabled));}
  const status=portal.querySelector('[data-bn-picker-selection-status]');if(status)status.textContent=`${selectedCount} card${selectedCount===1?'':'s'} selected`;
  updatePickerAssignments();
 }
 function updatePickerCommitUi() {
  const portal=pickerPortalHost,picker=state.cardPicker;if(!portal||!picker)return;
  const buttonNode=portal.querySelector('[data-bn-picker-commit]');if(buttonNode){buttonNode.disabled=pickerCommitDisabled(picker);buttonNode.setAttribute('aria-disabled',String(buttonNode.disabled));}
  const status=portal.querySelector('[data-bn-picker-lot-status]');if(status)status.textContent=`${picker.rowIds.length} lot${picker.rowIds.length===1?'':'s'} selected`;
 }
 function pickerResultMarkup(picker) {
  const matches=pickerMatches(picker),visible=matches,host=pickerPortalHost;
  const results=host?.querySelector('[data-bn-picker-results]');if(results)results.innerHTML=visible.map(group=>`<label class="bn-choice bn-picker-result"><input type="checkbox" data-bn-picker-card="${esc(group.key)}" aria-label="Select card ${esc(group.itemcode)} ${esc(group.commonname)}" ${(picker.selectedKeys||[]).includes(group.key)?'checked':''} onchange="BunchNote.togglePickerCard(${arg(group.key)},this.checked);this.focus({preventScroll:true})"><span><strong>${esc(group.itemcode)} · ${esc(group.commonname)}</strong><small>${esc(group.contsize||'Size not specified')} · ${group.rows.length} lot${group.rows.length===1?'':'s'}</small></span></label>`).join('')||'<p class="bn-muted">No verified inventory card matches this search.</p>';
  const count=host?.querySelector('[data-bn-picker-result-count]');if(count)count.textContent=`${matches.length} ${matches.length===1?'card':'cards'} shown`;
  updatePickerSelectionUi();
  syncPickerSelectionControls();
 }
 function syncPickerSelectionControls() {
  const picker=state.cardPicker,portal=pickerPortalHost,search=portal?.querySelector('[data-bn-picker-search]');if(!picker||!search||picker.details)return;
  let toolbar=portal.querySelector('[data-bn-picker-toolbar]');if(!toolbar){toolbar=document.createElement('div');toolbar.className='bn-picker-toolbar';toolbar.dataset.bnPickerToolbar='true';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Inventory card controls');toolbar.innerHTML='<button type="button" data-sort="commonname">Common Name</button><button type="button" data-sort="itemcode">Item Code</button><button type="button" data-select-all>Select All Shown</button><button type="button" data-clear>Clear</button>';search.closest('label')?.after(toolbar);toolbar.querySelector('[data-sort="commonname"]').onclick=()=>root.BunchNote.sortPickerCards('commonname');toolbar.querySelector('[data-sort="itemcode"]').onclick=()=>root.BunchNote.sortPickerCards('itemcode');toolbar.querySelector('[data-select-all]').onclick=()=>root.BunchNote.selectAllPickerCards();toolbar.querySelector('[data-clear]').onclick=()=>root.BunchNote.clearPickerCards();}
  for(const buttonNode of toolbar.querySelectorAll('[data-sort]'))buttonNode.setAttribute('aria-pressed',String(buttonNode.dataset.sort===(picker.sortBy||'commonname')));
  const shown=pickerMatches(picker);toolbar.querySelector('[data-select-all]').disabled=state.busy||!shown.length;toolbar.querySelector('[data-clear]').disabled=state.busy||!(picker.selectedKeys||[]).length;
  portal.querySelector('[data-bn-picker-more]')?.remove();
 }
 function updatePickerRoutingUi() {
  const portal=pickerPortalHost,picker=state.cardPicker,host=portal?.querySelector('[data-bn-picker-routing]');if(!host||!picker)return;
  host.innerHTML=pickerRoutingMarkup(picker);updatePickerCommitUi();
 }
 function pickerRoutingMarkup(picker) {
  return picker.workflow_action==='move'?`<label class="bn-field">Destination location<input aria-label="Move destination" list="bn-picker-destinations" data-bn-focus-key="picker-destination" value="${esc(picker.destination_search||picker.destination_location||'')}" oninput="BunchNote.pickerField('destination_search',this.value)" onchange="BunchNote.pickCardDestination(this.value)"></label><datalist id="bn-picker-destinations">${destinationChoices().map(choice=>`<option value="${esc(choice.display)}"></option>`).join('')}</datalist><div data-bn-destination-choice="picker" style="display:contents">${exactDestinationField(picker.destination_search||displayLocation(picker.destination_location||''),picker.destination_location,'picker-full-destination',"BunchNote.pickerField('destination_location',this.value)")}</div><label class="bn-field">Destination qualifier<input aria-label="Destination qualifier" data-bn-focus-key="picker-qualifier" value="${esc(picker.destination_qualifier||'')}" oninput="BunchNote.pickerField('destination_qualifier',this.value)"></label>`:picker.workflow_action==='bunch'?hybridField('Bunch destination house',picker.destination_house||'',BUNCH_HOUSES,"BunchNote.pickerField('destination_house',this.value)",'Type or choose a house','picker-house'):'';
 }
 function pickerUserChoices(picker,ownerIds,groupKey='') {
  const query=normalize(picker.userSearch),users=state.users.filter(user=>!query||normalize(`${user.display||''} ${user.username||''}`).includes(query));
  return users.map(user=>`<label class="bn-choice"><input type="checkbox" data-bn-picker-owner="${esc(user.id)}" aria-label="Assign to ${esc(user.display||user.username)}" ${ownerIds.includes(user.id)?'checked':''} onchange="${groupKey?`BunchNote.togglePickerCardOwner(${arg(groupKey)},${arg(user.id)},this.checked)`: `BunchNote.togglePickerOwner(${arg(user.id)},this.checked)`};this.focus({preventScroll:true})"><span>${esc(user.display||user.username)}</span></label>`).join('')||'<p class="bn-muted">No users match this search.</p>';
 }
 function pickerIndividualMarkup(location,picker,groups) {
  return groups.map(group=>{const draft=pickerCardDraft(location,picker,group);return `<details class="bn-picker-card-editor" open><summary>${esc(group.itemcode)} at ${esc(location.location)} Â· ${esc(group.commonname)}</summary>${hybridField('Action',draft.workflow_action,workflowOptions,`BunchNote.pickerCardField(${arg(group.key)},'workflow_action',this.value)`,'Type or choose an action',`picker-card-action:${group.key}`)}${hybridField('Card direction',draft.direction,CREW_DIRECTIONS,`BunchNote.pickerCardField(${arg(group.key)},'direction',this.value)`,'Type or choose a direction',`picker-card-direction:${group.key}`)}${hybridField('Destination',draft.destination_location||draft.destination_house,[...destinationChoices().map(choice=>choice.display),...BUNCH_HOUSES],`BunchNote.pickerCardField(${arg(group.key)},'destination',this.value)`,'Type or choose a destination',`picker-card-destination:${group.key}`)}<fieldset class="bn-picker-lots"><legend>Assigned users</legend>${pickerUserChoices(picker,draft.ownerIds,group.key)}</fieldset>${textfield('Card notes',draft.notes,`BunchNote.pickerCardField(${arg(group.key)},'notes',this.value)`,state.busy)}${hybridField('Workflow instructions',draft.workflow_instructions,workflowInstructions(),`BunchNote.pickerCardField(${arg(group.key)},'workflow_instructions',this.value)`,'Type or choose instructions',`picker-card-instructions:${group.key}`)}</details>`;}).join('');
 }
 function updatePickerAssignments() {
  const picker=state.cardPicker,location=state.draft?.body.locations.find(item=>item.location===state.location),host=pickerPortalHost?.querySelector('[data-bn-picker-assignments]');if(!picker||!location||!host)return;
  host.innerHTML=pickerAssignmentMarkup(location,picker,(picker.groups||[]).filter(group=>(picker.selectedKeys||[]).includes(group.key)));
 }
 function sequenceCardNode(id) {
  const host=document.getElementById('bunch-note-content');return [...(host?.querySelectorAll?.('[data-sequence-id]')||[])].find(node=>node.dataset.sequenceId===id)||null;
 }
 function syncCheckboxByFocusKey(container,key,checked) {
  const input=[...(container?.querySelectorAll?.('[data-bn-focus-key]')||[])].find(node=>node.dataset.bnFocusKey===key);if(input)input.checked=!!checked;
 }
 function updateSequenceCardUi(location,card,{routing=false,owners=false,fields=false}={}) {
  const article=sequenceCardNode(card.id);if(!article)return;
  const summary=article.querySelector('[data-bn-sequence-summary]');if(summary)summary.innerHTML=sequenceSummaryMarkup(location,card);
  if(routing){const routeHost=article.querySelector('[data-bn-sequence-routing]');if(routeHost)routeHost.innerHTML=sequenceRouteFields(location,card);}
  const focusNode=key=>[...(article.querySelectorAll('[data-bn-focus-key]')||[])].find(node=>node.dataset.bnFocusKey===key);
  if(routing){const action=focusNode(`card-action:${card.id}`);if(action)action.value=card.workflow_action||'';}
  if(owners){const select=focusNode(`card-owners:${card.id}`);if(select){const ids=new Set(Array.isArray(card.owner_ids)?card.owner_ids:card.owner_id?[card.owner_id]:[]);for(const option of select.options)option.selected=ids.has(option.value);}}
  if(fields){const margin=focusNode(`card-margin:${card.id}`),notes=focusNode(`card-notes:${card.id}`),instructions=focusNode(`card-instructions:${card.id}`);if(margin)margin.value=card.left_margin||'';if(notes)notes.value=card.notes||cardNotesAction(location,card.id)?.instructions||'';if(instructions)instructions.value=card.workflow_instructions||'';}
 }
 function refreshSequenceDestinationChoice(card) {
  const article=sequenceCardNode(card.id),host=[...(article?.querySelectorAll('[data-bn-destination-choice]')||[])].find(node=>node.dataset.bnDestinationChoice===`card:${card.id}`);if(!host)return;
  const display=state.cardDestinationSearch?.[card.id]||displayLocation(card.destination_location||'');
  host.innerHTML=exactDestinationField(display,card.destination_location,`card-destination-full:${card.id}`,`BunchNote.setCardDestinationFull(${arg(state.location)},${arg(card.id)},this.value)`);
 }
 function refreshBulkDestinationChoice() {
  const host=document.querySelector('#bunch-note-content [data-bn-destination-choice="bulk"]');if(!host)return;
  const display=state.bulkDestinationSearch||displayLocation(state.bulkDestination||'');
  host.innerHTML=exactDestinationField(display,state.bulkDestination,'bulk-destination-full',"BunchNote.setBulkDestinationFull(this.value)");
 }
 function refreshPickerDestinationChoice() {
  const picker=state.cardPicker,host=pickerPortalHost?.querySelector('[data-bn-destination-choice="picker"]');if(!picker||!host)return;
  const display=picker.destination_search||displayLocation(picker.destination_location||'');
  host.innerHTML=exactDestinationField(display,picker.destination_location,'picker-full-destination',"BunchNote.pickerField('destination_location',this.value)");
 }
 function sequentialCardMarkup(location,card,index) {
  if(card.kind==='divider')return `<article class="bn-sequence-divider" data-sequence-id="${esc(card.id)}"><span class="bn-divider-rule"></span><label class="bn-field">Divider / instruction row<input data-bn-focus-key="divider:${esc(card.id)}" value="${esc(card.text||'')}" oninput="BunchNote.editDivider(${arg(location.location)},${arg(card.id)},'text',this.value)"></label><label class="bn-field">Left-margin tag<input aria-label="Divider left-margin tag" data-bn-focus-key="divider-margin:${esc(card.id)}" list="bn-left-margin-tags" value="${esc(card.left_margin||'')}" oninput="BunchNote.editDivider(${arg(location.location)},${arg(card.id)},'left_margin',this.value)"></label><div class="bn-sequence-actions"><button type="button" class="bn-button" aria-label="Move divider up" onclick="BunchNote.reorderCard(${arg(location.location)},${arg(card.id)},-1)" ${state.busy||index===0?'disabled':''}>↑</button><button type="button" class="bn-button" aria-label="Move divider down" onclick="BunchNote.reorderCard(${arg(location.location)},${arg(card.id)},1)" ${state.busy||index===location.cards.length-1?'disabled':''}>↓</button>${button('Remove divider',`BunchNote.removeSequenceRow(${arg(location.location)},${arg(card.id)})`,state.busy)}</div></article>`;
  const action=card.workflow_action||'';
  const owners=Array.isArray(card.owner_ids)?card.owner_ids:card.owner_id?[card.owner_id]:[],legacyNote=cardNotesAction(location,card.id),noteValue=card.notes||legacyNote?.instructions||'';
  const size=card.contsize||'Size not specified';
  return `<article class="bn-sequence-card" data-sequence-id="${esc(card.id)}"><div class="bn-sequence-number">${index+1}</div><div class="bn-sequence-content"><header><span class="bn-eyebrow">${esc(card.itemcode||'Inventory card')}</span><h4>${esc(card.commonname||'')}</h4><span>${esc(size)}</span></header><div class="bn-sequence-summary" data-bn-sequence-summary aria-label="Card summary">${sequenceSummaryMarkup(location,card)}</div><p class="bn-sequence-lots">${card.row_ids?.length||0} selected lot${card.row_ids?.length===1?'':'s'}</p><div class="bn-sequence-controls"><label class="bn-field">Action<select aria-label="Action for ${esc(card.itemcode)}" data-bn-focus-key="card-action:${esc(card.id)}" onchange="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'workflow_action',this.value)">${workflowOptions.map(([value,label])=>`<option value="${value}" ${action===value?'selected':''}>${label}</option>`).join('')}</select></label><div data-bn-sequence-routing style="display:contents">${sequenceRouteFields(location,card)}</div><label class="bn-field">Assigned users<select multiple aria-label="Assigned users for ${esc(card.itemcode)}" data-bn-focus-key="card-owners:${esc(card.id)}" onchange="BunchNote.editCardOwners(${arg(location.location)},${arg(card.id)},this)">${state.users.map(user=>`<option value="${esc(user.id)}" ${owners.includes(user.id)?'selected':''}>${esc(user.display||user.username)}</option>`).join('')}</select></label><label class="bn-field">Left-margin tag<input data-bn-focus-key="card-margin:${esc(card.id)}" value="${esc(card.left_margin||'')}" list="bn-left-margin-tags" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'left_margin',this.value)"></label><label class="bn-field">Card notes<textarea data-bn-focus-key="card-notes:${esc(card.id)}" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'notes',this.value)">${esc(noteValue)}</textarea></label><label class="bn-field">Workflow instructions<textarea data-bn-focus-key="card-instructions:${esc(card.id)}" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'workflow_instructions',this.value)">${esc(card.workflow_instructions||'')}</textarea></label></div><div class="bn-chip-list">${CARD_ACTION_PHRASES.map(phrase=>`<button class="bn-chip" type="button" onclick="BunchNote.appendCardPhrase(${arg(location.location)},${arg(card.id)},${arg(phrase)})">${esc(phrase)}</button>`).join('')}</div><div class="bn-sequence-actions">${button('↑',`BunchNote.reorderCard(${arg(location.location)},${arg(card.id)},-1)`,state.busy||index===0)}${button('↓',`BunchNote.reorderCard(${arg(location.location)},${arg(card.id)},1)`,state.busy||index===location.cards.length-1)}<label><input type="checkbox" aria-label="Select ${esc(card.itemcode)} for bulk edit" ${state.bulkSelection.includes(card.id)?'checked':''} onchange="BunchNote.toggleSequenceCard(${arg(location.location)},${arg(card.id)},this.checked);this.focus({preventScroll:true})"> Bulk edit</label>${button('Remove',`BunchNote.removeSequenceRow(${arg(location.location)},${arg(card.id)})`,state.busy)}</div></div></article>`;
 }
 function bulkToolbarMarkup(location) {
  const selected=(state.bulkSelection||[]).filter(id=>location.cards.some(card=>card.id===id)),bulkDisplay=state.bulkDestinationSearch||displayLocation(state.bulkDestination||'');
  return `<fieldset class="bn-bulk-toolbar" data-bn-bulk-toolbar ${selected.length?'':'hidden'} style="${selected.length?'':'display:none'}"><legend data-bn-bulk-legend>Update ${selected.length} selected cards</legend><label class="bn-field">Action<select aria-label="Bulk card action" data-bn-focus-key="bulk-action" onchange="BunchNote.setBulk('workflow_action',this.value)">${workflowOptions.map(([value,label])=>`<option value="${value}" ${state.bulkAction===value?'selected':''}>${label}</option>`).join('')}</select></label><div data-bn-bulk-routing style="display:contents">${bulkRoutingMarkup()}</div><label class="bn-field">Assigned users<select multiple aria-label="Bulk assigned users" data-bn-focus-key="bulk-owners" onchange="BunchNote.setBulkOwners(this)">${state.users.map(user=>`<option value="${esc(user.id)}" ${state.bulkOwnerIds.includes(user.id)?'selected':''}>${esc(user.display||user.username)}</option>`).join('')}</select></label><label class="bn-field">Left-margin tag<input list="bn-left-margin-tags" aria-label="Bulk left-margin tag" value="${esc(state.bulkMargin)}" oninput="BunchNote.setBulk('left_margin',this.value)"></label><label class="bn-field">Append to card notes<textarea aria-label="Append bulk card notes" oninput="BunchNote.setBulk('notes_append',this.value)">${esc(state.bulkAppend)}</textarea></label>${button('Apply to selected cards','BunchNote.applyBulk()',state.busy||selected.length===0)}</fieldset>`;
 }
 function bulkRoutingMarkup() {
  const display=state.bulkDestinationSearch||displayLocation(state.bulkDestination||'');
  return state.bulkAction==='move'?`<label class="bn-field">Move destination<input aria-label="Bulk move destination" data-bn-focus-key="bulk-destination" list="bn-card-destinations" value="${esc(display)}" oninput="BunchNote.setBulk('destination',this.value)" onchange="BunchNote.setBulkDestination(this.value)"></label><div data-bn-destination-choice="bulk" style="display:contents">${exactDestinationField(display,state.bulkDestination,'bulk-destination-full',"BunchNote.setBulkDestinationFull(this.value,this)")}</div><label class="bn-field">Destination qualifier<input aria-label="Bulk destination qualifier" data-bn-focus-key="bulk-qualifier" value="${esc(state.bulkQualifier)}" oninput="BunchNote.setBulk('qualifier',this.value)"></label>`:state.bulkAction==='bunch'?`<label class="bn-field">Bunch house<select aria-label="Bulk Bunch house" data-bn-focus-key="bulk-house" onchange="if(this.value!=='Custom')BunchNote.setBulk('house',this.value)"><option value="">Choose a house</option>${BUNCH_HOUSES.map(house=>`<option value="${esc(house)}" ${state.bulkHouse===house?'selected':''}>${esc(house)}</option>`).join('')}<option value="Custom" ${state.bulkHouse&&!BUNCH_HOUSES.includes(state.bulkHouse)?'selected':''}>Custom house...</option></select><input aria-label="Custom bulk Bunch house" value="${esc(BUNCH_HOUSES.includes(state.bulkHouse)?'':state.bulkHouse)}" placeholder="Type a custom house" oninput="BunchNote.setBulk('house',this.value)"></label>`:'';
 }
 function updateBulkUi(location,{routing=false,fields=false}={}) {
  if(typeof document==='undefined'||typeof document.querySelector!=='function')return;
  const host=document.querySelector('#bunch-note-content [data-bn-bulk-toolbar]');if(!host||!location)return;
  const selected=(state.bulkSelection||[]).filter(id=>location.cards.some(card=>card.id===id));
  host.hidden=selected.length===0;host.style.display=selected.length?'':'none';const legend=host.querySelector('[data-bn-bulk-legend]');if(legend)legend.textContent=`Update ${selected.length} selected cards`;
  let groupActions=host.querySelector('[data-bn-group-actions]');if(!groupActions){groupActions=document.createElement('div');groupActions.className='bn-group-actions';groupActions.dataset.bnGroupActions='true';groupActions.innerHTML='<button type="button" data-group-selected>Group Selected</button><button type="button" data-ungroup-selected>Ungroup</button>';host.prepend(groupActions);groupActions.querySelector('[data-group-selected]').onclick=()=>root.BunchNote.groupSelectedCards();groupActions.querySelector('[data-ungroup-selected]').onclick=()=>root.BunchNote.ungroupSelectedCards();}
  groupActions.querySelector('[data-group-selected]').disabled=selected.length<2;groupActions.querySelector('[data-ungroup-selected]').disabled=!selected.length;
  const apply=host.querySelector('button[onclick="BunchNote.applyBulk()"]');if(apply)apply.disabled=state.busy||selected.length===0||state.bulkActionTouched&&state.bulkAction==='move'&&!state.bulkDestination.trim()||state.bulkActionTouched&&state.bulkAction==='bunch'&&!state.bulkHouse.trim();
  if(routing){const routeHost=host.querySelector('[data-bn-bulk-routing]');if(routeHost)routeHost.innerHTML=bulkRoutingMarkup();}
  if(fields){const margin=host.querySelector('[aria-label="Bulk left-margin tag"]'),append=host.querySelector('[aria-label="Append bulk card notes"]'),owners=host.querySelector('[data-bn-focus-key="bulk-owners"]');if(margin)margin.value=state.bulkMargin;if(append)append.value=state.bulkAppend;if(owners)for(const option of owners.options)option.selected=state.bulkOwnerIds.includes(option.value);}
 }
 function sequentialEditor(location) {
  return `<datalist id="bn-card-destinations">${destinationChoices().map(choice=>`<option value="${esc(choice.display)}"></option>`).join('')}</datalist><datalist id="bn-left-margin-tags">${CARD_MARGIN_TAGS.map(tag=>`<option value="${esc(tag)}"></option>`).join('')}</datalist><section class="bn-sequence" aria-label="Printed note sequence">${location.cards.map((card,index)=>sequentialCardMarkup(location,card,index)).join('')||'<p class="bn-muted">No inventory cards added yet. Header-only notes can still be saved and previewed.</p>'}</section><div class="bn-toolbar">${button('＋ Add inventory card','BunchNote.openCardPicker()',state.busy)}${button('＋ Divider / instruction row',`BunchNote.insertDivider(${arg(location.location)})`,state.busy)}</div>${bulkToolbarMarkup(location)}`;
 }
 function syncSequenceCustomControls(location) {
  if(!location)return;for(const card of location.cards||[]){if(card.kind!=='inventory')continue;const article=sequenceCardNode(card.id),controls=article?.querySelector('.bn-sequence-controls');if(!controls)continue;
   const byFocus=key=>[...controls.querySelectorAll('[data-bn-focus-key]')].find(node=>node.dataset.bnFocusKey===key),action=byFocus(`card-action:${card.id}`);if(action?.tagName==='SELECT'&&!controls.querySelector(`[data-bn-custom-action="${card.id}"]`))action.closest('label').insertAdjacentHTML('beforeend',`<input data-bn-custom-action="${esc(card.id)}" aria-label="Custom action for ${esc(card.itemcode)}" value="${esc(workflowOptions.some(([value])=>value===card.workflow_action)?'':card.workflow_action||'')}" placeholder="Or type a custom action" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'workflow_action',this.value)">`);
   if(!byFocus(`card-direction:${card.id}`))controls.insertAdjacentHTML('beforeend',hybridField('Card direction',card.direction||location.direction||'',CREW_DIRECTIONS,`BunchNote.editCard(${arg(location.location)},${arg(card.id)},'direction',this.value)`,'Type or choose a direction',`card-direction:${card.id}`));
   const instructions=byFocus(`card-instructions:${card.id}`),instructionsListId=`bn-workflow-instructions-${String(card.id).replace(/[^a-zA-Z0-9_-]/g,'-')}`;if(instructions?.tagName==='TEXTAREA'&&!controls.querySelector(`[data-bn-workflow-choice="${card.id}"]`))instructions.closest('label').insertAdjacentHTML('beforeend',`<input data-bn-workflow-choice="${esc(card.id)}" list="${instructionsListId}" aria-label="Workflow instruction options for ${esc(card.itemcode)}" placeholder="Type or choose instructions" oninput="BunchNote.editCard(${arg(location.location)},${arg(card.id)},'workflow_instructions',this.value)"><datalist id="${instructionsListId}">${workflowInstructions().map(value=>`<option value="${esc(value)}"></option>`).join('')}</datalist>`);
   const actions=article.querySelector('.bn-sequence-actions');if(card.group_id&&actions&&!actions.querySelector('[data-select-card-group]')){const groupButton=document.createElement('button');groupButton.type='button';groupButton.className='bn-button';groupButton.dataset.selectCardGroup='true';groupButton.textContent='Edit group';groupButton.onclick=()=>root.BunchNote.selectCardGroup(location.location,card.id);actions.prepend(groupButton);}
  }
  updateBulkUi(location);
 }
 function cardPickerHtml(location,index) {
  const picker=state.cardPicker, groups=picker.groups||(picker.groups=cardPickerGroups(location,picker.sortBy)), selectedGroups=groups.filter(group=>(picker.selectedKeys||[]).includes(group.key));
  const matches=pickerMatches(picker), visibleMatches=matches, locked=state.busy||!!picker.committedId;
  const checkedOwnerIds=Array.isArray(picker.ownerIds)?picker.ownerIds:pickerDefaultOwnerIds(location,picker);
  const retainedAssignments=pickerAssignmentMarkup(location,picker,selectedGroups);
  return `<div class="bn-picker-backdrop" role="presentation" onclick="if(event.target===this)BunchNote.closeCardPicker()"><section class="bn-card-picker" data-bn-scroll-key="card-picker" role="dialog" aria-modal="true" aria-labelledby="bn-card-picker-title" tabindex="-1" onkeydown="if(event.key==='Escape'){event.preventDefault();BunchNote.closeCardPicker()}">
   <div class="bn-card-picker__heading"><div><span class="bn-eyebrow">${esc(location.location)}</span><h2 id="bn-card-picker-title" data-bn-picker-title>${selectedGroups.length?'Card routing and notes':'Search inventory'}</h2></div>${button('Close','BunchNote.closeCardPicker()',state.busy)}</div>
   ${picker.details&&selectedGroups.length?`${button('Back to card selection','BunchNote.showPickerDetails(false)',locked)}<fieldset class="bn-picker-editor" ${locked?'disabled':''}><p class="bn-muted" role="status" data-bn-picker-lot-status>${picker.rowIds.length} lot${picker.rowIds.length===1?'':'s'} selected</p>${selectedGroups.map(group=>`<fieldset class="bn-picker-lots" data-bn-scroll-key="picker-lots:${esc(encodeURIComponent(group.key))}" ${state.busy?'disabled':''}><legend>${esc(group.itemcode)} · ${esc(group.commonname)} · ${esc(group.contsize||'Size not specified')}</legend>${group.rows.map(row=>`<label class="bn-choice"><input type="checkbox" data-bn-picker-lot="${esc(row.unique_id)}" aria-label="Select lot ${esc(row.contsize)} ${esc(row.lotcode)} ${esc(row.unique_id)}" ${picker.rowIds.includes(row.unique_id)?'checked':''} onchange="BunchNote.togglePickerLot(${arg(row.unique_id)},this.checked);this.focus({preventScroll:true})"><span><b>${esc(row.contsize||'Size not specified')} · Lot ${esc(row.lotcode||'Unknown')}</b><small>On Hand ${esc(stock(row.stock))} · Available ${esc(stock(row.available))}</small></span></label>`).join('')}</fieldset>`).join('')}
    <div class="bn-mode-toggle" role="group" aria-label="Card grouping mode">${button('Group selected cards together',"BunchNote.setPickerGroupMode('group')",locked,picker.groupMode==='group')}${button('Individual cards',"BunchNote.setPickerGroupMode('individual')",locked,picker.groupMode==='individual')}</div>
    <label class="bn-field">Search users<input data-bn-focus-key="picker-user-search" value="${esc(picker.userSearch||'')}" oninput="BunchNote.pickerUserSearch(this.value)" placeholder="Type a name or username"></label><fieldset class="bn-picker-lots"><legend>Assign to users</legend><p class="bn-muted">Assignments update every selected card preview immediately.</p><ul class="bn-muted" data-bn-picker-assignments>${retainedAssignments}</ul>${picker.groupMode==='group'?pickerUserChoices(picker,checkedOwnerIds):'<p class="bn-muted">Set assigned users inside each card below.</p>'}</fieldset>
    ${picker.groupMode==='individual'?pickerIndividualMarkup(location,picker,selectedGroups):`<label class="bn-field">Action<select aria-label="Required card action" data-bn-focus-key="picker-action" onchange="BunchNote.pickerField('workflow_action',this.value)">${workflowOptions.map(([value,label])=>`<option value="${value}" ${picker.workflow_action===value?'selected':''}>${label}</option>`).join('')}</select><input aria-label="Custom card action" value="${esc(workflowOptions.some(([value])=>value===picker.workflow_action)?'':picker.workflow_action)}" placeholder="Or type a custom action" oninput="BunchNote.pickerField('workflow_action',this.value)"></label><div data-bn-picker-routing style="display:contents">${pickerRoutingMarkup(picker)}</div>${textfield('Card direction',picker.direction,"BunchNote.pickerField('direction',this.value)",state.busy)}${textfield('Card notes',picker.notes,"BunchNote.pickerField('notes',this.value)",state.busy)}${textfield('Workflow instructions',picker.workflow_instructions||'',"BunchNote.pickerField('workflow_instructions',this.value)",state.busy)}<div class="bn-chip-list">${CARD_ACTION_PHRASES.map(phrase=>`<button class="bn-chip" type="button" onclick="BunchNote.appendPickerPhrase(${arg(phrase)})">${esc(phrase)}</button>`).join('')}</div>`}
    </fieldset>${picker.committedId?'<p role="status">These cards are retained. Retry saving before making further edits.</p>':''}<div class="bn-picker-actions"><button type="button" class="bn-button" data-bn-picker-commit onclick="BunchNote.commitPickerCard()" ${pickerCommitDisabled(picker)?'disabled':''}>${picker.committedId?'Save cards and continue':'＋ Add selected card(s) and continue'}</button></div>`
    :`<label class="bn-field">Search inventory<input type="text" data-bn-focus-key="picker-search" data-bn-picker-search value="${esc(picker.search)}" oninput="BunchNote.cardPickerSearch(this.value)" ${state.busy?'disabled':''}></label><p class="bn-muted" role="status" aria-live="polite" data-bn-picker-result-count>${matches.length} ${matches.length===1?'card':'cards'} shown</p><div class="bn-picker-results" data-bn-scroll-key="picker-results" data-bn-picker-results role="list">${visibleMatches.map(group=>`<label class="bn-choice bn-picker-result"><input type="checkbox" data-bn-picker-card="${esc(group.key)}" aria-label="Select card ${esc(group.itemcode)} ${esc(group.commonname)}" ${(picker.selectedKeys||[]).includes(group.key)?'checked':''} onchange="BunchNote.togglePickerCard(${arg(group.key)},this.checked);this.focus({preventScroll:true})"><span><strong>${esc(group.commonname)} · ${esc(group.itemcode)}</strong><small>${esc(group.contsize||'Size not specified')} · ${group.rows.length} lot${group.rows.length===1?'':'s'}</small></span></label>`).join('')||'<p class="bn-muted">No verified inventory card matches this search.</p>'}</div><p class="bn-muted" role="status" data-bn-picker-selection-status>${selectedGroups.length} card${selectedGroups.length===1?'':'s'} selected</p><div class="bn-picker-actions"><button type="button" class="bn-button" data-bn-picker-continue onclick="BunchNote.showPickerDetails()" ${selectedGroups.length===0||state.busy?'disabled':''}>Continue to card details</button></div>`}
   </section></div>`;
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
  const t=state.targets[key],o=state.choiceSnapshots[key+':'+id]||state.options.find(o=>o.id===id&&o.active);if(!t||!o)throw new Error('This instruction is no longer available. Your work has been retained.');
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
  return `<h2 id="bn-action-editor-heading" tabindex="-1" data-bn-action-editor-heading>${esc(a.label||a.group)}</h2><p>${esc(state.location||state.detail?.job.location)} · ${esc([...new Set(rows.map(r=>r.itemcode))].join(', '))}</p><p class="bn-muted">${e.worker?'Additional work instruction':'Planned work'}</p>
   ${move&&groups.size>1?`<label class="bn-field">Source item and sales year<select aria-label="Source item and sales year" data-bn-focus-key="action-source:${esc(a.id)}" onchange="BunchNote.actionSource(this.value)"><option value="">Choose source lots / year</option>${[...groups].map(([key,rs])=>`<option value="${esc(key)}" ${sourceGroups(selected).size===1&&sourceGroups(selected).has(key)?'selected':''}>${esc(rs[0].itemcode)} · ${esc(salesYear(rs[0].salesyear)||'Unknown sales year')}</option>`).join('')}</select></label>`:''}
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
  const requiredRecipientIds=requiredBunchRecipientIds(draft?.body),requiredRecipientLabels=requiredBunchRecipientLabels(draft?.body);
  let html = draft ? '' : `<h2>Inv Bunch Notes</h2>${viewTabs()}<p class="bn-muted">Choose a block. Include and assign each inventory card independently; Move plans work without changing inventory.</p>`;
  if (!draft) {const saved=savedDraftLocations();const bar=`<section class="bn-saved-drafts-bar" aria-label="Saved Drafts"><b>Saved Drafts / Active Bunch Notes</b><div>${saved.map(item=>`<button type="button" onclick="BunchNote.openSavedLocation(${arg(item.id)},${arg(item.location)})">${esc(item.location)} (Draft)</button>`).join('')||'<span class="bn-muted">No saved drafts.</span>'}</div></section>`;return html + bar + `<h3>Block Alpha</h3><div class="bn-drill-grid">${state.blocks.map(b => drillCard(b, 'View locations', `BunchNote.chooseBlock(${arg(b)})`, 'block',saved.some(item=>item.block===b)?'DRAFT':'')).join('') || `<p>${state.busy ? 'Loading blocks…' : 'No blocks available.'}</p>`}</div>${catalogEditor()}<h3>Saved batches</h3><div class="bn-drill-grid">${state.drafts.map(d => drillCard(d.body?.block||d.block, `${d.body.locations.length} locations · ${new Date(d.updated_at||d.local_saved_at).toLocaleString()}`, `BunchNote.openDraft(${arg(d.id||d.local_id)})`, 'batch','SAVED')).join('') || '<p class="bn-muted">No saved batches.</p>'}</div>`;}
  html += `<nav class="bn-breadcrumb" aria-label="Bunch Note drill-down"><button type="button" onclick="BunchNote.backToBlocks()">Blocks</button><span aria-hidden="true">›</span><button type="button" onclick="BunchNote.backToLocations()">${esc(draft.body.block)}</button>${state.location?`<span aria-hidden="true">›</span><button type="button" aria-current="page">${esc(displayLocation(state.location))}</button>`:''}</nav>`;
  if (!state.location) {
   const locations=groupInventory(state.rows).get(normalize(draft.body.block))||new Map();
   html += `<section class="bn-location-list" aria-label="Source locations"><h3>Locations in ${esc(draft.body.block)}</h3><div class="bn-drill-grid">${[...locations].sort(([a],[b])=>a.localeCompare(b)).map(([location,rows])=>locationDrillCard(location,`${rows.length} inventory rows`)).join('')||'<p class="bn-muted">No locations in this block.</p>'}</div></section>`;
  } else {
   const i=draft.body.locations.findIndex(l => l.location === state.location), loc=draft.body.locations[i];
   if(loc && state.item) return html+plants(loc.source_all||loc.source||[],loc.row_ids,i)+button('Save draft','BunchNote.save()',state.busy);
   if(loc && state.locationStep==='setup') return html+locationSetupHtml(loc,i);
   if(loc && state.locationStep==='items') {const advancedOpen=state.panels.has('advanced-inventory:'+normalize(loc.location));return html+`<section class="bn-location-editor bn-wizard-items" aria-label="Inventory cards"><div class="bn-location-heading"><div><span class="bn-eyebrow">${esc(draft.body.block)} · ${esc(loc.location)}</span><h3>${esc(loc.work_type||loc.purposes)}</h3><p><b>Direction:</b> ${esc(loc.direction||'Not specified')}</p>${loc.instructions?`<p><b>Extra notes:</b> ${esc(loc.instructions)}</p>`:''}${loc.schedule_banner?`<p class="bn-schedule-banner"><b>Schedule:</b> ${esc(loc.schedule_banner)}</p>`:''}${loc.default_house_plan?`<p><b>Default House Plan:</b> ${esc(loc.default_house_plan)}</p>`:''}</div>${button('Edit header','BunchNote.editSetup()',state.busy)}</div>${sequentialEditor(loc)}<div class="bn-toolbar">${button('Save draft','BunchNote.save()',state.busy)}${button('Preview PDFs and recipients','BunchNote.preview()',state.busy)}</div><details class="bn-options" ${advancedOpen?'open':''} ontoggle="BunchNote.advancedInventoryPanel(${arg(loc.location)},this.open)"><summary data-bn-focus-key="advanced-inventory-toggle:${esc(normalize(loc.location))}">Advanced inventory and action controls</summary>${advancedOpen?`<div class="bn-options-body"><div data-bn-cards></div>${plants(loc.source_all||loc.source||[],loc.row_ids,i)}<details class="bn-options"><summary>Whole-location actions</summary>${draftActions(loc,i)}${actionChoices('location:'+i,loc.source_all||[],{index:i,worker:false,scope:'location'})}</details></div>`:''}</details></section>`;}
   if(loc && state.locationStep!=='items') html+=`<section class="bn-location-editor"><div class="bn-location-heading"><h3>${esc(loc.location)}</h3>${button('Edit location setup','BunchNote.editSetup()',state.busy)}</div><p>${esc(loc.purposes)}</p><h3>Items at this location</h3>`
    +`<div data-bn-structured="edit" data-index="${i}"></div>`+plants(loc.source_all||loc.source||[],loc.row_ids,i)
    +`<details class="bn-options" ${panelAttrs('actions:'+loc.location)}><summary>Whole-location actions<i class="ph-bold ph-caret-down"></i></summary>${draftActions(loc,i)}${actionChoices('location:'+i,loc.source_all||[],{index:i,worker:false,scope:'location'})}</details>`
    +button('Remove location from batch',`BunchNote.removeLocation(${arg(loc.location)})`,state.busy||!!draft.id&&draft.body.locations.length===1)+'</section>';
  }
  html += '<details class="bn-options"><summary>Instruction guidance from Bunch Notes <i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><div class="bn-options-body"><p>Use “Center house” for the house over the 4-inch line. Specify quantity or percentage, stage, destination, and whether crews should grade or row-run.</p><p>BOB, QC, SAM, RHETT, SHARON, MATT, BUNCHERS and TA are instruction labels. They do not assign users or select recipients.</p><p>Flags: blue = ship first; white = lesser quality; red = promo / worst quality; green = grow-on. Outside corner ribbons: yellow = water control; pink = overwinter outside; shift = haul for shift; shift + pink = outside for spring shift. Apply only where you explicitly choose.</p></div></details>';
  html += `<details class="bn-card bn-options" ${panelAttrs('recipients')}><summary>Email recipients · server required group included</summary><div class="bn-options-body"><p class="bn-muted">Always included by the server: ${esc(requiredRecipientLabels.join(', '))}. Card assignees are added automatically; optional selections below use profile IDs, and recipient email addresses are resolved by the server.</p>${state.users.filter(u => u.email).map(u => {const id=u.id||u.profile_id,required=requiredRecipientIds.has(id);return `<label class="bn-choice"><input type="checkbox" data-bn-focus-key="recipient:${esc(id)}" aria-label="Email recipient ${esc(u.display || u.username)}" ${required || draft.body.recipient_ids.includes(id) ? 'checked' : ''} ${required ? 'disabled' : ''} onchange="BunchNote.recipient(${arg(id)},this.checked);this.focus({preventScroll:true})"><span>${esc(u.display || u.username)}<small>${esc(required?'Required by server':'Optional recipient')}</small></span></label>`;}).join('')}</div></details>`;
  return html + destinationList() + `<p class="bn-muted">${draft.body.locations.length} locations in this batch</p><div class="bn-toolbar">` + button('Refresh source for review', 'BunchNote.refreshSource()', state.busy) + button('Save draft', 'BunchNote.save()', state.busy || !draft.body.locations.length) + button('Preview PDFs and recipients', 'BunchNote.preview()', state.busy || !draft.body.locations.length) + '</div>';
 }
 function previewHtml() {
  const p = state.preview;
  return `<h2>Review ${p.report_kind==='completed_work'?'Completed Work':'Inv Bunch Notes'} PDFs</h2><p>Recipients: ${p.recipients.map(r => esc(r.email)).join(', ')}</p>${state.urls.map((url, i) => `<section class="bn-card"><a href="${url}" target="_blank" rel="noopener">Open ${esc(p.pdfs[i].filename)}</a><iframe title="${esc(p.pdfs[i].filename)}" src="${url}" style="width:100%;height:60vh;border:1px solid #aaa"></iframe></section>`).join('')}`
   + (p.report_kind==='completed_work'&&!p.saved ? button('Save completed-work PDF','BunchNote.publishWork(false)',state.busy)+button('Save and email reviewed PDF','BunchNote.publishWork(true)',state.busy) : p.saved ? button('Email reviewed PDFs', 'BunchNote.sendSaved()', state.busy) : button('Publish to Assigned work', 'BunchNote.publish(false)', state.busy) + button('Publish and email reviewed PDFs', 'BunchNote.publish(true)', state.busy));
 }
 function queue() {
  if (!state.loaded && !state.loading && !state.error) void run(load);
  if (state.detail) return detailHtml();
  let html = '<h2>Inv Bunch Notes</h2>'+viewTabs()+'<p>Claim available cards or legacy location work. Assigned work is visible to its owner and Dylan.</p>';
  ['available','mine','completed', ...(author() ? ['all','cancelled'] : [])].forEach(filter => { html += button(({available:'Available',mine:'My Work',completed:'Completed',all:'All assignments',cancelled:'Canceled'})[filter], `BunchNote.filter(${arg(filter)})`, state.busy, state.filter === filter); });
  html += button('Refresh', 'BunchNote.refresh()');
  const uid = typeof nativeAuthProfile === 'undefined' ? '' : nativeAuthProfile?.id || '';
  const jobs = state.jobs.filter(j => state.filter === 'all' || (state.filter === 'available' ? j.status === 'open' && (j.cards?.length?j.cards.some(c=>c.status==='open'&&!cardOwnerIds(c).length):!j.owner_id) : state.filter === 'mine' ? j.status === 'open' && (j.cards?.length?j.cards.some(c=>c.status==='open'&&isCardAssignedTo(c,uid)):j.owner_id === uid) : state.filter === 'completed'&&j.cards?.length?j.cards.some(c=>c.status==='complete'&&(author()||isCardAssignedTo(c,uid))):j.status === (state.filter === 'completed' ? 'complete' : 'cancelled')));
  const names=[...new Set(jobs.map(j=>normalize(j.location)))], groups=locationGroups(names);
  if(!state.queueBase)return html+`<div class="bn-drill-grid">${[...groups].map(([base,codes])=>drillCard(base,`${codes.length} full locations`,`BunchNote.queueBase(${arg(base)})`,'location')).join('')||'<p>No work in this filter.</p>'}</div>`;
  if(!state.queueLocation)return html+`<h3>${esc(state.queueBase)}</h3><div class="bn-drill-grid">${(groups.get(state.queueBase)||[]).map(loc=>drillCard(loc,'Open location work',`BunchNote.queueLocation(${arg(loc)})`,'location')).join('')||'<p>No work in this location.</p>'}</div>`;
  return html + (!jobs.length ? '<p>No work in this filter.</p>' : jobs.filter(j=>normalize(j.location)===state.queueLocation).map(j => `<article class="bn-card"><h3>${esc(j.block)} → ${esc(j.location)}</h3><p>${esc(j.note_number)} · Revision ${j.instruction_revision} · ${esc(j.body.purposes)}</p><p>Priority: ${esc(j.body.priority || '—')} · ${Object.keys(j.progress).length}/${allActions(j).length} actions</p><p>Work: ${esc(j.status)} · Email: ${esc(j.delivery_status)}</p>${button('Open', `BunchNote.detail(${arg(j.id)})`)}</article>`).join(''));
 }
 function queueModeMarkup() {
  if (!author()) return '';
  return `<nav class="bn-toolbar bn-queue-mode" aria-label="Inv Bunch Notes mode">${button('Create note','BunchNote.setQueueMode(\'create\')',state.busy,state.queueMode==='create','bn-create-note-mode')}${button('Assigned work','BunchNote.setQueueMode(\'assigned\')',state.busy,state.queueMode==='assigned','bn-assigned-work-mode')}</nav>`;
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
  if (open && author() && !state.item && !j.card_id) html += `<label class="bn-field">Assign / reassign<select id="bn-owner" data-bn-focus-key="job-owner:${esc(j.id)}">${userOptions(j.owner_id)}</select></label>` + button('Apply assignment', `BunchNote.assign()`) + button('Revise instructions', `BunchNote.revise()`) + button('Cancel work', `BunchNote.cancel()`);
  if(!state.item)html += '<div data-bn-structured="read"></div>';
  html += plants(j.body.source || [],null,'work',j) + allActions(j).filter(a=>state.workAction ? a.id===state.workAction : state.item ? a.scope!=='location' && actionApplies(a,(j.body.source||[]).filter(r=>groupItems([r])[0]?.key===state.item)) : j.card_id||a.scope==='location').map(a => {
   const done=j.progress[a.id], actuals=currentActuals(j).filter(x=>x.action_id===a.id), key=j.id+':'+a.id, form=state.workForms[key]||{}, kind=actionKind(a);
   const lots=(j.body.source||[]).filter(r=>(a.scope==='location'||(a.row_ids||[]).includes(r.unique_id))&&(a.group!=='hauling'||shiftEligible(r)));
   const mayCorrect=(open&&owner)||(author()&&j.status==='complete');
   return `<article class="bn-card" data-bn-work-action="${esc(a.id)}"><h3>${esc(a.label || a.crew || a.group)}${a.worker_added?' · Added by worker':''}</h3><p class="bn-pre">${esc(a.instructions)}</p><p>${esc(a.scope==='location'?'Whole location':(a.row_ids||[]).map(id=>{const r=(j.body.source||[]).find(r=>r.unique_id===id);return r?[r.itemcode,r.contsize,r.lotcode].join(' / '):id;}).join('; '))}</p><p>Planned quantity ${esc(a.quantity || '—')} · % ${esc(a.percentage || '—')} · ${esc(a.stage || '')} · ${esc(a.destination || '')} · ${esc(a.marking || '')}</p>
    <p><b>Recorded ${actuals.length?actuals.reduce((sum,x)=>sum+Number(x.quantity),0):'Not recorded'} ${esc(kind==='instruction'?'':kind.toUpperCase())}</b></p>${actuals.map(x=>`<div class="bn-lot"><b>${esc(x.quantity)} · ${esc(x.source_snapshot.contsize)} · Lot ${esc(x.source_snapshot.lotcode)}</b><p>${esc(x.destination ? 'To '+x.destination : '')}</p><p>${esc(x.explanation)}</p>${x.review_flags.length?'<strong class="bn-review">Review: '+esc(reviewText(x.review_flags))+'</strong>':''}${x.replaces_id?'<small>Audited correction</small>':''}${mayCorrect?button('Correct entry',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</div>`).join('')}
    ${open&&owner&&['ta','move','hauling'].includes(kind)?`<details class="bn-options" ${panelAttrs('actual:'+a.id)}><summary>Record ${esc(kind.toUpperCase())} / partial work</summary><div class="bn-options-body"><label class="bn-field">Container size and lot<select aria-label="Container size and lot" data-bn-focus-key="work-source:${esc(a.id)}" onchange="BunchNote.workField(${arg(key)},'source_id',this.value)"><option value="">Choose size and lot</option>${lots.map(r=>`<option value="${esc(r.unique_id)}" ${form.source_id===r.unique_id?'selected':''}>${esc([r.contsize,r.lotcode,r.salesyear||'Unknown sales year',r.season,r.unique_id].join(' · '))}</option>`).join('')}</select></label>${field('Actual quantity',form.quantity||'',`BunchNote.workField(${arg(key)},'quantity',this.value)`,'number')}${kind!=='ta'?field('Moved to',form.destination||'',`BunchNote.workField(${arg(key)},'destination',this.value)`)+button('Choose destination',`BunchNote.chooseDestination('actual',${arg(key)})`,state.busy||!form.source_id):''}${textfield('Explanation / review note',form.explanation||'',`BunchNote.workField(${arg(key)},'explanation',this.value)`)}${button('Record entry',`BunchNote.recordActual(${arg(a.id)})`,state.busy)}</div></details>`:''}
    <b>${esc(done?.status || 'Pending')}</b><p>${esc(done?.reason || '')}</p>${done?.review_flags?.length?'<p class="bn-review">Review: '+esc(reviewText(done.review_flags))+'</p>':''}${open&&owner?textfield('Completion / variance reason',form.reason||'',`BunchNote.workField(${arg(key)},'reason',this.value)`)+button('Done',`BunchNote.progress(${arg(a.id)},'done')`,state.busy)+button('Not needed',`BunchNote.progress(${arg(a.id)},'not_needed')`,state.busy):''}</article>`;
  }).join('');
  if(state.item)return html;
  if (open && owner) html += button(j.card_id?'Complete card':'Complete location', j.card_id?`BunchNote.cardCommand('complete_card',${arg(j.card_id)})`:`BunchNote.command('complete')`, state.busy || allActions(j).some(a=>!j.progress[a.id]));
  if (state.detail.job.status==='complete' && author()) html += `<details class="bn-card bn-options" ${panelAttrs('work-report')}><summary>Completed-work PDF and recipients</summary><div class="bn-options-body">${state.users.filter(u=>u.email).map(u=>`<label class="bn-choice"><input type="checkbox" data-bn-focus-key="work-recipient:${esc(u.id)}" aria-label="Completed work email recipient ${esc(u.display || u.username)}" ${u.username==='dylan_collyge'||state.workRecipients.includes(u.id)?'checked':''} ${u.username==='dylan_collyge'?'disabled':''} onchange="BunchNote.workRecipient(${arg(u.id)},this.checked);this.focus({preventScroll:true})"><span>${esc(u.display || u.username)}<small>${esc(u.email)}</small></span></label>`).join('')}${button('Preview completed-work PDF','BunchNote.previewWork()',state.busy)}</div></details>`;
  if(!j.card_id||author())html += `<h3>Completed-work PDFs</h3>${(state.detail.work_reports||[]).map(v=>`<p>Work revision ${v.job_revision} · Email ${esc(v.delivery_status)} ${button('Open completed-work PDF',`BunchNote.workPdf(${arg(v.preview_id)})`)}${author()&&['not_sent','failed','unknown','sending'].includes(v.delivery_status)?button(v.delivery_status==='not_sent'?'Review and send':v.delivery_status==='failed'?'Retry delivery':'Reconcile delivery',`BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`):''}</p>`).join('')}`;
  html += `<details class="bn-options"><summary>Actual entry and correction history (${(j.actuals||[]).length})</summary>${(j.actuals||[]).map(x=>`<p>${esc(x.created_at)} · ${esc(x.action_snapshot.label || x.action_snapshot.instructions)} · ${esc(x.source_snapshot.contsize)} / ${esc(x.source_snapshot.lotcode)} · ${esc(x.quantity)} · ${esc(x.destination)} · ${x.superseded?'Replaced by correction':'Current'} · ${esc(x.explanation)}${!x.superseded&&((open&&owner)||(author()&&j.status==='complete'))?button('Amend recorded work',`BunchNote.correctActual(${arg(x.id)})`,state.busy):''}</p>`).join('')}</details>` + destinationList();
  if(!j.card_id||author())html += `<h3>PDF revisions</h3>${versions.map(v => `<p>Revision ${v.instruction_revision} · Email ${esc(v.delivery_status)} ${button('Open PDF', `BunchNote.pdf(${v.instruction_revision})`)}${author() && ['not_sent','failed','unknown','sending'].includes(v.delivery_status) ? button(v.delivery_status === 'not_sent' ? 'Review and send' : v.delivery_status === 'failed' ? 'Retry delivery' : 'Reconcile delivery', `BunchNote.delivery(${arg(v.preview_id)},${arg(v.delivery_status)})`) : ''}</p>`).join('')}`;
  return html + `<details><summary>History (${audit.length})</summary>${audit.map(a => `<p>${esc(a.created_at)} · ${esc(a.operation)} · ${esc(JSON.stringify(a.detail))}</p>`).join('')}</details>`;
 }
 function renderSearch(label,value) {render();const input=[...document.querySelectorAll('.bn-field input')].find(el=>el.parentElement.textContent.trim()===label);if(input){input.focus({preventScroll:true});input.setSelectionRange(value.length,value.length);}}
 function navigationKey() { return JSON.stringify([typeof getCurrentVisibleViewId==='function'?getCurrentVisibleViewId():'',state.screen,state.locationStep,state.actionEdit?.id,state.customEdit?.category,state.draft?.body.block,state.base,state.location,state.queueBase,state.queueLocation,state.detail?.job.id,state.workCard,state.item,state.destinationBase,state.destinationLocation,state.picker?.kind,state.picker?.key,state.picker?.base,state.picker?.tab]); }
 function rememberScroll() { state.scrolls.set(navigationKey(),typeof getMainAreaScrollTop==='function'?getMainAreaScrollTop():(root.scrollY||0)); }
 function restoreScroll() { if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>typeof setMainAreaScrollTop==='function'?setMainAreaScrollTop(state.scrolls.get(navigationKey())||0):root.scrollTo?.(0,state.scrolls.get(navigationKey())||0)); }
 function revealActionEditor(actionId, owner, epoch) {
  if(typeof requestAnimationFrame!=='function')return;
  requestAnimationFrame(()=>{
   if(state.account!==owner||state.epoch!==epoch||state.actionEdit?.id!==actionId)return;
   if(typeof getCurrentVisibleViewId==='function'&&getCurrentVisibleViewId()!=='bunch-note')return;
   const heading=document.querySelector?.('#bn-action-editor-heading');
   const mainArea=document.getElementById?.('main-scroll-area');
   if(!heading||!mainArea||typeof setMainAreaScrollTop!=='function')return;
   try{heading.focus?.({preventScroll:true});}catch(error){}
   const delta=heading.getBoundingClientRect().top-mainArea.getBoundingClientRect().top;
   setMainAreaScrollTop(Math.max(0,(typeof getMainAreaScrollTop==='function'?getMainAreaScrollTop():mainArea.scrollTop||0)+delta));
  });
 }
 function viewTabs() { return `<div class="bn-toolbar bn-source-tabs">${button('Source locations',"BunchNote.view('source')",state.busy,state.screen==='source')}${button('By Destination',"BunchNote.view('destinations')",state.busy,state.screen==='destinations')}</div>`; }
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
  if(state.cardPicker)state.cardPicker=null;
  else if(state.picker){if(state.picker.base)state.picker.base='';else state.picker=null;}
  else if(state.preview){root.BunchNote.closePreview();return true;}
  else if(state.screen==='destinations'){if(state.destinationLocation){state.destinationLocation='';state.destinationData=null;}else if(state.destinationBase)state.destinationBase='';else state.screen='source';}
  else if(state.customEdit)state.customEdit=null;
  else if(state.actionEdit)state.actionEdit=null;
  else if(state.item||state.workAction){state.item='';state.workAction='';}
  else if(state.workCard){state.workCard='';state.item='';}
  else if(state.detail)state.detail=null;
  else if(state.queueMode==='assigned'){if(state.queueLocation)state.queueLocation='';else if(state.queueBase)state.queueBase='';else return false;}
  else if(state.location){state.location='';state.locationStep='setup';}
  else if(state.base)state.base='';
  else if(state.draft){void root.BunchNote.backEditor();return true;}
  else return false;
  render();restoreScroll();return true;
 }
 const destinationList = () => '';
 const destinationField = (label,value,action) => `<label class="bn-field">${esc(label)}<input list="bn-destinations" value="${esc(value)}" oninput="${action}" placeholder="Search or type a location"></label>`;
 const actionFromOption = (o,ids,scope='rows') => ({id:crypto.randomUUID(),option_id:o.id,group:o.category,label:o.label,kind:o.kind,instructions:o.instructions||o.label,scope,row_ids:ids,quantity:'',percentage:'',crew:'',stage:'',destination:'',marking:''});
 async function refreshCatalog() { const c=await api('catalog'); state.options=c.options; state.destinations=c.locations; }
 async function preparePdf(p) {
  const owner=state, pdf=await api('pdf_preview',{preview_id:p.id});
  if(owner!==state)return;
  if(!Array.isArray(pdf?.pdfs)||!pdf.pdfs.length)throw new Error(pdf?.message||'PDF preview failed.');
  state.preview={...p,pdfs:pdf.pdfs}; showPdfs(pdf.pdfs);
 }
 function render(retainedPosition=null) {
  ensureAccount();
  const view = typeof getCurrentVisibleViewId === 'function' ? getCurrentVisibleViewId() : '';
  const container = view === 'bunch-note' ? document.getElementById('bunch-note-content') : null;
  if (!container || !account()) { if(state.cardPicker){state.cardPicker=null;renderPickerPortal('');} return; }
  container.classList.add('bn-root');
  container.ontouchmove = root.BunchNote?.blurActiveInput || null;
  if((state.actionEdit?.worker||state.customEdit&&state.targets[state.customEdit.key]?.worker||state.picker?.kind==='actual')&&(!state.detail?.job||state.detail.job.status!=='open'||workJob()?.owner_id!==nativeAuthProfile?.id)){
   state.actionEdit=null;state.customEdit=null;state.picker=null;state.pendingActions={};state.item='';
  }
  const locationIndex=state.draft?.body.locations.findIndex(location=>location.location===state.location)??-1;
  const currentLocation=locationIndex>=0?state.draft.body.locations[locationIndex]:null;
  if (author() && state.queueMode === 'create' && !state.metadataLoaded && !state.metadataLoading && !state.busy && !state.error) void open({refresh:false});
  const modeMarkup = queueModeMarkup();
  const pickerMarkup=state.cardPicker&&currentLocation?cardPickerHtml(currentLocation,locationIndex):'';
  const canPortalPicker=typeof document.createElement==='function'&&!!document.body?.appendChild;
  const contentMarkup = state.cardPicker&&currentLocation?editor()+(canPortalPicker?'':pickerMarkup) : state.picker ? pickerHtml() : state.customEdit ? customEditor() : state.actionEdit ? actionEditor() : state.preview ? previewHtml() : state.screen==='destinations' ? destinationsHtml() : author() && state.queueMode === 'create' ? editor() : queue();
  const markup = (state.error ? `<p role="alert">${esc(state.error)}</p>` : '') + modeMarkup + contentMarkup;
  const renderSignature=JSON.stringify([markup,pickerMarkup]);
  const busy = String(state.busy);
  // A live list commit may land between touchstart and click. Replacing an
  // unchanged queue drops that in-flight tap. Compare intended markup and
  // owned child nodes: shell decoration adds classes and replaces icons.
  const previous = renderedQueues.get(container);
  if (previous?.markup === renderSignature && previous.busy === busy
    && previous.nodes.length === container.childNodes.length
    && previous.nodes.every((node, index) => node === container.childNodes[index])) { renderPickerPortal(canPortalPicker?pickerMarkup:'',retainedPosition);syncSequenceCustomControls(currentLocation);void mountStructured(container); return; }
  const boardHost=markup.includes('data-bn-cards')?container.querySelector?.('[data-bn-cards]'):null;
  const boardHandle=boardHost&&structuredHandles.get(boardHost);
  if(boardHandle)structuredHandles.delete(boardHost);
  const uiPosition=retainedPosition||captureUiPosition(container,pickerPortalHost);
  disposeView({preservePicker:true});
  container.innerHTML = markup;
  if(boardHandle){container.querySelector('[data-bn-cards]').replaceWith(boardHost);structuredHandles.set(boardHost,boardHandle);boardHandle.update(cardBoardProps());}
  renderPickerPortal(canPortalPicker?pickerMarkup:'',uiPosition);
  syncSequenceCustomControls(currentLocation);
  container.setAttribute('aria-busy', busy);
  if (state.busy) container.querySelectorAll('input,select,textarea,button').forEach(control => { if (!control.closest?.('[data-bn-cards]')) control.disabled = true; });
  renderedQueues.set(container, {markup:renderSignature, nodes: Array.from(container.childNodes), busy});
  restoreUiPosition(uiPosition,container,pickerPortalHost);
  void mountStructured(container);
}
 const invalidate = () => { state.preview = null; state.urls.forEach(url => URL.revokeObjectURL(url)); state.urls = []; queueMicrotask(scheduleDraftAutoSave); };
 function routeToAssignedWork() {
  state.queueMode = 'assigned'; state.screen = 'source'; state.detail = null; state.item = ''; state.queueBase = ''; state.queueLocation = '';
  state.loaded = false; state.jobs = [];
  if ((typeof getCurrentVisibleViewId !== 'function' || getCurrentVisibleViewId() !== 'bunch-note') && typeof switchView === 'function') switchView('bunch-note');
  else render();
 }
 async function saveDraft() {
  prepareDraftCards();const d = state.draft;
  const result = await api('save', {batch_id: d.id, body: d.body}, d.revision, crypto.randomUUID());
  removeLocalDraft(d);state.draft = result.draft;normalizeDraftBody(state.draft.body);for(const location of state.draft.body.locations)location.source_all=state.rows.filter(row=>normalizeBunchNoteLocationKey(row.locationcode)===normalizeBunchNoteLocationKey(location.location));persistLocalDraft(state.draft);state.drafts=mergePersistedDrafts([state.draft,...state.drafts.filter(item=>item.id!==state.draft.id)]);state.boardState={...state.boardState,cardForms:{},dirtyCardIds:[],cardErrors:{},rejectedCardIds:[]};
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
  prepareCards, cardKey, changeCard, moveCard, workJob, actionProblem, templates, normalize, normalizeBunchNoteLocationKey, baseLocation, locationGroups, salesYear, sourceGroups, quantity, groupInventory, groupItems, shiftEligible, actionKind, recipientEmails, mergeStructuredHeaderValue, api, render, reset, open, author, back, disposeView,
  queueBase: value => {rememberScroll();state.queueBase=value;render();restoreScroll();},
  queueLocation: value => {rememberScroll();state.queueLocation=value;render();restoreScroll();},
  hasBack: () => !!(state.actionEdit||state.customEdit||state.cardPicker||state.picker||state.preview||state.item||state.detail||state.draft||state.queueBase||state.screen==='destinations'),
  blurActiveInput: () => {const active=typeof document!=='undefined'?document.activeElement:null;if(active&&/^(?:INPUT|TEXTAREA|SELECT)$/.test(active.tagName||''))active.blur?.();},
  toggleSuggestion: key => {root.BunchNote.blurActiveInput();state.customSuggestion='';state.suggestionMenu=state.suggestionMenu===key?'':key;render();},
  selectSuggestion: (key,value) => {root.BunchNote.wizardField(key,value);state.suggestionMenu='';state.customSuggestion='';render();},
  openCustomSuggestion: key => {state.suggestionMenu='';state.customSuggestion=key;render();if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>document.querySelector?.(`[data-bn-focus-key="suggestion:${key}"]`)?.focus({preventScroll:true}));},
  suggestionInput: (key,value) => root.BunchNote.wizardField(key,value),
  backToBlocks: () => {state.draft=null;state.location='';state.locationStep='setup';state.suggestionMenu='';state.customSuggestion='';render();},
  backToLocations: () => {state.location='';state.locationStep='setup';state.suggestionMenu='';state.customSuggestion='';render();},
  wizardField: (fieldName,value) => {const location=state.draft?.body.locations.find(location=>location.location===state.location);if(!location||!author())return;invalidate();clearError();const text=String(value??'');if(fieldName==='workType'){location.work_type=text;location.purposes=text;return;}const key={direction:'direction',notes:'instructions',purpose_thread:'purpose_thread',default_house_plan:'default_house_plan',schedule_banner:'schedule_banner'}[fieldName];if(key)location[key]=text;},
  insertRuleChip: chip => {root.BunchNote.blurActiveInput();const location=state.draft?.body.locations.find(location=>location.location===state.location);if(!location||!author()||!HEADER_RULE_CHIPS.includes(chip))return;invalidate();const rules=new Set(Array.isArray(location.rule_chips)?location.rule_chips:[]);if(rules.has(chip))rules.delete(chip);else rules.add(chip);location.rule_chips=[...rules];const existing=String(location.instructions||'').split('\n').filter(line=>!HEADER_RULE_CHIPS.includes(line));location.instructions=[...existing,...location.rule_chips].filter(Boolean).join('\n');render();},
  nextItems: () => run(async()=>{const l=state.draft.body.locations.find(l=>l.location===state.location);if(!l.purposes?.trim())throw new Error('Enter a work type for this location.');await saveDraft();rememberScroll();state.locationStep='items';restoreScroll();}),
  openCardPicker: () => {if(state.busy||!author()||!state.draft||state.locationStep!=='items')return;const location=state.draft.body.locations.find(location=>location.location===state.location);if(!location)return;rememberScroll();state.cardPicker={search:'',userSearch:'',sortBy:'commonname',groupMode:'group',cardDrafts:{},destination_search:'',selectedKeys:[],rowIds:[],ownerIds:null,direction:location.direction||'',workflow_action:'',destination_location:'',destination_qualifier:'',destination_house:'',notes:'',workflow_instructions:'',committedId:'',groups:cardPickerGroups(location,'commonname')};render();restoreScroll();if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>document.querySelector?.('.bn-card-picker .bn-field input')?.focus({preventScroll:true}));},
  closeCardPicker: () => {if(state.busy)return;state.cardPicker=null;render();restoreScroll();if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>document.querySelector?.('.bn-wizard-items button[onclick="BunchNote.openCardPicker()"]')?.focus({preventScroll:true}));},
  cardPickerSearch: value => {if(!state.cardPicker||state.busy)return;state.cardPicker.search=String(value??'');pickerResultMarkup(state.cardPicker);},
  sortPickerCards: sortBy => {const picker=state.cardPicker,location=state.draft?.body.locations.find(item=>item.location===state.location);if(!picker||!location||!['commonname','itemcode'].includes(sortBy))return;picker.sortBy=sortBy;picker.groups=cardPickerGroups(location,sortBy);pickerResultMarkup(picker);},
  selectAllPickerCards: () => {const picker=state.cardPicker;if(!picker||state.busy)return;for(const group of pickerMatches(picker))root.BunchNote.togglePickerCard(group.key,true);pickerResultMarkup(picker);},
  clearPickerCards: () => {const picker=state.cardPicker;if(!picker||state.busy)return;picker.selectedKeys=[];picker.rowIds=[];picker.cardDrafts={};pickerResultMarkup(picker);},
  selectPickerCard: key => {root.BunchNote.togglePickerCard(key,true);},
  togglePickerCard: (key,included) => {const picker=state.cardPicker,group=picker?.groups?.find(item=>item.key===key);if(!picker||!group||state.busy)return;const location=state.draft?.body.locations.find(item=>item.location===state.location),existing=location?.cards.find(card=>card.kind==='inventory'&&cardKey(card)===key),selected=new Set(picker.selectedKeys||[]),ids=new Set(picker.rowIds||[]),firstSelection=included&&selected.size===0;if(included){selected.add(key);for(const id of existing?.row_ids||group.rows.map(row=>row.unique_id))ids.add(id);if(existing&&firstSelection){picker.workflow_action=existing.workflow_action||'';picker.destination_location=existing.destination_location||'';picker.destination_qualifier=existing.destination_qualifier||'';picker.workflow_instructions=existing.workflow_instructions||'';picker.destination_house=existing.destination_house||'';picker.notes=existing.notes||cardNotesAction(location,existing.id)?.instructions||'';picker.direction=existing.direction||picker.direction;}}else{selected.delete(key);for(const row of group.rows)ids.delete(row.unique_id);}picker.selectedKeys=[...selected];picker.rowIds=[...ids];for(const input of pickerPortalHost?.querySelectorAll('[data-bn-picker-card]')||[])if(input.dataset.bnPickerCard===key)input.checked=included;updatePickerSelectionUi();},
  showPickerDetails: (open=true) => {if(!state.cardPicker?.selectedKeys?.length)return;state.cardPicker.details=!!open;render();},
  togglePickerLot: (id,included) => {const picker=state.cardPicker,location=state.draft?.body.locations.find(location=>location.location===state.location);if(!picker||!location||state.busy)return;const allowed=new Set((location.source_all||[]).map(row=>row.unique_id));if(!allowed.has(id))return;picker.rowIds=included?[...new Set([...picker.rowIds,id])]:picker.rowIds.filter(value=>value!==id);for(const input of pickerPortalHost?.querySelectorAll('[data-bn-picker-lot]')||[])if(input.dataset.bnPickerLot===id)input.checked=included;updatePickerCommitUi();},
  togglePickerOwner: (id,included) => {const picker=state.cardPicker,location=state.draft?.body.locations.find(item=>item.location===state.location);if(!picker||!location||state.busy||!state.users.some(user=>user.id===id))return;const selected=Array.isArray(picker.ownerIds)?picker.ownerIds:pickerDefaultOwnerIds(location,picker);picker.ownerIds=included?[...new Set([...selected,id])]:selected.filter(value=>value!==id);for(const input of pickerPortalHost?.querySelectorAll('[data-bn-picker-owner]')||[])if(input.dataset.bnPickerOwner===id)input.checked=included;updatePickerAssignments();},
  pickerUserSearch: value => {const picker=state.cardPicker;if(!picker||state.busy)return;picker.userSearch=String(value??'');render();},
  setPickerGroupMode: mode => {const picker=state.cardPicker;if(!picker||state.busy||!['group','individual'].includes(mode))return;picker.groupMode=mode;render();},
  pickerCardField: (key,fieldName,value) => {const picker=state.cardPicker,location=state.draft?.body.locations.find(item=>item.location===state.location),group=picker?.groups?.find(item=>item.key===key);if(!picker||!location||!group||state.busy||!['workflow_action','direction','destination','notes','workflow_instructions'].includes(fieldName))return;const draft=pickerCardDraft(location,picker,group),next=String(value??'');if(fieldName==='destination'){draft.destination_location=next;draft.destination_house=next;}else draft[fieldName]=next;updatePickerCommitUi();},
  togglePickerCardOwner: (key,id,included) => {const picker=state.cardPicker,location=state.draft?.body.locations.find(item=>item.location===state.location),group=picker?.groups?.find(item=>item.key===key);if(!picker||!location||!group||state.busy||!state.users.some(user=>user.id===id))return;const draft=pickerCardDraft(location,picker,group);draft.ownerIds=included?[...new Set([...draft.ownerIds,id])]:draft.ownerIds.filter(value=>value!==id);updatePickerAssignments();},
  insertDivider: (locationCode,text='') => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode));if(!location||!author())return;invalidate();location.cards.push({id:crypto.randomUUID(),kind:'divider',text:String(text||'Divider / instruction'),left_margin:''});render();},
  editDivider: (locationCode,id,key,value) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),row=location?.cards.find(item=>item.kind==='divider'&&item.id===id);if(!location||!row||!author()||!['text','left_margin'].includes(key))return;invalidate();row[key]=String(value??'');},
  editCard: (locationCode,id,key,value) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id);if(!card||!['workflow_action','direction','destination_qualifier','destination_house','left_margin','notes','workflow_instructions','destination_search'].includes(key))return;if(key==='destination_search'){const shown=String(value??'');state.cardDestinationSearch={...state.cardDestinationSearch,[id]:shown};card.destination_location=resolveDestination(shown,card.destination_location)||shown.trim()||null;card.destination_qualifier='';invalidate();updateSequenceCardUi(location,card);return;}invalidate();card[key]=String(value??'');if(key==='workflow_action'&&value!=='move'){card.destination_location=null;card.destination_qualifier='';delete state.cardDestinationSearch[id];}if(key==='workflow_action'&&value!=='bunch')card.destination_house=null;if(key==='notes'){const old=cardNotesAction(location,id);if(old)old.instructions=String(value??'');else card.notes=String(value??'');}updateSequenceCardUi(location,card,{routing:key==='workflow_action',fields:key==='direction'});},
  setCardDestination: (locationCode,id,display) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id),shown=String(display||'').trim(),choice=destinationChoices().find(item=>item.display===shown||item.codes.includes(normalize(shown)));if(!card||!shown)return;invalidate();state.cardDestinationSearch={...state.cardDestinationSearch,[id]:choice?.display||shown};card.destination_location=resolveDestination(shown,card.destination_location)||shown;refreshSequenceDestinationChoice(card);updateSequenceCardUi(location,card);},
  setCardDestinationFull: (locationCode,id,value,select=null) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id),full=normalize(value),display=state.cardDestinationSearch?.[id]||displayLocation(card?.destination_location||'');if(!card||!destinationChoices().find(choice=>choice.display===normalize(display))?.codes.includes(full))return;invalidate();card.destination_location=full;state.cardDestinationSearch={...state.cardDestinationSearch,[id]:display};if(select?.isConnected)select.value=full;else refreshSequenceDestinationChoice(card);updateSequenceCardUi(location,card);},
  editCardOwners: (locationCode,id,select) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id);if(!card||!author())return;invalidate();card.owner_ids=[...select.selectedOptions].map(option=>option.value).filter(value=>state.users.some(user=>user.id===value));card.owner_id=card.owner_ids[0]||null;},
  appendCardPhrase: (locationCode,id,phrase) => {if(!CARD_ACTION_PHRASES.includes(phrase))return;const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id);if(!card)return;card.workflow_instructions=[card.workflow_instructions,phrase].filter(Boolean).join('\n');invalidate();updateSequenceCardUi(location,card,{fields:true});},
  removeSequenceRow: (locationCode,id) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode));if(!location||!author())return;invalidate();location.cards=location.cards.filter(card=>card.id!==id);state.bulkSelection=state.bulkSelection.filter(value=>value!==id);render();},
  reorderCard: (locationCode,id,delta) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode));if(!location||!author())return;const index=location.cards.findIndex(card=>card.id===id),next=index+Number(delta);if(index<0||next<0||next>=location.cards.length)return;invalidate();[location.cards[index],location.cards[next]]=[location.cards[next],location.cards[index]];render();},
  toggleSequenceCard: (locationCode,id,included) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id);if(!location||!card)return;state.bulkSelection=included?[...new Set([...state.bulkSelection,id])]:state.bulkSelection.filter(value=>value!==id);const article=sequenceCardNode(id),checkbox=article?.querySelector('input[aria-label^="Select "][aria-label$=" for bulk edit"]');if(checkbox)checkbox.checked=included;updateBulkUi(location);},
  selectCardGroup: (locationCode,id) => {const location=state.draft?.body.locations.find(item=>item.location===normalize(locationCode)),card=location?.cards.find(item=>item.kind==='inventory'&&item.id===id);if(!location||!card?.group_id)return;state.bulkSelection=location.cards.filter(item=>item.kind==='inventory'&&item.group_id===card.group_id).map(item=>item.id);render();},
  groupSelectedCards: () => {const location=state.draft?.body.locations.find(item=>item.location===state.location);if(!location||state.bulkSelection.length<2)return;setCardGroup(location,state.bulkSelection,true);render();},
  ungroupSelectedCards: () => {const location=state.draft?.body.locations.find(item=>item.location===state.location);if(!location||!state.bulkSelection.length)return;setCardGroup(location,state.bulkSelection,false);render();},
  setBulk: (key,value) => {if(key==='workflow_action'){state.bulkAction=String(value??'');state.bulkActionTouched=true;updateBulkUi(state.draft?.body.locations.find(item=>item.location===state.location),{routing:true});}else if(key==='left_margin')state.bulkMargin=String(value??'');else if(key==='notes_append')state.bulkAppend=String(value??'');else if(key==='destination'){const shown=String(value??'');state.bulkDestinationSearch=shown;state.bulkDestination=resolveDestination(shown,state.bulkDestination)||shown.trim();refreshBulkDestinationChoice();}else if(key==='qualifier')state.bulkQualifier=String(value??'');else if(key==='house')state.bulkHouse=String(value??'');updateBulkUi(state.draft?.body.locations.find(item=>item.location===state.location));},
  setBulkDestination: display => {const shown=String(display||'').trim(),choice=destinationChoices().find(item=>item.display===shown||item.codes.includes(normalize(shown)));if(!shown)return;state.bulkDestinationSearch=choice?.display||shown;state.bulkDestination=resolveDestination(shown,state.bulkDestination)||shown;refreshBulkDestinationChoice();updateBulkUi(state.draft?.body.locations.find(item=>item.location===state.location));},
  setBulkDestinationFull: (value,select=null) => {const full=normalize(value),choice=destinationChoices().find(item=>item.display===normalize(state.bulkDestinationSearch));if(choice?.codes.includes(full)){state.bulkDestination=full;if(select?.isConnected)select.value=full;else refreshBulkDestinationChoice();updateBulkUi(state.draft?.body.locations.find(item=>item.location===state.location));}},
  setBulkOwners: select => {state.bulkOwnerIds=[...select.selectedOptions].map(option=>option.value).filter(id=>state.users.some(user=>user.id===id));state.bulkOwnersTouched=true;for(const option of select.options)option.selected=state.bulkOwnerIds.includes(option.value);},
  bulkUpdateCards: (field,value) => {if(field==='notes_append')state.bulkAppend=String(value??'');else if(field==='workflow_action')state.bulkAction=String(value??'');else if(field==='left_margin')state.bulkMargin=String(value??'');root.BunchNote.applyBulk();},
  applyBulk: () => {const location=state.draft?.body.locations.find(item=>item.location===state.location);if(!location||!author())return;const selected=new Set(state.bulkSelection);for(const card of location.cards){if(card.kind!=='inventory'||!selected.has(card.id))continue;if(state.bulkActionTouched){if(state.bulkAction==='move'&&!state.bulkDestination.trim())throw new Error('Enter a Move destination before applying bulk routing.');if(state.bulkAction==='bunch'&&!state.bulkHouse.trim())throw new Error('Enter a Bunch house before applying bulk routing.');card.workflow_action=state.bulkAction;if(state.bulkAction==='move'){card.destination_location=state.bulkDestination;card.destination_qualifier=state.bulkQualifier;}else{card.destination_location=null;card.destination_qualifier='';}if(state.bulkAction==='bunch')card.destination_house=state.bulkHouse;else card.destination_house=null;}if(state.bulkOwnersTouched){card.owner_ids=[...state.bulkOwnerIds];card.owner_id=card.owner_ids[0]||null;}if(state.bulkMargin)card.left_margin=state.bulkMargin;if(state.bulkAppend){const old=cardNotesAction(location,card.id);if(old)old.instructions=[old.instructions,state.bulkAppend].filter(Boolean).join('\n');else card.notes=[card.notes,state.bulkAppend].filter(Boolean).join('\n');}updateSequenceCardUi(location,card,{routing:state.bulkActionTouched,owners:state.bulkOwnersTouched,fields:true});}invalidate();for(const id of state.bulkSelection){const article=sequenceCardNode(id),checkbox=article?.querySelector('input[aria-label^="Select "][aria-label$=" for bulk edit"]');if(checkbox)checkbox.checked=false;}state.bulkSelection=[];state.bulkAction='';state.bulkOwnerIds=[];state.bulkOwnersTouched=false;state.bulkActionTouched=false;state.bulkDestination='';state.bulkDestinationSearch='';state.bulkQualifier='';state.bulkHouse='';state.bulkMargin='';state.bulkAppend='';const action=document.querySelector('#bunch-note-content [data-bn-focus-key="bulk-action"]');if(action)action.value='';const routing=document.querySelector('#bunch-note-content [data-bn-bulk-routing]');if(routing)routing.innerHTML='';updateBulkUi(location,{fields:true});},
   pickerField: (fieldName,value) => {const picker=state.cardPicker;if(!picker||state.busy||picker.committedId||!['direction','notes','workflow_instructions','workflow_action','destination_location','destination_qualifier','destination_house','destination_search'].includes(fieldName))return;const next=String(value??''),actionChanged=fieldName==='workflow_action'&&next!==picker.workflow_action;if(fieldName==='destination_search'){const changed=normalize(next)!==normalize(picker.destination_search);picker.destination_search=next;picker.destination_location=resolveDestination(next,picker.destination_location)||next.trim();if(changed)picker.destination_qualifier='';refreshPickerDestinationChoice();}else picker[fieldName]=next;if(fieldName==='workflow_action'&&picker.workflow_action==='move'&&picker.destination_search)picker.destination_location=resolveDestination(picker.destination_search,picker.destination_location)||picker.destination_search.trim();if(actionChanged)updatePickerRoutingUi();updatePickerCommitUi();},
  pickCardDestination: (display,qualifier='') => {const picker=state.cardPicker,shown=String(display||'').trim(),choice=destinationChoices().find(item=>item.display===shown||item.codes.includes(normalize(shown)));if(!picker||!shown)return;picker.destination_location=resolveDestination(shown,picker.destination_location)||shown;picker.destination_search=choice?.display||shown;picker.destination_qualifier=String(qualifier||picker.destination_qualifier||'');refreshPickerDestinationChoice();updatePickerCommitUi();},
  appendPickerPhrase: phrase => {const picker=state.cardPicker;if(!picker||!CARD_ACTION_PHRASES.includes(phrase))return;picker.workflow_instructions=[picker.workflow_instructions,phrase].filter(Boolean).join('\n');const field=pickerPortalHost?.querySelector('[data-bn-focus-key="field:Workflow instructions"]');if(field)field.value=picker.workflow_instructions;updatePickerCommitUi();},
  commitPickerCard: () => run(async()=>{
   const picker=state.cardPicker,location=state.draft?.body.locations.find(location=>location.location===state.location);if(!picker||!location)throw new Error('Reopen the current location before adding inventory cards.');
   if(!picker.committedId){
    const selectedKeys=new Set(picker.selectedKeys||[]),ids=new Set(picker.rowIds),groups=cardPickerGroups(location,picker.sortBy).filter(group=>selectedKeys.has(group.key));if(!groups.length||!picker.rowIds.length)throw new Error('Select at least one verified card and lot row.');
    const used=new Set(),groupId=picker.groupMode==='group'&&groups.length>1?crypto.randomUUID():null;
    const plans=groups.map(group=>{const rows=group.rows.filter(row=>ids.has(row.unique_id));if(!rows.length)throw new Error('Select at least one verified lot for every card.');rows.forEach(row=>used.add(row.unique_id));return {group,rows,card:location.cards.find(existing=>existing.kind==='inventory'&&cardKey(existing)===group.key)||null,draft:picker.groupMode==='individual'?pickerCardDraft(location,picker,group):picker};});
    if(used.size!==ids.size)throw new Error('Selected lots no longer match the selected inventory cards.');
    for(const {group,rows,card:existing,draft} of plans){
     if(String(draft.direction||'').length>200||String(draft.notes||'').length>4000||String(draft.workflow_instructions||'').length>4000)throw new Error('Card directions or notes exceed the supported length.');
     if(draft.workflow_action==='move'&&!String(draft.destination_location||draft.destination_search||'').trim())throw new Error('Enter a destination.');
     if(draft.workflow_action==='bunch'&&!String(draft.destination_house||'').trim())throw new Error('Enter a destination house.');
     const card=existing||{id:crypto.randomUUID(),kind:'inventory',location_code:location.location,itemcode:group.itemcode,commonname:group.commonname,contsize:group.contsize,row_ids:[],owner_id:null,owner_ids:[],house:location.target_houses||location.default_house_plan||'',direction:location.direction||''};if(!existing)location.cards.push(card);
     card.row_ids=[...new Set([...card.row_ids,...rows.map(row=>row.unique_id)])];const owners=Array.isArray(draft.ownerIds)?draft.ownerIds:Array.isArray(picker.ownerIds)?picker.ownerIds:(existing?cardOwnerIds(existing):[]);card.owner_ids=[...new Set(owners)];card.owner_id=card.owner_ids[0]||null;card.group_id=groupId;card.workflow_action=String(draft.workflow_action||'').trim();card.destination_location=card.workflow_action==='move'?String(draft.destination_location||draft.destination_search||'').trim():null;card.destination_qualifier=card.workflow_action==='move'?String(draft.destination_qualifier||'').trim():null;card.destination_house=card.workflow_action==='bunch'?String(draft.destination_house||'').trim():null;const oldNote=cardNotesAction(location,card.id);if(oldNote){oldNote.instructions=String(draft.notes||'').trim();oldNote.row_ids=[...card.row_ids];}else card.notes=String(draft.notes||'').trim();card.workflow_instructions=String(draft.workflow_instructions||'').trim();card.direction=String(draft.direction||'').trim()||location.direction||'';
    }
    location.row_ids=[...new Set([...location.row_ids,...used])];picker.committedId='saved';invalidate();
   }
   await saveDraft();state.cardPicker={search:'',userSearch:'',sortBy:'commonname',groupMode:'group',cardDrafts:{},destination_search:'',selectedKeys:[],rowIds:[],ownerIds:null,direction:location.direction||'',workflow_action:'',destination_location:'',destination_qualifier:'',destination_house:'',notes:'',workflow_instructions:'',committedId:'',groups:cardPickerGroups(location,'commonname')};if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>document.querySelector?.('.bn-card-picker .bn-field input')?.focus({preventScroll:true}));
  }),
  editSetup: () => {rememberScroll();state.locationStep='setup';render();restoreScroll();},
  startAction: (key,id) => {if(state.busy||state.actionEdit)return;try{beginAction(key,id);state.error='';const actionId=state.actionEdit?.id,owner=state.account,epoch=state.epoch;render();restoreScroll();if(actionId)revealActionEditor(actionId,owner,epoch);}catch(e){state.error=e.message;render();}},
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
  chooseBlock: block => run(async () => { block=cleanText(block,100).toUpperCase().replace(/\.+$/,'');if (!block) return; state.rows = (await api('inventory',{block})).rows; state.location='';state.base='';state.item='';state.boardState={}; state.panels.clear();const saved=state.drafts.find(d=>(d.body?.block||d.block)===block); state.draft = saved?structuredClone(saved):{id:null,revision:null,body:{format_version:5,block,locations:[],recipient_ids:[]}};if(state.parked.has(block))state.draft=state.parked.get(block);normalizeDraftBody(state.draft.body);for(const location of state.draft.body.locations)location.source_all=state.rows.filter(row=>normalizeBunchNoteLocationKey(row.locationcode)===normalizeBunchNoteLocationKey(location.location));prepareDraftCards();persistLocalDraft(state.draft);state.epoch++; }),
  openDraft: id => run(async () => { const d = state.drafts.find(d => (d.id||d.local_id||localDraftIdentity(d)) === id);if(!d)throw new Error('This saved draft is no longer available.'); const rows=(await api('inventory',{block:d.body?.block||d.block})).rows; state.draft = structuredClone(d);normalizeDraftBody(state.draft.body); state.rows=rows;for(const location of state.draft.body.locations)location.source_all=rows.filter(row=>normalizeBunchNoteLocationKey(row.locationcode)===normalizeBunchNoteLocationKey(location.location));prepareDraftCards(); state.location='';state.base='';state.item='';state.boardState={}; state.panels.clear();persistLocalDraft(state.draft);state.epoch++; }),
  openSavedLocation: (id,location) => run(async()=>{const d=state.drafts.find(d=>(d.id||d.local_id||localDraftIdentity(d))===id);if(!d)throw new Error('This saved draft is no longer available.');const rows=(await api('inventory',{block:d.body?.block||d.block})).rows;state.draft=structuredClone(d);normalizeDraftBody(state.draft.body);state.rows=rows;for(const loc of state.draft.body.locations)loc.source_all=rows.filter(row=>normalizeBunchNoteLocationKey(row.locationcode)===normalizeBunchNoteLocationKey(loc.location));prepareDraftCards();state.location=canonicalLocation(location);state.locationStep='setup';state.base='';state.item='';state.boardState={};state.panels.clear();persistLocalDraft(state.draft);state.epoch++;}),
  backEditor: () => run(async () => { const d=state.draft;if(d.body.locations.length)await saveDraft();state.parked.set(d.body.block,state.draft); state.drafts=mergePersistedDrafts((await api('drafts')).drafts); invalidate(); state.draft=null; state.location=''; }),
  backLocations: () => { state.location=''; render(); },
  panel: (key, expanded) => { if(expanded)state.panels.add(key); else state.panels.delete(key); },
  advancedInventoryPanel: (location, expanded) => { const key='advanced-inventory:'+normalize(location),open=state.panels.has(key);if(open===!!expanded)return;if(expanded)state.panels.add(key);else state.panels.delete(key);render(); },
  openLocation: location => { if(state.busy)return;ensureLocation(location);persistLocalDraft();rememberScroll();state.location=canonicalLocation(location);state.base='';state.item='';state.locationStep='setup';render();restoreScroll(); },
  removeLocation: location => run(async () => { if(state.draft.id && state.draft.body.locations.length === 1)return; if(!await showAppConfirm('Remove this location and its draft instructions from this batch?',{title:'Bunch Note'}))return; invalidate(); state.draft.body.locations=state.draft.body.locations.filter(l=>l.location!==location); state.location=''; }),
  selectRow: (i,id,on) => { invalidate(); const l=state.draft.body.locations[i]; l.row_ids=on?[...new Set([...l.row_ids,id])]:l.row_ids.filter(v=>v!==id); const add=document.getElementById('bn-add-selected-'+i); if(add)add.disabled=state.busy || !l.row_ids.length; },
  edit: (i,key,value) => { invalidate(); const location=state.draft.body.locations[i];location[key]=value;if(key==='purposes')location.work_type=String(value??''); },
  editAction: (i,j,key,value) => { invalidate(); const a=state.draft.body.locations[i].actions[j];a[key]=value;if(key==='crew')a.margin_tag=value;if(key==='instructions')a.action_instruction=value;if(key==='destination'){if(value.trim())a.destination_mode='typed';else delete a.destination_mode;} },
  chooseOption: (key,id,on) => {const option=state.options.find(item=>item.id===id);if(on&&option)state.choiceSnapshots[key+':'+id]=structuredClone(option);if(!on)delete state.choiceSnapshots[key+':'+id];state.choices[key]=on?[...new Set([...(state.choices[key]||[]),id])]:(state.choices[key]||[]).filter(x=>x!==id);},
  custom: (key,field,value) => {state.custom[key]={...state.custom[key],[field]:value};},
  saveOption: (target,category) => run(async()=>{const k=target+':'+category,c=state.custom[k]||{},j=workJob(); if(!c.label?.trim())throw new Error('Type a new option first.'); const response=await api('option_add',{category,label:c.label.trim(),kind:c.kind||'instruction',...(!author()?{job_id:j.id,...workScope(j)}:{})},author()?null:j.revision,crypto.randomUUID()); await refreshCatalog(); state.choices[k]=[...(state.choices[k]||[]),response.option.id]; state.custom[k]={};}),
  editOption: (id,active) => {const o=state.options.find(o=>o.id===id),label=document.getElementById('bn-option-'+id).value;return run(async()=>{await api('option_edit',{option_id:id,label,active},o.revision,crypto.randomUUID());await refreshCatalog();});},
  selectItem: (index,ids,on,worker) => {if(worker){const j=workJob(),key=j.id+':'+(j.card_id||''),current=state.workRows[key]||j.body.source.map(r=>r.unique_id);state.workRows[key]=on?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id));}else{invalidate();const l=state.draft.body.locations[index];l.row_ids=on?[...new Set([...l.row_ids,...ids])]:l.row_ids.filter(id=>!ids.includes(id));if(on)prepareCards(l,true);else l.cards=l.cards.filter(c=>!c.row_ids.some(id=>ids.includes(id))||l.actions.some(a=>a.card_id===c.id));}render();},
  addChoices: (key,category) => run(async()=>{
   const target=state.targets[key],selection=state.choices[key+':'+category]||[],j=workJob(),l=target.worker?null:state.draft.body.locations[target.index];
   const source=target.worker?j.body.source:l.source_all, selected=target.worker?(state.workRows[j.id+':'+(j.card_id||'')]||source.map(r=>r.unique_id)):l.row_ids;
   const ids=source.filter(r=>target.ids.includes(r.unique_id)&&(target.scope==='location'||selected.includes(r.unique_id))&&(category!=='hauling'||shiftEligible(r))).map(r=>r.unique_id);
   if(!ids.length)throw new Error('Select at least one eligible lot row.'); if(!selection.length)throw new Error('Choose one or more options.');
   for(const id of selection){const snapshot=state.choiceSnapshots[key+':'+id],current=state.options.find(o=>o.id===id&&o.active),o=snapshot||current;if(!o||!String(o.label||'').trim()||!String(o.kind||'').trim())throw new Error('BUNCH_NOTE_OPTION_CHANGED');const pendingKey=key+':'+id;const a=target.worker?(state.pendingActions[pendingKey] ||= actionFromOption(o,ids,category==='hauling'?'rows':target.scope)):actionFromOption(o,ids,category==='hauling'?'rows':target.scope);
    if(target.worker){const current=workJob();a.card_id=current.card_id;await api('add_action',{job_id:current.id,...workScope(current),action:a},current.revision,crypto.randomUUID());state.detail=await api('get',{job_id:current.id});delete state.pendingActions[pendingKey];}
    else {invalidate();l.row_ids=[...new Set([...l.row_ids,...ids])];l.actions.push(a);state.panels.add('actions:'+l.location);}
    state.choices[key+':'+category]=(state.choices[key+':'+category]||[]).filter(v=>v!==id);delete state.choiceSnapshots[key+':'+id];
   }
  }),
  workField: (key,field,value) => {state.workForms[key]={...state.workForms[key],[field]:value,...(field==='destination'?{destination_mode:'typed'}:field==='source_id'&&state.workForms[key]?.destination_mode==='matching'?{destination:'',destination_mode:undefined}:{})};if(field==='source_id')render();},
  recordActual: id => run(async()=>{const j=workJob(),key=j.id+':'+id,form=state.workForms[key]||{};await api('actual',{job_id:j.id,...workScope(j),action_id:id,source_id:form.source_id,quantity:form.quantity,destination:form.destination||'',destination_mode:form.destination_mode||'typed',explanation:form.explanation||''},j.revision,crypto.randomUUID());if(state.workForms[key]===form)state.workForms[key]={source_id:form.source_id};state.detail=await api('get',{job_id:j.id,...workScope(j)});await load();}),
  correctActual: id => {const j=workJob(),x=j.actuals.find(x=>x.id===id),amount=prompt('Corrected quantity (0 cancels this entry):',String(x.quantity));if(amount===null)return;const destination=actionKind(x.action_snapshot)==='ta'?'':prompt('Correct destination:',x.destination);if(destination===null)return;const explanation=prompt('Reason for this correction:');if(!explanation?.trim())return;return run(async()=>{await api('actual',{job_id:j.id,...workScope(j),action_id:x.action_id,source_id:x.source_snapshot.unique_id,replaces_id:id,quantity:amount,destination,explanation},j.revision,crypto.randomUUID());state.detail=await api('get',{job_id:j.id,...workScope(j)});await load();});},
  workRecipient: (id,on) => {state.workRecipients=on?[...new Set([...state.workRecipients,id])]:state.workRecipients.filter(x=>x!==id);syncCheckboxByFocusKey(document.getElementById('bunch-note-content'),`work-recipient:${id}`,on);},
  previewWork: () => run(async()=>{const j=state.detail.job,{preview}=await api('work_preview',{job_id:j.id,recipient_ids:state.workRecipients},j.revision,crypto.randomUUID());await preparePdf(preview);switchView('bunch-note');}),
  publishWork: send_email => run(async()=>{await api('work_publish',{preview_id:state.preview.id,send_email},state.preview.job_revision,crypto.randomUUID());window.dispatchEvent(new CustomEvent('gnc:bunch-published'));invalidate();routeToAssignedWork();}),
  workPdf: preview_id => run(async()=>{const result=await api('work_pdf',{job_id:state.detail.job.id,preview_id});showPdfs([result.pdf]);const a=document.createElement('a');a.href=state.urls[0];a.target='_blank';a.rel='noopener';a.download=result.pdf.filename;a.click();}),
  removeAction: (i,j) => { invalidate(); state.draft.body.locations[i].actions.splice(j,1); render(); },
  recipient: (id,on) => { if(requiredBunchRecipientIds().has(id)){syncCheckboxByFocusKey(document.getElementById('bunch-note-content'),`recipient:${id}`,true);return;}invalidate(); const d=state.draft.body; d.recipient_ids=on?[...new Set([...d.recipient_ids,id])]:d.recipient_ids.filter(v=>v!==id);syncCheckboxByFocusKey(document.getElementById('bunch-note-content'),`recipient:${id}`,on); },
  refreshSource: () => run(async () => { invalidate(); const d=state.draft.body; state.rows=(await api('inventory',{block:d.block})).rows; const locations=groupInventory(state.rows).get(d.block)||new Map(); d.locations.forEach(l=>{l.source_all=locations.get(l.location)||[];for(const card of l.cards||[]){if(card.kind!=='inventory')continue;const matching=l.source_all.filter(r=>cardKey(r)===cardKey(card)),ids=new Set(matching.map(r=>r.unique_id));if(card.row_ids.every(id=>ids.has(id)))card.row_ids=[...ids];}prepareCards(l);});state.epoch++; }),
  save: () => run(saveDraft),
  preview: () => run(async () => { await saveDraft(); const d=state.draft; const {preview:p}=await api('preview',{batch_id:d.id},d.revision,crypto.randomUUID()); await preparePdf(p); }),
  closePreview: () => { const work=state.preview?.report_kind==='completed_work';invalidate();if(work)state.detail=null;routeToAssignedWork(); },
  publish: send_email => run(async () => { const publishedDraft=state.draft;await api('publish',{preview_id:state.preview.id,send_email},state.draft.revision,crypto.randomUUID()); window.dispatchEvent(new CustomEvent('gnc:bunch-published')); removeLocalDraft(publishedDraft);invalidate(); state.draft=null; state.drafts=mergePersistedDrafts((await api('drafts')).drafts); routeToAssignedWork(); showToast('Inv Bunch Notes',send_email?'Published. Email queued.':'Published to Assigned work.'); }),
  refresh: () => run(load), filter: value => { state.filter=value;state.queueBase='';state.queueLocation=''; render(); },
  detail: id => run(async () => { rememberScroll();state.item='';state.workAction='';state.workCard='';state.detail=await api('get',{job_id:id}); await refreshCatalog(); if(author()&&!state.users.length)state.users=(await api('directory')).users;restoreScroll(); }),
  backQueue: () => { state.detail=null;state.item='';state.queueBase='';state.queueLocation='';state.screen='source';render(); },
  setQueueMode: mode => {if(mode!=='create'&&mode!=='assigned')return;if(mode==='create'&&!author())return;state.queueMode=mode;state.detail=null;state.item='';state.queueBase='';state.queueLocation='';state.screen='source';render();if(mode==='create'&&!state.metadataLoaded&&!state.metadataLoading)void open({refresh:false});},
  command: (operation, extra={}) => run(async () => { const j=operation==='progress'?workJob():state.detail.job; await api(operation,{job_id:j.id,...workScope(j),...extra},j.revision,crypto.randomUUID()); state.detail=operation==='progress'?await api('get',{job_id:j.id}):null; await load(); }),
  sharedOwner: (index,owner_id) => {if(state.busy||!author())return;const location=state.draft.body.locations[index];if(location.job_id)return;const card=location.cards.find(c=>c.kind==='shared');if(card){invalidate();card.owner_id=owner_id||null;card.owner_ids=owner_id?[owner_id]:[];}},
  openWorkCard: id => {rememberScroll();state.workCard=id;state.item='';state.workAction='';render();restoreScroll();},
  cardCommand: (operation,id,extra={}) => run(async()=>{const j=state.detail.job,card=j.cards.find(c=>c.id===id);if(!card)throw new Error('This card changed. Refresh the Queue.');const result=await api(operation,{job_id:j.id,card_id:id,...extra},card.revision,crypto.randomUUID());if(operation==='release_card'&&result.released&&!result.job){state.detail=null;state.workCard='';await load();return;}state.detail=await api('get',{job_id:j.id});await load();}),
  assignCard: id => root.BunchNote.cardCommand('assign_card',id,{owner_ids:[...document.querySelectorAll(`[data-card-owner="${CSS.escape(id)}"]:checked`)].map(input=>input.value)}),
  assign: () => root.BunchNote.command('assign',{owner_id:document.getElementById('bn-owner').value}),
  progress: (id,status) => { const key=state.detail.job.id+':'+id;const reason=state.workForms[key]?.reason || (status==='not_needed'?prompt('Why is this action not needed?'):''); if(status==='not_needed'&&!reason?.trim())return; return root.BunchNote.command('progress',{action_id:id,status,reason}); },
  cancel: () => { const reason=prompt('Reason for canceling this location work:'); if(reason?.trim())return root.BunchNote.command('cancel',{reason}); },
  revise: () => run(async () => { const j=state.detail.job; const data=await api('revise',{job_id:j.id},j.revision,crypto.randomUUID()); state.draft=data.draft;prepareDraftCards();state.workCard=''; state.rows=(await api('inventory',{block:j.block})).rows; state.users=(await api('directory')).users;state.epoch++; state.queueMode='create';state.location='';state.locationStep='setup';state.base='';state.item=''; state.panels.clear(); state.panels.add('location:'+j.location); state.panels.add('actions:'+j.location); state.detail=null; switchView('bunch-note'); }),
  pdf: revision => run(async () => { const result=await api('pdf',{job_id:state.detail.job.id,instruction_revision:revision}); showPdfs([result.pdf]); const a=document.createElement('a'); a.href=state.urls[0]; a.target='_blank'; a.rel='noopener'; a.download=result.pdf.filename; a.click(); }),
  sendSaved: () => run(async () => { await api('send',{preview_id:state.preview.id},null,crypto.randomUUID()); invalidate(); routeToAssignedWork(); }),
  delivery: (preview_id,status) => run(async () => { const p=await api('preview_read',{preview_id}); if(status==='not_sent'){state.preview={...p,saved:true}; showPdfs(p.pdfs); switchView('bunch-note'); return;} if(!await showAppConfirm(status==='failed'?'Retry this failed delivery to the saved recipients?':'Reconcile against Sent mail without sending another copy?',{title:'Bunch Notes delivery'}))return; await api(status==='failed'?'retry':'reconcile',{preview_id},null,crypto.randomUUID()); state.detail=null; await load(); }),
 };
 function cardPickerContextIsCurrent() {
  if(!state.cardPicker||state.account!==account()||!author())return false;
  const view=typeof getCurrentVisibleViewId==='function'?getCurrentVisibleViewId():'';
  if(view!=='bunch-note')return false;
  const location=state.draft?.body.locations.find(location=>location.location===state.location);
  return !!location&&state.locationStep==='items';
 }
 function handleCardPickerKeydown(event) {
  if(event?.key!=='Escape'||state.busy||!cardPickerContextIsCurrent())return;
  event.preventDefault?.();event.stopPropagation?.();root.BunchNote.closeCardPicker();
 }
 function handleCardPickerOutsideClick(event) {
  if(state.cardPicker&&!cardPickerContextIsCurrent()) { state.cardPicker=null;renderPickerPortal('');return; }
  if(!state.cardPicker||event?.target?.closest?.('.bn-card-picker'))return;
  if(state.busy){event.preventDefault?.();event.stopPropagation?.();return;}
  if(!cardPickerContextIsCurrent())return;
  event.preventDefault?.();event.stopPropagation?.();root.BunchNote.closeCardPicker();
  queueMicrotask(()=>{if(state.cardPicker&&!cardPickerContextIsCurrent()){state.cardPicker=null;renderPickerPortal('');}});
 }
 if(typeof document!=='undefined'){
  document.addEventListener?.('keydown',handleCardPickerKeydown,true);
  document.addEventListener?.('click',handleCardPickerOutsideClick,true);
 }
})(typeof globalThis !== 'undefined' ? globalThis : this);
