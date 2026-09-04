/* Dylan-only historical photo gallery. Full objects are resolved only by explicit Open. */
(() => {
  'use strict';
  const KEY = 'gnc-photo-history-dylan-v1';
  const ROW = 356;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => String(value || '').slice(0, 10) || 'Unknown date';
  let bridge, dialog, viewer, returnFocus, generation = 0, timer, poll, frame, requestBusy = false, openGeneration = 0;
  let photos = [], cursor = null, asOf = '', hasMore = true, loading = false, loadError = false, lastWindow = '', selection = new Map();
  let draft = { q: '', container: '', location: '', lot: '', from: '', to: '', recipientId: '', message: '', pending: null };
  const thumbCache = new Map();
  let archiveActive = 0;
  const el = id => dialog.querySelector('#phg-' + id);
  const active = () => dialog?.open && bridge?.allowed();
  const api = async (operation, input = {}) => {
    if (!bridge?.allowed()) throw new Error('Photo History is available only to Dylan.');
    const result = await bridge.request(operation, input);
    if (result?.ok !== true) throw new Error(result?.code === 'PHOTO_HISTORY_BUSY' ? 'Another send is finishing. Retry with this same selection.' : 'Photo History could not finish. Retry.');
    return result;
  };
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ draft, selected: [...selection.values()] })); } catch (_) {}
  }
  function tell(message) { el('message').textContent = message; }
  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (saved.draft && typeof saved.draft === 'object') draft = { ...draft, ...saved.draft };
      selection = new Map((Array.isArray(saved.selected) ? saved.selected : []).slice(0,20).filter(p => p?.id).map(p => [p.id,p]));
    } catch (_) {}
  }
  function create() {
    const style = document.createElement('style');
    style.textContent = `
      .phg-dialog{box-sizing:border-box;max-width:none!important;max-height:none!important;width:100vw;height:100dvh;margin:0;padding:0;border:0;background:#071b14;color:#edf8f2;font:16px system-ui;}
      .phg-dialog::backdrop{background:#000b}.phg-shell{height:100%;display:flex;flex-direction:column;padding:env(safe-area-inset-top) 12px env(safe-area-inset-bottom)}
      .phg-dialog *{box-sizing:border-box}.phg-dialog button,.phg-dialog input,.phg-dialog select,.phg-dialog textarea{font:inherit;min-height:44px;border:1px solid #5acb9d;border-radius:9px;background:#102e22;color:#fff;padding:8px 12px;touch-action:manipulation}
      .phg-dialog :focus-visible{outline:3px solid #a9dcff;outline-offset:2px}.phg-dialog button:disabled{opacity:.5}.phg-header{display:flex;align-items:center;gap:12px;padding:10px 0}.phg-header h2{font-size:22px;font-weight:800;flex:1;margin:0}
      .phg-dialog label{display:flex;flex-direction:column;gap:4px;font-size:13px}.phg-search{display:flex;gap:8px}.phg-search input{flex:1;min-width:0}.phg-filters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:8px 0}.phg-filters input{width:100%}
      .phg-dialog summary{cursor:pointer;padding:8px 0;min-height:44px}.phg-muted{color:#b4cdc0;font-size:12px;margin:4px 0}.phg-scroll{overflow:auto;overscroll-behavior:contain;flex:1;min-height:100px;position:relative;overflow-anchor:none}.phg-space{position:relative;min-height:100%}.phg-window{position:absolute;inset:0 0 auto;display:grid;gap:12px}
      .phg-card{height:344px;min-width:0;border:1px solid #408c6c;border-radius:12px;overflow:hidden;background:#10271e;padding:8px;display:flex;flex-direction:column;gap:4px}.phg-card.selected{border:3px solid #45e7a5;padding:6px}.phg-card strong{font-size:14px;line-height:18px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.phg-file{font:11px monospace;color:#c3e0d1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .phg-preview{position:relative;background:#07120d;height:168px;flex-shrink:0;border-radius:7px;overflow:hidden;display:flex;align-items:center;justify-content:center}.phg-preview img{width:100%;height:100%;object-fit:contain}.phg-preview button{position:absolute;inset:0;background:#10271e;max-height:168px}.phg-actions{display:flex;gap:6px;margin-top:auto}.phg-actions button{flex:1;padding:6px;font-size:13px}.phg-actions label{flex:1;display:flex;flex-direction:row;align-items:center;gap:8px;cursor:pointer}.phg-actions input{width:24px;height:24px;min-height:24px;accent-color:#27df98}
      .phg-tray{border-top:1px solid #5acb9d;padding:8px 0;flex-shrink:0}.phg-tray summary{font-weight:700}.phg-selected{display:flex;gap:5px;overflow-x:auto;padding:4px 0}.phg-selected button{white-space:nowrap;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis}.phg-send-fields{display:flex;gap:8px;align-items:end}.phg-send-fields label{flex:1;min-width:0}.phg-send-fields textarea{width:100%;height:48px;resize:vertical;max-height:120px}.phg-dialog .phg-primary{background:#0c8054;font-weight:750}.phg-notice{border:1px solid #62d2a6;padding:6px 10px;border-radius:9px;display:flex;gap:10px;align-items:center;font-size:13px}.phg-notice span{flex:1}.phg-notice button{font-size:12px}.phg-notices{max-height:100px;overflow:auto}.phg-error{color:#ffca9d;font-size:13px;margin:2px 0;min-height:18px}.phg-viewer{padding:12px}.phg-viewer img{display:block;width:100%;height:calc(100% - 85px);object-fit:contain}
      @media(max-width:640px){.phg-header h2{font-size:18px}.phg-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.phg-send-fields{flex-wrap:wrap}.phg-send-fields label{flex-basis:42%}.phg-send-fields button{width:100%}.phg-card{font-size:12px}.phg-shell{padding-left:8px;padding-right:8px}.phg-tray details[open]{max-height:42dvh;overflow:auto}}`;
    document.head.append(style);
    dialog = document.createElement('dialog');
    dialog.id = 'photo-history-dialog';
    dialog.className = 'phg-dialog';
    dialog.setAttribute('aria-labelledby','phg-title');
    dialog.setAttribute('data-fast-press-ignore','');
    dialog.innerHTML = `<div class="phg-shell"><header class="phg-header"><button id="phg-close" aria-label="Close Photo History">Back</button><h2 id="phg-title">Photo History</h2><span class="phg-muted">Dylan only</span></header>
      <div class="phg-search"><input id="phg-q" type="search" inputmode="search" aria-label="Search Common Name, ITEMCODE or filename" placeholder="Common Name, ITEMCODE or photo filename"><button id="phg-clear">Clear</button></div>
      <details><summary>Filters · container, location, lot and dates</summary><div class="phg-filters">${[['container','Container size'],['location','Location'],['lot','Lot'],['from','From date'],['to','Through date']].map(([id,label])=>`<label>${label}<input id="phg-${id}" type="${id==='from'||id==='to'?'date':'text'}" autocomplete="off"></label>`).join('')}</div><button id="phg-reset">Reset filters</button></details>
      <p id="phg-count" class="phg-muted" role="status">Historical photos — not confirmation of current availability. Scroll to browse all matches.</p><p id="phg-message" class="phg-error" role="alert"></p><div id="phg-notices" class="phg-notices" aria-live="polite"></div>
      <div id="phg-scroll" class="phg-scroll" tabindex="0" aria-label="Historical photo gallery"><div id="phg-space" class="phg-space"><div id="phg-window" class="phg-window"></div></div></div>
      <footer class="phg-tray"><details id="phg-tray"><summary id="phg-selection-count">0 photos selected</summary><div id="phg-selected" class="phg-selected"></div><div class="phg-send-fields"><label>Sales rep<select id="phg-recipientId"><option value="">Choose a sales rep</option></select></label><label>Optional message<textarea id="phg-message-input" maxlength="2000" placeholder="Add context for the sales rep"></textarea></label><button id="phg-send" class="phg-primary">Send One Email</button></div><p class="phg-muted">Up to 20 photos per email. Dates and original filenames are included. No inventory or Requests are changed.</p></details></footer></div>`;
    dialog.querySelectorAll('input,textarea,select,button').forEach(e=>e.setAttribute('data-fast-press-ignore',''));
    document.body.append(dialog);
    el('close').onclick = close;
    dialog.addEventListener('cancel', e=>{e.preventDefault();close();});
    for (const id of ['q','container','location','lot','from','to']) {
      el(id).value = draft[id] || '';
      el(id).addEventListener('input',()=>{draft[id]=el(id).value;persist();clearTimeout(timer);timer=setTimeout(resetSearch,id==='q'?220:300);});
    }
    el('clear').onclick=()=>{draft.q='';el('q').value='';persist();resetSearch();el('q').focus();};
    el('reset').onclick=()=>{for(const id of ['container','location','lot','from','to']){draft[id]='';el(id).value='';}persist();resetSearch();};
    el('message-input').value=draft.message;
    el('message-input').oninput=()=>{draft.message=el('message-input').value;persist();};
    el('recipientId').onchange=()=>{draft.recipientId=el('recipientId').value;persist();};
    el('send').onclick=send;
    el('scroll').addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=null;renderWindow();});},{passive:true});
    new ResizeObserver(()=>{lastWindow='';if(active())renderWindow();}).observe(el('scroll'));
  }
  function resetSearch() {
    if (!active()) return;
    clearTimeout(timer);generation++;loading=false;photos=[];cursor=null;asOf='';hasMore=true;loadError=false;lastWindow='';
    el('scroll').scrollTop=0;tell('');renderWindow();loadNext();
  }
  async function loadNext() {
    if (!active() || loading || !hasMore || loadError) return;
    const version=generation;loading=true;
    try {
      const result=await api('search',{q:draft.q,container:draft.container,location:draft.location,lot:draft.lot,from:draft.from,to:draft.to,cursor,asOf,limit:36});
      if(version!==generation || !active())return;
      const seen=new Set(photos.map(p=>p.id));
      photos.push(...result.photos.filter(p=>!seen.has(p.id)));hasMore=result.hasMore;asOf=result.asOf;
      const last=result.photos.at(-1);if(last)cursor={at:last.photo_at,id:last.id};else hasMore=false;
      el('count').textContent=`${photos.length.toLocaleString()} matching photos${hasMore?' · more appear automatically as you scroll':''} · Historical, not current availability. Indexed ${date(result.indexedAt)}.`;
    } catch(error) {
      if(version!==generation || !active())return;
      loadError=true;tell(error.message);el('count').textContent='Could not load photos — selection retained.';
    } finally {if(version===generation){loading=false;lastWindow='';if(active())renderWindow();}}
  }
  function renderWindow() {
    if (!active()) return;
    const scroller=el('scroll'),width=scroller.clientWidth,cols=Math.max(2,Math.floor(width/255));
    const start=Math.max(0,Math.floor(scroller.scrollTop/ROW)-1)*cols;
    const count=(Math.ceil(scroller.clientHeight/ROW)+3)*cols;
    const end=Math.min(photos.length,start+count);
    const key=[start,end,cols,photos.length,...selection.keys(),!!draft.pending,loadError].join(':');
    el('space').style.height=(Math.ceil(photos.length/cols)*ROW+(hasMore?50:0))+'px';
    if(key!==lastWindow){
      lastWindow=key;const grid=el('window');grid.style.gridTemplateColumns=`repeat(${cols},minmax(0,1fr))`;grid.style.transform=`translateY(${Math.floor(start/cols)*ROW}px)`;
      grid.innerHTML=photos.slice(start,end).map(p=>`<article class="phg-card ${selection.has(p.id)?'selected':''}" data-id="${esc(p.id)}"><div class="phg-preview"><img alt="${esc(p.commonname||p.filename)}" data-photo-id="${esc(p.id)}" decoding="async" loading="lazy" fetchpriority="low"><button class="phg-retry" hidden>Retry thumbnail</button></div><strong title="${esc(p.commonname)}">${esc(p.commonname||'Name not recorded')}</strong><span class="phg-file">${esc([p.contsize,p.itemcode].filter(Boolean).join(' · '))||'Filename search available'}</span><span class="phg-file">${esc([p.locationcode,p.lotcode].filter(Boolean).join(' · '))}</span><span class="phg-file" title="${esc(p.filename)}">${esc(p.filename)}</span><span class="phg-muted">${date(p.photo_at)} · ${p.archived?'Archived':'Historical'}</span><div class="phg-actions"><label><input type="checkbox" aria-label="Select ${esc(p.filename)}" ${selection.has(p.id)?'checked':''} ${draft.pending?'disabled':''}>Select</label><button class="phg-open">Open photo</button></div></article>`).join('');
      if(!photos.length)grid.innerHTML=`<p>${loadError?'Could not load photos.':loading?'Loading photos…':hasMore?'Loading photos…':'No matching photos. Try another name or clear the filters.'}</p>`;
      if(loadError){const retry=document.createElement('button');retry.textContent='Retry loading';retry.onclick=()=>{loadError=false;loadNext();};grid.append(retry);}
      grid.querySelectorAll('article').forEach(card=>{
        const p=photos.find(p=>p.id===card.dataset.id);
        card.querySelector('input').onchange=e=>toggle(p,e.target.checked);
        card.querySelector('.phg-open').onclick=()=>openPhoto(p);
        card.querySelector('.phg-retry').onclick=()=>hydrate(card,p,true);
        const image=card.querySelector('img');
        image.onerror=()=>{image.removeAttribute('src');card.querySelector('.phg-retry').hidden=false;};
      });
    }
    // Only the viewport plus a small near-screen margin is eligible for an image request.
    const bounds=scroller.getBoundingClientRect(),mobile=width<641,margin=mobile?160:320;
    let budget=mobile?12:24;
    el('window').querySelectorAll('article').forEach(card=>{
      const rect=card.getBoundingClientRect();
      if(budget>0 && rect.bottom>bounds.top-margin && rect.top<bounds.bottom+(mobile?320:480)){
        const image=card.querySelector('img');if(!image.getAttribute('src') && card.querySelector('.phg-retry').hidden){budget--;hydrate(card,photos.find(p=>p.id===card.dataset.id));}
      }
    });
    if(scroller.scrollTop+scroller.clientHeight>Math.ceil(photos.length/cols)*ROW-ROW*2)loadNext();
  }
  async function hydrate(card,p,retry=false){
    if(!p||!card.isConnected||card.dataset.hydrating==='yes')return;
    const img=card.querySelector('img'),button=card.querySelector('.phg-retry');
    if(p.thumbnailUrl){button.hidden=true;img.src=p.thumbnailUrl;return;}
    if(thumbCache.has(p.id)){img.src=thumbCache.get(p.id);button.hidden=true;return;}
    if(archiveActive>=3&&!retry)return;
    card.dataset.hydrating='yes';archiveActive++;button.hidden=true;
    try{const result=await api('asset',{id:p.id});thumbCache.set(p.id,result.thumbnail);if(thumbCache.size>100)thumbCache.delete(thumbCache.keys().next().value);if(card.isConnected)img.src=result.thumbnail;}
    catch(_){if(card.isConnected)button.hidden=false;}
    finally{archiveActive--;card.dataset.hydrating='';if(active())requestAnimationFrame(renderWindow);}
  }
  function toggle(p,checked){
    if(draft.pending)return;
    if(checked && !selection.has(p.id) && selection.size>=20){tell('Choose up to 20 photos for one email.');lastWindow='';renderWindow();return;}
    if(checked)selection.set(p.id,p);else selection.delete(p.id);persist();renderSelection();lastWindow='';renderWindow();
  }
  function renderSelection(){
    el('selection-count').textContent=`${selection.size} photos selected · choose rep & send`;
    el('selected').innerHTML=[...selection.values()].map(p=>`<button data-id="${esc(p.id)}" ${draft.pending?'disabled':''} title="Remove ${esc(p.filename)}">× ${esc(p.commonname||p.filename)} · ${date(p.photo_at)}</button>`).join('');
    el('selected').querySelectorAll('button').forEach(b=>b.onclick=()=>toggle(selection.get(b.dataset.id),false));
    el('recipientId').disabled=!!draft.pending;el('message-input').disabled=!!draft.pending;
    el('send').disabled=requestBusy||!selection.size;
    el('send').textContent=requestBusy?'Saving…':draft.pending?'Retry Same Send':'Send One Email';
    if(selection.size)el('tray').open=true;
  }
  async function send(){
    if(requestBusy)return;
    if(!draft.pending && (!selection.size||!draft.recipientId)){tell('Select photos and choose a sales rep first.');return;}
    if(!draft.pending){draft.pending={ids:[...selection.keys()],recipientId:draft.recipientId,message:draft.message,idempotencyKey:crypto.randomUUID()};persist();}
    requestBusy=true;tell('');renderSelection();
    try{
      await api('send',draft.pending);
      selection.clear();draft.pending=null;draft.message='';el('message-input').value='';persist();await refreshStatus();
    }catch(error){
      if(['PHOTO_HISTORY_RECIPIENT_UNAVAILABLE','PHOTO_HISTORY_ASSET_UNAVAILABLE','PHOTO_HISTORY_SELECTION_INVALID'].includes(error?.payload?.code)){
        draft.pending=null;persist();tell(error.message);
      }else tell(error.message+' Your original send is retained; Retry Same Send cannot create a duplicate.');
    }
    finally{requestBusy=false;renderSelection();lastWindow='';renderWindow();}
  }
  async function refreshStatus(){
    if(!active())return;
    try{
      const result=await api('status');if(!active())return;
      el('notices').innerHTML=result.shares.filter(s=>s.delivered||['failed','unknown'].includes(s.status)).map(s=>`<div class="phg-notice"><span>${s.delivered?'Email Sent':'Email Failed'} · ${s.photo_count} photos · ${esc(s.recipient_name)}</span>${!s.delivered?`<button data-retry="${esc(s.id)}">Retry</button>`:''}<button data-dismiss="${esc(s.id)}">Dismiss</button></div>`).join('');
      el('notices').querySelectorAll('button').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(b.dataset.retry?'retry':'dismiss',{id:b.dataset.retry||b.dataset.dismiss});await refreshStatus();}catch(error){tell(error.message);b.disabled=false;}});
    }catch(_){/* Silent bounded polling; sends and explicit retries surface their own errors. */}
  }
  async function openPhoto(p){
    if(viewer?.open)return;
    viewer=document.createElement('dialog');viewer.className='phg-dialog phg-viewer';viewer.setAttribute('data-fast-press-ignore','');viewer.setAttribute('aria-label','Historical photo viewer');
    viewer.innerHTML=`<header class="phg-header"><button>Back to gallery</button><span>${esc(p.commonname||p.filename)} · ${date(p.photo_at)}</span></header><p role="status">Opening selected photo…</p>`;
    document.body.append(viewer);viewer.showModal();
    const finish=()=>{viewer.close();viewer.remove();};viewer.querySelector('button').onclick=finish;viewer.oncancel=e=>{e.preventDefault();finish();};
    try{const result=await api('asset',{id:p.id,open:true});if(!viewer.open)return;viewer.querySelector('p').remove();
      if(result.archived){const a=document.createElement('a');a.textContent='Open original in Google Drive';a.href=result.url;a.target='_blank';a.rel='noopener noreferrer';viewer.append(a);}
      else {const img=document.createElement('img');img.alt=p.filename;img.src=result.url;img.onerror=()=>{const text=document.createElement('p');text.textContent='Photo unavailable. Close and try again.';viewer.append(text);};viewer.append(img);}
    }catch(error){if(viewer.open)viewer.querySelector('p').textContent=error.message;}
  }
  async function open(nextBridge){
    bridge=nextBridge;if(!bridge?.allowed())return false;
    if(!dialog){restore();create();}
    if(dialog.open)return false;
    returnFocus=document.activeElement;dialog.showModal();const opened=++openGeneration;
    renderSelection();resetSearch();
    try{const result=await api('recipients');if(opened!==openGeneration||!active())return false;el('recipientId').innerHTML='<option value="">Choose a sales rep</option>'+result.recipients.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');el('recipientId').value=draft.recipientId;}catch(error){if(active())tell(error.message);}
    refreshStatus();clearInterval(poll);poll=setInterval(()=>{if(!bridge.allowed())clear();else if(document.visibilityState==='visible')refreshStatus();},15000);
    return false;
  }
  function close(){persist();generation++;openGeneration++;clearTimeout(timer);clearInterval(poll);if(viewer?.open){viewer.close();viewer.remove();}dialog?.close();returnFocus?.focus?.({preventScroll:true});}
  function clear(){close();selection.clear();draft={q:'',container:'',location:'',lot:'',from:'',to:'',recipientId:'',message:'',pending:null};photos=[];thumbCache.clear();try{localStorage.removeItem(KEY);}catch(_){}if(dialog){dialog.remove();dialog=null;}}
  window.GncPhotoHistory={open,close,clear};
})();
