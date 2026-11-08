import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';
import vm from 'node:vm';

export function evalReclassFixture(engine) {
  const runtime = readComposedRuntimeSource();
  const extract = name => runtime.match(new RegExp('^        (?:async )?function '+name+'\\([^]*?^        }','m'))?.[0];
  const rows = [['c16f','C.16.000','27.F1',61,61],['f19f','F.19.000','27.F1',180,104],['c16s','C.16.000','27.S1',504,504],['h06s','H.06.000','27.S1',7,7],['c19u','C.19.000','27.U1',105,105]].map(([UNIQUE_ID,LOCATIONCODE,LOTCODE,PTRONHAND,PTRAVAILABLE])=>({UNIQUE_ID,ITEMCODE:'001973.010.1',COMMONNAME:'Northwind Switch Grass',LOCATIONCODE,LOTCODE,PTRONHAND,PTRAVAILABLE,PTRREVIEWED:UNIQUE_ID==='f19f'?76:'',PRIORITY:UNIQUE_ID==='f19f'?'1':''}));
  const group={key:'item:001973.010.1',itemCode:'001973.010.1',rows,representativeRow:rows[0],reportIds:['low-stock']};
  const inquiry={innerHTML:''}, sourceHeader={innerHTML:''};
  const modal={classList:{remove(){}},querySelectorAll:()=>[]};
  const ctx={Map,Set,AbortController,window:{},activeItem:null,currentUser:'fixture-manager',canUserReclassRow:()=>true,
    firstNonEmptyValue:(...v)=>v.find(x=>x!==null&&x!==undefined&&x!==''),escapeHtml:v=>String(v??''),formatArgosInventoryNumber:v=>String(v??0),
    masterInventoryByItemCode:new Map([[group.itemCode,[rows[0]]]]),fullInventory:[],rebuildMasterInventoryIndexes(){},
    isRequestLikeItem:()=>false,isDockLikeItem:()=>false,isSalesOfficeLikeItem:()=>false,
    getCurrentSeasonSortRank:v=>['F1','S1','U1','U2','U3'].indexOf(v),
    getManagerEvalReport2VisibleItemGroups:()=>[group],getManagerEvalReport2AllCurrentItemRows:()=>rows,
    useManagerReportPages:()=>true,getManagerReportPageController:()=>({state:()=>({metadata:{}})}),getManagerEvalReports2Api:()=>engine,
    loadPagedManagerItem:async()=>rows,isEvalWorkManagerUser:()=>true,managerModuleReadGeneration:1,
    getSupabaseReadIdentityScope:()=>'account-a',getCurrentVisibleViewId:()=>'managers',activeHomeTab:'eval2',MANAGER_EVAL_REPORTS_2_VIEW:'eval2',
    managerEvalReport2SelectedLocationCode:'C.19.000',managerEvalReport2BrowseMode:'location',activeManagerEvalReport2:'low-stock',getManagerEvalReport2ReportLabel:()=>'LowStock',
    showToast:(...args)=>{throw Error(args.join(' '));},findItemByUniqueId:id=>rows.find(r=>r.UNIQUE_ID===id),
    getVerifiedCachedArgosItemInquiryGroup:()=>null,getReadableCachedArgosItemInquiryGroup:()=>null,
    isArgosInventoryTransactionEligible:()=>true,activeDetailSourceView:'',lastView:'managers',
    argosInquiryOpenRevision:0,argosInventoryTransactionState:null,ensureArgosInventoryTransactionModal:()=>modal,
    document:{getElementById:id=>id==='argos-reclass-item-inquiry'?inquiry:id==='argos-inventory-transaction-source'?sourceHeader:null},
    buildItemInquiryViewModel:(item,scope)=>({identity:{itemcode:item.ITEMCODE},rows:scope,locationRows:scope.map(row=>({unique_id:row.UNIQUE_ID,sourceRow:row,values:{locationcode:row.LOCATIONCODE,lotcode:row.LOTCODE,ptronhand:row.PTRONHAND,ptrreviewed:row.PTRREVIEWED,ptravailable:row.PTRAVAILABLE,priority:row.PRIORITY}}))}),
    resetArgosReclassMultiActionState(){},getArgosReclassLiveEditIdentityKey:()=>'account-a',generateArgosInventoryTransactionId:()=>'cmd',readPendingArgosInventoryReclassMove:()=>null,
    refreshArgosInventoryTransactionLotOptions(){},refreshArgosInventoryTransactionPriorityOptions(){},setArgosInventoryTransactionAction(){},setArgosInventoryTransactionHoldAction(){},captureArgosInventoryTransactionDraftBaseline:()=>[],canUseProductionLiveSync:()=>false,
    isArgosReclassMobileEditorViewport:()=>true,argosReclassRowEditorEntries:new Map(),getArgosReclassRowBodyId:id=>'body-'+id,
    getArgosReclassV3ScopeActionsForEntry:()=>[],getArgosReclassV3ActionCountForEntry:()=>0,getEvalWorkInquiryRowResolution:()=>'',getArgosReclassProposalRenderSignature:()=>'',getArgosReclassRowRenderSignature:()=>'',
  };
  vm.createContext(ctx);
  const photo = runtime.match(/^function inventoryPhotoLocationKey\([^]*?^}/m)?.[0];
  vm.runInContext(photo, ctx);
  for(const name of ['isEvalReclassRowAssigned','getItemInquiryItemCode','getItemInquiryRowValue','getItemInquiryRowKey','getItemInquiryLotSortParts','compareItemInquiryRows','getItemInquiryRows','getArgosInventorySourceSnapshot','renderArgosInventoryTransactionSource','renderArgosReclassInquiryEditor','openArgosInventoryTransactionModal','openManagerEvalReport2DirectInquiry'])vm.runInContext(extract(name),ctx);
  return {ctx,rows,group,inquiry,sourceHeader};
}
