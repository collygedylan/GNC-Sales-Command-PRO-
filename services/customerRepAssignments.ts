import type { MappingTransport, MappingRow } from './customerRepMapping';

export interface RepOption { salesrepId: string; salesrepName: string }
export interface AssignmentPage { rows: MappingRow[]; total: number; page: number; pageSize: number; revision: string; canEdit: boolean }
export interface AssignmentMutationResult { row: MappingRow; revision: string }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isCanonicalName = (name: string): boolean => name.length > 0 && name.length <= 240 && name === name.trim()
  && !Array.from(name).some(character=>{const code=character.charCodeAt(0);return code<32||code===127;}) && !name.includes('@') && !name.includes(',')
  && name.split(/\s+/u).length >= 2 && !/^S99(?:\s|$)/iu.test(name);
const repCaches = new Map<string, { revision: string; reps: RepOption[] }>();
const requestIds = new Map<string, string>();
const inflight = new Map<string, Promise<AssignmentMutationResult>>();

function uuid(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export function validateMappingRow(value: unknown): MappingRow {
  if (!isRecord(value) || typeof value.unique_id !== 'string' || !value.unique_id || typeof value.revision !== 'string' || !value.revision)
    throw new Error('The server returned an invalid assignment. Refresh before continuing.');
  const requiredTextFields = ['customeridentityid','consigneeid','salesrepid','salesrepname','customername','consigneename','customerstatus','consigneestatus'];
  for (const field of requiredTextFields) if (value[field] !== null && typeof value[field] !== 'string')
    throw new Error(`The server returned an invalid mapping field: ${field}. Refresh before continuing.`);
  for (const field of ['sourceSalesrepId','sourceSalesrepName']) if (value[field] !== undefined && value[field] !== null && typeof value[field] !== 'string')
    throw new Error(`The server returned invalid assignment metadata: ${field}. Refresh before continuing.`);
  if (value.hasOverride !== undefined && typeof value.hasOverride !== 'boolean') throw new Error('The server returned invalid assignment metadata. Refresh before continuing.');
  return { unique_id:value.unique_id, revision:value.revision,
    customeridentityid:(value.customeridentityid as string|null|undefined) ?? null,
    consigneeid:(value.consigneeid as string|null|undefined) ?? null,
    salesrepid:(value.salesrepid as string|null|undefined) ?? null,
    salesrepname:(value.salesrepname as string|null|undefined) ?? null,
    customername:(value.customername as string|null|undefined) ?? null,
    consigneename:(value.consigneename as string|null|undefined) ?? null,
    customerstatus:(value.customerstatus as string|null|undefined) ?? null,
    consigneestatus:(value.consigneestatus as string|null|undefined) ?? null,
    hasOverride:value.hasOverride === true,
    sourceSalesrepId:(value.sourceSalesrepId as string|null|undefined) ?? null,
    sourceSalesrepName:(value.sourceSalesrepName as string|null|undefined) ?? null };
}

export function validateMappingPage(value: unknown): AssignmentPage {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.rows) || value.rows.length > 100
    || !Number.isSafeInteger(value.total) || Number(value.total) < 0 || !Number.isSafeInteger(value.page) || Number(value.page) < 0
    || !Number.isSafeInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 100
    || typeof value.revision !== 'string' || typeof value.canEdit !== 'boolean') throw new Error('Mapping directory is unavailable. Refresh and try again.');
  return { rows:value.rows.map(validateMappingRow), total:Number(value.total), page:Number(value.page), pageSize:Number(value.pageSize), revision:value.revision, canEdit:value.canEdit };
}

export function createCustomerRepAssignments(transport: MappingTransport, identityScope: string) {
  const scope = identityScope.trim() || `anonymous-session:${uuid()}`;
  let currentRevision = '';
  const pageCache = new Map<string, AssignmentPage>();

  async function reps(signal: AbortSignal): Promise<RepOption[]> {
    const requestedRevision=currentRevision;
    const cached = repCaches.get(scope);
    if (cached && (!currentRevision || cached.revision === currentRevision)) {
      currentRevision=cached.revision;
      repCaches.delete(scope);repCaches.set(scope,cached);
      return cached.reps;
    }
    const first = await transport({ action:'customer-rep-map', operation:'reps', page:0, pageSize:100 }, signal);
    if (!isRecord(first) || first.ok !== true || !Array.isArray(first.rows) || !Number.isSafeInteger(first.total)
      || !Number.isSafeInteger(first.page) || first.page !== 0 || !Number.isSafeInteger(first.pageSize)
      || Number(first.pageSize) < 1 || Number(first.pageSize) > 100 || typeof first.revision !== 'string')
      throw new Error('Sales rep choices are unavailable. Retry to reload them.');
    const total=Number(first.total), pageSize=Number(first.pageSize), revision=first.revision;
    if(total>5000||first.rows.length>pageSize)throw new Error('Sales rep choices contain an invalid page. Refresh and try again.');
    const values:unknown[]=[...first.rows];
    for(let page=1;page<Math.ceil(total/pageSize);page++){
      const next=await transport({action:'customer-rep-map',operation:'reps',page,pageSize},signal);
      if(!isRecord(next)||next.ok!==true||!Array.isArray(next.rows)||next.revision!==revision||next.page!==page||next.pageSize!==pageSize||next.total!==total||next.rows.length>pageSize)
        throw new Error('Sales rep choices changed while loading. Retry to reload them.');
      values.push(...next.rows);
    }
    if(values.length!==total)throw new Error('Sales rep choices are incomplete. Retry to reload them.');
    if(signal.aborted||(requestedRevision&&requestedRevision!==revision)||(currentRevision&&currentRevision!==revision))
      throw new Error('Sales rep choices changed while loading. Retry to reload them.');
    const seen=new Set<string>();
    const rows=values.map(value=>{
      if(!isRecord(value)||typeof value.salesrepId!=='string'||!value.salesrepId.trim()||typeof value.salesrepName!=='string'
        ||!isCanonicalName(value.salesrepName)||/^S99$/iu.test(value.salesrepId.trim())||seen.has(value.salesrepId))
        throw new Error('Sales rep choices contain an invalid assignment. Refresh and try again.');
      seen.add(value.salesrepId);return{salesrepId:value.salesrepId,salesrepName:value.salesrepName};
    });
    currentRevision=revision;repCaches.delete(scope);repCaches.set(scope,{revision,reps:rows});
    while(repCaches.size>16)repCaches.delete(repCaches.keys().next().value!);
    return rows;
  }

  function setRevision(revision:string):void{
    if(currentRevision&&currentRevision!==revision){pageCache.clear();repCaches.delete(scope);}
    currentRevision=revision;
  }
  function cachedPage(key:string):AssignmentPage|undefined{return pageCache.get(key);}
  function storePage(key:string,value:AssignmentPage):void{setRevision(value.revision);pageCache.set(key,value);}
  function invalidate():void{pageCache.clear();repCaches.delete(scope);currentRevision='';}
  async function list(payload:Record<string,unknown>,signal:AbortSignal):Promise<AssignmentPage>{
    return validateMappingPage(await transport(payload,signal));
  }

  function mutation(operation:'assign'|'reset'|'save',row:MappingRow,salesrepId:string|undefined,signal:AbortSignal,names?:{customerName:string;consigneeName:string}):Promise<AssignmentMutationResult>{
    const detail=operation==='save'?`${names?.customerName||''}\u0000${names?.consigneeName||''}`:salesrepId||'';
    const key=`${scope}|${operation}|${row.unique_id}|${row.revision}|${detail}`;
    const active=inflight.get(key);if(active)return active;
    const requestId=requestIds.get(key)||uuid();requestIds.set(key,requestId);
    const payload:Record<string,unknown>={action:'customer-rep-map',operation,id:row.unique_id,expectedRevision:row.revision,requestId};
    if(operation==='assign')payload.salesrepId=salesrepId;
    if(operation==='save'&&names){payload.salesrepId=row.salesrepid||'';payload.salesrepName=row.salesrepname||'';payload.customerName=names.customerName;payload.consigneeName=names.consigneeName;}
    const promise=transport(payload,signal).then(value=>{
      if(!isRecord(value)||value.ok!==true||typeof value.revision!=='string')throw new Error('Assignment was not confirmed. Retry to check its status.');
      const savedRow=validateMappingRow(value.row);
      if(savedRow.unique_id!==row.unique_id)throw new Error('The server confirmed a different mapping. Refresh before continuing.');
      const result={row:savedRow,revision:value.revision};requestIds.delete(key);invalidate();return result;
    }).finally(()=>{inflight.delete(key);});
    inflight.set(key,promise);return promise;
  }

  return {
    reps,setRevision,getRevision:()=>currentRevision,cachedPage,storePage,invalidate,list,dispose(){pageCache.clear();},
    saveNames(row:MappingRow,customerName:string,consigneeName:string,signal:AbortSignal){return mutation('save',row,undefined,signal,{customerName,consigneeName});},
    assign(row:MappingRow,salesrepId:string,signal:AbortSignal){return mutation('assign',row,salesrepId,signal);},
    reset(row:MappingRow,signal:AbortSignal){return mutation('reset',row,undefined,signal);},
  };
}

/** Warm the same identity-scoped rep catalog used by the mounted assignment editor. */
export async function prefetchCustomerRepOptions(transport: MappingTransport, identityScope: string, signal: AbortSignal): Promise<RepOption[]> {
  const assignments = createCustomerRepAssignments(transport, identityScope);
  try { return await assignments.reps(signal); }
  finally { assignments.dispose(); }
}
