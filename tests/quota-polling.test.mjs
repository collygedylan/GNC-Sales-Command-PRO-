import test from 'node:test';
import assert from 'node:assert/strict';
import {assertQuotaPollingContract} from './helpers/quota-poll-contract.mjs';
import {createJsonResponder,cacheablePreferenceRead,readOnlyPollResponse} from '../supabase/functions/_shared/poll-response.ts';

test('passive status polling freezes hidden/offline work and backs off without overlaps',assertQuotaPollingContract);
test('only successful authenticated read responses receive private two-minute cache headers',()=>{
    const respond = createJsonResponder({},'3.0.88',(_key,value)=>value);
    const read = cacheablePreferenceRead({shortcuts:['drive']});
    assert.equal(respond({ok:true,data:read}).headers.get('cache-control'),'private, max-age=120');
    assert.equal(respond({ok:true,data:{shortcuts:[]}}).headers.get('cache-control'),'private, no-store');
    assert.equal(respond({data:read},403).headers.get('cache-control'),'private, no-store');
    assert.equal(readOnlyPollResponse(respond({ok:true}),{action:'photo_history',operation:'status'}).headers.get('cache-control'),'private, max-age=120');
    assert.equal(readOnlyPollResponse(respond({ok:true}),{action:'photo_history',operation:'send'}).headers.get('cache-control'),'private, no-store');
});
