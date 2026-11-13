import { buildSync } from 'esbuild';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';

export function mappingBrowserBundle() {
  return buildSync({ entryPoints: ['services/customerRepMapping.ts'], bundle:true, format:'iife', globalName:'MappingEditor', write:false, logLevel:'silent' }).outputFiles[0].text + '\nglobalThis.MappingEditor = MappingEditor;';
}
let cachedRequestMappingFunctions;
let composedFunctionSource;

function collectComposedFunctions() {
  const source = readComposedRuntimeSource();
  const declarations = new Map();
  simple(parse(source, { ecmaVersion: 'latest' }), {
    FunctionDeclaration(node) {
      const previous = declarations.get(node.id.name);
      if (!previous || previous.start > node.start) declarations.set(node.id.name, node);
    },
  });
  return { source, declarations };
}

export function requestMappingFunction(name) {
  composedFunctionSource ??= collectComposedFunctions();
  const { source, declarations } = composedFunctionSource;
  const declaration = declarations.get(name);
  if (!declaration) throw new Error('Missing Request mapping function ' + name);
  return source.slice(declaration.start, declaration.end);
}

export function requestMappingFunctions() {
  if (cachedRequestMappingFunctions) return cachedRequestMappingFunctions;
  const names = ['normalizeRepMatchToken','normalizeRepDisplayOrder','getRepNameLookupTokens','matchSalesRepIdentity','getRequestRepMatchTokens','doesRequestRepMatchValue',
    'buildRequestModalRepOption','mergeRequestModalRepOptions','getAllRequestModalRepOptions','resolveCanonicalRequestRepName','isRequestRepRoleValue','normalizeRequestRepUserOption','dedupeRequestModalRepUsers','ensureRequestRepUserOptionsReady','getRequestModalLookupOwnerSignature','getRequestModalCustomerMappingCacheSignature','normalizeRequestSalesrepId','syncRequestModalCustomerMappingOwner','clearRequestModalCustomerMappingOwnerState',
    'getRequestMappedRepDirectory','getRequestReserveFallbackDirectory','getRequestAuthorizedReserveFallbackMappings','getReserveSalesRepLabel','isUniversalRequestDirectoryRep','getRequestSelectedSalesrepId','getRequestCustomerContext','buildRequestModalCustomerSearchOption','buildRequestModalNaCustomerOption','requestCustomerOptionKey','buildRequestCustomIdentity','addCustomRequestCustomerOption','getCustomerRepMapRepValue','isRequestModalCustomerAuthorizationFailure','hasVerifiedRequestRepCanonicalDirectory',
    'getCustomerRepMapCustomerValue','getCustomerRepMapConsigneeValue','appendCustomerRepMapOption','mergeRequestModalCustomerOptions','getRequestGlobalCustomerOptions','buildSalesRepCustomerDirectory','getRequestUniversalCustomerOptions','fetchRequestUniversalCustomerOptions',
    'isActiveRequestCustomerMapping','fetchRequestCustomerMapRows','fetchRequestCustomerMapRowsForRepName','isRequestModalCustomerMapReady','buildRequestModalCustomerOptionsCache','loadRequestModalCustomerOptionsForRep','prefetchRequestModalCustomerOptions','scheduleRequestModalReferencePrefetch','scheduleGlobalReferencePrefetch','ensureDockAssignableUsers','prepareRequestModalChoicesForStartup','getRequestModalCustomerOptionsForRep','ensureRequestModalCustomerOptionsReady',
    'isCurrentRequestCustomerContext','getRequestModalCachedCustomerOptionsForRep','isRequestNaCustomerValue','isRequestNaCustomerPair','buildRequestCustomerPickerGroups','getExistingRequestFolderRepRows','getExistingRequestFolderRowsSignature','buildExistingRequestFolderCustomerGroups','createNewRequestFolderForSelectedExistingPair','resolveNewRequestFolderChoice','isReservedRequestNaChoice','hasRequestCreateMappingTuple','processCustStep','renderRequestModalRepPickerOnOpen',
    'isRequestCustomerMappingError','getRequestOutboxFailureStatus'];
  cachedRequestMappingFunctions = names.map(requestMappingFunction).join('\n');
  return cachedRequestMappingFunctions;
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
var requestExistingFolderGroupsCacheKey='',requestExistingFolderGroupsCache=[],requestExistingFolderGroupsByRepCache=new Map();
var requestMappingRpcCacheOwner='',requestMappingSecurityEpoch=0,requestReserveFallbackSource=null,requestReserveFallbackRevision='',requestReserveFallbackRowsBySalesrepId=new Map(),requestReserveFallbackOptionsByKey=new Map();
var requestModalCustomerOptionRowsCache=new Map(),requestExistingFolderGroupsByRepCache=new Map();
var requestGlobalCustomerOptionsCacheKey='',requestGlobalCustomerOptionsCache=[],requestUniversalCustomerOptionsCacheKey='',requestUniversalCustomerOptionsCache=[];
var requestCustomCustomerOptions=new Map();
var requestModalCustomerOptionsLoadPromise=null,requestModalCustomerOptionsReady=false,requestModalCustomerOptionsLoading=false,requestModalCustomerOptionsError='';
var requestMappingReadGeneration=0,requestModalAsyncGeneration=0;
var mappingRevision='1',resolvedViewStateEpoch=0;
var refreshRequestModalCustomerStepIfVisible=()=>false;
var getDatasetLoadSignature=key=>String(key)==='customerRepMap'?'customerRepMap:'+mappingRevision:String(key)+':1';
var isDatasetLoaded=()=>true;
var REQUEST_MODAL_REP_OPTIONS=['Rep One','Rep Two','Molly Dixon'].map(label=>{const token=normalizeRepMatchToken(label);return {label,token,collapsedToken:token.replace(/\\s+/g,'')};});
var REQUEST_NA_CUSTOMER_NAME='N/A',REQUEST_NA_CONSIGNEE_NAME='N/A',JD_EXECUTIVE_SALESREP_ID='AGDATA_EXECUTIVE_ALL';
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
var customerRepMapRows=[],socInventory=[],reservesInventory=[],toasts=[],qtyCalls=[],tempSelectedReqSalesrepId='',requestMappingRpcCache=new Map();
var requestsInventory=[],requestHistoryInventory=[],canUseRequestMappedFoldersForCurrentUser=()=>false,isRequestRowArchivedForCompletion=()=>false;
var showToast=(...args)=>toasts.push(args),goToQtyStep=(...args)=>qtyCalls.push(args);
`;
