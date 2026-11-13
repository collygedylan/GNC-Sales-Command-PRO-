import assert from 'node:assert/strict';
import vm from 'node:vm';
import {read,functionSource,runFunctions,plain} from './golden-test-environment.mjs';

export async function invariant212() {
  const calls=[];
  const context=vm.createContext({moveProcessed:async()=>{},Date});
  vm.runInContext(functionSource('supabase/functions/_shared/erp-sync.mjs','stageFile'),context);
  const supabase={rpc:async(name,args)=>{
    assert.equal(name,'check_erp_file_sync_needed_v1');calls.push(args);
    assert.ok(args.p_content_hash===null || /^[a-f0-9]{64}$/.test(args.p_content_hash));
    return {data:{skip:args.p_file_id === 'file'}};
  }};
  const options={supabase,status:async()=>{},file:{id:'file',name:'Drive.xlsx',modifiedTime:'2026-10-30T12:00:00Z',md5Checksum:'a'.repeat(32)},dataset:'drive_around',maxRowsPerSlice:1000,sliceStartMs:0};
  assert.equal((await context.stageFile(options)).outcome,'UP_TO_DATE');
  assert.equal(calls.length,1);assert.equal(calls[0].p_modified_at,options.file.modifiedTime);
  const continuation=functionSource('supabase/functions/_shared/erp-sync.mjs','stageFileContinuation');
  assert.match(continuation,/contentHash=await hashHex\(bytes\)/);
  assert.doesNotMatch(continuation,/md5Checksum/);
}

export function invariant213() {
  const row={UNIQUE_ID:'row-a',ITEMCODE:'005243.031.1',LOCATIONCODE:'D.26.000',LOTCODE:'27.F1',SOURCE:'DRIVE'};
  const sibling={...row,UNIQUE_ID:'row-b',LOTCODE:'26.F1',PHOTO_LINK:'keep.jpg',AV_NOTE:'KEEP'};
  const receipt={ok:true,canonicalConfirmed:true,row:{unique_id:'row-a',itemcode:row.ITEMCODE,locationcode:row.LOCATIONCODE,lotcode:row.LOTCODE,source:'DRIVE',photo_link:'one.jpg,two.jpg,three.jpg',photo_name:'a,b,c',av_note:'FULL BODY / SPEC - 16-18" H'},locationRows:[]};
  const columns=['unique_id','itemcode','locationcode','lotcode','source','photo_link','photo_name','av_note'];
  const context=runFunctions('assets/app-runtime.js',['normalizeDriveEvidenceLocationPart','isSameDriveEvidenceLocation','reconcileConfirmedDriveEvidence',
    'getConfirmedDriveEvidenceRow','applyConfirmedDriveLocationEvidence','reconcileConfirmedDriveMasterRows','updateConfirmedDriveEvidenceState',
    'preserveDriveEvidenceEditor','restoreDriveEvidenceEditor','reapplyPendingEvaluationProjection'],{
    getManagerAssignedColumnState:()=>({}), fullInventory:[row,sibling],masterInventoryById:new Map([[row.UNIQUE_ID,row],[sibling.UNIQUE_ID,sibling]]),activeItem:null,confirmedDriveEvidenceRows:new Map(),
    masterInventoryByItemCode:new Map([[row.ITEMCODE,[row,sibling]]]),
    readRowEvaluationDraft:()=>({}),
    firstNonEmptyValue:(...values)=>values.find(value=>value!==null&&value!==undefined&&String(value)!=='') ?? '',
    window:{GncDatabase:{confirmedDriveEvidence:result=>result.row,driveEvidenceColumns:columns}},
    getRequestItemCodeOptionItemCode: value => value.ITEMCODE || value.itemcode || '',
    getSupabaseReadIdentityScope:()=> 'account',formatFetchedRows:rows=>rows.map(raw=>Object.fromEntries(Object.entries(raw).map(([key,value])=>[key.toUpperCase(),value]))),
    getEditorLocMatchQtyValue:()=>null,parseAppNumber:()=>null,setPhotoAliasFieldsForPrefix:(...args)=>Object.assign(args[0],{PHOTO_LINK:args[2],PHOTO_NAME:args[3]}),
    normalizeRowPhotoFields(){},buildSearchIndex(){},buildConfirmedDriveEvidenceState:target=>({...target}),getDatasetKeysForTable:()=>[],
    rebuildMasterInventoryIndexes(){},touchDatasetLoadStateForLocalChange(){},propagateCommittedEdit(){}
  });
  const result=context.reconcileConfirmedDriveEvidence(receipt,row,'ssn-');
  assert.equal(result.row.PHOTO_LINK,'one.jpg,two.jpg,three.jpg');assert.equal(result.row.AV_NOTE,receipt.row.av_note);
  assert.equal(sibling.PHOTO_LINK,'keep.jpg');assert.equal(sibling.AV_NOTE,'KEEP');
  context.activeItem={...row,SOURCE_TABLE:'ph_master_inventory',AV_NOTE:'UNSAVED / SPEC - 18 inches'};
  context.reconcileConfirmedDriveEvidence(receipt,row,'ssn-',{photoOnly:true});
  assert.equal(context.activeItem.AV_NOTE,'UNSAVED / SPEC - 18 inches');
  assert.equal(context.activeItem.PHOTO_LINK,receipt.row.photo_link);
  assert.throws(()=>context.reconcileConfirmedDriveEvidence(receipt,row,'ssn-',{scope:'another-account'}),/Photo session changed/);
  assert.throws(()=>context.reconcileConfirmedDriveEvidence({...receipt,row:{...receipt.row,unique_id:'other'}},row,'ssn-'),/IDENTITY_MISMATCH/);
}

export function invariant214() {
  let scope = 'account';
  const context=runFunctions('assets/app-runtime.js',['sanitizeAvNoteWithoutSpecCaliper','resolveCanonicalPhotoUrls','getPendingPhotoPreviewEntries'],{
    getRowPhotoLink:()=> 'saved.jpg',getPhotoUrlList:value=>value.split(','),resolveAndFormatPhotoDate(){},
    getSupabaseReadIdentityScope:()=>scope,getInventoryLocationPhotos:()=>[],
    pendingPhotoPreviews:new Map([['row-a::saved',[{url:'blob:pending',localPreviewUrl:'blob:pending',scope:'account',status:'Uploading'}]]]),
  });
  assert.equal(context.sanitizeAvNoteWithoutSpecCaliper('FULL BODY / SPEC - 16-18" H',{preserveEnteredText:true}),'FULL BODY / SPEC - 16-18" H');
  assert.deepEqual(plain(context.resolveCanonicalPhotoUrls({UNIQUE_ID:'row-a'},'drive')),['saved.jpg','blob:pending']);
  assert.deepEqual(plain(context.resolveCanonicalPhotoUrls({UNIQUE_ID:'row-b'},'drive')),['saved.jpg']);
  scope = 'different-account';
  assert.deepEqual(plain(context.resolveCanonicalPhotoUrls({UNIQUE_ID:'row-a'},'drive')),['saved.jpg']);
  assert.match(functionSource('assets/app-runtime.js','populateDetailInputsForPrefix'),/preserveEnteredText: true/);
  assert.match(functionSource('assets/app-runtime.js','persistConfirmedRowEvaluation'),/itemToSave\.AV_NOTE = String\(avEl\.value \?\? ''\)/);
}

export function invariant216() {
  const state={filters:{},sort:null,viewMode:'unique'};const selected=new Set();let rows=[{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'A',PLANTGROUPCODE:'TREE',ASSIGNEDTO:'dylan_collyge'},{ITEMCODE:'B',PLANTGROUPCODE:'SHRUB',ASSIGNEDTO:'megan_kelly'}];
  const context=runFunctions('assets/app-runtime.js',['getFilteredManagerAssignedItemsExportRows','getManagerAssignedSelectionSnapshot','selectAllFilteredManagerAssignedItems','getManagerAssignableOwnerUsers'],{
    getManagerAssignedColumnState:()=>state,getManagerAssignedItemsDisplayRows:()=>rows,rememberManagerAssignedColumnLabels(){},getManagerAssignedItemsActiveAssigneeKey:()=> 'all',managersSearchTerm:'',managerEvalAssignmentSelection:selected,
    matchesManagerAssignedColumnFilters:row=>!state.filters.PLANTGROUPCODE||state.filters.PLANTGROUPCODE.includes(row.PLANTGROUPCODE.toLowerCase()),normalizeEvalAssignableUser:value=>String(value||'').toLowerCase(),managerTextMatchesSearch:()=>true,
    buildManagerEvalAssignmentKey:value=>value,sortManagerAssignedColumnRows:value=>value,updateManagerAssignedItemsView(){},scheduleManagersRender(){},
    getAssignableAppUserOptions:()=>[{username:'dylan_collyge'},{username:'new_manager'}],EVAL_ASSIGNMENT_ROSTER_USERS:['ellen_ward','megan_kelly'],evalAssignableUsers:[],EVAL_TASK_INACTIVE_USERS:new Set()
  });
  assert.equal(context.getFilteredManagerAssignedItemsExportRows().length,2);state.viewMode='rows';assert.equal(context.getFilteredManagerAssignedItemsExportRows().length,3);
  state.filters.PLANTGROUPCODE=['tree'];context.selectAllFilteredManagerAssignedItems(true);assert.deepEqual([...selected],['A']);context.selectAllFilteredManagerAssignedItems(false);assert.equal(selected.size,0);
  assert.deepEqual(plain(context.getManagerAssignableOwnerUsers()),['dylan_collyge','megan_kelly','new_manager']);
  const jsx=read('components/assigned-items/AssignedItems.jsx');assert.match(jsx,/data-assigned-select-all-visible/);assert.doesNotMatch(jsx,/Refreshing history|Use suggestion|>Bulk</);
  assert.match(functionSource('assets/app-runtime.js','getManagerAssignedColumnDefinitions'),/PLANTGROUPCODE/);
}

export function invariant217() {
  const html=read('index.html');assert.match(html,/<details open id="dashboard-sync-accordion"/);
  assert.match(html,/#dashboard-print-btn svg\{width:16px;height:16px/);
  assert.match(html,/#dashboard-sync-files\{display:grid!important;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(functionSource('assets/app-runtime.js','syncGoogleScriptButton'),/bindErpHomeStatusPanel\(panel\)/);
  assert.match(functionSource('assets/erp-sync-ui-functions.js','bindErpHomeStatusPanel'),/panel\.open = true/);
}
