import fs from 'node:fs';
import { buildSync } from 'esbuild';

export function mappingBrowserBundle() {
  return buildSync({ entryPoints: ['services/customerRepMapping.ts'], bundle:true, format:'iife', globalName:'MappingEditor', write:false, logLevel:'silent' }).outputFiles[0].text + '\nglobalThis.MappingEditor = MappingEditor;';
}
export function requestMappingFunctions() {
  const html = fs.readFileSync('index.html','utf8');
  const names = ['normalizeRepMatchToken','normalizeRepDisplayOrder','getRepNameLookupTokens','getRequestRepMatchTokens','doesRequestRepMatchValue',
    'buildRequestModalRepOption','mergeRequestModalRepOptions','getAllRequestModalRepOptions','resolveCanonicalRequestRepName',
    'getRequestCustomerContext','buildRequestModalCustomerSearchOption','requestCustomerOptionKey','getCustomerRepMapRepValue',
    'getCustomerRepMapCustomerValue','getCustomerRepMapConsigneeValue','appendCustomerRepMapOption','mergeRequestModalCustomerOptions',
    'isActiveRequestCustomerMapping','getRequestModalCustomerOptionsCacheSignature','buildRequestModalCustomerOptionsCache','getRequestModalCustomerOptionsForRep',
    'isCurrentRequestCustomerContext','buildRequestCustomerPickerGroups','processCustStep',
    'isRequestCustomerMappingError','getRequestOutboxFailureStatus'];
  return names.map(name => {
    const start = html.indexOf(`        function ${name}(`);
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
var mappingRevision='1',resolvedViewStateEpoch=0;
var getDatasetLoadSignature=key=>String(key)==='customerRepMap'?'customerRepMap:'+mappingRevision:String(key)+':1';
var REQUEST_MODAL_REP_OPTIONS=['Rep One','Rep Two','Molly Dixon'].map(label=>{const token=normalizeRepMatchToken(label);return {label,token,collapsedToken:token.replace(/\\s+/g,'')};});
var requestModalRepUserOptions=[],requestMappedRepSource=null,requestMappedRepRevision='',requestMappedRepOptions=[];
var isRequestModalCustomerMapReady=()=>true;
var tempSelectedReqRep='Rep One',tempRequestCustomerSelectedContext=null,tempRequestCustomerSelectedFinalLabel='';
var customerRepMapRows=[],reservesInventory=[],toasts=[],qtyCalls=[];
var showToast=(...args)=>toasts.push(args),goToQtyStep=(...args)=>qtyCalls.push(args);
`;
