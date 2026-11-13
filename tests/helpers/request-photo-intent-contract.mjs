import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {functionSource} from './completed-row-contract.mjs';
import {canonicalEngineFailures} from '../../scripts/fast-regression-contracts.mjs';

export function assertRequestPhotoIntentContract() {
    const scope = 'actor';
    const issues = [];
    const jobs = new Map([
        ['1',{id:'1',prefix:'req-',identity:{UNIQUE_ID:'request'},scope}],
        ['2',{id:'2',prefix:'req-',identity:{UNIQUE_ID:'request'},scope}],
        ['foreign',{id:'foreign',prefix:'req-',identity:{UNIQUE_ID:'request'},scope:'other'}],
        ['tag',{id:'tag',prefix:'req-',identity:{UNIQUE_ID:'tag'},scope}],
    ]);
    const ctx = runInNewContext(
        ['getScopedDetailRowPhotoJobs','getQueuedRequestPhotoIds','requestCompletionPhotoPatch','acknowledgeRequestPhotoIntentReceipt']
            .map(functionSource).join('\n') + '\n({requestCompletionPhotoPatch,acknowledgeRequestPhotoIntentReceipt})',
        {drivePhotoAttachments:jobs,isCurrentDrivePhotoAttachment:job=>job.scope===scope,
            reportHandledRuntimeIssue:(_owner,issue)=>issues.push(issue)}
    );
    const patch = {req_spec:'captured text'};
    const queued = ctx.requestCompletionPhotoPatch({request_id:'request',complete:true,patch});
    assert.deepEqual(Array.from(queued.queued_photo_ids),['1','2']);
    assert.equal(queued.req_spec,patch.req_spec);
    assert.equal(patch.queued_photo_ids,undefined);
    assert.equal(ctx.requestCompletionPhotoPatch({request_id:'request',complete:false,patch}),patch);
    ctx.acknowledgeRequestPhotoIntentReceipt(queued,{photo_intents_registered:true});
    assert.deepEqual(issues,[]);
    ctx.acknowledgeRequestPhotoIntentReceipt(queued,{});
    assert.deepEqual(issues,['REQUEST_PHOTO_INTENT_UNCONFIRMED']);

    const contract = {engines:[],routes:[],requestPhotoOwners:['persistRegularRequestPhotoAttachment']};
    const approved = {name:'supabaseRpc',firstArgument:'append_request_photo_intent_v3079',
        owner:'persistRegularRequestPhotoAttachment',insidePublisher:true};
    assert.deepEqual(canonicalEngineFailures({calls:[approved]},contract),[]);
    assert.match(canonicalEngineFailures({calls:[{...approved,insidePublisher:false}]},contract)[0],/bypasses canonical/);
    assert.match(canonicalEngineFailures({calls:[{...approved,owner:'directUiHandler'}]},contract)[0],/bypasses canonical/);
}
