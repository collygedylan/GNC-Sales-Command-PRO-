import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseExpressionAt } from 'acorn';

function installFunction(context, file, name) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf('function ' + name + '(');
    const { end } = parseExpressionAt(source, start, { ecmaVersion:'latest' });
    vm.runInContext(source.slice(start,end), context);
}

export function assertWarmAvAndFinalSuspendReceipt() {
    const context = vm.createContext({ warmAvInventoryOwners:new WeakMap(), activeAVTab:'open',
        fullInventory:[{id:'warm'}], avOpenInventory:[], owner:'account-a',
        getSupabaseReadIdentityScope:()=>context.owner, canAccessView:()=>true,
        hasConfirmedCurrentAccountRevocation:()=>false, hasAuthenticatedOperationalReadIdentity:()=>true,
        getDockSuspendDcRequestGroupParts:()=>({ dock:'38', drop:'1', itemcode:'ITEM' }) });
    installFunction(context,'./view-dataset-loading.js','rememberWarmAvInventoryRows');
    installFunction(context,'./view-dataset-loading.js','canRenderWarmAvInventory');
    installFunction(context,'./suspend-receipt-domain.js','matchesFinalSuspendPullReceipt');
    assert.equal(context.canRenderWarmAvInventory(),false);
    context.rememberWarmAvInventoryRows(context.fullInventory);
    assert.equal(context.canRenderWarmAvInventory(),true);
    context.owner = 'account-b';
    assert.equal(context.canRenderWarmAvInventory(),false);

    const source = { suspend_origin_uid:'order' };
    const target = { LOCATIONCODE:'A.02.000', LOTCODE:'27.F1' };
    const common = { dock:'38', stopnumber:'1', itemcode:'ITEM', date_completed:'2026-11-13T15:00:00Z', suspend:null, suspend_to:null };
    const order = { ...common, unique_id:'order', locationcode:target.LOCATIONCODE, lotcode:target.LOTCODE, suspend_candidate_state:'approved' };
    const candidate = { ...common, unique_id:'candidate', suspend_origin_uid:'order', suspend_candidate_state:'replaced' };
    const receipt = { ok:true, finalPull:true, originUid:'order', rows:[order,candidate] };
    assert.equal(context.matchesFinalSuspendPullReceipt(receipt,source,target,'candidate'),true);
    assert.equal(context.matchesFinalSuspendPullReceipt(receipt,source,{...target,LOTCODE:'27.S1'},'candidate'),false);
    const foreign = { ...candidate, unique_id:'foreign', suspend_origin_uid:'other-order' };
    assert.equal(context.matchesFinalSuspendPullReceipt({...receipt,rows:[order,foreign]},source,target,'candidate'),false);
}
