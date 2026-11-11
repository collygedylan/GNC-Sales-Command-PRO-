import { worksheet } from './helpers/excel-download-browser.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { openAssignedBrowser, seedAssignedBrowser } from './helpers/assigned-items-first-open-browser.mjs';


async function exportAssigned(page, filters, expected) {
    await page.evaluate(filters => window.eval('getManagerAssignedColumnState().filters = ' + JSON.stringify(filters)), filters);
    const downloadPromise = page.waitForEvent('download', {timeout:15000});
    await page.evaluate(() => window.eval('exportActiveHeaderRows()'));
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /Assigned_Items.*\.xlsx$/);
    const document = worksheet(await fs.readFile(await download.path()));
    const rows = [...document.querySelectorAll('sheetData > row')];
    const header = rows.findIndex(row => row.textContent.startsWith('Effective Worker'));
    assert.ok(header >= 0);
    assert.deepEqual([...rows[header].querySelectorAll('t')].map(node => node.textContent),
        ['Effective Worker','Itemcode Default Owner','Warehouse','Location','Item Code','Container Size','Common Name','Genus Name']);
    assert.equal(rows.length - header - 1, expected);
    assert.equal(await page.locator('#global-excel-export span').textContent(), '✓ Exported (' + expected + ' rows)');
}

test('cold Assigned Items paints within 100ms and downloads all filtered rows as XLSX', {timeout:60000}, async () => {
    const fixture = await openAssignedBrowser();
    try {
        const measured = await seedAssignedBrowser(fixture.page);
        assert.ok(measured.elapsed < 100, JSON.stringify(measured));
        assert.ok(measured.count > 0 && measured.count <= 100, JSON.stringify(measured));
        await fixture.page.waitForFunction(() => window.eval('getManagerAssignedColumnState().displayCache?.rows.length === 9695'));
        const filters = await measureAssignedFilters(fixture.page);
        assert.ok(Math.max(...filters.map(value => value.ms)) < 16,JSON.stringify(filters));
        assert.deepEqual(filters.map(value => value.count),[3232,9695,9695,97,1,9695,8310,9695,8310]);
        await exportAssigned(fixture.page, {}, 9695);
        await exportAssigned(fixture.page, {ASSIGNEDTO:['megan_kelly']}, 3232);
        await exportAssigned(fixture.page, {COMMONNAME:['zebra rose']}, 1385);
        process.stdout.write('ASSIGNED PERFORMANCE ' + JSON.stringify({firstPaint:measured,filters}) + '\n');
    } finally { await fixture.close(); }
});

async function measureAssignedFilters(page) {
    return page.evaluate(() => window.eval(`(() => {
        const state=getManagerAssignedColumnState(),rows=getManagerAssignedItemsDisplayRows();
        const cases={ASSIGNEDTO:'megan_kelly',DEFAULT_ASSIGNEDTO:'dylan_collyge',WAREHOUSEI:'10',LOCATIONCODE:'d.08.001',
            ITEMCODE:'000001',CONTSIZE:'#3',COMMONNAME:'acer',GENUSNAME:'rosa'};
        const timings=[];
        for(const [field,value] of Object.entries(cases)) {
            state.filters={[field]:[value]};
            const start=performance.now(),result=getFilteredManagerAssignedItemsExportRows(rows);
            timings.push({field,ms:performance.now()-start,count:result.length});
        }
        state.filters={};managersSearchTerm='acer';
        const start=performance.now(),searched=getFilteredManagerAssignedItemsExportRows(rows);
        timings.push({field:'Search',ms:performance.now()-start,count:searched.length});
        managersSearchTerm='';
        return timings;
    })()`));
}
