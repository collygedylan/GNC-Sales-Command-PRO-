const nurseryTableLocal_global = window;
'use strict';
  const nurseryTableLocal_model=nurseryTableLocal_global.GncNurseryModel;
  let nurseryTableLocal_cache={scope:'',refs:{},loaded:false,pending:new Map(),retries:new Map(),failedDrafts:new Map()};
  const nurseryTableLocal_escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nurseryTableLocal_numeric=new Set(['block_number','house_count','total_beds','cpb','water_rank','col_index','planned_qty','req_qty','cutoff_qty','beds_needed','override_qty']);
  const nurseryTableLocal_president=['PLAN_ID','DYLAN_DECISION','DYLAN_OVERRIDE_TARGET_LOC','DYLAN_OVERRIDE_QTY','DYLAN_EXECUTIVE_NOTES','COMPATIBILITY_SCORE','GEM_CHAIN_OF_COMMAND','WORKFLOW_TYPE','PRIORITY_TIER','ITEMCODE','COMMONNAME','CONTSIZE','LOT_OR_TARGET_DATE','SOURCE','PLAN_QTY','CPB','BEDS_NEEDED','FROM_OR_STAGED_LOC','RECOMMENDED_TARGET_LOC','DEST_OPEN_BEDS','HYDRO-ZONE & DAILY WATER','SUPERVISOR 7-GATE COMPATIBILITY & OTHER LOCATIONS'];
  const nurseryTableLocal_execution=['CREW_DONE','EXEC_STEP','PLAN_ID','DYLAN_STATUS','WORKFLOW_TYPE','FROM_OR_STAGED_LOC','FINAL_APPROVED_TARGET_LOC','ITEMCODE','COMMONNAME','CONTSIZE','LOT_OR_PLANT_DATE','SOURCE','FINAL_APPROVED_QTY','BEDS_NEEDED','HYDRO-ZONE & DAILY WATER','COMPATIBILITY & DYLAN NOTES'];
  const nurseryTableLocal_waterText=p=>[p.water?.hydro_zone,p.water?.schedule_flag,...['1','2','3','5','7'].filter(n=>p.water?.['dwu_'+n]).map(n=>'#'+n+': '+p.water['dwu_'+n])].filter(Boolean).join(' | ')||'Water profile requires review';
function mountNurseryTables(root,options){
    const context = {
      get escape() { return nurseryTableLocal_escape; },
      get state() { return state; },
      get model() { return nurseryTableLocal_model; },
      get issueFilters() { return issueFilters; },
      get ownedCache() { return ownedCache; },
      get cache() { return nurseryTableLocal_cache; }, set cache(value) { nurseryTableLocal_cache = value; },
      get activeBunchWrites() { return activeBunchWrites; }, set activeBunchWrites(value) { activeBunchWrites = value; },
      get bunchWriteWaiters() { return bunchWriteWaiters; },
      get global() { return nurseryTableLocal_global; },
      get stableRenderPending() { return stableRenderPending; }, set stableRenderPending(value) { stableRenderPending = value; },
      get execution() { return nurseryTableLocal_execution; },
      get waterText() { return nurseryTableLocal_waterText; },
      get president() { return nurseryTableLocal_president; },
      get numeric() { return nurseryTableLocal_numeric; },
      root, options
    };
    Object.assign(context, createNurseryTableController(context));
    if(nurseryTableLocal_cache.scope!==options.identity)nurseryTableLocal_cache={scope:options.identity,refs:{},loaded:false,pending:new Map(),retries:new Map(),failedDrafts:new Map()};
    const ownedCache=nurseryTableLocal_cache;
    const state={view:options.selected,refs:nurseryTableLocal_cache.refs,q:'',column:'',columnValue:'',location:'G.10.000',season:'F1',year:'2027',mode:'ALL_MOVES_AND_PLANTINGS',page:0,subview:options.selected==='prod-schedule'?'planting':'table',bunchSimulatorDrillLevel:'alpha',alpha:'',blockNumber:'',plantDrafts:new Map(),cardFilter:'all',selectedCards:null,cardDrafts:new Map(),sendPending:false,issueFilter:'all',currentIssues:[],error:'',loading:true,destroyed:false,pending:nurseryTableLocal_cache.pending,bunchRetries:nurseryTableLocal_cache.retries,generation:0};
    
    
    const issueFilters=[['all','All Issues'],['destination','Unresolved Haul-To (???)'],['partial',"Partial / Won’t-Fit Split"],['conflict','Planting Shield / Water Conflict'],['inventory','Drive Mode / TA Mismatch'],['crew','Drape / Look-Alike / Crew Prefix'],['approved','Approved / Resolved']];
    
    let activeBunchWrites=0;const bunchWriteWaiters=[];
    
    let stableRenderPending=false;
    root.bunchSimulatorBack = () => nurseryTable_back(context);
    nurseryTableLocal_global.addEventListener?.('gnc:bunch-settled',context.onBunchSettled);
    root.addEventListener('focusin',context.preparePlantingChoices);root.addEventListener('change',context.change);root.addEventListener('click',context.click);root.addEventListener('input',context.onSearchInput);
    installNurseryExcelProvider(context);
    const timer = startNurseryInventoryObserver(context);
    if(nurseryTableLocal_cache.loaded){state.loading=false;context.draw();}else void context.load();
    return {refresh:context.draw,destroy(){nurseryTableLocal_global.removeEventListener?.('gnc:bunch-settled',context.onBunchSettled);document.getElementById('bunch-note-issue-modal')?.remove();state.draft=null;state.destroyed=true;state.generation++;clearInterval(timer);clearTimeout(state.searchTimer);root.removeEventListener('focusin',context.preparePlantingChoices);root.removeEventListener('change',context.change);root.removeEventListener('click',context.click);root.removeEventListener('input',context.onSearchInput);}};
  }
  nurseryTableLocal_global.GncNurseryTables=Object.freeze({mount: mountNurseryTables,back:()=>document.getElementById('manager-table-management-root')?.bunchSimulatorBack?.()||false});
