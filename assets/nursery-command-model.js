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
  function parseBlockAllocations(raw){const text=string(raw);if(!text||['0','#N/A','FALSE'].includes(text.toUpperCase()))return [];const found=new Map();for(const m of text.matchAll(/\b([A-L])\.?0*(\d{1,2})\b(?:\s*=\s*(\d+(?:\.\d+)?))?/gi)){const n=Number(m[2]);if(n<1||n>99)continue;const location=m[1].toUpperCase()+'.'+String(n).padStart(2,'0')+'.000';found.set(location,(found.get(location)||0)+(number(m[3])>0?number(m[3]):1));}return [...found].map(([location,weight])=>({location,weight}));}
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

  const BUNCH_THREADS=Object.freeze(['Early Winter Protect','Haul-In Space','Small Container Crew','Fall Drill Shift Clearing','LD Canfill Clearing','Shovel Shift Clearing','Rain Day']);
  const BUNCH_CREWS=Object.freeze(['BOB','QC','SAM','RHETT','CHRIS','SHARON','ZAYNE','TA']);
  const BUNCH_TAPES=Object.freeze(['None','Yellow Tape','Pink Tape','Shift Tape','Shift + Pink Tape']);
  const BUNCH_RULES=Object.freeze([
    ['Shift .Y & Pathology Hold Free','No consolidation move of .Y or Hold/Stop stock. Keep protected stock anchored.'],
    ['100% Whole-Group Move','Move the entire item, source and sale-year group. No unassigned make-fit remainder.'],
    ['Source & SaleYear Tier Match','Match source and sale year; carryover before 2027 stays separate from 2027.'],
    ['4-Tier Planting Bed Shield','Reserve confirmed, historical and rotation planting beds before consolidation.'],
    ['Container-Agnostic Water ±250 mL/day','Compare documented daily demand, including Yellow Tape low-water stock, across container sizes.'],
    ['Permanent Shade & Orientation','Both source and destination must have matching documented shade and orientation.'],
    ['Net Post-Move Capacity','Account for live occupancy, all reserved planting beds and approved moves.'],
    ['7 Sequence Threads & Center House','Tag the thread and N > S, S > N, W > E or E > W walking direction. The house straddling the 4-inch line is Center House.'],
    ['Inside Drape Plastic −1 Edge Row','Crapemyrtle, Abelia, Hydrangea, Boxwood, Indian Hawthorn and Pampas Grass: Leave out 1 row at house edge for inside drape plastic; deduct 8% of bed capacity.'],
    ['Overwinter Spacing','Early-protect Hydrangea, Hosta and vigorous Weigela: Spread space (fill in aisles and holes only). Small Hosta/Astilbe: 2-finger space. 3DP Baby Gem Boxwood: 4-finger space. Shift staging: Can-tight countable.'],
    ['Crew Prefix & Stake/Flag Color Code','BOB grade before bunching; QC small grade/TA/stakes; SAM shear or inter-block haul; RHETT shift grade/haul; CHRIS residue/scale spray; SHARON/ZAYNE signs/tags; TA reconcile cull/dump with Drive. Back-half/corner flags: Blue ship 1st, White lesser, Red promo/cull, Green SY28 grow-on >. Yellow Tape LowH20 haul; Pink Tape outside/drape haul (≤1/3 vigorous Weigela/Astilbe/Blueberry; 100% Grapes to G.01; Forsythia/Quince); Shift Tape countable staging; Shift + Pink Tape outside spring shift.'],
    ['Look-Alike / Same-Color Tag Separation','Use a divider variety, wide aisle or opposite house for listed look-alike varieties and same-color field tags.'],
    ['Single-House & Center-House Flags','One house whenever the whole variety fits. If both houses are required, no-flags in outer house and flagged groups in back 1/2 of warmer Center House.']
  ].map(([title,description],i)=>Object.freeze({number:i+1,title,description})));
  const LOOK_ALIKES=[['kay parris','bracken'],['low scape mound','ground hug'],['nantucket blue','e.s. original'],['alice-n-wonderland','autumn reprise'],['purple pillar','red pillar'],['strawberry smoothie','raspberry smoothie'],['dynamite','colorama scarlet'],['fragrant','korean spice']];
  const AUDITED_BLOCKS=Object.freeze('B.02 C.08 I.02 E.01 E.06 G.22 A.05 G.26 F.15 C.09 H.11 H.09 E.23 D.17 E.14 G.10 D.22 E.03 C.15 A.08 D.31 D.32'.split(' '));
  const bunchUid=row=>string(value(row,'unique_id','master_unique_id'));
  const bunchPlanId=row=>'BN-'+encodeURIComponent(bunchUid(row));
  function dailyWater(row,profile){
    const size=string(value(row,'contsize')).match(/#?\s*(1|2|3|5|7)(?:\D|$)/)?.[1];
    const raw=value(row,'water_ml_day')||profile?.['dwu_'+size];
    const text=string(raw).replace(/,/g,'');
    return /^\d+(?:\.\d+)?(?:\s*(?:m[lL]|m[lL]\/day))?$/.test(text)?Number(text.match(/[\d.]+/)[0]):null;
  }
  function buildBunchNoteContext(inventory,references,compiled){
    const data=compiled||compile(inventory,references,{location:'ALL_LOCATIONS'}),byBlock=new Map(),byUid=new Map(),candidateBlocksByItem=new Map(),waterRows=references.ph_nursery_water_rating||[];
    const waterNames=new Map();for(const w of waterRows)for(const key of ['common_name','botanical_name','sort_name'])if(w[key])waterNames.set(nameKey(w[key]),w);
    const waterGenus=new Map(waterRows.filter(w=>w.genus).map(w=>[string(w.genus).toUpperCase(),w]));
    const cpbs=new Map((references.ph_nursery_items_cpb||[]).map(r=>[r.itemcode,number(r.cpb)]));
    for(const row of inventory||[]){if(!string(value(row,'warehouse','warehousei','warehouseid','wh')).includes('10'))continue;const loc=block(value(row,'locationcode')),uid=bunchUid(row);if(!loc||!uid)continue;if(!byBlock.has(loc))byBlock.set(loc,[]);byBlock.get(loc).push(row);byUid.set(uid,row);const item=string(value(row,'itemcode'));if(!candidateBlocksByItem.has(item))candidateBlocksByItem.set(item,new Set());candidateBlocksByItem.get(item).add(loc);}
    return {data,byBlock,byUid,candidateBlocksByItem,decisions:new Map((references.ph_dylan_decisions_store||[]).map(r=>[r.plan_id,r])),cpbFor:r=>cpbs.get(string(value(r,'itemcode')))||CPB[string(value(r,'itemcode')).split('.')[1]]||0,waterFor:r=>waterNames.get(nameKey(value(r,'commonname')))||waterNames.get(nameKey(value(r,'botanicalname')))||waterGenus.get(string(value(r,'genusname')).toUpperCase())||{}};
  }
  function evaluateBunchNoteRowAndIssues(row,context,choices={}){
    const item=string(value(row,'itemcode')),name=string(value(row,'commonname')),size=string(value(row,'contsize')),from=block(value(row,'locationcode')),uid=bunchUid(row),plan_id=bunchPlanId(row);
    const qty=Math.max(0,number(value(row,'ptronhand','onhand'))),available=number(value(row,'ptravailable','available')),source=string(value(row,'source')),saleYear=year(value(row,'saleyear','salesyear')||value(row,'lotcode')),profile=context.waterFor(row),water=dailyWater(row,profile),cpb=context.cpbFor(row);
    const saved=context.decisions.get(plan_id),raw=string(choices.note??saved?.notes??value(row,'bunch_note','bunchnote','locationnote','inventorynote'));
    const bunchNoteIssues=[];const issue=(rule,category,reason)=>bunchNoteIssues.push({rule,category,reason});
    const protectedRow=/\.Y(?:\b|$)|^Y$/i.test(string(value(row,'lotcode'))+' '+string(value(row,'season')))||!!string(value(row,'holdstopcode','lochold'));
    const sourceLocation=context.data.locations.get(from),drape=/crape\s?myrtle|abelia|hydrangea|boxwood|indian hawthorn|pampas grass/i.test(name);
    const group=(context.byBlock.get(from)||[]).filter(r=>value(r,'itemcode')===item&&value(r,'source')===source&&year(value(r,'saleyear')||value(r,'lotcode'))===saleYear);
    const groupQty=group.reduce((sum,r)=>sum+Math.max(0,number(value(r,'ptronhand','onhand'))),0);
    const targetProblems=target=>{
      const problems=[],loc=context.data.locations.get(target),peers=context.byBlock.get(target)||[];
      if(!loc){problems.push([7,'Destination is not a verified LOCATIONS block.']);return problems;}
      if(target===from)return problems;
      if(protectedRow||peers.some(r=>/\.Y(?:\b|$)/i.test(string(value(r,'lotcode')))||!!string(value(r,'holdstopcode'))))problems.push([1,'Shift .Y or Hold/Stop stock must remain anchored.']);
      if(group.length!==1)problems.push([2,'This group spans multiple inventory rows; a reviewed whole-group destination is required before moving this row.']);
      if(!source||!saleYear||!peers.length||peers.some(r=>string(value(r,'source'))!==source||year(value(r,'saleyear')||value(r,'lotcode'))!==saleYear))problems.push([3,'Destination source or sale-year tier differs or is unverified (carryover and 2027 cannot mix).']);
      const net=number(loc.total_beds)*(drape ? 0.92 : 1)-loc.occupied-loc.reserved-loc.prior;
      if(loc.reserved>0&&(!cpb||groupQty/cpb>net))problems.push([4,'PROD SCHEDULE 102726 reserved beds collide with the whole-group move.']);
      if(water===null||!peers.length||peers.some(r=>{const other=dailyWater(r,context.waterFor(r));return other===null||Math.abs(water-other)>250;}))problems.push([5,'Documented water demands must match within ±250 mL/day, including Yellow Tape LowH20 hauls.']);
      if(!sourceLocation?.permanent_shade||!sourceLocation?.house_orientation||sourceLocation.permanent_shade!==loc.permanent_shade||sourceLocation.house_orientation!==loc.house_orientation)problems.push([6,'Permanent shade or orientation is missing or different.']);
      if(!cpb||groupQty/cpb>net)problems.push([7,'Whole group does not fit after occupancy, planting reservations, prior moves and the drape edge deduction.']);
      return problems;
    };
    const rawTarget=raw.match(/(?:haul|move)(?:\s+\d[\d,]*)?\s+to\s+([A-L]\.\d{2}(?:\.\d{3})?)/i)?.[1];
    const unresolved=/haul\s+to\s*\?+|_{3,}/i.test(raw);
    if(unresolved)issue(2,'destination','Unresolved Haul-To: the note has no assigned, verified destination block.');
    if(/make fit|won.t fit|partial|remainder|overflow/i.test(raw)&&!rawTarget)issue(2,'partial','Partial / Won’t-Fit Split: assign the entire group and an explicit destination; do not leave a remainder.');
    if(rawTarget)for(const [rule,reason] of targetProblems(block(rawTarget)))issue(rule,rule===2?'partial':'conflict',reason);
    if(/TA\s*[;,]?\s*no report/i.test(raw)&&qty>0)issue(2,'inventory','Drive Mode / TA Mismatch: TA; no report still has '+qty+' On Hand. Reconcile cull/dump before execution.');
    if(/not on inventory/i.test(raw))issue(2,'inventory','Drive Mode / TA Mismatch: this note claims ghost stock; verify the exact inventory identity and count.');
    const shiftQty=raw.match(/shift\s+(\d[\d,]*)/i)?.[1];if(protectedRow&&shiftQty&&number(shiftQty)!==qty)issue(1,'inventory','Shift quantity '+shiftQty+' does not match live On Hand '+qty+'.');
    const thread=choices.thread||BUNCH_THREADS.find(t=>raw.includes(t))||(/rain day/i.test(raw)?'Rain Day':/shovel/i.test(raw)?'Shovel Shift Clearing':/canfill/i.test(raw)&&source==='LD'?'LD Canfill Clearing':/shift|\.Y\b/i.test(raw+' '+value(row,'lotcode'))?'Fall Drill Shift Clearing':/haul/i.test(raw)?'Haul-In Space':/small|#1|#2/.test(size)?'Small Container Crew':'Early Winter Protect');
    const direction=choices.direction||raw.match(/\b[NSWE]\s*>\s*[NSWE]\b/)?.[0]||(/east|west/i.test(sourceLocation?.house_orientation)?'W > E':'N > S');
    if(!BUNCH_THREADS.some(t=>raw.includes(t))||!/[NSWE]\s*>\s*[NSWE]/.test(raw)||(number(sourceLocation?.house_count)>0&&!/Center House/i.test(raw)))issue(8,'crew','Add the sequence thread, walking direction and Center House designation for the 4-inch line.');
    if(drape&&!/Leave out 1 row at house edge for inside drape plastic/i.test(raw))issue(9,'crew','Missing Inside-Drape −1 row instruction; effective bed capacity must deduct 8%.');
    const spacing=protectedRow?'Can-tight countable':/baby gem/i.test(name)&&/3DP/i.test(size+' '+name)?'4-finger space':/hosta|astilbe/i.test(name)&&/#?[12]\b|small/i.test(size+' '+raw)?'2-finger space':/hydrangea|hosta/i.test(name)||/weigela/i.test(name)&&/vigorous/i.test(raw)?'Spread space (fill in aisles and holes only)':'Can-tight countable';
    if(!raw.toLowerCase().includes(spacing.toLowerCase()))issue(10,'crew','Use '+spacing+' for this overwinter operation.');
    const crewSource=string(value(row,'bunch_note','bunchnote','locationnote','inventorynote'));
    const requiredCrew=/residue|scale|spray/i.test(crewSource)?'CHRIS':/sign|tag/i.test(crewSource)?'SHARON':protectedRow||/shift/i.test(crewSource)?'RHETT':/shear|haul/i.test(crewSource)?'SAM':/small grade|stakes|\bTA\b/i.test(crewSource)?'QC':'BOB';
    const crew=choices.crew||requiredCrew;
    if(!new RegExp('^'+(crew==='SHARON'?'(?:SHARON|ZAYNE)':crew)+'\\b').test(raw))issue(11,'crew','Missing pre-bunching crew prefix '+requiredCrew+' for the work described.');
    let target=choices.target?block(choices.target):rawTarget&&!targetProblems(block(rawTarget)).length?block(rawTarget):'';
    if(!target&&!protectedRow)target=[...(context.candidateBlocksByItem.get(item)||[])].find(loc=>loc!==from&&!targetProblems(loc).length)||'';
    if(!target)target=from;
    const blockers=targetProblems(target);if(!uid||context.byUid.get(uid)!==row)blockers.push([2,'An exact live inventory UID is required.']);
    if(!context.data.locations.has(from))blockers.push([7,'Source block is not in LOCATIONS.']);
    if(!cpb||sourceLocation?.house_count==null||!number(sourceLocation?.total_beds))blockers.push([13,'Verify ITEMS CPB, house count and bed capacity before approving the house plan.']);
    const tape=choices.tape||(/low\s*h[2]?o|lowh20|yellow tape/i.test(raw)?'Yellow Tape':protectedRow&&/outside|spring shift|pink tape/i.test(raw)?'Shift + Pink Tape':protectedRow?'Shift Tape':/outside|drape haul|pink tape/i.test(raw)?'Pink Tape':'None');
    if(tape==='Yellow Tape'&&water===null)blockers.push([5,'Yellow Tape requires a documented LowH20 water rating.']);
    const pinkLimited=/weigela|astilbe|blueberry/i.test(name)&&/vigorous/i.test(raw),grape=/grape/i.test(name);
    if(tape==='Pink Tape'&&pinkLimited&&target!==from)blockers.push([11,'Pink Tape vigorous groups are limited to 1/3; resolve the whole-group allocation before hauling.']);
    if(tape==='Pink Tape'&&grape&&target!=='G.01.000')blockers.push([11,'100% of Grapes with Pink Tape must be assigned to verified G.01.']);
    const peers=context.byBlock.get(rawTarget?block(rawTarget):target)||[],tag=string(value(row,'fieldtagcolor','field_tag_color')).toLowerCase();
    const collision=peers.some(other=>{if(bunchUid(other)===uid||value(other,'itemcode')===item)return false;const otherName=string(value(other,'commonname')).toLowerCase();return LOOK_ALIKES.some(pair=>pair.some((a,i)=>name.toLowerCase().includes(a)&&otherName.includes(pair[1-i])))||tag&&tag===string(value(other,'fieldtagcolor','field_tag_color')).toLowerCase();});
    if(collision&&!/divider variety|wide aisle|opposite house/i.test(raw))issue(12,'crew','Look-Alike / Same-Color Tag collision: separate with a divider variety, wide aisle or opposite house.');
    const loc=context.data.locations.get(target),effectiveBeds=number(loc?.total_beds)*(drape ? 0.92 : 1),houses=Math.max(1,number(loc?.house_count)),oneHouse=cpb>0&&groupQty/cpb<=effectiveBeds/houses;
    if(drape&&loc?.house_count===0)blockers.push([9,'Inside drape requires a verified house; this destination is an open block.']);
    const house=loc?.house_count===0?'Open block (no house)':oneHouse?'1 house — Center House':'Both houses: no-flags in outer house; flagged groups in back 1/2 of warmer Center House';
    if(!raw.includes(house))issue(13,'crew','Consolidate into '+house+'.');
    const flags='Flags in back 1/2 & corners: Blue=ship 1st; White=lesser; Red=promo/cull; Green=SY28 grow-on >';
    const action=target===from?'Hold / bunch in place '+qty+' at verified '+from:'Haul 100% whole group '+groupQty+' to '+target;
    const tapeRule=tape==='Pink Tape'?(pinkLimited?' (≤ 1/3; allocation review required)':grape?' (100% Grapes to G.01)':/forsythia|quince/i.test(name)?' (overwinter outside)':' (outside / drape haul)'):tape==='Yellow Tape'?' (LowH20)':tape==='Shift + Pink Tape'?' (overwinter outside for spring shift)':tape==='Shift Tape'?' (stage countable for shift)':'';
    const autoSuggestedBunchNote=[crew,thread,direction,house,spacing,drape?'Leave out 1 row at house edge for inside drape plastic (8% edge capacity deduction)':'',action,'Corner stake tie-tape: '+tape+tapeRule,collision?'Separate look-alikes / same-color tags with a wide aisle':'',flags,protectedRow?'Keep .Y / Hold/Stop stock anchored; grade/reconcile before execution':''].filter(Boolean).join(' | ');
    return {row,uid,plan_id,location:string(value(row,'locationcode')),itemcode:item,commonname:name,contsize:size,from,qty,available,saleYear,source,water,rawBunchNote:raw,bunchNoteIssues,autoSuggestedBunchNote,target,crew,tape,thread,direction,house,spacing,blockers,canApprove:!blockers.length,approved:!!saved&&DECISIONS.slice(0,2).includes(saved.decision),saved,auditedBlock:AUDITED_BLOCKS.includes(from.slice(0,4)),choices:{target,crew,tape,thread,direction}};
  }
  let bunchStore={scope:'',rows:[]};
  function publishBunchDecisions(scope,rows){bunchStore={scope,rows:rows.filter(r=>r.plan_id?.startsWith('BN-'))};try{global.localStorage?.setItem('gnc_bunch_decisions:'+scope,JSON.stringify(bunchStore.rows));}catch{} }
  function approvedBunchNote(row,scope){if(!scope||!bunchUid(row))return '';if(bunchStore.scope!==scope){let rows=[];try{rows=JSON.parse(global.localStorage?.getItem('gnc_bunch_decisions:'+scope)||'[]');}catch{}bunchStore={scope,rows:Array.isArray(rows)?rows:[]};}const saved=bunchStore.rows.find(r=>r.plan_id===bunchPlanId(row));return saved&&DECISIONS.slice(0,2).includes(saved.decision)?string(saved.notes):'';}

  global.GncNurseryModel=Object.freeze({BUNCH_THREADS,BUNCH_CREWS,BUNCH_TAPES,BUNCH_RULES,AUDITED_BLOCKS,buildBunchNoteContext,evaluateBunchNoteRowAndIssues,publishBunchDecisions,approvedBunchNote,bunchPlanId,TABLES,FIELDS,CPB,DECISIONS,compile,block,number,year,parseBlockAllocations,resolveScheduleTargets});
})(typeof window==='undefined'?globalThis:window);
