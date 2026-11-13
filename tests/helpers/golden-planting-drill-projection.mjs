import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function assertPlantingDrillUsesExactLocationPlans() {
    const source = readFileSync(new URL('../../assets/nursery-table-render.js',import.meta.url),'utf8');
    const scope = vm.createContext({publishNurseryDrillExcelSnapshot() {}});
    vm.runInContext(source,scope);
    const plans = [
        {final_target:'F.05.000',id:'first-bay'},
        {final_target:'F.05.001',id:'second-bay'},
        {final_target:'G.10.000',id:'other-block'}
    ];
    const state = {currentIssues:[],q:'',bunchSimulatorDrillLevel:'cards',subview:'planting',
        alpha:'F',blockNumber:'F.05',location:'F.05.000'};
    const bodies = [];
    const context = {state,plantingRows:()=>plans,locationCards:()=>[],escape:String,
        model:{block:String},blockMetrics:()=>({total:101,occupied:7,reserved:1,open:93}),roundBeds:String,
        plantingCard:plan=>`<article>${plan.id}</article>`,
        commitBunchMarkup:(_top,body)=>bodies.push(body)};
    scope.nurseryTable_drawBunchDrill(context,{locations:new Map()});
    state.location = 'F.05.001';
    scope.nurseryTable_drawBunchDrill(context,{locations:new Map()});
    assert.match(bodies[0], /<article>first-bay<\/article>/);
    assert.doesNotMatch(bodies[0], /second-bay|other-block/);
    assert.match(bodies[1], /<article>second-bay<\/article>/);
    assert.doesNotMatch(bodies[1], /first-bay|other-block/);
}
