import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extractGoldenFunction} from '../../src/core/golden-function-extractor.mjs';
import {createSuspendRoutingFixture} from './suspend-assigned-routing-contract.mjs';

export function assertQueOwnerNormalization() {
    const {context:c,state} = createSuspendRoutingFixture();
    state.itemcodeDefaultOwners.set('000450.030.1',{assignedto:'dylan_collyge'});
    const owner = itemcode => c.resolveSuspendOwner({itemcode,DOCK_SUSPEND_DC_REQUEST:true});
    for (const code of ['000450.030.1',' 000450.030.1 ','450.30.01','000450.030.','000450.030.1...']) {
        assert.equal(owner(code),'dylan_collyge',code);
    }
    assert.equal(owner('000450.050.1'),'dylan_collyge','unambiguous family evidence');
    state.itemcodeDefaultOwners.set('000450.050.1',{assignedto:'other_worker'});
    assert.equal(owner('000450.070.1'),'Unassigned','conflicting families cannot grant ownership');
    assert.equal(owner('000450.050.1'),'other_worker','exact assignment wins');
    state.fullInventory=[{itemcode:'000451.030.1',effective_worker:'inventory_worker'}];
    assert.equal(owner('451.30.'),'inventory_worker','current inventory evidence');
    assert.equal(owner('999999.030.1'),'Unassigned','no fabricated owner');
    assert.equal(c.resolveSuspendOwner({itemcode:'000450.030.1',DOCK_SUSPEND_DC_REQUEST:true,
        suspend_owner_zone_override:true,suspend_eval_owner:'zone_worker'}),'zone_worker');
    state.itemcodeDefaultOwners.set(' 452.30.01... ',{assignedto:'current_worker'});
    assert.equal(c.resolveSuspendOwner({itemcode:'000452.030.1',DOCK_SUSPEND_DC_REQUEST:true,
        suspend_eval_owner:'stale_worker'}),'current_worker','normalized exact assignment precedes stale projection');
    state.itemcodeDefaultOwners.set('453.',{assignedto:'prefix_worker'});
    assert.equal(owner('000453.030.1'),'prefix_worker','base-only owner keys retain leading zeros');
}

export function assertQueHeaderContract() {
    assertQueOwnerNormalization();
    const source=fs.readFileSync(new URL('../../src/ui/ops-pilot-collections.js',import.meta.url),'utf8');
    const context=vm.createContext({});
    vm.runInContext(extractGoldenFunction(source,'decorateCompactBrowseRail'),context);
    const rail={id:'request-filter-toolbar',matches(){throw Error('Que commands must retain their own header owner');}};
    context.decorateCompactBrowseRail(rail,true);
    context.decorateCompactBrowseRail(rail,false);
}
