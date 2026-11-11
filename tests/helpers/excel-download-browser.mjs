import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { JSDOM } from 'jsdom';

export function worksheet(bytes) {
    for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50;) {
        const size = bytes.readUInt32LE(offset + 18);
        const length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
        const name = bytes.subarray(offset + 30, offset + 30 + length).toString();
        const start = offset + 30 + length + extra;
        if (name === 'xl/worksheets/sheet1.xml') {
            const data = bytes.subarray(start, start + size);
            const xml = bytes.readUInt16LE(offset + 8) === 8 ? inflateRawSync(data) : data;
            return new JSDOM(xml.toString(), {contentType:'text/xml'}).window.document;
        }
        offset = start + size;
    }
    throw Error('XLSX worksheet missing');
}

export async function assertActiveExcelDownload(page, expected, header) {
    const pending = page.waitForEvent('download', {timeout:15000});
    await page.evaluate(() => window.eval('exportActiveHeaderRows()'));
    const download = await pending;
    assert.match(download.suggestedFilename(),/\.xlsx$/);
    const document = worksheet(await fs.readFile(await download.path()));
    const rows = [...document.querySelectorAll('sheetData > row')];
    const start = rows.findIndex(row => row.querySelector('t')?.textContent === header);
    assert.ok(start >= 0,header);
    assert.equal(rows.length - start - 1,expected);
    assert.equal(await page.locator('#global-excel-export span').textContent(),'✓ Exported (' + expected + ' rows)');
    return rows.slice(start + 1).map(row => row.textContent);
}
