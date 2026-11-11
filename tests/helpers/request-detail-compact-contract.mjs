import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export const readDetailSource = name => fs.readFileSync(new URL('../../' + name, import.meta.url),'utf8');

export function detailFunctionSource(names, file = 'assets/app-runtime.js') {
    const source = readDetailSource(file);
    return names.map(name => {
        const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^        }`, 'm'));
        assert.ok(match, name);
        return match[0];
    }).join('\n');
}

export function assertCompactRequestHeader() {
    const context = vm.createContext({escapeShareHtml:String,firstNonEmptyValue:(...values) => values.find(v => v != null && v !== ''),
        isRequestDetailItem:() => true,isDockSuspendDcRequestMirrorRow:item => !!item.suspend});
    vm.runInContext(readDetailSource('assets/request-detail-summary.js'),context);
    const snapshot = {commonName:'Grass',priorityValue:1,ptrValue:70,ptrReviewedValue:5,ptrAvailableValue:65,sLtsValue:100,
        requestQty:1,reserveValue:'YES',salesRepName:'Rep',customerConsignee:'Customer / Consignee',desiredSpec:'12 in',desiredCaliper:'N/A'};
    const item = {CONTSIZE:'#3',LOTCODE:'27.F1',LOCATIONCODE:'C.16.000'};
    const markup = context.buildCompactRequestDetailHeader(item,snapshot);
    assert.ok(markup.indexOf('27.F1') < markup.indexOf('C.16.000'));
    assert.ok(markup.indexOf('Inventory metrics') < markup.indexOf('Request metadata'));
    assert.match(markup,/data-detail-field="Reserve"[^]*?>YES<\/span>/);
    assert.doesNotMatch(markup,/<select|<input|Full Info|Share \/ Copy/);
    const suspend = context.buildCompactRequestDetailHeader({...item,suspend:true,docknumber:38,dropnumber:2,loadnumber:56},snapshot);
    for (const label of ['Dock #','Drop #','Load #']) assert.ok(suspend.includes(label));
    assert.equal(context.isCompactQueueDetail(item,'av'),false);
    assert.equal(context.isCompactQueueDetail(item,'drive'),false);
}

export function assertDirectRequestSummaryReplacement(runFunctions) {
    const host = { innerHTML: '', removeAttribute() {}, replaceChildren() { this.innerHTML = ''; } };
    const root = {classList:{toggle() {}},prepend() {},after() {},querySelector:()=>null};
    const api = runFunctions('assets/app-runtime.js', ['renderRequestDetailInfo', 'buildRequestOpenInfoCardFromValues'], {
        document: {getElementById:id => id === 'request-detail-info' ? host : root},
        getCurrentVisibleViewId:()=> 'detail',getItemUniqueId:item=>item.name,
        activeItem:{name:'First request'},isCompactQueueDetail:(_,source)=>source==='request',
        buildRequestOpenInfoHtml:item => item.name,escapeShareHtml:String
    });
    for (const name of ['First request','Next request']) {
        api.activeItem={name};
        api.renderRequestDetailInfo({name},'request');
        assert.equal(host.innerHTML,name);
    }
    api.activeItem={name:'Drive row'};
    api.renderRequestDetailInfo({name:'Drive row'},'drive');
    assert.equal(host.innerHTML,'');
    assert.match(api.buildRequestOpenInfoCardFromValues({chips:[['Qty',0]]}),/request-open-info-value">0<\/span>/);
}
