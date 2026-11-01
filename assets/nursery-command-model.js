(function (global) {
  'use strict';
  const DECISIONS = Object.freeze(['✅ APPROVE','🔧 MODIFY / BUILD ON','❌ REMOVE','➕ ADD TO PLAN','⏳ HOLD / ANCHOR']);
  const TABLES = Object.freeze([
    ['president-command-center','PRESIDENT_COMMAND_CENTER',null],
    ['approved-execution-plan','APPROVED_EXECUTION_PLAN',null],
    ['bunch-notes-simulator','BUNCH_NOTES_SIMULATOR',null],
    ['prod-schedule','PROD SCHEDULE 102726 (2026-10-29_1232)','ph_prod_schedule_active'],
    ['header-control','00_HEADER_CONTROL','ph_header_control'],
    ['water-rating','Water_Rating','ph_nursery_water_rating'],
    ['nursery-items','ITEMS','ph_nursery_items_cpb'],
    ['nursery-locations','LOCATIONS','ph_nursery_locations'],
    ['scientific-evidence','Scientific_Evidence_Log','ph_scientific_evidence_log']
  ].map(([id,label,relation]) => Object.freeze({id,label,relation,section:'editable',nursery:true,description:relation?'Maintained nursery reference data.':'Live Park Hill inventory and reviewed planting plans.'})));
  const FIELDS = Object.freeze({
    ph_nursery_locations:['location_code','block_alpha','block_number','house_orientation','permanent_shade','house_count','total_beds'],
    ph_nursery_items_cpb:['itemcode','cpb'],
    ph_nursery_water_rating:['id','genus','botanical_name','common_name','sort_name','water_rank','water_tier','hydro_zone','schedule_flag','dwu_1','dwu_2','dwu_3','dwu_5','dwu_7'],
    ph_scientific_evidence_log:['id','genus','water_rank','water_tier','hydro_zone','schedule_flag','dwu_1','dwu_2','dwu_3','dwu_5','dwu_7','evidence_notes'],
    ph_header_control:['id','source_tab','col_letter','col_index','raw_header_text','live_sample_values','assigned_category_dropdown','standardized_field_name','managing_gem'],
    ph_prod_schedule_active:['id','source_tab_name','line_id','itemcode','commonname','contsize','source','planned_qty','req_qty','cutoff_qty','cpb','beds_needed','target_loc','tier_label','plant_date','can_fill_date','staged_from'],
    ph_dylan_decisions_store:['plan_id','decision','override_loc','override_qty','notes','is_custom','wf_type','itemcode','commonname','contsize','lot_date','from_loc','crew_done']
  });
  const CPB = Object.freeze({'000':320,'007':3360,'008':728,'010':944,'011':944,'013':976,'0150':50,'016':540,'019':180,'020':516,'021':516,'022':248,'027':320,'028':540,'030':320,'031':320,'033':141,'050':176,'051':220,'055':120,'060':248,'061':100,'070':120,'071':120,'077':1544,'079':1544,'081':728,'083':333,'100':72,'111':944,'150':50,'250':32,'450':16,'920':516});
  const string = value => String(value ?? '').trim();
  const number = value => { const n=Number(string(value).replace(/,/g,'')); return Number.isFinite(n)?n:0; };
  const nameKey = value => string(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).sort().join(' ');
  const round = value => Math.round(value*100)/100;
  const value = (row,...names) => { for(const name of names) { if(row[name]!=null)return row[name]; if(row[name.toUpperCase()]!=null)return row[name.toUpperCase()]; } return ''; };
  const block = location => parseBlockAllocations(location)[0]?.location||'';
  const year = raw => { const full=string(raw).match(/(?:^|\D)(20\d{2})(?:\D|$)/);if(full)return Number(full[1]);const short=string(raw).match(/^(\d{2})(?:\.|$)/);return short?2000+Number(short[1]):0; };
  const tierLabels=['Tier 1 (Confirmed 2027 Sch — WH 10)','Tier 2 (2026 Historical Block — WH 10)','Tier 3 (2025 Historical Block — WH 10)','Tier 4 (27.F1/SY27 Block Rotation — WH 10)'];
  function parseBlockAllocations(raw){const text=string(raw);if(!text||['0','#N/A','FALSE'].includes(text.toUpperCase()))return [];const found=new Map();for(const m of text.matchAll(/\b([A-L])\.?0*(\d{1,2})\b(?:\s*=\s*(\d+(?:\.\d+)?))?/gi)){const n=Number(m[2]);if(n<1||n>26)continue;const location=m[1].toUpperCase()+'.'+String(n).padStart(2,'0')+'.000';found.set(location,(found.get(location)||0)+(number(m[3])>0?number(m[3]):1));}return [...found].map(([location,weight])=>({location,weight}));}
  function rotationIndex(inventory,locations,waterFor){
    const present=new Set(),byItem=new Map(),byGenus=new Map();
    const add=(index,key,location,qty)=>{if(!index.has(key))index.set(key,new Map());const map=index.get(key);map.set(location,(map.get(location)||0)+qty);};
    for(const row of inventory||[]){if(!string(value(row,'warehouse','warehousei','warehouseid','wh')).includes('10'))continue;const item=string(value(row,'itemcode'));present.add(item);if(/Y/i.test(string(value(row,'season'))+' '+string(value(row,'lotcode'))))continue;const location=block(value(row,'locationcode','location'));if(!locations.has(location))continue;const qty=Math.max(0,number(value(row,'onhand','ptronhand','on_hand','qtyonhand','quantityonhand','qty_on_hand'))),botanical=string(value(row,'botanicalname')),genus=string(value(row,'genusname','genus')||botanical.split(/\s+/)[0]).toUpperCase(),water=waterFor({commonname:value(row,'commonname'),botanical,genus});add(byItem,item,location,qty);if(genus&&water.hydro_zone)add(byGenus,genus+'|'+water.hydro_zone,location,qty);}
    return {present,byItem,byGenus};
  }
  function resolveScheduleTargets(row,locations,rotation,profile){
    const tiers=row.location_shield?.tiers;
    for(let tier=0;tier<3;tier++)for(const cell of row.location_shield?.tier_cells?.[tier]||[tiers?.[tier]||[]]){const candidates=cell.filter(candidate=>locations.has(block(candidate.location))).map(candidate=>({location:block(candidate.location),weight:number(candidate.weight)||1}));if(candidates.length)return {tier:tier+1,label:tierLabels[tier],candidates};}
    if(!tiers&&block(row.target_loc)&&locations.has(block(row.target_loc))&&/^Tier [1-3]/.test(row.tier_label||''))return {tier:1,label:row.tier_label,candidates:[{location:block(row.target_loc),weight:1}]};
    const genus=string(row.location_shield?.genus||profile.genus).toUpperCase(),shade=/CAMELLIA|AUCUBA|RHODODENDRON|AZALEA|HOSTA|FERN|ATHYRIUM|DRYOPTERIS|LEUCOTHOE/i.test(genus+' '+string(row.commonname));
    const candidates=rotation.present.has(row.itemcode)?rotation.byItem.get(row.itemcode):rotation.byGenus.get(genus+'|'+string(profile.hydro_zone));
    const selected=[...(candidates||[])].filter(([location])=>rotation.present.has(row.itemcode)||!shade||locations.get(location)?.permanent_shade==='Y').sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
    return {tier:4,label:tierLabels[3],candidates:selected?[{location:selected[0],weight:1}]:[]};
  }
  function allocatePlanting(row,resolved,cpb){
    const total=number(row.planned_qty),beds=cpb?round(total/cpb):0,weight=resolved.candidates.reduce((sum,c)=>sum+c.weight,0);let priorQty=0,priorBeds=0;
    return resolved.candidates.map((candidate,index)=>{const last=index===resolved.candidates.length-1,qty=last?round(total-priorQty):round(total*candidate.weight/weight),partBeds=last?round(beds-priorBeds):round(beds*candidate.weight/weight);priorQty+=qty;priorBeds+=partBeds;return {target:candidate.location,qty,beds:partBeds,tier:resolved.label};});
  }
  function compile(inventory, references, filters={}) {
    const locations=new Map((references.ph_nursery_locations||[]).map(row=>[row.location_code,{...row,occupied:0,reserved:0,prior:0}]));
    const cpbs=new Map((references.ph_nursery_items_cpb||[]).map(row=>[row.itemcode,number(row.cpb)]));
    const water=references.ph_nursery_water_rating||[], evidence=references.ph_scientific_evidence_log||[],waterByGenus=new Map();for(const row of water)if(row.genus&&!waterByGenus.has(string(row.genus).toUpperCase()))waterByGenus.set(string(row.genus).toUpperCase(),row);
    const waterByName=new Map(); for(const row of water)for(const field of ['common_name','botanical_name','sort_name'])if(row[field])waterByName.set(nameKey(row[field]),row);
    const decisions=new Map((references.ph_dylan_decisions_store||[]).map(row=>[row.plan_id,row]));
    const cpbFor=(item,explicit)=>cpbs.get(item)||number(explicit)||CPB[item.split('.')[1]]||0;
    const waterFor=row=>waterByName.get(nameKey(row.commonname))||waterByName.get(nameKey(row.botanical))||waterByGenus.get(string(row.genus||row.location_shield?.genus||string(row.botanical).split(/\s+/)[0]).toUpperCase())||{};
    const rotation=rotationIndex(inventory,locations,waterFor);
    const groups=new Map();
    for(const row of inventory||[]) {
      if(!string(value(row,'warehouse','warehousei','warehouseid','wh')).includes('10'))continue;
      const itemcode=string(value(row,'itemcode')),location=block(value(row,'locationcode','location')),qty=Math.max(0,number(value(row,'onhand','ptronhand','on_hand','qtyonhand','quantityonhand','qty_on_hand')));
      if(!itemcode||!locations.has(location)||qty<=0)continue;
      const lot=string(value(row,'lotcode','lot_date','lotdate')),source=string(value(row,'source')),salesYear=year(value(row,'salesyear','saleyear','sales_year')||lot),hold=/\bY\b/i.test(string(value(row,'season')))||/\.Y(?:\b|$)/i.test(lot);
      const key=[itemcode,location,source,salesYear,hold?'Y':'crop'].join('|');
      let group=groups.get(key);
      if(!group){group={itemcode,location,source,salesYear,hold,qty:0,rowCount:0,commonname:string(value(row,'commonname')),contsize:string(value(row,'contsize')),botanical:string(value(row,'botanicalname')),lots:new Set(),cpb:cpbFor(itemcode,value(row,'cpb'))};groups.set(key,group);}
      group.qty+=qty;group.rowCount++;group.lots.add(lot);
    }
    const all=[...groups.values()];
    for(const row of all){row.beds=row.cpb?row.qty/row.cpb:0;row.water=waterFor(row);row.evidence=evidence.find(e=>string(e.genus).toLowerCase()===string(row.water.genus).toLowerCase());locations.get(row.location).occupied+=row.beds;}
    const activeYear=number(filters.year)||2027,season=string(filters.season)||'F1',plans=[];
    const identity=(kind,parts)=>kind+'-'+parts.map(part=>encodeURIComponent(string(part))).join('-');
    const applyDecision=plan=>{
      const saved=decisions.get(plan.plan_id)||{}; Object.assign(plan,{decision:plan.score===100?DECISIONS[0]:DECISIONS[4],override_loc:'',override_qty:null,notes:'',crew_done:false},saved);
      plan.final_target=block(plan.override_loc)||plan.target;
      plan.final_qty=plan.override_qty==null||plan.override_qty===''?plan.qty:Math.max(0,number(plan.override_qty));
      plan.final_beds=plan.cpb?plan.final_qty/plan.cpb:0;
      plan.approved=DECISIONS.slice(0,2).concat(DECISIONS[3]).includes(plan.decision);
      return plan;
    };
    // All active plantings reserve their resolved beds before any consolidation allocation.
    for(const row of references.ph_prod_schedule_active||[]) {
      const scheduleYear=string(row.line_id).match(/^\.?(\d{4}|\d{2})(?:\.|$)/)?.[1];
      const dateYear=year(scheduleYear)||year(row.plant_date);if(dateYear&&dateYear!==activeYear)continue;
      const qty=number(row.planned_qty);if(qty<=0||string(row.source)==='>')continue;
      const cpb=number(row.cpb)>0?number(row.cpb):cpbFor(row.itemcode),profile=waterFor(row),resolved=resolveScheduleTargets(row,locations,rotation,profile),allocations=allocatePlanting(row,resolved,cpb);
      if(!allocations.length)allocations.push({target:'',qty,beds:cpb?round(qty/cpb):0,tier:resolved.label+' — HOLD: no matching block'});
      for(const allocation of allocations){
        const {target,beds}=allocation,loc=locations.get(target),before=loc?round(number(loc.total_beds)-loc.occupied-loc.reserved-loc.prior):0,gates=[!!loc,cpb>0,!!row.source&&row.source!=='>',dateYear===activeYear,beds<=before,!!profile.hydro_zone,!!loc?.house_orientation&&!!loc?.permanent_shade];
        const plan=applyDecision({plan_id:identity('PLT',[row.line_id||row.id,row.itemcode,row.plant_date,...(allocations.length>1?[target]:[])]),workflow:'🌱 NEXT PLANTING',tier:allocation.tier,itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,lot:row.plant_date,source:row.source,qty:allocation.qty,cpb,beds,from:row.staged_from||row.source,target,open:before,water:profile,score:round(gates.filter(Boolean).length/7*100),explanation:['Resolved location','CPB','Source','Sales year','Reserved capacity','Hydro-zone','Documented block compatibility'].map((label,i)=>label+': '+(gates[i]?'OK':'review')).join(' | ')});
        if(loc)loc.reserved=round(loc.reserved+beds);
        plans.push(plan);
      }
    }
    all.sort((a,b)=>a.qty-b.qty||a.itemcode.localeCompare(b.itemcode));
    const peersByItem=new Map();for(const row of all){if(!peersByItem.has(row.itemcode))peersByItem.set(row.itemcode,[]);peersByItem.get(row.itemcode).push(row);}
    for(const row of all) {
      const peers=peersByItem.get(row.itemcode).filter(other=>other!==row&&other.location!==row.location);
      const src=locations.get(row.location);
      const targets=peers.filter(other=>(other.qty>row.qty||(other.qty===row.qty&&other.location<row.location))).sort((a,b)=>b.qty-a.qty||a.location.localeCompare(b.location));
      let chosen=null,gates=[];
      for(const candidate of targets){
        const dest=locations.get(candidate.location),available=round(number(dest.total_beds)-dest.occupied-dest.reserved-dest.prior);
        const candidateGates=[!row.hold&&!candidate.hold,row.qty>0&&row.cpb>0,!!row.source&&row.source===candidate.source,!!row.salesYear&&row.salesYear===candidate.salesYear,row.beds<=available,!!row.water.hydro_zone&&row.water.hydro_zone===candidate.water.hydro_zone,src.permanent_shade===dest.permanent_shade&&src.house_orientation===dest.house_orientation];
        if(candidateGates.every(Boolean)){chosen=candidate;gates=candidateGates;break;}
        if(!gates.length)gates=candidateGates;
      }
      const destination=chosen?locations.get(chosen.location):null,score=gates.filter(Boolean).length/7*100;
      const plan=applyDecision({plan_id:identity('MOV',[row.itemcode,row.location,row.source,row.salesYear,row.hold?'Y':'crop']),workflow:'🚚 CONSOLIDATION MOVE',tier:row.hold?'Season Y — hold for up-can':!peers.length?'Sole location — anchor':!chosen?'No compatible destination':row.salesYear<activeYear?'P1: Carryover move':[...row.lots].some(l=>l.includes(season))?'P2: Active-season move':'P3: Sales-year wave move',itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,lot:[...row.lots].sort().join(', '),source:row.source,qty:row.qty,cpb:row.cpb,beds:row.beds,from:row.location,target:chosen?.location||'',open:destination?round(number(destination.total_beds)-destination.occupied-destination.reserved-destination.prior):0,water:row.water,score:chosen?100:round(score),explanation:['Hold/Y','Whole group / CPB','Source','Sales year','Planting capacity shield','Hydro-zone','Shade / orientation'].map((name,i)=>name+': '+(gates[i]?'OK':'review')).join(' | ')+' | Other locations: '+(peers.map(p=>p.location+' ('+p.qty+')').join(', ')||'none')});
      if(plan.approved&&plan.final_target&&plan.final_qty<=row.qty&&locations.has(plan.final_target)){locations.get(plan.final_target).prior=round(locations.get(plan.final_target).prior+plan.final_beds);}
      plans.push(plan);
    }
    const selected=filters.location||'G.10.000',filter=filters.mode||'ALL_MOVES_AND_PLANTINGS';
    const visible=plans.filter(p=>(selected==='ALL_LOCATIONS'||p.from===selected||p.final_target===selected)&&(filter!=='PRIORITY_MOVES_ONLY'||p.workflow.includes('MOVE'))&&(filter!=='NEXT_PLANTINGS_ONLY'||p.workflow.includes('PLANTING')));
    const execution=plans.filter(p=>p.approved&&p.final_target&&p.final_qty>0).sort((a,b)=>a.final_target.localeCompare(b.final_target,undefined,{numeric:true})||a.from.localeCompare(b.from)||a.plan_id.localeCompare(b.plan_id));
    const selectedLocations=selected==='ALL_LOCATIONS'?[...locations.values()]:[locations.get(selected)].filter(Boolean);
    const total=selectedLocations.reduce((sum,l)=>sum+number(l.total_beds),0),occupied=selectedLocations.reduce((sum,l)=>sum+l.occupied,0),reserved=selectedLocations.reduce((sum,l)=>sum+l.reserved,0),prior=selectedLocations.reduce((sum,l)=>sum+l.prior,0);
    const kpis={'Selected Location Total Beds':round(total),'Occupied Beds':round(occupied),'Reserved Planting Beds':round(reserved),'Unreserved Open Beds':round(Math.max(0,total-occupied-reserved-prior)),'Shade / Orientation':selectedLocations.length===1?(selectedLocations[0].permanent_shade+' / '+selectedLocations[0].house_orientation):'Mixed','Suggestions Shown':visible.length,'✅ Approved / Modified':visible.filter(p=>p.approved).length,'❌ Removed':visible.filter(p=>p.decision===DECISIONS[2]).length,'Mean 7-Gate Compatibility':round(visible.reduce((sum,p)=>sum+p.score,0)/(visible.length||1))+'%','Approved Move / Plant Beds':round(visible.filter(p=>p.approved).reduce((sum,p)=>sum+p.final_beds,0))};
    return {plans,visible,execution,kpis,locations,groups:all};
  }
  global.GncNurseryModel=Object.freeze({TABLES,FIELDS,CPB,DECISIONS,compile,block,number,year,parseBlockAllocations,resolveScheduleTargets});
})(typeof window==='undefined'?globalThis:window);
