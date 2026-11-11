import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';

function nurseryFixture() {
    const dom = new JSDOM('<div id="manager-table-management-root"></div>', {runScripts:'outside-only'});
    const context = dom.getInternalVMContext();
    const scripts = ['nursery-command-model','nursery-excel-context','nursery-table-render','nursery-table-controller','nursery-command-tables'];
    for (const name of scripts) vm.runInContext(fs.readFileSync(new URL('../assets/' + name + '.js',import.meta.url),'utf8'),context);
    const rows = Array.from({length:225},(_,id) => ({id:'water-'+id,genus:id % 2 ? 'Oak' : 'Pine',water_rank:2}));
    let allowed = true, reads = 0;
    const options = {identity:'fixture',selected:'water-rating',inventory:() => [],inventoryReady:() => true,
        authorized:() => allowed,request:async ({table}) => {reads++; return {rows:table === 'ph_nursery_water_rating' ? rows : []};}};
    const root = dom.window.document.getElementById('manager-table-management-root');
    return {dom,root,options,mount:() => dom.window.GncNurseryTables.mount(root,options),
        revoke:() => {allowed=false;},reads:() => reads};
}

test('nursery owner exports all filtered rows and exact columns across pagination without another read',async () => {
    const fixture = nurseryFixture();
    const view = fixture.mount();
    try {
        await new Promise(resolve => setTimeout(resolve,0));
        assert.equal(fixture.root.querySelectorAll('tbody tr').length,100);
        const reads = fixture.reads();
        let exported = fixture.root.agdataExcelProvider();
        assert.equal(exported.rows.length,225);
        assert.deepEqual(Array.from(exported.columns,column => column.label),
            Array.from(fixture.dom.window.GncNurseryModel.FIELDS.ph_nursery_water_rating));
        fixture.root.querySelector('[data-nursery-page="1"]').click();
        exported = fixture.root.agdataExcelProvider();
        assert.equal(exported.rows.length,225);
        const search = fixture.root.querySelector('[data-nursery-search]');
        search.value = 'Oak';
        search.dispatchEvent(new fixture.dom.window.Event('input',{bubbles:true}));
        exported = fixture.root.agdataExcelProvider();
        assert.equal(exported.rows.length,112);
        assert.ok(exported.rows.every(row => row[1] === 'Oak'));
        assert.equal(fixture.reads(),reads);
        fixture.revoke();
        assert.throws(() => fixture.root.agdataExcelProvider(),/account changed/);
    } finally {view.destroy();fixture.dom.window.close();}
});

async function assertNurseryWorkspace(fixture, table) {
    fixture.options.selected = table.id;
    const view = fixture.mount();
    try {
        await new Promise(resolve => setTimeout(resolve,0));
        const exported = fixture.root.agdataExcelProvider();
        assert.equal(exported.title,table.label);
        assert.ok(exported.columns.length > 0,table.id);
    } finally {view.destroy();}
}

test('every nursery workspace mounts and exposes its own export projection',async () => {
    const fixture = nurseryFixture();
    try {
        for (const table of fixture.dom.window.GncNurseryModel.TABLES) await assertNurseryWorkspace(fixture,table);
    } finally {fixture.dom.window.close();}
});
