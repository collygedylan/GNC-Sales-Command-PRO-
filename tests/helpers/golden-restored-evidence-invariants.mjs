import assert from 'node:assert/strict';
import vm from 'node:vm';
import {read,functionSource,runFunctions} from './golden-test-environment.mjs';
import {readComposedAppSource} from '../../scripts/composed-app-source.mjs';

export function invariant186() {
  const ctx=runFunctions('assets/app-runtime.js',['getPrimaryDetailTabForItemContext','formatInventoryHoldSince'],{
    activeDetailSourceView:'',lastView:'',activeTaskTab:'',activeAVTab:'reserves',firstNonEmptyValue:(...values)=>values.find(v=>v!==undefined&&v!==null&&v!==''),Date,
    canEditEvidenceWorkflow:(_prefix,_row,source)=>source==='av',isAvDetailSource:source=>source==='av'
  });
  for(const source of ['drive','av']) for(const row of [{PTRREVIEWED:12,PTRAVAILABLE:-2,HOLDSTOPCODE:'S'},{DATE_COMPLETED:'2026-10-29',APP_TAB_ASSIGNMENT:'season'}]) assert.equal(ctx.getPrimaryDetailTabForItemContext(row,source),'location');
  assert.equal(ctx.formatInventoryHoldSince(46259),'8/25/2026');
  assert.equal(ctx.formatInventoryHoldSince('1/1/46259'),'8/25/2026');
}

export function invariant193() {
  const source = functionSource('assets/suspend-receipt-domain.js', 'executeSuspendRowCommand');
  const receipt = source.slice(source.indexOf('const editableOperation ='), source.indexOf('const receiptRow ='));
  assert.ok(receipt.includes('The server did not confirm'));
  const run = (operation, row, patch = {}) => vm.runInNewContext(receipt, { operation, result: {ok:true,row}, sourceUid:'old-source', expectedRevision:'old-revision', options:{}, photoOnly:Object.keys(patch).length>0, patch, getDockSuspendCompletionRevision:r=>r.last_updated });
  const row = {unique_id:'current-source',last_updated:'current-revision',suspend_tag_version:4,suspend_tag_status:'pending',dock_photo_link:'old,new'};
  assert.doesNotThrow(()=>run('save',row,{dock_photo_link:'new'}));
  assert.throws(()=>run('save',{...row,dock_photo_link:'old'},{dock_photo_link:'new'}),/did not confirm/);
  assert.throws(()=>run('send',row),/did not confirm/);
  assert.doesNotThrow(()=>run('complete',{...row,suspend_tag_status:'completed',date_completed:'2026-10-29T12:00:00Z'}));
}

export function invariant202() {
  const first=(...values)=>values.find(value=>value!==null&&value!==undefined&&value!=='');
  const rows=['28.F1','28.S1','26.U3','27.U3','27.Y','28.Y','28.F1'].map((lot,i)=>({UNIQUE_ID:'row-'+i,ITEMCODE:'000180.008.1',LOCATIONCODE:'L.05.000',LOTCODE:lot,SOURCE:i===2||i===6?'HL':'LD',SOURCE_TABLE:'ph_master_inventory'}));
  const av=rows.map(row=>({...row}));
  const keys=['PHOTO_LINK','SPEC','MATCH','AV_NOTE'];
  const api=runFunctions('assets/app-runtime.js',['applyRowSyncSnapshot','syncRowDataAcrossViews','getMasterInventoryExactKey','buildNcrCurrentCropInheritancePayload','inventoryPhotoLocationKey','findLinkedMasterRow'],{
    fullInventory:rows,avOpenInventory:av,masterInventoryById:new Map(rows.map(row=>[row.UNIQUE_ID,row])),masterInventoryByItemCode:new Map([['000180.008.1',rows]]),masterInventoryByExactKey:new Map(),masterInventoryByNormalizedItemLocation:new Map(),
    window:{GncDatabase:{driveEvidenceRevision:()=>0}},firstNonEmptyValue:first,getMasterInventorySourceCode:row=>row.SOURCE||row.source||'',
    isDockSuspendDcRequestMirrorRow:()=>false,bufferRowPatchUntilHydrated:()=>false,findItemByUniqueId:id=>rows.find(row=>row.UNIQUE_ID===id),findRequestRowByUniqueId:()=>null,
    FLYER_FOLDER_ROWS_TABLE:'flyer',MASTER_EVIDENCE_SYNC_KEYS:keys,EXACT_ROW_SYNC_KEYS:keys,LINKED_ROW_SYNC_KEYS:[],
    getInventoryCardItemLocationKey:()=>'',getCardPtrOnHandValue:()=>0,isRowScopedDesignationSyncKey:()=>false,
    repairDisplayFieldsOnRow:()=>{},normalizeFlyerShadowFields:()=>{},normalizeRowPhotoFields:row=>row,syncSharedFlyerPhotoFields:()=>{},buildSearchIndex:row=>row,
    isFlyerFolderRow:()=>false,syncMasterFieldsToRow:(from,to,fields)=>fields.forEach(key=>{to[key]=from[key];}),shouldIncludeMasterItemInAvSeasonView:()=>true,rebuildInventoryByIdMap:()=>new Map(),
    lowStockInventory:[],managerReviewInventory:[],moveUpInventory:[],salesOfficeInventory:[],socInventory:[],reservesInventory:[],requestsInventory:[],flyerFolderInventory:[],activeItem:null
  });
  const patch={PHOTO_LINK:'f1-photo-1,f1-photo-2,f1-photo-3',SPEC:'16-18" H',MATCH:60,AV_NOTE:'F1 ONLY'};
  assert.equal(api.applyRowSyncSnapshot({uniqueId:'row-0',masterUniqueId:'row-1',sourceTable:'ph_master_inventory',data:patch}),true);
  for(const collection of [rows,av]) {
    for(const key of keys) assert.equal(collection[0][key],patch[key]);
    for(const sibling of collection.slice(1)) for(const key of keys) assert.equal(sibling[key],undefined);
  }
  for(const sibling of rows.slice(1)) assert.equal(api.buildNcrCurrentCropInheritancePayload(rows[0],sibling),null);
  assert.equal(api.findLinkedMasterRow({...rows[1],MASTER_ID:'row-0'}),null,'a contradictory explicit master link cannot guess another physical row');
  assert.equal(api.findLinkedMasterRow(rows[1]).UNIQUE_ID,'row-1');
  const sql=read('supabase/migrations/20261029230000_agdata_v23109_strict_row_evidence.sql');
  assert.match(sql,/add primary key\(source_unique_id\)/);
  assert.match(sql,/add primary key\(unique_id\)/);
  assert.match(sql,/where m.unique_id=btrim\(p_master_uid\)/);
  assert.match(sql,/where m.unique_id=new.unique_id/);
  assert.match(sql,/on e.source_unique_id=m.unique_id/);
  assert.match(read('scripts/apply-item-low-stock-migration.mjs'),/agdataV23109StrictRowEvidenceMigrationName/);
}

export function invariant204() {
  const runtime = read('assets/app-runtime.js');
  const projectStart = runtime.indexOf('let bloomInventoryProjectDraft');
  const projectEnd = runtime.indexOf('async function submitBloomInventoryProject', projectStart);
  const project = runtime.slice(projectStart, projectEnd);
  assert.ok(projectStart >= 0 && projectEnd > projectStart);
  assert.doesNotMatch(project, /<\/?datalist\b|\blist=/i);
  assert.match(project, /toggleBloomProjectPicker/);
  const names=runFunctions('assets/app-runtime.js',['normalizeRepDisplayOrder']);
  assert.equal(names.normalizeRepDisplayOrder('Collyge, Dylan'),'Dylan Collyge');
  assert.match(project, /setBloomProjectPickerOptions/);
  assert.match(runtime, /toggleArgosReclassDestinationMenu/);
  assert.match(runtime, /selectArgosReclassDestination/);
  const shell = readComposedAppSource();
  assert.match(shell, /bloom-picker-actions-list #batch-btn-request/);
  assert.match(shell, /min-height:78px/);
  assert.match(shell, /\.argos-reclass-confirmation::backdrop/);
  assert.match(shell, /rgba\(255,255,255,\.06\)/);
}
