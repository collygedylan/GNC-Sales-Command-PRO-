import { buildSync } from 'esbuild';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';

export function mappingBrowserBundle() {
  return buildSync({ entryPoints: ['services/customerRepMapping.ts'], bundle:true, format:'iife', globalName:'MappingEditor', write:false, logLevel:'silent' }).outputFiles[0].text + '\nglobalThis.MappingEditor = MappingEditor;';
}
let cachedRequestMappingFunctions;
export function requestMappingFunctions() {
  if (cachedRequestMappingFunctions) return cachedRequestMappingFunctions;
  const html = readComposedAppSource();
  const names = ['normalizeRepMatchToken','normalizeRepDisplayOrder','getRepNameLookupTokens','getRequestRepMatchTokens','doesRequestRepMatchValue',
    'buildRequestModalRepOption','mergeRequestModalRepOptions','getAllRequestModalRepOptions','resolveCanonicalRequestRepName','isRequestRepRoleValue','normalizeRequestRepUserOption','ensureRequestRepUserOptionsReady','getRequestModalLookupOwnerSignature','getRequestModalCustomerMappingCacheSignature','normalizeRequestSalesrepId','syncRequestModalCustomerMappingOwner','clearRequestModalCustomerMappingOwnerState',
    'getRequestMappedRepDirectory','getRequestReserveFallbackDirectory','getRequestAuthorizedReserveFallbackMappings','getReserveSalesRepLabel','getRequestSelectedSalesrepId','getRequestCustomerContext','buildRequestModalCustomerSearchOption','requestCustomerOptionKey','getCustomerRepMapRepValue','isRequestModalCustomerAuthorizationFailure',
    'getCustomerRepMapCustomerValue','getCustomerRepMapConsigneeValue','appendCustomerRepMapOption','mergeRequestModalCustomerOptions','getRequestGlobalCustomerOptions',
    'isActiveRequestCustomerMapping','fetchRequestCustomerMapRows','fetchRequestCustomerMapRowsForRepName','isRequestModalCustomerMapReady','buildRequestModalCustomerOptionsCache','loadRequestModalCustomerOptionsForRep','prefetchRequestModalCustomerOptions','scheduleRequestModalReferencePrefetch','scheduleGlobalReferencePrefetch','ensureDockAssignableUsers','prepareRequestModalChoicesForStartup','getRequestModalCustomerOptionsForRep','ensureRequestModalCustomerOptionsReady',
    'isCurrentRequestCustomerContext','getRequestModalCachedCustomerOptionsForRep','isRequestNaCustomerValue','buildRequestCustomerPickerGroups','getExistingRequestFolderRepRows','getExistingRequestFolderRowsSignature','buildExistingRequestFolderCustomerGroups','createNewRequestFolderForSelectedExistingPair','processCustStep','renderRequestModalRepPickerOnOpen',
    'isRequestCustomerMappingError','getRequestOutboxFailureStatus'];
  return cachedRequestMappingFunctions = names.map(name => {
    let start = html.indexOf(`        function ${name}(`);
    if (start < 0) start = html.indexOf(`        async function ${name}(`);
    if (start < 0) throw new Error('Missing Request mapping function ' + name);
    const tail = html.slice(start); const end = tail.slice(20).search(/\n        (?:async )?function /);
    if (end < 0) throw new Error('Missing function boundary ' + name);
    return tail.slice(0,end+20);
  }).join('\n');
}
export const mappingFixtureRow = {
  unique_id:'map-1', customeridentityid:'00012', consigneeid:'00007', salesrepid:'01', salesrepname:'Rep One',
  customername:'Garden ®', consigneename:'North ™', customerstatus:'A', consigneestatus:'A', revision:'3',
};
export const requestMappingSetup = `
var firstNonEmptyValue=(...values)=>values.find(value=>value!==undefined&&value!==null&&String(value).trim()!=='')||'';
var buildRequestCustomerValue=(a,b)=>a+' | '+b;
var getRequestCustomerConsigneeLabel=buildRequestCustomerValue;
var parseRequestCustomerFolderParts=(label,option)=>({customerName:option?.customerName||String(label).split(' | ')[0],consigneeName:option?.consigneeName||String(label).split(' | ')[1]||''});
var getRequestConsigneeFolderLabel=value=>value||'No consignee';
var normalizeRequestCustomerFolderKey=value=>normalizeRepMatchToken(value);
var requestModalCustomerOptionsCacheKey='',requestModalCustomerOptionsByRepCache=new Map(),requestModalCustomerGroupCacheKey='',requestModalCustomerGroupCache=[];
var requestMappingRpcCacheOwner='',requestMappingSecurityEpoch=0,requestReserveFallbackSource=null,requestReserveFallbackRevision='',requestReserveFallbackRowsBySalesrepId=new Map(),requestReserveFallbackOptionsByKey=new Map();
var requestModalCustomerOptionRowsCache=new Map(),requestExistingFolderGroupsByRepCache=new Map();
var requestGlobalCustomerOptionsCacheKey='',requestGlobalCustomerOptionsCache=[];
var mappingRevision='1',resolvedViewStateEpoch=0;
var getDatasetLoadSignature=key=>String(key)==='customerRepMap'?'customerRepMap:'+mappingRevision:String(key)+':1';
var isDatasetLoaded=()=>true;
var REQUEST_MODAL_REP_OPTIONS=['Rep One','Rep Two','Molly Dixon'].map(label=>{const token=normalizeRepMatchToken(label);return {label,token,collapsedToken:token.replace(/\\s+/g,'')};});
var REQUEST_NA_CUSTOMER_NAME='N/A';
var requestModalRepUserOptions=[],requestMappedRepSource=null,requestMappedRepRevision='',requestMappedRepOptions=[],requestMappedRepIdsByName=new Map();
var requestModalRepUserOptionsReady=false,requestModalRepUserOptionsLoadPromise=null,requestModalRepUserOptionsLoading=false,requestModalRepUserOptionsError='';
var getSupabaseReadIdentityScope=()=> 'identity-1',appAccessSnapshotState={status:'ready',stale:false,snapshot:{dataPermissionVersion:'perm-1'}};
var normalizeRoleAccessToken=value=>String(value||'').trim().toUpperCase(),normalizePushUsername=value=>String(value||'').trim().toLowerCase();
var resolveStaticRequestRepLabel=()=>'';
var isCsrRequestAssistantUser=()=>true,shouldUseProductionLiveSyncSideLoad=()=>false,supabaseFetch=async()=>[];
var assignableAppUsers=[],assignableAppUsersLoaded=false,ensureProductionLiveSyncSideData=async()=>true;
var currentUser='tester',getRoleAccessState=()=>({}),canAccessView=()=>true,canUseRequestRepScopedAccess=()=>false;
var getAllowedRequestModalRepOptions=()=>REQUEST_MODAL_REP_OPTIONS,getDefaultRequestRepName=()=>'',isRequestRepPickerLockedForCurrentUser=()=>false,getLockedRequestRepNameForCurrentUser=()=>'';
var isRequestModalCustomerMapReady=()=>true;
var tempSelectedReqRep='Rep One',tempRequestCustomerSelectedContext=null,tempRequestCustomerSelectedFinalLabel='';
var customerRepMapRows=[],reservesInventory=[],toasts=[],qtyCalls=[],tempSelectedReqSalesrepId='',requestMappingRpcCache=new Map();
var requestsInventory=[],canUseRequestMappedFoldersForCurrentUser=()=>false,isRequestRowArchivedForCompletion=()=>false;
var showToast=(...args)=>toasts.push(args),goToQtyStep=(...args)=>qtyCalls.push(args);
`;
