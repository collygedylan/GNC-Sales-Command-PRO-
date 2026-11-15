import assert from 'node:assert/strict';
import {createJsonResponder,cacheablePreferenceRead} from '../../supabase/functions/_shared/poll-response.ts';

export function assertCanonicalPollResponse() {
    const respond=createJsonResponder({},'fixture',(_key,value)=>value);
    const preferences=cacheablePreferenceRead({theme:'dark'});
    assert.equal(respond({data:preferences}).headers.get('Cache-Control'),'private, max-age=120');
    assert.equal(respond({data:{theme:'dark'}}).headers.get('Cache-Control'),'private, no-store');
    for(const status of [401,403,409,423]) {
        const denied=respond({data:preferences},status);
        assert.equal(denied.status,status);
        assert.equal(denied.headers.get('Cache-Control'),'private, no-store');
    }
}
