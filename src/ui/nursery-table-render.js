export function nurseryTable_patchBunchApproval(context, p){
      context.state.bodySignature=null;
      const card=[...context.root.querySelectorAll('[data-bunch-card]')].find(el=>el.dataset.bunchCard===p.uid);
      if (card) nurseryTable_patchApprovedCard(context, card, p);
      const status=context.root.querySelector('[data-nursery-status]');if(status)status.textContent=context.state.error;
      const issues=context.root.querySelector('[data-bunch-subview="issues"]');if(issues)issues.textContent='⚠️ Issues ('+context.state.currentIssues.filter(p=>!p.approved&&p.bunchNoteIssues.length).length+')';
    }

export function nurseryTable_commitBunchMarkup(context, top,body,level){
      let shell=context.root.querySelector('.bunch-drill-shell');
      if(!shell){context.root.innerHTML='<section class="nursery-shell bunch-drill-shell"><div class="bunch-drill-top"></div><div class="bunch-drill-scroll"></div><p role="status" data-nursery-status></p></section>';shell=context.root.querySelector('.bunch-drill-shell');}
      shell.dataset.bunchDrillLevel=level;shell.dataset.bunchReady=String(!context.state.loading&&context.cache.loaded);
      const head=shell.querySelector('.bunch-drill-top'),scroll=shell.querySelector('.bunch-drill-scroll'),scrollTop=scroll.scrollTop;
      if(context.state.topSignature!==top){head.innerHTML=top;context.state.topSignature=top;}
      if(context.state.bodySignature!==body){
        const template=document.createElement('template');template.innerHTML=body;
        const key=el=>el.dataset.bunchCard||el.dataset.plantingCard;
        const previous=new Map([...scroll.children].map(el=>[key(el),el]).filter(([k])=>k));
        if(previous.size&&[...template.content.children].every(el=>key(el))){
          nurseryTable_patchCardNodes(scroll, template, key, previous);
        }else scroll.replaceChildren(template.content);
        context.state.bodySignature=body;scroll.scrollTop=scrollTop;
      }
      shell.querySelector('[data-nursery-status]').textContent=context.state.error||'';
    }

export function nurseryTable_drawBunchDrill(context, data){
      if(context.state.bunchData!==data)context.state.plantChoiceCache=new Map();
      context.state.bunchData=data;const all=context.state.currentIssues,q=context.state.q.toLowerCase(),level=context.state.bunchSimulatorDrillLevel,planting=context.state.subview==='planting',plans=context.plantingRows(),issues=all.filter(p=>!p.approved&&p.bunchNoteIssues.length),cards=context.locationCards();
      const rows=planting?plans.map(p=>({...p,location:p.final_target||'UNASSIGNED'})):all;
      const locations=[...new Set(planting?rows.map(p=>p.location):[...data.locations.keys(),...all.map(p=>p.location)])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      const tabs='<nav class="bunch-drill-line bunch-subviews" aria-label="Nursery workspace">'+[['table','BUNCH NOTES'],['planting','PLANTING'],['issues','ISSUES ('+issues.length+')'],['rules','RULES (13)']].map(([key,label])=>'<button data-bunch-subview="'+key+'" aria-pressed="'+(context.state.subview===key)+'">'+label+'</button>').join('')+'</nav>';
      const crumbs='<div class="bunch-drill-line"><button data-bunch-shell-back aria-label="Global Back">←</button><button data-bunch-reset>LOCATION</button>'+(context.state.alpha?' &gt; BLOCK '+context.escape(context.state.alpha):'')+(level==='location'||level==='cards'?' &gt; '+context.escape(context.state.blockNumber):'')+(level==='cards'?' &gt; '+context.escape(context.state.location):'')+'<button data-bunch-reset>RESET FILTERS</button></div>';
      let body='',actions='';
      const rowButton=(attrs,title,detail)=>'<button class="bunch-drill-card app-drive-compact-card" '+attrs+'><strong>'+context.escape(title)+'</strong><span>'+context.escape(detail)+'</span><b aria-hidden="true">›</b></button>';
      publishNurseryDrillExcelSnapshot(context, rows, planting ? rows.filter(row => row.location === context.state.location) : cards, planting, level, q);
      ({body, actions} = nurseryTable_drillProjection(context, all, q, level, planting, rows, locations, cards, rowButton));
      const top=tabs+crumbs+actions+(level==='alpha'?'<input type="search" data-nursery-search aria-label="Search blocks, locations or plants" placeholder="Search blocks, locations or plants" value="'+context.escape(context.state.q)+'">':'');
      context.commitBunchMarkup(top,body||'<p>No matching rows.</p>',level);
    }

export function nurseryTable_draw(context){
      if(context.state.destroyed||!context.root.isConnected)return;
      const view=context.model.TABLES.find(t=>t.id===context.state.view),isPlan=context.isNurseryWorkspace()||!view.relation,data=isPlan?context.model.compile(context.options.inventory(),context.state.refs,context.state):{plans:[],kpis:{}};
      let rows,headers,render;
      if(['bunch-notes-simulator','prod-schedule','approved-execution-plan'].includes(context.state.view)){context.state.contextInventory=context.options.inventory();context.state.contextRevision=context.options.revision?.();context.state.bunchContext=context.model.buildBunchNoteContext(context.state.contextInventory,context.state.refs,data);context.state.currentIssues=[...context.state.bunchContext.byUid.values()].map(row=>context.model.evaluateBunchNoteRowAndIssues(row,context.state.bunchContext));}

      if(context.isNurseryWorkspace()){context.drawBunchDrill(data);context.state.currentPlans=data.plans;return;}
      ({rows, headers, render} = nurseryTable_tableProjection(context, view, data));
      const q=context.state.q.toLowerCase();rows=rows.filter(row=>(!q||JSON.stringify(row).toLowerCase().includes(q))&&(!context.state.columnValue||String(row[context.state.column]??'').toLowerCase().includes(context.state.columnValue.toLowerCase())));
      publishNurseryExcelSnapshot(context, rows, headers, render);
      context.state.page=Math.min(context.state.page,Math.max(0,Math.ceil(rows.length/100)-1));
      const kpis=context.state.view==='bunch-notes-simulator'?Object.entries({'Selected Block Total Beds':data.kpis['Selected Location Total Beds'],'Occupied Beds (Live WH 10)':data.kpis['Occupied Beds'],'Reserved Beds (Next Planting WH 10)':data.kpis['Reserved Planting Beds'],'Unreserved Open Beds':data.kpis['Unreserved Open Beds'],'Block Utilization %':((data.kpis['Occupied Beds']+data.kpis['Reserved Planting Beds'])/(data.kpis['Selected Location Total Beds']||1)*100).toFixed(1)+'%','Block Row Count':data.groups.filter(row=>row.location===context.state.location).reduce((sum,row)=>sum+row.rowCount,0),'Shade / Orientation':data.kpis['Shade / Orientation']}):Object.entries(data.kpis);
      const filters = nurseryTable_filterControls(context, data, headers, isPlan);
      context.root.innerHTML=`<section class="nursery-shell"><header><button data-nursery-back>All tables</button><h2>${context.escape(view.label)}</h2><select aria-label="Nursery view" data-nursery-filter="view">${context.model.TABLES.map(t=>`<option value="${t.id}" ${t.id===context.state.view?'selected':''}>${context.escape(t.label)}</option>`).join('')}</select><p>Live Park Hill inventory · Planning changes do not move inventory. Water references are imported workbook claims.</p></header><div class="nursery-toolbar">${context.state.view==='bunch-notes-simulator'?`<nav class="bunch-subviews" aria-label="Bunch Note workspace"><button data-bunch-subview="table" aria-pressed="${context.state.subview==='table'}">📋 Simulator Table (${context.state.currentIssues.length})</button><button data-bunch-subview="issues" aria-pressed="${context.state.subview==='issues'}">⚠️ Issues (${context.state.currentIssues.filter(p=>!p.approved&&p.bunchNoteIssues.length).length})</button><button data-bunch-subview="rules" aria-pressed="${context.state.subview==='rules'}">📏 Bunch Note Rules (13 Rules)</button></nav>`:''}${filters}<label>Search <input type="search" data-nursery-search value="${context.escape(context.state.q)}"></label><button data-nursery-refresh>Refresh reference data</button></div>${isPlan&&(context.state.view!=='bunch-notes-simulator'||context.state.subview==='table')?`<div class="nursery-kpis">${kpis.map(([name,v])=>`<div><span>${context.escape(name)}</span><strong>${context.escape(v)}</strong></div>`).join('')}</div>`:''}<p role="status" data-nursery-status>${context.escape(context.state.error|| (context.state.pending.size?'Saving '+context.state.pending.size+' change(s)…':context.state.loading?'Loading reference data…':'Changes saved'))}</p>${context.state.view==='bunch-notes-simulator'&&context.state.subview!=='table'?context.bunchPanel(rows):`<div class="nursery-scroll"><table><thead><tr>${headers.map(h=>`<th>${context.escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(context.state.page*100,context.state.page*100+100).map((row,i)=>`<tr>${render(row,i).map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">${context.state.loading?'Loading…':'No matching rows.'}</td></tr>`}</tbody></table></div>`}<footer><button data-nursery-page="-1" ${context.state.page===0?'disabled':''}>Previous</button><span>${rows.length.toLocaleString()} rows · Page ${context.state.page+1}</span><button data-nursery-page="1" ${(context.state.page+1)*100>=rows.length?'disabled':''}>Next</button></footer></section>`;
      context.state.currentPlans=data.plans;
    }

export function nurseryTable_tableProjection(context, view, data) {
    let rows, headers, render;
    if (view.relation) {
headers=context.model.FIELDS[view.relation];rows=context.state.refs[view.relation]||[];render=row=>headers.map(field=>context.input(view.relation,row,field));
        return {rows, headers, render};
    }
    if (context.state.view==='approved-execution-plan') {
headers=context.execution;rows=data.execution.concat((context.state.currentIssues||[]).filter(p=>p.approved).map(p=>({...p,workflow:'BUNCH NOTE',decision:p.saved.decision,final_target:p.saved.override_loc||p.from,final_qty:p.saved.override_qty,final_beds:0,lot:context.readRow(p.row,'lotcode'),water:{},explanation:'Approved exact-row Bunch Note',notes:p.saved.notes}))).filter(p=>context.state.location==='ALL_LOCATIONS'||p.from===context.state.location||p.final_target===context.state.location);render = (p,i) => nurseryTable_executionCells(context,p,i);
        return {rows, headers, render};
    }
    if (context.state.view==='bunch-notes-simulator') {
headers=['ITEMCODE','COMMONNAME','CONTSIZE','LOCATION','LOT / DATE','ON HAND','AVAILABLE','WATER mL/day','CURRENT BUNCH NOTE','AUTO-SUGGESTED BUNCH NOTE','STATUS'];rows=context.state.currentIssues.filter(p=>context.state.location==='ALL_LOCATIONS'||p.from===context.state.location);render=p=>[p.itemcode,p.commonname,p.contsize,p.from,context.readRow(p.row,'lotcode'),p.qty,p.available,p.water??'Unverified',p.rawBunchNote,p.autoSuggestedBunchNote,nurseryTable_issueStatus(p)].map(context.escape);
        return {rows, headers, render};
    }
headers=context.president;rows=data.visible;render=p=>[context.escape(p.plan_id),...['decision','override_loc','override_qty','notes'].map(f=>context.input('ph_dylan_decisions_store',p,f)),context.escape(p.score+'%'),'Specialists → Shield Supervisor → Schedule Manager → President',...['workflow','tier','itemcode','commonname','contsize','lot','source','qty','cpb'].map(f=>context.escape(p[f])),p.beds.toFixed(2),context.escape(p.from),context.escape(p.target||'Review required'),context.escape(p.open.toFixed(2)+' → '+(p.open-p.final_beds).toFixed(2)),context.escape(context.waterText(p)),context.escape(p.explanation)];
    return {rows, headers, render};
}

export function nurseryTable_drillProjection(context, all, q, level, planting, rows, locations, cards, rowButton) {
    let body = '', actions = '';
    if (['issues','rules'].includes(context.state.subview)) {
body=context.bunchPanel(all)
        return {body, actions};
    }
    if (level==='alpha') {
body='<div class="bunch-alpha-grid">'+'0ABCDEFGHIJKL'.split('').filter(a=>!q||rows.some(p=>p.location.startsWith(a+'.')&&(p.itemcode+' '+p.commonname+' '+p.location).toLowerCase().includes(q))||a.toLowerCase()===q).map(a=>{const subset=rows.filter(p=>p.location.startsWith(a+'.')),numbers=new Set(locations.filter(l=>l.startsWith(a+'.')).map(l=>l.slice(0,4)));return rowButton('data-bunch-alpha="'+a+'"',a,subset.length+(planting?' SCHEDULED PLANTINGS':' ROWS')+' · '+numbers.size+' BLOCK NUMBERS · '+(nurseryTable_alphaDetail(context, subset, planting)));}).join('')+(planting&&rows.some(p=>p.location==='UNASSIGNED')?rowButton('data-bunch-location-open="UNASSIGNED"','UNASSIGNED / FALLBACK UNRESOLVED','Review compatible location before approval'):'')+'</div>'
        return {body, actions};
    }
    if (level==='number') {
body=[...new Set(locations.filter(l=>l.startsWith(context.state.alpha+'.')).map(l=>l.slice(0,4)))].map(n=>rowButton('data-bunch-number="'+n+'"',n,locations.filter(l=>l.startsWith(n+'.')).length+' full locations / bays')).join('')
        return {body, actions};
    }
    if (level==='location') {
body=locations.filter(loc=>loc.startsWith(context.state.blockNumber+'.')).map(loc=>rowButton('data-bunch-location-open="'+context.escape(loc)+'"',loc,rows.filter(p=>p.location===loc).length+' ROWS · '+context.bedLabel(context.blockMetrics(context.model.block(loc))))).join('')
        return {body, actions};
    }
    if (planting) {
const m=context.blockMetrics(context.model.block(context.state.location)),freed=all.filter(p=>p.approved&&p.from===context.model.block(context.state.location)&&p.saved?.override_loc&&p.saved.override_loc!==p.from).reduce((sum,p)=>sum+(context.state.bunchContext.cpbFor(p.row)?p.qty/context.state.bunchContext.cpbFor(p.row):0),0);body='<p class="bunch-capacity">Total Beds: '+context.roundBeds(m.total)+' · Currently Occupied: '+context.roundBeds(m.occupied)+' · Planned Beds Freed by Bunch Notes Hauls: +'+context.roundBeds(freed)+' · Net Open Beds for Planting: '+context.roundBeds(m.open)+' · Beds Required by 2027 Plantings: '+context.roundBeds(m.reserved)+'</p>'+plans.filter(p=>(p.final_target||'UNASSIGNED')===context.state.location).map(context.plantingCard).join('');
        return {body, actions};
    }
const m=context.blockMetrics(context.model.block(context.state.location));actions='<div class="bunch-drill-line"><button data-bunch-pdf>📄 DOWNLOAD PDF</button><button data-bunch-send '+(context.state.sendPending?'disabled':'')+'>✅ APPROVE LOCATION &amp; EMAIL PDF TO dylan_collyge</button></div>';body='<p class="bunch-capacity">Thread: '+context.escape([...new Set(cards.map(p=>p.thread))].join(' / '))+' · Walk: '+context.escape(cards[0]?.direction||'Unverified')+' · '+context.bedLabel(m)+'</p>'+cards.filter(p=>!q||(p.itemcode+' '+p.commonname).toLowerCase().includes(q)).map(context.reviewCard).join('');
    return {body, actions};
}

function nurseryTable_patchApprovedCard(context, card, p) {
    if (context.state.subview === 'table' && context.state.bunchSimulatorDrillLevel === 'cards') {
        const badge = card.querySelector('[data-bunch-card-status]');
        if (badge) badge.textContent = nurseryTable_approvalLabel(p);
        return;
    }
    if (p.approved && context.state.issueFilter !== 'approved') card.remove();
    else card.outerHTML = context.issueCard(p);
}

function nurseryTable_approvalLabel(p) {
    if (!p.approved) return 'Review required';
    return '✅ Approved' + (p.saved?._optimistic ? ' · Saving…' : '');
}

function nurseryTable_patchCardNodes(scroll, template, key, previous) {
    for (const next of [...template.content.children]) {
        const old = previous.get(key(next));
        if (!old) { scroll.append(next); continue; }
        previous.delete(key(next));
        if (old.outerHTML !== next.outerHTML && !old.contains(document.activeElement)) old.replaceWith(next);
    }
    for (const old of previous.values()) old.remove();
}

function nurseryTable_executionCells(context, p, i) {
    const values = [context.input('ph_dylan_decisions_store',p,'crew_done'),i+context.state.page*100+1,p.plan_id,p.decision,p.workflow,p.from,p.final_target,p.itemcode,p.commonname,p.contsize,p.lot,p.source,p.final_qty,p.final_beds.toFixed(2),context.waterText(p),p.explanation+' | '+p.notes];
    return values.map((value,index) => index === 0 ? value : context.escape(value));
}

function nurseryTable_filterControls(context, data, headers, isPlan) {
    if (!isPlan) return `<label>Filter column <select data-nursery-filter="column"><option value="">All columns</option>${headers.map(field=>`<option ${context.state.column===field?'selected':''}>${field}</option>`).join('')}</select></label><label>Contains <input data-nursery-filter="columnValue" value="${context.escape(context.state.columnValue)}"></label>`;
    return `<label>Active Season <input data-nursery-filter="season" value="${context.escape(context.state.season)}"></label><label>Active Sales Year <input type="number" data-nursery-filter="year" value="${context.escape(context.state.year)}"></label>${context.state.view==='bunch-notes-simulator'?`<label>BLOCKALPHA <select data-nursery-block="alpha">${'ABCDEFGHIJKL'.split('').map(a=>`<option ${context.state.location.startsWith(a+'.')?'selected':''}>${a}</option>`).join('')}</select></label><label>BLOCKNUMBER <input type="number" min="1" max="99" data-nursery-block="number" value="${Number(context.state.location.split('.')[1])||10}"></label>`:''}<label>Filter Location Code <select data-nursery-filter="location"><option ${context.state.location==='ALL_LOCATIONS'?'selected':''}>ALL_LOCATIONS</option>${[...data.locations.keys()].map(loc=>`<option ${context.state.location===loc?'selected':''}>${loc}</option>`).join('')}</select></label><label>View Filter <select data-nursery-filter="mode">${['ALL_MOVES_AND_PLANTINGS','PRIORITY_MOVES_ONLY','NEXT_PLANTINGS_ONLY'].map(mode=>`<option ${context.state.mode===mode?'selected':''}>${mode}</option>`).join('')}</select></label>`;
}

function nurseryTable_alphaDetail(context, subset, planting) {
    if (planting) return context.roundBeds(subset.reduce((sum,p) => sum + p.final_beds,0)) + ' BEDS NEEDED';
    return subset.filter(p => p.approved).length + '/' + subset.length + ' BUNCH NOTES';
}

function nurseryTable_issueStatus(p) {
    if (p.approved) return p.saved?._optimistic ? '✅ Approved Bunch Note Created · Saving…' : '✅ Approved Bunch Note Created';
    return p.bunchNoteIssues.length + ' issues';
}
