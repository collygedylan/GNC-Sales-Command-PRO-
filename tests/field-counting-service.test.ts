import { describe, expect, it, vi } from 'vitest';
import { createFieldCountingBridge, fieldCountingSnapshot, fieldCountingReceipt } from '../services/fieldCounting';
const row = { sourceUid:'001', block:'D', location:'D.01.000', itemcode:'00021', commonname:'Oak ®', contsize:'3g',lotcode:'01',season:'F1',onHand:'12' };
const snapshot = { rows:[row],counts:[],options:[],datasetRevision:'2',masterRevision:'4',page:0,total:1,complete:true };
const input = {countType:'bunch' as const,scope:{block:'D',location:'D.01.000'},direction:'north_south',entries:[{sourceUid:'001',countedQty:0,note:'Checked ™',expectedUpdatedAt:null,rowOrder:1}],idempotencyKey:'fc200000-0000-4000-8000-000000000002'};
describe('field counting typed database boundary',()=>{
 it('preserves physical identity, Unicode and explicit completeness',()=>{expect(fieldCountingSnapshot(snapshot)).toEqual(snapshot);});
 it('rejects malformed, duplicate and out-of-scope response rows',()=>{
  expect(()=>fieldCountingSnapshot({...snapshot,rows:[row,row]})).toThrow(/identities/);
  expect(()=>fieldCountingSnapshot({...snapshot,rows:[{...row,onHand:12}]})).toThrow(/text/);
  expect(()=>fieldCountingSnapshot({...snapshot,complete:undefined})).toThrow(/completeness/);
  expect(()=>fieldCountingSnapshot({...snapshot,counts:[{sourceUid:'other',countedQty:1,direction:'north_south',rowOrder:1,note:'',updatedAt:'2026-10-10T00:00:00Z',actor:'Worker'}]})).toThrow(/identities/);
 });
 it('uses only the fixed command operation, forwards abort and keeps zero counts',async()=>{
  const transport=vi.fn().mockResolvedValueOnce({ok:true,data:snapshot}).mockResolvedValueOnce({ok:true,data:{revision:'3',savedSourceUids:['001']}});
  const bridge=createFieldCountingBridge({scopeKey:'actor',countType:'bunch',revisionKey:'4:2',transport});
  const signal=new AbortController().signal;
  await bridge.readSnapshot({countType:'bunch',block:'D',location:'D.01.000',signal});
  expect(transport).toHaveBeenNthCalledWith(1,{action:'field_count',operation:'read',payload:{countType:'bunch',block:'D',location:'D.01.000'}},signal);
  await bridge.saveCounts(input);
  expect(transport.mock.calls[1][0]).toEqual({action:'field_count',operation:'save',commandId:input.idempotencyKey,payload:{countType:'bunch',scope:input.scope,direction:input.direction,entries:input.entries}});
 });
 it('reports only server-confirmed count revisions to the active view',async()=>{
  const onRevision=vi.fn();
  const transport=vi.fn().mockResolvedValue({ok:true,data:{revision:'19',savedSourceUids:['001']}});
  const bridge=createFieldCountingBridge({scopeKey:'actor',countType:'bunch',revisionKey:'4:2',transport,onRevision});
  await bridge.saveCounts(input);
  expect(onRevision).toHaveBeenCalledTimes(1);
  expect(onRevision).toHaveBeenCalledWith('bunch','19');
  transport.mockResolvedValue({ok:false,message:'FIELD_COUNT_REVISION_CONFLICT'});
  await expect(bridge.saveCounts(input)).rejects.toThrow(/changed while you were editing/);
  expect(onRevision).toHaveBeenCalledTimes(1);
 });
 it('requires a durable report receipt and every saved row before confirming completion',async()=>{
  const transport=vi.fn().mockResolvedValue({ok:true,data:{revision:'3',savedSourceUids:['001'],reportId:input.idempotencyKey,deliveryStatus:'queued'}});
  const bridge=createFieldCountingBridge({scopeKey:'actor',countType:'bunch',revisionKey:'4:2',transport});
  expect((await bridge.completeAndEmail(input)).deliveryStatus).toBe('queued');
  expect(transport.mock.calls[0][0].operation).toBe('complete');
  transport.mockResolvedValue({ok:true,data:{revision:'3',savedSourceUids:['other']}});
  await expect(bridge.saveCounts(input)).rejects.toThrow(/every count/);
  expect(()=>fieldCountingReceipt({revision:'3',savedSourceUids:['001']},true)).toThrow();
 });
 it('enforces the server quantity ceiling and 100-row mutation cap before transport',async()=>{
  const transport=vi.fn();
  const bridge=createFieldCountingBridge({scopeKey:'actor',countType:'bunch',revisionKey:'4:2',transport});
  await expect(bridge.saveCounts({...input,entries:[{...input.entries[0],countedQty:1_000_000_000}]})).rejects.toThrow(/999,999,999/);
  await expect(bridge.completeAndEmail({...input,entries:Array.from({length:101},(_,index)=>({...input.entries[0],sourceUid:`uid-${index}`}))})).rejects.toThrow(/1–100/);
  expect(transport).not.toHaveBeenCalled();
 });
 it('rejects account/type changes and returns actionable server failures',async()=>{
  const transport=vi.fn().mockResolvedValue({ok:false,message:'Count changed. Refresh and review.'});
  const bridge=createFieldCountingBridge({scopeKey:'actor',countType:'bunch',revisionKey:'4:2',transport});
  await expect(bridge.saveCounts({...input,countType:'profiles' as never})).rejects.toThrow(/scope changed/);
  expect(transport).not.toHaveBeenCalled();
  await expect(bridge.saveCounts(input)).rejects.toThrow(/Count changed/);
 });
});
