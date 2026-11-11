function createNurseryTableController(context) {
    const methods = {
        keyFor: (...args) => nurseryTable_keyFor(...args),
        writable: (...args) => nurseryTable_writable(context, ...args),
        request: (...args) => nurseryTable_request(context, ...args),
        input: (...args) => nurseryTable_input(context, ...args),
        readRow: (...args) => nurseryTable_readRow(...args),
        photo: (...args) => nurseryTable_photo(context, ...args),
        roundBeds: (...args) => nurseryTable_roundBeds(...args),
        isNurseryWorkspace: (...args) => nurseryTable_isNurseryWorkspace(context, ...args),
        metricStrip: (...args) => nurseryTable_metricStrip(context, ...args),
        issueReasons: (...args) => nurseryTable_issueReasons(context, ...args),
        issueCard: (...args) => nurseryTable_issueCard(context, ...args),
        bunchPanel: (...args) => nurseryTable_bunchPanel(context, ...args),
        showBunchIssue: (...args) => nurseryTable_showBunchIssue(context, ...args),
        patchBunchApproval: (...args) => nurseryTable_patchBunchApproval(context, ...args),
        persistBunch: (...args) => nurseryTable_persistBunch(context, ...args),
        approveBunchIssue: (...args) => nurseryTable_approveBunchIssue(context, ...args),
        blockMetrics: (...args) => nurseryTable_blockMetrics(context, ...args),
        bedLabel: (...args) => nurseryTable_bedLabel(context, ...args),
        cardDraft: (...args) => nurseryTable_cardDraft(context, ...args),
        locationCards: (...args) => nurseryTable_locationCards(context, ...args),
        reviewCard: (...args) => nurseryTable_reviewCard(context, ...args),
        plantingRows: (...args) => nurseryTable_plantingRows(context, ...args),
        plantingCheck: (...args) => nurseryTable_plantingCheck(context, ...args),
        plantingCard: (...args) => nurseryTable_plantingCard(context, ...args),
        commitBunchMarkup: (...args) => nurseryTable_commitBunchMarkup(context, ...args),
        drawBunchDrill: (...args) => nurseryTable_drawBunchDrill(context, ...args),
        approvePlanting: (...args) => nurseryTable_approvePlanting(context, ...args),
        scheduleStableViewRender: (...args) => nurseryTable_scheduleStableViewRender(context, ...args),
        pdfCards: (...args) => nurseryTable_pdfCards(context, ...args),
        downloadBunchPdf: (...args) => nurseryTable_downloadBunchPdf(context, ...args),
        approveInline: (...args) => nurseryTable_approveInline(context, ...args),
        approveLocation: (...args) => nurseryTable_approveLocation(context, ...args),
        handleBunchDrillClick: (...args) => nurseryTable_handleBunchDrillClick(context, ...args),
        draw: (...args) => nurseryTable_draw(context, ...args),
        load: (...args) => nurseryTable_load(context, ...args),
        save: (...args) => nurseryTable_save(context, ...args),
        preparePlantingChoices: (...args) => nurseryTable_preparePlantingChoices(context, ...args),
        change: (...args) => nurseryTable_change(context, ...args),
        click: (...args) => nurseryTable_click(context, ...args),
        onSearchInput: (...args) => nurseryTable_onSearchInput(context, ...args),
        onBunchSettled: (...args) => nurseryTable_onBunchSettled(context, ...args)
    };
    return methods;
}

function nurseryTable_back(context) {
    if (!context.isNurseryWorkspace()) return false;
    if (!['table','planting'].includes(context.state.subview)) {
        context.state.subview = 'table';
        context.draw();
        return true;
    }
    if (context.state.bunchSimulatorDrillLevel === 'alpha') return false;
    context.state.bunchSimulatorDrillLevel = {cards:'location',location:'number',number:'alpha'}[context.state.bunchSimulatorDrillLevel] || 'alpha';
    context.state.q = '';
    context.drawBunchDrill(context.state.bunchData);
    return true;
}

function startNurseryInventoryObserver(context) {
    let inventory = context.options.inventory(), revision = context.options.revision?.();
    let inFlight = false, retryNotBefore = 0;
    function poll() {
        if (context.state.destroyed || !context.root.isConnected || document.hidden || inFlight || Date.now() < retryNotBefore) return;
        inFlight = true;
        try {
            if (context.options.authorized?.() === false) {
                context.state.destroyed = true;
                context.root.replaceChildren();
                clearInterval(timer);
                return;
            }
            const next = context.options.inventory(), rev = context.options.revision?.();
            if (next !== inventory || rev !== revision) {
                inventory = next;
                revision = rev;
                nurseryTable_scheduleInventoryRefresh(context);
            }
        } catch (error) {
            retryNotBefore = Date.now() + 5000;
            context.state.error = String(error?.message || error);
            globalThis.GncRuntimeWatchdog?.captureHandled?.('nursery_inventory_refresh');
        } finally { inFlight = false; }
    }
    const timer = setInterval(poll, 1000);
    return timer;
}

function nurseryTable_scheduleInventoryRefresh(context) {
    if (context.state.draft || context.state.pending.size
        || document.activeElement?.matches('[data-nursery-edit],[data-bunch-inline-note],[data-bunch-inline-target]')) return;
    context.scheduleStableViewRender();
}

function nurseryTable_issueReasons(context, p){return p.bunchNoteIssues.map(i=>'<li><strong>Rule '+i.rule+'</strong> · '+context.escape(i.reason)+'</li>').join('');}

function nurseryTable_issueCard(context, p){const url=context.photo(p.row);return '<article class="bunch-issue-card app-smart-card app-drive-compact-card" data-bunch-card="'+context.escape(p.uid)+'" data-bunch-location="'+context.escape(p.location)+'" data-bunch-itemcode="'+context.escape(p.itemcode)+'" data-bunch-lotcode="'+context.escape(context.readRow(p.row,'lotcode'))+'" data-bunch-historical="'+(p.row.historical?'true':'false')+'">'+(p.row.synthetic?'<strong data-bunch-ghost>👻 Ghost Stock / Not on Live Inventory</strong><p>'+context.escape(p.row.identityProvenance||'Historical record')+'</p>':'')+'<div class="bunch-card-heading">'+(url?'<img class="bunch-card-photo" src="'+context.escape(url)+'" alt="'+context.escape(p.commonname)+'" loading="lazy" referrerpolicy="no-referrer">':'<div class="bunch-card-photo">No photo</div>')+'<div><strong>'+context.escape(p.commonname)+' · '+context.escape(p.contsize)+'</strong><p>'+context.escape(p.location)+' · '+context.escape(p.itemcode)+'</p><p>'+context.escape(context.readRow(p.row,'lotcode'))+' · '+context.escape(p.source)+'</p></div></div><div class="bunch-card-metrics"><span>On Hand <b>'+p.qty+'</b></span><span>Available <b>'+p.available+'</b></span><span>Sale Year / Season <b>'+context.escape(p.saleYear||'Unverified')+' / '+context.escape(context.readRow(p.row,'season'))+'</b></span><span>Water mL/day <b>'+(p.water??'Unverified')+'</b></span></div><p><b>Current Raw Bunch Note</b><br>'+context.escape(p.rawBunchNote||'No Bunch Note recorded')+'</p>'+(p.approved?'<strong data-bunch-approved>✅ Approved Bunch Note Created'+(p.saved?._optimistic?' · Saving…':'')+'</strong>':'<div class="bunch-inaccuracy"><strong>⚠️ INACCURATE BUNCH NOTE REASON</strong><ul>'+context.issueReasons(p)+'</ul></div>')+'<button data-bunch-open="'+context.escape(p.uid)+'">Inspect &amp; Fix Bunch Note</button></article>';}

function nurseryTable_bunchPanel(context, rows){
      const visible=rows.filter(p=>context.state.issueFilter==='approved'?p.approved:!p.approved&&p.bunchNoteIssues.length&&(context.state.issueFilter==='all'||p.bunchNoteIssues.some(i=>i.category===context.state.issueFilter)));
      if (context.state.subview === 'issues') publishNurseryIssueExcelSnapshot(context, visible);
      if (context.state.subview === 'rules') publishNurseryExcelSnapshot(context, context.model.BUNCH_RULES, ['Rule','Title','Description'], row => [row.number,context.escape(row.title),context.escape(row.description)]);
      if(context.state.subview==='rules')return '<div class="bunch-rules">'+context.model.BUNCH_RULES.map(r=>'<article data-bunch-rule="'+r.number+'"><h3>'+(r.number<=7?'Gate ':'Rule ')+r.number+' · '+context.escape(r.title)+'</h3><p>'+context.escape(r.description)+'</p></article>').join('')+'</div>';
      if(context.state.subview==='issues')return '<div class="bunch-issue-filters">'+context.issueFilters.map(([key,label])=>'<button data-bunch-filter="'+key+'" aria-pressed="'+(context.state.issueFilter===key)+'">'+context.escape(label)+'</button>').join('')+'</div><div class="bunch-issue-list">'+(visible.slice(context.state.page*100,context.state.page*100+100).map(context.issueCard).join('')||'<p>No matching issues in this selection.</p>')+'</div>';
      return '';
    }

function nurseryTable_showBunchIssue(context, uid){
      const p=context.state.currentIssues.find(p=>p.uid===uid);if(!p)return;
      const existing=document.getElementById('bunch-note-issue-modal');existing?.remove();
      context.state.draft=context.ownedCache.failedDrafts.get(uid)||{uid,choices:{...p.choices},note:p.autoSuggestedBunchNote,dirty:false};
      const dialog=document.createElement('dialog');dialog.id='bunch-note-issue-modal';dialog.className='bunch-issue-dialog';dialog.setAttribute('aria-labelledby','bunch-issue-title');
      const select=(key,label,values,selected)=>'<label>'+label+'<select data-bunch-choice="'+key+'">'+values.map(v=>'<option '+(v===selected?'selected':'')+' value="'+context.escape(v)+'">'+context.escape(v)+'</option>').join('')+'</select></label>';
      dialog.innerHTML='<form method="dialog"><button aria-label="Close Bunch Note issue">Close</button></form><h2 id="bunch-issue-title">Bunch Note Issue &amp; Approval</h2><p>'+context.escape(p.commonname)+' · '+context.escape(p.itemcode)+' · '+context.escape(context.readRow(p.row,'locationcode'))+' · '+context.escape(context.readRow(p.row,'lotcode'))+'</p><p>On Hand '+p.qty+' · Available '+p.available+' · Hold/Stop '+context.escape(context.readRow(p.row,'holdstopcode','lochold')||'None')+'</p><p>Specs: '+context.escape(context.readRow(p.row,'spec','itemspec')||'Not recorded')+'</p>'+(context.photo(p.row)?'<a href="'+context.escape(context.photo(p.row))+'" target="_blank" rel="noopener noreferrer"><img class="bunch-card-photo" src="'+context.escape(context.photo(p.row))+'" alt="Row photo" referrerpolicy="no-referrer"></a>':'')+'<h3>❌ Why It Is Not an Accurate Bunch Note for This Row</h3><ul>'+context.issueReasons(p)+'</ul><h3>✅ Gem-Recommended New Bunch Note</h3><div class="bunch-choices">'+select('target','Target Block',p.row.synthetic?[p.target]:[...context.state.bunchContext.data.locations.keys()],p.target)+select('crew','Crew Prefix',context.model.BUNCH_CREWS,p.crew)+select('tape','Corner Tape',context.model.BUNCH_TAPES,p.tape)+select('thread','Sequence Thread',context.model.BUNCH_THREADS,p.thread)+select('direction','Walking Direction',['N > S','S > N','W > E','E > W'],p.direction)+'</div><label>Suggested Compliant Bunch Note<textarea data-bunch-note rows="8">'+context.escape(context.state.draft.note)+'</textarea></label><p data-bunch-blockers role="status"></p><button type="button" data-bunch-approve>✅ Approve &amp; Create New Bunch Note</button>';
      document.body.append(dialog);
      function validate(){const current=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,{...context.state.draft.choices,note:context.state.draft.note});const errors=current.blockers.map(b=>'Rule '+b[0]+': '+b[1]).concat(current.bunchNoteIssues.map(i=>'Rule '+i.rule+': '+i.reason));if(!context.state.draft.note.trim())errors.push('Enter a Bunch Note.');if(context.state.loading||!context.cache.loaded||context.options.inventoryReady?.()===false)errors.push('Review remains open while the complete inventory and reference snapshot loads.');dialog.querySelector('[data-bunch-blockers]').textContent=errors.join(' ');dialog.querySelector('[data-bunch-approve]').disabled=errors.length>0||context.state.pending.has('ph_dylan_decisions_store:'+p.plan_id);return current;}
      dialog.addEventListener('input',event=>{if(event.target.matches('[data-bunch-note]')){context.state.draft.note=event.target.value;context.state.draft.dirty=true;validate();}});
      dialog.addEventListener('change',event=>{if(!event.target.dataset.bunchChoice)return;context.state.draft.choices[event.target.dataset.bunchChoice]=event.target.value;const next=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,context.state.draft.choices);context.state.draft.note=next.autoSuggestedBunchNote;context.state.draft.dirty=false;dialog.querySelector('[data-bunch-note]').value=context.state.draft.note;validate();});
      dialog.querySelector('[data-bunch-approve]').addEventListener('click',()=>void context.approveBunchIssue(dialog,p,validate()));
      dialog.addEventListener('close',()=>{context.state.draft=null;dialog.remove();},{once:true});
      validate();if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');dialog.querySelector('textarea').focus();
    }



async function nurseryTable_persistBunch(context, payload){if(context.activeBunchWrites>=4)await new Promise(resolve=>context.bunchWriteWaiters.push(resolve));else context.activeBunchWrites++;try{return await context.options.request({table:'ph_dylan_decisions_store',operation:'save',payload});}finally{const next=context.bunchWriteWaiters.shift();if(next)next();else context.activeBunchWrites--;}}

function nurseryTable_approveBunchIssue(context, dialog,p,checked,batchDraft){
      const token='ph_dylan_decisions_store:'+p.plan_id;
      if(context.state.pending.has(token)||!checked.canApprove||checked.bunchNoteIssues.length||context.options.authorized?.()===false||context.state.destroyed)return;
      if(context.state.loading||!context.cache.loaded||context.options.inventoryReady?.()===false||context.options.inventory()!==context.state.contextInventory||!batchDraft&&context.options.revision?.()!==context.state.contextRevision){dialog.querySelector('[data-bunch-blockers]').textContent='Inventory changed. Review the refreshed row before approval.';return;}
      const row=context.state.bunchContext.byUid.get(p.uid);if(!row)return;
      const list=context.state.refs.ph_dylan_decisions_store||(context.state.refs.ph_dylan_decisions_store=[]),before=list.find(r=>r.plan_id===p.plan_id),draft=batchDraft||{...context.state.draft,choices:{...context.state.draft.choices}};
      const updated={plan_id:p.plan_id,decision:context.model.DECISIONS[0],override_loc:row.synthetic?'':checked.target,override_qty:checked.qty,notes:draft.note.trim(),is_custom:'Y',wf_type:'BUNCH NOTE',itemcode:p.itemcode,commonname:p.commonname,contsize:p.contsize,lot_date:String(context.readRow(row,'lotcode')),from_loc:String(context.readRow(row,'locationcode')),crew_done:false};
      const payload={row:updated,expectedUpdatedAt:before?.updated_at||null,commandId:context.global.crypto.randomUUID()},signature=JSON.stringify({...payload,commandId:undefined});
      payload.commandId=context.state.bunchRetries.get(signature)||payload.commandId;context.state.bunchRetries.set(signature,payload.commandId);
      const optimistic={...updated,_optimistic:true,_commandId:payload.commandId},beforeProjection={saved:p.saved,approved:p.approved,rawBunchNote:p.rawBunchNote};
      const index=list.findIndex(r=>r.plan_id===p.plan_id);if(index>=0)list[index]=optimistic;else list.push(optimistic);
      context.state.pending.set(token,optimistic);context.state.dylanDecisionsStore=list;context.state.bunchContext.decisions.set(p.plan_id,optimistic);Object.assign(p,{saved:optimistic,approved:true,rawBunchNote:updated.notes});
      if(!batchDraft)context.model.publishBunchDecisions(context.options.identity,list);context.options.onBunchNoteSaved?.(row,optimistic);context.state.error='✅ Approved Bunch Note Created · Saving…';
      dialog.close?.();dialog.remove();context.state.draft=null;context.patchBunchApproval(p);
      // The visible transaction is complete before any network work or full planning render.
      return Promise.resolve().then(()=>context.persistBunch(payload)).then(response=>{
        const result=response?.data||response;if(result?.row?.plan_id!==p.plan_id||result.row.notes!==updated.notes)throw Error('Bunch Note save receipt did not match the exact row.');
        const at=list.findIndex(r=>r.plan_id===p.plan_id);if(at<0||list[at]._commandId!==payload.commandId)return;
        list[at]=result.row;context.state.bunchContext.decisions.set(p.plan_id,result.row);p.saved=result.row;context.state.pending.delete(token);context.state.bunchRetries.delete(signature);context.ownedCache.failedDrafts.delete(p.uid);
        context.model.publishBunchDecisions(context.options.identity,list);
        if(context.options.authorized?.()!==false){context.options.onBunchNoteSaved?.(row,result.row);context.state.error='✅ Approved Bunch Note Created';if(!context.state.destroyed)context.patchBunchApproval(p);context.global.dispatchEvent?.(new context.global.CustomEvent('gnc:bunch-settled',{detail:{identity:context.options.identity,uid:p.uid}}));}
      }).catch(()=>{
        const at=list.findIndex(r=>r.plan_id===p.plan_id);if(at<0||list[at]._commandId!==payload.commandId)return;
        if(before)list[at]=before;else list.splice(at,1);context.state.pending.delete(token);Object.assign(p,beforeProjection);if(before)context.state.bunchContext.decisions.set(p.plan_id,before);else context.state.bunchContext.decisions.delete(p.plan_id);
        context.ownedCache.failedDrafts.set(p.uid,draft);context.model.publishBunchDecisions(context.options.identity,list);
        if(context.options.authorized?.()!==false){context.options.onBunchNoteSaved?.(row,before||null);context.state.error='Bunch Note was not saved. Previous values restored; your draft is retained.';context.options.onBunchNoteError?.(context.state.error);if(!context.state.destroyed)context.draw();context.global.dispatchEvent?.(new context.global.CustomEvent('gnc:bunch-settled',{detail:{identity:context.options.identity,uid:p.uid,rollback:true}}));}
      });
    }

function nurseryTable_blockMetrics(context, location){const l=context.state.bunchData?.locations.get(location)||{};return {total:Number(l.total_beds||0),occupied:Number(l.occupied||0),reserved:Number(l.reserved||0),open:Math.max(0,Number(l.total_beds||0)-Number(l.occupied||0)-Number(l.reserved||0)-Number(l.prior||0))};}

function nurseryTable_bedLabel(context, m){return context.roundBeds(m.total)+' Beds · '+context.roundBeds(m.occupied)+' Occ · '+context.roundBeds(m.reserved)+' Rsv · '+context.roundBeds(m.open)+' Open';}

function nurseryTable_cardDraft(context, p){if(!context.state.cardDrafts.has(p.uid))context.state.cardDrafts.set(p.uid,context.ownedCache.failedDrafts.get(p.uid)||{uid:p.uid,choices:{...p.choices},note:p.saved?.notes||p.autoSuggestedBunchNote});return context.state.cardDrafts.get(p.uid);}

function nurseryTable_locationCards(context){return context.state.currentIssues.filter(p=>p.location===context.state.location).sort((a,b)=>a.location.localeCompare(b.location,undefined,{numeric:true})||a.itemcode.localeCompare(b.itemcode,undefined,{numeric:true})||String(context.readRow(a.row,'lotcode')).localeCompare(String(context.readRow(b.row,'lotcode'))));}

function nurseryTable_reviewCard(context, p){
      const draft=context.cardDraft(p),checked=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,{...draft.choices,note:draft.note}),cpb=context.state.bunchContext.cpbFor(p.row),url=context.photo(p.row),r=p.row;
      const readMetric=(...keys)=>{const v=context.readRow(r,...keys);return v===''?'Unverified':v;};
      const lots=context.state.currentIssues.filter(x=>x.itemcode===p.itemcode&&x.location===p.location),locQty=lots.reduce((sum,x)=>sum+x.qty,0);
      const match=context.global.getManagerLocPhotoMatchQtyValue?.(r,'drive')??(context.model.number(context.readRow(r,'locphotomatch','loc_photo_match','photo_match_qty','match_qty'))||Math.round(locQty*context.model.number(context.readRow(r,'match_pct','matchpct','loc_match_pct'))/100));
      const planting=context.state.bunchData.plans.filter(x=>x.workflow.includes('PLANTING')&&x.final_target===p.from);
      const how=[['Crew & Pre-Work',checked.crew+' · '+(/\.Y\b|^Y$/i.test(context.readRow(r,'lotcode')+' '+context.readRow(r,'season'))?'Shift Staging (.Y): row up countable can-tight; stake all 4 corners with SHIFT TAPE.':'Grade, sort flags and verify crew pre-work before execution.')],['House / Direction / Spacing',checked.house+' · '+checked.direction+' · '+checked.spacing],['Drape / Look-Alikes',checked.autoSuggestedBunchNote.split(' | ').filter(x=>/drape|look-alike|Flags in back/i.test(x)).join(' · ')||'Keep variety dividers and corner flags visible.'],['Haul Destination',checked.target===p.from?'Keep in '+p.location+' ('+checked.house+')':'Haul 100% Whole Group to '+checked.target+' · verified seven-gate target'],['Corner Tape',checked.tape+' · mark all four corner stakes']];
      return '<article class="bunch-review-card app-smart-card app-drive-compact-card" data-bunch-approval-ready="'+(checked.canApprove&&!checked.bunchNoteIssues.length)+'" data-bunch-card="'+context.escape(p.uid)+'"><label class="bunch-card-selection"><input type="checkbox" data-bunch-select="'+context.escape(p.uid)+'" '+(!context.state.selectedCards||context.state.selectedCards.has(p.uid)?'checked':'')+'> Include in PDF email</label><div class="bunch-card-heading">'+(url?'<img class="bunch-card-photo" src="'+context.escape(url)+'" alt="'+context.escape(p.commonname)+'" loading="lazy" referrerpolicy="no-referrer">':'<div class="bunch-card-photo">NO PHOTO</div>')+'<div class="bunch-card-identity"><strong>'+context.escape(p.commonname)+' '+context.escape(p.contsize)+'</strong><p><u>'+context.escape(p.itemcode)+'</u></p><p>'+context.escape(p.location)+' · '+context.escape(p.saleYear)+' · '+context.escape(context.readRow(r,'lotcode'))+' · '+context.escape(p.source)+'</p><span data-bunch-card-status>'+(p.approved?'✅ Approved'+(p.saved?._optimistic?' · Saving…':''):'Review required')+'</span></div><span class="bunch-crew-badges">'+context.escape(context.readRow(r,'fieldtagcolor','holdstopcode')||'')+' '+context.escape(checked.crew)+'</span></div>'+context.metricStrip([['On Hand',p.qty],['Review',context.global.getCardPtrReviewedValue?.(r)??readMetric('review','ptrreview','ptrreviewed')],['Available',p.available],['Open Stock',context.global.getCardOpenStockValue?.(r)??readMetric('openstock','open_stock','ptropenstock','s_lts')],['Loc Photo Match',match],['Loc On Hand',locQty]])+'<p>Spec: '+context.escape(context.readRow(r,'spec','itemspec')||'Not recorded')+'</p><p>Beds: '+(cpb?context.roundBeds(p.qty/cpb):'Unverified')+' · Water: '+context.escape(context.model.documentedWaterDemand(r,context.state.bunchContext.waterFor(r))?.label??p.water??'Unverified')+' mL/day</p><section class="bunch-how-panel"><label>📋 AUTO-GENERATED BUNCH NOTE<textarea data-bunch-inline-note rows="4">'+context.escape(draft.note)+'</textarea></label><h3>🏠 HOW TO BUNCH</h3>'+how.map(([label,value])=>'<p><b>'+label+'</b> · '+context.escape(value)+'</p>').join('')+(planting.length?'<p data-planting-reservation>🛡️ Reserved Beds: '+context.roundBeds(planting.reduce((sum,x)=>sum+x.final_beds,0))+' · '+planting.length+' scheduled plantings · next can fill '+context.escape(planting.map(x=>x.can_fill_date).filter(Boolean).sort((a,b)=>new Date(a)-new Date(b))[0]||'date unverified')+' · Clear only after the approved whole-group haul; protected .Y stays anchored.</p>':'')+'</section>'+(p.bunchNoteIssues.length&&!p.approved?'<details><summary>Review '+p.bunchNoteIssues.length+' rule issues</summary><ul>'+context.issueReasons(p)+'</ul></details>':'')+(p.row.synthetic?'<p>Historical identity · unverified stock; reconciliation only.</p>':'')+'<label>Target destination block<select data-bunch-inline-target>'+[...new Set([draft.choices.target,...context.state.bunchContext.data.locations.keys()])].filter(Boolean).map(loc=>'<option '+(loc===draft.choices.target?'selected':'')+'>'+context.escape(loc)+'</option>').join('')+'</select></label><div class="bunch-card-actions"><button data-bunch-card-approve="'+context.escape(p.uid)+'">'+(p.approved?'✅ Approved Bunch Note — Click to Edit/Re-Save':'✅ Approve Bunch Note for '+context.escape(p.commonname)+' ('+context.escape(p.location)+')')+'</button><button data-bunch-open="'+context.escape(p.uid)+'">Review 13 Rules / Crew</button></div></article>';
    }

function nurseryTable_plantingRows(context){return context.state.bunchData.plans.filter(p=>p.workflow.includes('PLANTING'));}

function nurseryTable_plantingCheck(context, p,target){return context.model.evaluatePlantingTarget(p,target,context.state.bunchData,context.state.bunchContext);}

function nurseryTable_plantingCard(context, p){
      const target=context.state.plantDrafts.get(p.plan_id)||p.final_target,check=context.plantingCheck(p,target),saved=(context.state.refs.ph_dylan_decisions_store||[]).find(x=>x.plan_id===p.plan_id),shiftSource=/\bSH\b|(?:^|\s)\.Y(?:\s|$)/i.test(p.source),sourceLots=shiftSource?context.state.currentIssues.filter(x=>x.itemcode===p.itemcode&&x.saleYear===p.saleYear&&/\.Y\b|^Y$/i.test(context.readRow(x.row,'lotcode')+' '+context.readRow(x.row,'season'))):[],clearing=context.state.currentIssues.filter(x=>x.from===target&&x.target!==x.from),compatible=context.state.plantChoiceCache?.get(p.plan_id)||[target],token='ph_dylan_decisions_store:'+p.plan_id;
      return '<article class="bunch-review-card app-smart-card app-drive-compact-card" data-planting-card="'+context.escape(p.plan_id)+'"><div class="bunch-card-heading"><div class="bunch-card-photo">🌱</div><div class="bunch-card-identity"><strong>'+context.escape(p.commonname)+' '+context.escape(p.contsize)+'</strong><p><u>'+context.escape(p.itemcode)+'</u></p><p>'+context.escape(target||'UNASSIGNED')+' · Target Plant: '+context.escape(p.lot||'Unverified')+' · Can Fill: '+context.escape(p.can_fill_date||'Unverified')+' · Source: '+context.escape(p.source)+'</p></div></div>'+context.metricStrip([['Plan Qty',p.final_qty],['Beds Needed',context.roundBeds(p.final_beds)],['CPB',p.cpb||'Unverified'],['Water mL/day',check.water??'Unverified'],['Source Stock (.Y)',shiftSource?sourceLots.reduce((sum,x)=>sum+x.qty,0):'—'],['Compatibility',check.score+'%']])+'<section class="bunch-how-panel"><h3>🌱 WHERE TO PLANT &amp; WHY (Gem Recommendation)</h3><p>'+context.escape(p.tier)+' · '+context.escape(check.reasons.join(' · '))+'</p><p>Media / fertilizer can-fill batch: '+context.escape(p.media||'verify production schedule before can fill')+'</p><label>Target Location<select data-planting-target="'+context.escape(p.plan_id)+'">'+[...new Set([target,...compatible])].filter(Boolean).map(loc=>'<option '+(loc===target?'selected':'')+'>'+context.escape(loc)+'</option>').join('')+'</select></label><h3>🤝 HAND-IN-HAND BUNCH NOTE LINK</h3><p>Clearance window: '+context.escape(p.clearance_date||'Unverified')+' to '+context.escape(p.can_fill_date||'Unverified')+'. Approved plans require field clearance confirmation.</p>'+clearing.map(x=>'<p>'+context.escape(x.itemcode)+' · '+context.escape(x.location)+' · '+context.escape(context.readRow(x.row,'lotcode'))+' → '+context.escape(x.target)+' · '+(x.approved?'Approved haul plan':'Haul awaiting approval')+'</p>').join('')+(!clearing.length?'<p>No verified outbound haul plan; occupied beds remain occupied.</p>':'')+sourceLots.map(x=>'<button data-planting-source="'+context.escape(x.uid)+'">RHETT / SHIFT TAPE · '+context.escape(x.itemcode)+' · '+context.escape(x.location)+' · '+context.escape(context.readRow(x.row,'lotcode'))+'</button>').join('')+'</section><button class="bunch-send-primary" data-planting-approve="'+context.escape(p.plan_id)+'" '+(!check.ok||context.state.pending.has(token)?'disabled':'')+'>'+(saved&&context.model.DECISIONS.slice(0,2).includes(saved.decision)?'✅ Approved Planting Location'+(context.state.pending.has(token)?' · Saving…':' — Re-Save'):'✅ Approve Planting Location &amp; Sync With Bunch Notes')+'</button></article>';
    }





function nurseryTable_approvePlanting(context, id){
      const p=context.plantingRows().find(p=>p.plan_id===id),target=context.state.plantDrafts.get(id)||p?.final_target,token='ph_dylan_decisions_store:'+id;
      if(!p||context.state.pending.has(token)||context.state.loading||!context.cache.loaded||context.options.authorized?.()===false||context.options.inventoryReady?.()===false||!context.plantingCheck(p,target).ok)return;
      const list=context.state.refs.ph_dylan_decisions_store||(context.state.refs.ph_dylan_decisions_store=[]),before=list.find(x=>x.plan_id===id),updated={plan_id:id,decision:context.model.DECISIONS[0],override_loc:target,override_qty:p.final_qty,notes:p.notes||'Planting capacity and source reviewed; confirm field clearance before can fill.',is_custom:'Y',wf_type:p.workflow,itemcode:p.itemcode,commonname:p.commonname,contsize:p.contsize,lot_date:p.lot,from_loc:p.from,crew_done:false};
      const payload={row:updated,expectedUpdatedAt:before?.updated_at||null,commandId:context.global.crypto.randomUUID()},signature=JSON.stringify({...payload,commandId:undefined});payload.commandId=context.state.bunchRetries.get(signature)||payload.commandId;context.state.bunchRetries.set(signature,payload.commandId);
      const at=list.findIndex(x=>x.plan_id===id);if(at<0)list.push(updated);else list[at]=updated;context.state.pending.set(token,updated);
      const button=[...context.root.querySelectorAll('[data-planting-approve]')].find(el=>el.dataset.plantingApprove===id);if(button){button.textContent='✅ Approved Planting Location · Saving…';button.disabled=true;}
      context.state.error='Planting reservation updated · Saving…';context.scheduleStableViewRender();
      Promise.resolve().then(()=>context.request({table:'ph_dylan_decisions_store',operation:'save',payload})).then(result=>{if(result.row?.plan_id!==id||result.row.override_loc!==target||result.row.decision!==updated.decision)throw Error('Planting receipt did not match the reviewed plan.');list[list.findIndex(x=>x.plan_id===id)]=result.row;context.state.bunchRetries.delete(signature);context.state.error='✅ Planting saved; Bunch Notes reservations synchronized.';}).catch(()=>{const index=list.findIndex(x=>x.plan_id===id);if(before)list[index]=before;else list.splice(index,1);context.state.error='Planting was not saved. Prior reservation restored; target draft retained.';context.options.onBunchNoteError?.(context.state.error);}).finally(()=>{context.state.pending.delete(token);context.scheduleStableViewRender();});
    }

function nurseryTable_scheduleStableViewRender(context){if(context.stableRenderPending||context.state.destroyed)return;context.stableRenderPending=true;(context.global.requestAnimationFrame||context.global.setTimeout)(()=>{context.stableRenderPending=false;context.draw();});}

function nurseryTable_pdfCards(context, rows){return rows.map(p=>{const d=context.cardDraft(p);return {plan_id:p.plan_id,itemcode:p.itemcode,commonname:p.commonname,contsize:p.contsize,lotcode:String(context.readRow(p.row,'lotcode')),notes:p.saved?.notes||d.note,target:p.saved?.override_loc||d.choices.target,crew:d.choices.crew,tape:d.choices.tape,direction:d.choices.direction,qty:p.qty,available:p.available,updated_at:p.saved?.updated_at||''};});}

async function nurseryTable_downloadBunchPdf(context, location,rows,metrics){
      const builder=context.options.buildPdf||((...args)=>import(new URL('./services/bunch-note-pdf.mjs',document.baseURI).href).then(m=>m.buildBunchNotesBlockPdfDocument(...args)));
      const documentPdf=await builder(location,context.pdfCards(rows),metrics,context.options.approvedBy||'Reviewer');
      if(context.options.downloadPdf){context.options.downloadPdf(documentPdf);return documentPdf;}
      const bytes=Uint8Array.from(context.global.atob(documentPdf.base64),c=>c.charCodeAt(0)),url=context.global.URL.createObjectURL(new context.global.Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=documentPdf.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>context.global.URL.revokeObjectURL(url),60000);return documentPdf;
    }

function nurseryTable_approveInline(context, p,batch){
      const draft=context.cardDraft(p),checked=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,{...draft.choices,note:draft.note});
      if(!checked.canApprove||checked.bunchNoteIssues.length)throw Error('Review '+p.itemcode+': '+checked.blockers.map(b=>b[1]).concat(checked.bunchNoteIssues.map(i=>i.reason)).join(' '));
      context.state.draft=draft;return context.approveBunchIssue({close(){},remove(){},querySelector(){return {set textContent(value){context.state.error=value;}};}},p,checked,batch?draft:undefined);
    }

async function nurseryTable_approveLocation(context){
      if(context.state.sendPending)return;const rows=context.locationCards().filter(p=>!context.state.selectedCards||context.state.selectedCards.has(p.uid)),location=context.state.location,metrics=context.blockMetrics(location);
      try{
        if(!rows.length||context.state.loading||!context.cache.loaded||context.options.inventoryReady?.()===false||context.options.authorized?.()===false||context.options.inventory()!==context.state.contextInventory||context.options.revision?.()!==context.state.contextRevision)throw Error('Complete authorized nursery references are required before approval.');
        for(const p of rows){const draft=context.cardDraft(p),checked=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,{...draft.choices,note:draft.note});if(!checked.canApprove||checked.bunchNoteIssues.length)throw Error('Review '+p.itemcode+' before approving this location.');}
        context.state.sendPending=true;const button=context.root.querySelector('[data-bunch-send]');if(button)button.disabled=true;
        const saves=rows.map(p=>p.approved&&!p.saved?._optimistic&&p.saved?.notes===context.cardDraft(p).note?Promise.resolve():context.approveInline(p,true));
        context.model.publishBunchDecisions(context.options.identity,context.state.refs.ph_dylan_decisions_store||[]);
        const pdf=context.downloadBunchPdf(location,rows,metrics);
        await Promise.all([...saves,pdf]);
        if(rows.some(p=>!p.approved||p.saved?._optimistic||!p.saved?.updated_at||p.saved.notes!==context.cardDraft(p).note))throw Error('Some approvals are not confirmed. Your drafts are retained; retry to send the PDF.');
        if(context.state.destroyed||context.options.authorized?.()===false)return;
        const payload={locationCode:location,cards:context.pdfCards(rows),metrics},signature=JSON.stringify(payload);
        if(context.state.sendSignature!==signature){context.state.sendSignature=signature;context.state.sendCommandId=context.global.crypto.randomUUID();}
        const receipt=await context.options.sendPdf(payload,context.state.sendCommandId);
        if(!receipt?.eventId||!['sent','queued'].includes(receipt.status))throw Error('PDF email queue receipt was not confirmed.');
        context.state.error='✅ Approved '+rows.length+' Bunch Notes for '+location+' & '+(receipt.status==='sent'?'sent PDF email':'queued PDF email')+' to dylan_collyge!';
      }catch(error){context.state.error=error.message||'PDF email was not queued. Retry with your retained approvals.';context.options.onBunchNoteError?.(context.state.error);}
      finally{context.state.sendPending=false;if(!context.state.destroyed){const button=context.root.querySelector('[data-bunch-send]');if(button)button.disabled=false;const status=context.root.querySelector('[data-nursery-status]');if(status)status.textContent=context.state.error;}}
    }

function nurseryTable_handleBunchDrillClick(context, el){
      if(!el||!context.isNurseryWorkspace())return false;
      if(el.hasAttribute('data-bunch-reset')){context.state.alpha='';context.state.blockNumber='';context.state.bunchSimulatorDrillLevel='alpha';context.state.q='';context.drawBunchDrill(context.state.bunchData);return true;}
      if(el.dataset.bunchNumber){context.state.blockNumber=el.dataset.bunchNumber;context.state.bunchSimulatorDrillLevel='location';context.drawBunchDrill(context.state.bunchData);return true;}
      if(el.dataset.plantingApprove){context.approvePlanting(el.dataset.plantingApprove);return true;}
      if(el.dataset.plantingSource){const p=context.state.currentIssues.find(p=>p.uid===el.dataset.plantingSource);if(p){context.state.subview='table';context.state.alpha=p.location[0];context.state.blockNumber=p.location.slice(0,4);context.state.location=p.location;context.state.bunchSimulatorDrillLevel='cards';context.drawBunchDrill(context.state.bunchData);}return true;}
      if(el.hasAttribute('data-bunch-shell-back')){if(context.global.goBackUniversal)context.global.goBackUniversal();else if(!context.root.bunchSimulatorBack())context.options.back();return true;}
      if(el.dataset.bunchAlpha){context.state.alpha=el.dataset.bunchAlpha;context.state.bunchSimulatorDrillLevel='number';context.state.q='';context.drawBunchDrill(context.state.bunchData);return true;}
      if(el.dataset.bunchLocationOpen){context.state.location=el.dataset.bunchLocationOpen;context.state.bunchSimulatorDrillLevel='cards';context.state.cardFilter='all';context.state.selectedCards=new Set(context.locationCards().map(p=>p.uid));context.state.q='';context.drawBunchDrill(context.state.bunchData);return true;}
      if(el.hasAttribute('data-bunch-drill-back')){if(context.global.goBackUniversal)context.global.goBackUniversal();else context.root.bunchSimulatorBack();return true;}
      if(el.dataset.bunchCardFilter){context.state.cardFilter=el.dataset.bunchCardFilter;context.drawBunchDrill(context.state.bunchData);return true;}
      if(el.dataset.bunchCardApprove){try{context.approveInline(context.state.currentIssues.find(p=>p.uid===el.dataset.bunchCardApprove));}catch(error){context.state.error=error.message;context.root.querySelector('[data-nursery-status]').textContent=context.state.error;}return true;}
      if(el.hasAttribute('data-bunch-pdf')){void context.downloadBunchPdf(context.state.location,context.locationCards(),context.blockMetrics(context.state.location)).catch(error=>{context.state.error=error.message;context.root.querySelector('[data-nursery-status]').textContent=context.state.error;});return true;}
      if(el.hasAttribute('data-bunch-send')){void context.approveLocation();return true;}return false;
    }



async function nurseryTable_load(context){
      context.state.loading=true;context.state.error='';context.draw();
      try{await Promise.all(Object.keys(context.model.FIELDS).map(table => nurseryTable_loadReference(context, table)));}
      catch(error){context.state.error=error.message||'Reference refresh failed; retained data is still shown.';}
      finally{context.model.publishBunchDecisions?.(context.options.identity,context.state.refs.ph_dylan_decisions_store||[]);context.state.loading=false;context.cache.loaded=!context.state.error&&Object.keys(context.state.refs).length===Object.keys(context.model.FIELDS).length;context.draw();}
    }

async function nurseryTable_save(context, inputElement){
      const {nurseryTable:table,nurseryKey:key,nurseryEdit:field}=inputElement.dataset,token=table+':'+key;
      if(context.state.pending.has(token)){inputElement.value=String(context.state.pending.get(token)[field]??'');return;}
      const list=context.state.refs[table]||(context.state.refs[table]=[]),existing=list.find(row=>String(context.keyFor(table,row))===key),plan=table==='ph_dylan_decisions_store'?context.state.currentPlans.find(p=>p.plan_id===key):null;
      if(!existing&&!plan)return;
      const before=existing?{...existing}:null,base=existing||{plan_id:key,decision:plan.decision,override_loc:'',override_qty:null,notes:'',is_custom:'N',wf_type:plan.workflow,itemcode:plan.itemcode,commonname:plan.commonname,contsize:plan.contsize,lot_date:plan.lot,from_loc:plan.from,crew_done:false};
      const updated={...base,[field]:field==='crew_done'?inputElement.checked:context.numeric.has(field)?inputElement.value===''?null:Number(inputElement.value):inputElement.value};
      if(existing)Object.assign(existing,updated);else list.push(updated);
      context.state.pending.set(token,updated);context.state.error='';inputElement.dataset.saveState='pending';
      const payload={row:Object.fromEntries(context.model.FIELDS[table].filter(f=>updated[f]!==undefined).map(f=>[f,updated[f]])),expectedUpdatedAt:before?.updated_at||null,commandId:context.global.crypto.randomUUID()};
      try {const result=await context.request({table,operation:'save',payload});if(!result.row||String(context.keyFor(table,result.row))!==key)throw Error('Nursery save receipt did not match the row.');const index=list.findIndex(row=>String(context.keyFor(table,row))===key);list[index]=result.row;}
      catch(error){const index=list.findIndex(row=>String(context.keyFor(table,row))===key);if(before)list[index]=before;else if(index>=0)list.splice(index,1);context.state.error=error.message||'Save failed; the previous value was restored.';}
      finally{context.state.pending.delete(token);if(!context.state.destroyed)context.draw();}
    }

function nurseryTable_preparePlantingChoices(context, event){const el=event.target;if(!el.dataset.plantingTarget||el.dataset.choicesLoaded)return;const p=context.plantingRows().find(p=>p.plan_id===el.dataset.plantingTarget);if(!p)return;const value=el.value,choices=[...context.state.bunchData.locations.keys()].filter(loc=>context.plantingCheck(p,loc).ok);context.state.plantChoiceCache.set(p.plan_id,choices);el.innerHTML=[...new Set([value,...choices])].filter(Boolean).map(loc=>'<option '+(loc===value?'selected':'')+'>'+context.escape(loc)+'</option>').join('');el.dataset.choicesLoaded='true';}

function nurseryTable_change(context, event){const el=event.target;if(el.dataset.plantingTarget){context.state.plantDrafts.set(el.dataset.plantingTarget,el.value);context.drawBunchDrill(context.state.bunchData);return;}if(el.dataset.bunchSelect){context.state.selectedCards||=new Set(context.locationCards().map(p=>p.uid));if(el.checked)context.state.selectedCards.add(el.dataset.bunchSelect);else context.state.selectedCards.delete(el.dataset.bunchSelect);const status=context.root.querySelector('[data-nursery-status]');if(status)status.textContent=context.state.selectedCards.size+' cards selected for approval and PDF email.';return;}if(el.dataset.nurseryEdit){void context.save(el);return;}if(el.dataset.nurseryFilter){if(el.dataset.nurseryFilter==='view'&&context.options.selectView){context.options.selectView(el.value);return;}context.state[el.dataset.nurseryFilter]=el.value;context.state.page=0;context.draw();}if(el.dataset.nurseryBlock){const alpha=el.dataset.nurseryBlock==='alpha'?el.value:context.state.location[0],n=el.dataset.nurseryBlock==='number'?el.value:context.state.location.split('.')[1];context.state.location=alpha+'.'+String(n).padStart(2,'0')+'.000';context.state.page=0;context.draw();}}

function nurseryTable_click(context, event){const el=event.target.closest('button');if(context.handleBunchDrillClick(el))return;if(!el){const card=event.target.closest('[data-bunch-card]');if(card)context.showBunchIssue(card.dataset.bunchCard);return;}if(el.dataset.bunchSubview){context.state.subview=el.dataset.bunchSubview;context.state.page=0;context.draw();return;}if(el.dataset.bunchFilter){context.state.issueFilter=el.dataset.bunchFilter;context.state.page=0;context.draw();return;}if(el.dataset.bunchOpen){context.showBunchIssue(el.dataset.bunchOpen);return;}if(el.hasAttribute('data-nursery-back'))context.options.back();if(el.hasAttribute('data-nursery-refresh'))void context.load();if(el.dataset.nurseryPage){context.state.page+=Number(el.dataset.nurseryPage);context.draw();}}

function nurseryTable_onSearchInput(context, event){if(event.target.matches('[data-bunch-inline-note],[data-bunch-inline-target]')){const card=event.target.closest('[data-bunch-card]'),p=context.state.currentIssues.find(p=>p.uid===card.dataset.bunchCard),draft=context.cardDraft(p);if(event.target.hasAttribute('data-bunch-inline-note'))draft.note=event.target.value;else {draft.choices.target=event.target.value;draft.note=context.model.evaluateBunchNoteRowAndIssues(p.row,context.state.bunchContext,draft.choices).autoSuggestedBunchNote;card.querySelector('[data-bunch-inline-note]').value=draft.note;}return;}if(event.target.hasAttribute('data-nursery-search')){context.state.q=event.target.value;context.state.page=0;clearTimeout(context.state.searchTimer);context.state.searchTimer=setTimeout(()=>{const pos=event.target.selectionStart;context.draw();const search=context.root.querySelector('[data-nursery-search]');search?.focus();search?.setSelectionRange(pos,pos);},180);}}

function nurseryTable_onBunchSettled(context, event){if(context.state.destroyed||event.detail?.identity!==context.options.identity||context.options.authorized?.()===false)return;const p=context.state.currentIssues.find(p=>p.uid===event.detail.uid);if(!p)return;if(event.detail.rollback){context.draw();return;}const saved=(context.state.refs.ph_dylan_decisions_store||[]).find(r=>r.plan_id===p.plan_id);if(saved){p.saved=saved;p.approved=true;p.rawBunchNote=saved.notes;context.state.error='✅ Approved Bunch Note Created';context.patchBunchApproval(p);}}



function nurseryTable_keyFor(table, row) { return table==='ph_nursery_locations'?row.location_code:table==='ph_nursery_items_cpb'?row.itemcode:table==='ph_dylan_decisions_store'?row.plan_id:row.id; }

function nurseryTable_writable(context, table, field) { return field!==(table==='ph_nursery_locations'?'location_code':table==='ph_nursery_items_cpb'?'itemcode':table==='ph_dylan_decisions_store'?'plan_id':'id')&&context.model.FIELDS[table]?.includes(field); }

async function nurseryTable_request(context, body) {const generation=context.state.generation,result=await context.options.request(body);if(context.state.destroyed||generation!==context.state.generation)throw Error('Nursery account or view changed.');return result?.data||result;}

function nurseryTable_input(context, table, row, field) {const value=row[field],attrs=`data-nursery-edit="${context.escape(field)}" data-nursery-table="${table}" data-nursery-key="${context.escape(context.keyFor(table,row))}" aria-label="${context.escape(field)}"`;if(field==='decision')return `<select ${attrs}>${context.model.DECISIONS.map(d=>`<option ${d===value?'selected':''}>${context.escape(d)}</option>`).join('')}</select>`;if(field==='crew_done')return `<input type="checkbox" ${attrs} ${value?'checked':''}>`;return `<input ${attrs} type="${context.numeric.has(field)?'number':'text'}" ${context.numeric.has(field)?'step="any"':''} value="${context.escape(value)}" ${context.writable(table,field)?'':'readonly'}>`;}

function nurseryTable_readRow(row, ...keys) {for(const key of keys)if(row[key]!=null)return row[key];else if(row[key.toUpperCase()]!=null)return row[key.toUpperCase()];return '';}

function nurseryTable_photo(context, row) {const value=String(context.readRow(row,'photo_url','photo_link')).trim(),raw=context.global.getPhotoUrlList?.(value)?.[0]||value.split(/,(?=https?:)/)[0];return /^https:\/\//i.test(raw)?raw.replace(/\/storage\/v1\/render\/image\/public\//,'/storage/v1/object/public/'):'';}

function nurseryTable_roundBeds(value) { return Number(value||0).toFixed(2); }

function nurseryTable_isNurseryWorkspace(context) { return ['bunch-notes-simulator','prod-schedule'].includes(context.state.view); }

function nurseryTable_metricStrip(context, values) { return '<div class="bunch-card-metrics">'+values.map(([label,value])=>'<span>'+context.escape(label)+'<b>'+context.escape(value??'Unverified')+'</b></span>').join('')+'</div>'; }





async function nurseryTable_loadReference(context, table) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
        const result = await context.request({table, operation:'read', payload:{offset,limit:1000}});
        rows.push(...result.rows);
        if (result.rows.length < 1000) break;
    }
    if (!context.state.destroyed && ![...context.state.pending.keys()].some(key => key.startsWith(table + ':'))) {
        context.state.refs[table] = rows;
    }
}
