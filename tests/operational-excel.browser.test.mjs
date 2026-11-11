import assert from 'node:assert/strict';
import test from 'node:test';
import { openAssignedBrowser, seedAssignedBrowser } from './helpers/assigned-items-first-open-browser.mjs';
import { assertActiveExcelDownload } from './helpers/excel-download-browser.mjs';
import { seedOperationalExcel, selectOperationalExcel } from './helpers/operational-excel-browser.mjs';

test('Drive, Valid Photos AV, both Que tabs, Docks and Eval2 download their complete active filtered XLSX rows',{timeout:60000},async () => {
    const fixture = await openAssignedBrowser();
    try {
        await seedAssignedBrowser(fixture.page);
        await seedOperationalExcel(fixture.page);
        const cases = [['drive','',2],['av','',1],['request','pending',2],['request','suspend-tag',2],['docks','',2],['managers','',2]];
        for (const [view,tab,count] of cases) {
            const header = await selectOperationalExcel(fixture.page,view,tab);
            const rows = await assertActiveExcelDownload(fixture.page,count,header);
            assert.ok(rows.every(row => row.includes('Acer')),view + '/' + tab);
            assert.ok(rows.every(row => !row.includes('Oak')),view + '/' + tab);
        }
    } finally {await fixture.close();}
});
