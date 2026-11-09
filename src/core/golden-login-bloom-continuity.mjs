import assert from 'node:assert/strict';
import vm from 'node:vm';

function browserFunction(read, asset, name, bindings) {
    return vm.runInNewContext(read(`assets/${asset}.js`) + `\n${name}`, bindings);
}

export async function loginBloomContinuity({ read }) {
    const saved = { username: 'nelly_aguilar' };
    let remoteCalls = 0;
    const login = browserFunction(read, 'login-continuity', 'fetchLoginUser', {
        startGlobalProgress() {}, stopGlobalProgress() {}, window: {}, navigator: { onLine: true },
        normalizeNativeAuthAlias: user => user, scheduleLoginCachePrefetch() {},
        tryVerifiedLoginRecord: (_, code) => code === 'saved' ? saved : null,
        tryLocalCachedLoginRecord: () => null,
        fetchRemoteLoginUser: () => { remoteCalls++; return { ok: false, reason: 'mismatch' }; }
    });
    assert.equal((await login(saved.username, 'saved')).user, saved);
    assert.equal(remoteCalls, 0);
    assert.equal((await login(saved.username, 'wrong')).reason, 'mismatch');

    const reserved = { customeridentityid: 'AGDATA_NA_CUSTOMER', consigneeidentityid: 'AGDATA_NA_CONSIGNEE',
        customername: 'N/A', consigneename: 'N/A', request_selected_salesrep_id: '' };
    const bind = browserFunction(read, 'request-folder-choice', 'bindRequestNaRep', {
        isRequestNaCustomerPair: (a, b) => a === 'N/A' && b === 'N/A', tempSelectedReqRep: 'Troy Lee',
        getRequestSelectedSalesrepId: name => name === 'Troy Lee' ? 'fixture-verified-rep' : ''
    });
    assert.equal(bind(reserved).request_selected_salesrep_id, 'fixture-verified-rep');
    assert.equal(bind({ ...reserved, consigneeidentityid: 'other' }).request_selected_salesrep_id, '');

    const url = 'https://example.test/photo.jpg';
    const share = browserFunction(read, 'inventory-share-text', 'formatInventoryItemsText', {
        getInventorySharePhotoEntries: () => [{ label: 'Photo 1', href: url }],
        getInventoryShareGalleryIdentity: () => ({ title: 'Fixture' }), getInventoryShareFieldRows: () => []
    });
    assert.ok(share([{}], '', { includePhotoUrls: true }).includes(`Photo 1: ${url}`));
    assert.ok(!share([{}]).includes(url));
}
