import assert from 'node:assert/strict';
import {navigationVisibilityFixture} from '../../src/ui/navigation-visibility-fixture.mjs';
import {runOperationalRpcRetry} from '../../src/services/operational-rpc-retry.js';

export function verifyColdProfileIsolation() {
    const fixture = navigationVisibilityFixture({username:' NELLIE_AGUILAR ',role:'standard'});
    try {
        fixture.render();
        assert.equal(fixture.visible('#bottom-nav .footer-nav-btn').length, 8);
        assert.equal(fixture.context.canDisplayNavigationView('drive'), true);
        fixture.context.nativeAuthSessionUserId = 'different-profile';
        assert.equal(fixture.context.canDisplayNavigationView('drive'), false);
    } finally { fixture.close(); }
}

export async function verifyLateReadIsDiscarded() {
    let active = true, attempts = 0;
    const send = async () => {
        attempts++;
        active = false;
        return {ok:true, value:'former account'};
    };
    await assert.rejects(runOperationalRpcRetry(send, {
        safe:true, current:() => active, isTransient:() => false,
        wait:() => assert.fail('an old account must never retry')
    }), {code:'REQUEST_SCOPE_CHANGED'});
    assert.equal(attempts,1);
}
