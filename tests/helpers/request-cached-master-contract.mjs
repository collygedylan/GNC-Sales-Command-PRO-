import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { calculateLiveLocPhotoMatch } from '../../src/core/inventory-photo-domain.js';
import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import { extractRequestRuntimeFunction } from './request-runtime-function.mjs';

export function requestCachedMasterContract() {
    const master = { UNIQUE_ID: 'master-ivy', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', PTRONHAND: 88, PTRREVIEWED: 0, PTRAVAILABLE: 88, S_LTS: 88, LOC_MATCH_QTY: 0, LOC_ON_HAND: 3 };
    const optionsSeen = [];
    let masterState = { initialLoaded: true, rowCompleteness: 'complete', liveVerifiedScope: 'owner-scope', liveVerifiedPermission: 'permission-v1' };
    let authorization = { scope: 'owner-scope', readScope: 'user-owner', permission: 'permission-v1' };
    const context = vm.createContext({
        window: {}, fullInventory: [],
        resolveLiveInventoryForCard: () => null, getQueueDisplayEvidenceRow: () => null,
        getSuspendTagInventoryIdentity: item => item, calculateLiveLocPhotoMatch, productionDisplayMasterReceipt: null,
        firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? undefined,
        isDockSuspendDcRequestMirrorRow: () => false,
        getQueueCardInventoryState: () => ({ status: 'loading', row: null }),
        getQueueCardInventoryAuthorizationContext: () => authorization,
        getDatasetState: () => masterState,
        findLinkedMasterRow: () => master,
        buildInventoryQuantityChipsHtml: (row, options) => { optionsSeen.push(options); return JSON.stringify(row); }
    });
    vm.runInContext(readFileSync(new URL('../../assets/queue-inventory-hydration.js', import.meta.url), 'utf8'), context);
    context.masterInventoryLookup = context.window.AgMetricQueueInventory.createIndex([master]);
    const request = { UNIQUE_ID: 'request-ivy', MASTER_ID: 'master-ivy', ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1' };
    const source = readComposedAppSource();
    vm.runInContext(['isFalseBlockLocation', 'normalizeRequestCardMetrics', 'buildQueueInventoryMetricsHtml'].map(name => extractRequestRuntimeFunction(source, name)).join('\n'), context);
    const rendered = JSON.parse(context.buildQueueInventoryMetricsHtml(request, 'request'));
    for (const key of ['PTRONHAND','PTRREVIEWED','PTRAVAILABLE','S_LTS','LOC_MATCH_QTY','LOC_ON_HAND']) assert.equal(rendered[key], master[key], key + ' ' + JSON.stringify({ rendered, options: optionsSeen[0] }));
    assert.equal(optionsSeen[0].sourceView, 'drive');
    assert.equal(optionsSeen[0].hydrationStatus, 'ready');
    authorization = { scope: 'new-owner-scope', readScope: 'new-user-owner', permission: 'permission-new' };
    masterState = { initialLoaded: true, rowCompleteness: 'complete', liveVerifiedScope: 'owner-scope', liveVerifiedPermission: 'permission-v1' };
    const denied = JSON.parse(context.buildQueueInventoryMetricsHtml(request, 'request'));
    assert.notEqual(denied.PTRONHAND, master.PTRONHAND);
    assert.notEqual(denied.PTRAVAILABLE, master.PTRAVAILABLE);
    assert.equal(optionsSeen[1].hydrationStatus, 'loading');
}

