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
  const block = location => { const m=string(location).toUpperCase().match(/^([A-L])\.(\d{1,2})(?:\.|$)/);return m?`${m[1]}.${m[2].padStart(2,'0')}.000`:''; };
  const year = raw => { const full=string(raw).match(/(?:^|\D)(20\d{2})(?:\D|$)/);if(full)return Number(full[1]);const short=string(raw).match(/^(\d{2})(?:\.|$)/);return short?2000+Number(short[1]):0; };
  function compile(inventory, references, filters={}) {
    const locations=new Map((references.ph_nursery_locations||[]).map(row=>[row.location_code,{...row,occupied:0,reserved:0}]));
    const cpbs=new Map((references.ph_nursery_items_cpb||[]).map(row=>[row.itemcode,number(row.cpb)]));
    const water=references.ph_nursery_water_rating||[], evidence=references.ph_scientific_evidence_log||[];
    const waterByName=new Map(); for(const row of water)for(const field of ['common_name','botanical_name','sort_name'])if(row[field])waterByName.set(nameKey(row[field]),row);
    const decisions=new Map((references.ph_dylan_decisions_store||[]).map(row=>[row.plan_id,row]));
    const cpbFor=(item,explicit)=>cpbs.get(item)||number(explicit)||CPB[item.split('.')[1]]||0;
    const waterFor=row=>waterByName.get(nameKey(row.commonname))||waterByName.get(nameKey(row.botanical))||water.find(w=>w.genus&&string(row.botanical).toLowerCase().startsWith(string(w.genus).toLowerCase()))||{};
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
    // Reserve known scheduled destinations before considering any consolidation.
    for(const row of references.ph_prod_schedule_active||[]) {
      const dateYear=year(string(row.line_id).replace(/^\./,''))||year(row.plant_date);if(dateYear&&dateYear!==activeYear)continue;
      const target=block(row.target_loc),cpb=cpbFor(row.itemcode,row.cpb),qty=Math.max(0,number(row.cutoff_qty??row.planned_qty)),beds=cpb?qty/cpb:0;
      if(!qty)continue;
      const loc=locations.get(target),before=loc?Math.max(0,number(loc.total_beds)-loc.occupied-loc.reserved):0;
      const profile=waterFor(row),gates=[!!loc,cpb>0,!!row.source&&row.source!=='>',dateYear===activeYear,beds<=before,!!profile.hydro_zone,!!loc?.house_orientation&&!!loc?.permanent_shade&&/^Tier [1-4]/.test(row.tier_label||'')];
      const valid=gates.every(Boolean);
      const plan=applyDecision({plan_id:identity('PLT',[row.line_id||row.id,row.itemcode,row.plant_date]),workflow:'🌱 NEXT PLANTING',tier:row.tier_label||'Unresolved location — review required',itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,lot:row.plant_date,source:row.source,qty,cpb,beds,from:row.staged_from||row.source,target,open:before,water:profile,score:round(gates.filter(Boolean).length/7*100),explanation:['Resolved location','CPB','Source','Sales year','Reserved capacity','Hydro-zone','Documented block compatibility'].map((label,i)=>label+': '+(gates[i]?'OK':'review')).join(' | ')});
      // Approved overrides are included in the same capacity ledger.
      const chosen=locations.get(plan.final_target);if(chosen&&plan.decision!==DECISIONS[2])chosen.reserved+=plan.final_beds;
      plans.push(plan);
    }
    for(const row of all.sort((a,b)=>a.qty-b.qty||a.itemcode.localeCompare(b.itemcode))) {
      const peers=all.filter(other=>other!==row&&other.itemcode===row.itemcode&&other.location!==row.location);
      const src=locations.get(row.location);
      const targets=peers.filter(other=>(other.qty>row.qty||(other.qty===row.qty&&other.location<row.location))).sort((a,b)=>b.qty-a.qty||a.location.localeCompare(b.location));
      let chosen=null,gates=[];
      for(const candidate of targets){
        const dest=locations.get(candidate.location),available=number(dest.total_beds)-dest.occupied-dest.reserved;
        const candidateGates=[!row.hold&&!candidate.hold,row.qty>0&&row.cpb>0,!!row.source&&row.source===candidate.source,!!row.salesYear&&row.salesYear===candidate.salesYear,row.beds<=available,!!row.water.hydro_zone&&row.water.hydro_zone===candidate.water.hydro_zone,src.permanent_shade===dest.permanent_shade&&src.house_orientation===dest.house_orientation];
        if(candidateGates.every(Boolean)){chosen=candidate;gates=candidateGates;break;}
        if(!gates.length)gates=candidateGates;
      }
      const destination=chosen?locations.get(chosen.location):null,score=gates.filter(Boolean).length/7*100;
      const plan=applyDecision({plan_id:identity('MOV',[row.itemcode,row.location,row.source,row.salesYear,row.hold?'Y':'crop']),workflow:'🚚 CONSOLIDATION MOVE',tier:row.hold?'Season Y — hold for up-can':!peers.length?'Sole location — anchor':!chosen?'No compatible destination':row.salesYear<activeYear?'P1: Carryover move':[...row.lots].some(l=>l.includes(season))?'P2: Active-season move':'P3: Sales-year wave move',itemcode:row.itemcode,commonname:row.commonname,contsize:row.contsize,lot:[...row.lots].sort().join(', '),source:row.source,qty:row.qty,cpb:row.cpb,beds:row.beds,from:row.location,target:chosen?.location||'',open:destination?number(destination.total_beds)-destination.occupied-destination.reserved:0,water:row.water,score:chosen?100:round(score),explanation:['Hold/Y','Whole group / CPB','Source','Sales year','Planting capacity shield','Hydro-zone','Shade / orientation'].map((name,i)=>name+': '+(gates[i]?'OK':'review')).join(' | ')+' | Other locations: '+(peers.map(p=>p.location+' ('+p.qty+')').join(', ')||'none')});
      if(plan.approved&&plan.final_target&&plan.final_qty<=row.qty&&locations.has(plan.final_target)){locations.get(plan.final_target).reserved+=plan.final_beds;}
      plans.push(plan);
    }
    const selected=filters.location||'G.10.000',filter=filters.mode||'ALL_MOVES_AND_PLANTINGS';
    const visible=plans.filter(p=>(selected==='ALL_LOCATIONS'||p.from===selected||p.final_target===selected)&&(filter!=='PRIORITY_MOVES_ONLY'||p.workflow.includes('MOVE'))&&(filter!=='NEXT_PLANTINGS_ONLY'||p.workflow.includes('PLANTING')));
    const execution=plans.filter(p=>p.approved&&p.final_target&&p.final_qty>0).sort((a,b)=>a.final_target.localeCompare(b.final_target,undefined,{numeric:true})||a.from.localeCompare(b.from)||a.plan_id.localeCompare(b.plan_id));
    const selectedLocations=selected==='ALL_LOCATIONS'?[...locations.values()]:[locations.get(selected)].filter(Boolean);
    const total=selectedLocations.reduce((sum,l)=>sum+number(l.total_beds),0),occupied=selectedLocations.reduce((sum,l)=>sum+l.occupied,0),reserved=selectedLocations.reduce((sum,l)=>sum+l.reserved,0);
    const kpis={'Selected Location Total Beds':round(total),'Occupied Beds':round(occupied),'Reserved Planting Beds':round(plans.filter(p=>p.workflow.includes('PLANTING')&&p.decision!==DECISIONS[2]&&locations.has(p.final_target)&&(selected==='ALL_LOCATIONS'||p.final_target===selected)).reduce((sum,p)=>sum+p.final_beds,0)),'Unreserved Open Beds':round(Math.max(0,total-occupied-reserved)),'Shade / Orientation':selectedLocations.length===1?(selectedLocations[0].permanent_shade+' / '+selectedLocations[0].house_orientation):'Mixed','Suggestions Shown':visible.length,'✅ Approved / Modified':visible.filter(p=>p.approved).length,'❌ Removed':visible.filter(p=>p.decision===DECISIONS[2]).length,'Mean 7-Gate Compatibility':round(visible.reduce((sum,p)=>sum+p.score,0)/(visible.length||1))+'%','Approved Move / Plant Beds':round(visible.filter(p=>p.approved).reduce((sum,p)=>sum+p.final_beds,0))};
    return {plans,visible,execution,kpis,locations,groups:all};
  }
  global.GncNurseryModel=Object.freeze({TABLES,FIELDS,CPB,DECISIONS,compile,block,number,year});
})(typeof window==='undefined'?globalThis:window);
