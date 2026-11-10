import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export async function createRequestWithChoice(reuse) {
  const source = readFileSync(new URL('../../assets/request-folder-choice.js', import.meta.url), 'utf8');
  const item = { UNIQUE_ID:'row-a', ITEMCODE:'item-a', LOCATIONCODE:'loc-a', LOTCODE:'lot-a', SPEC:'saved spec', PHOTO_LINK:'saved-photo' };
  let outbox;
  const ctx = {
    window:{AgMetricRequestSubmission:{normalizeOptionalQuantity:x=>x||null}},
    navigator:{onLine:true}, requestSubmissionGeneration:1, requestSubmissionEntries:new Map(),
    tempSelectedReqRep:'Rep', currentUser:'user', activeDetailSourceView:'general', lastView:'general', selectedItemSources:new Map(),
    getRequestSubmissionOwnerKey:()=> 'owner', captureRequestSubmissionForm:()=>({domIds:['row-a']}),getActiveRequestSubmissionEntry:()=>null,
    isQuickDriveRequestMode:()=>false, resolveRequestRepSelectionForCurrentUser:x=>x,getDefaultRequestRepName:()=> 'Rep',
    syncRequestEmailChainSelectionFromInputs:()=>{},buildRequestCreatorAuditInfo:()=>({creatorUsername:'user'}),
    firstNonEmptyValue:(...values)=>values.find(v=>v!==undefined&&v!==null&&String(v)!=='')??'',
    canUseRequestEmailChainPicker:()=>false,getRequestSourceDomIds:()=>['row-a'],findItemByDomId:()=>item,
    getRequestSelectionIntentToken:()=> 'token',getRequestEntryCapabilities:()=>({canCreateGeneral:true}),
    resolveRequestCustomerContext:()=>({customeridentityid:'c',customername:'Customer',consigneeidentityid:'d',consigneename:'Consignee'}),
    getRequestCustomerContext:x=>x,isRequestNaCustomerValue:()=>false,ensureRequestSchemaCompatible:async()=>true,
    createStandardRequestFolderName:()=> 'folder', createStableClientBatchId:()=> 'batch',
    resolveCanonicalInventoryRow:value=>value, getRequestReusableData:()=>({hasReusableEvidence:true,spec:'saved spec',photoLink:'saved-photo'}),
    normalizeRequestDesiredMeasurementValue:x=>x||'',getRequestResolvedPickNoteValue:()=>'',mergePhotoCsvList:values=>values.filter(Boolean)[0]||'',
    parseAppNumber:x=>Number(x)||null,getPhotoUrlList:x=>x?[x]:[],applyRequestCreatorAuditFields:()=>{},
    performRequestSubmission:async entry=>{outbox=entry;return true;},showToast:()=>{}
  };
  vm.runInNewContext(source,ctx);
  await ctx.submitRequestCreateBatch('', 'Customer', {'row-a':{reuse}});
  return outbox;
}
