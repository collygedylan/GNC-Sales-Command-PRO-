import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit } from 'playwright';
import { getDocumentProxy } from 'unpdf';
import { reclassPdfFixture, reclassPdfV7Fixture } from './helpers/reclass-pdf-fixture.mjs';

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  test(`Reclass ${name} keeps stacked arrows in content-sized location cells`, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const { html, arrows } = reclassPdfFixture();
    await page.setContent(html);
    const cells = await page.locator('.movement-cell').evaluateAll(elements => elements.map(element => {
      const cell = element.getBoundingClientRect();
      return { top: cell.top, bottom: cell.bottom, lines: [...element.querySelectorAll('.proposal-box-movement')].map(line => {
        const box = line.getBoundingClientRect();
        return { text: line.textContent, top: box.top, bottom: box.bottom, scroll: line.scrollWidth, width: line.clientWidth };
      }) };
    }));
    assert.equal(cells.length, arrows.length);
    cells.forEach((cell, index) => {
      assert.deepEqual(cell.lines.map(line => line.text), arrows[index]);
      cell.lines.forEach((line, lineIndex) => {
        assert.ok(line.top >= cell.top && line.bottom <= cell.bottom + 1, 'instruction remains in its location cell');
        assert.ok(line.scroll <= line.width + 1, 'arrow text is not clipped');
        if (lineIndex) assert.ok(line.top >= cell.lines[lineIndex - 1].bottom, 'stacked lines never overlap');
      });
    });
    await mkdir('.gnc-local/reclass-pdf-layout', { recursive: true });
    await page.screenshot({ path: `.gnc-local/reclass-pdf-layout/${name}.png`, fullPage: true });
    if (name !== 'chromium') return;
    const bytes = await page.pdf({ path: '.gnc-local/reclass-pdf-layout/stacked-moves.pdf', preferCSSPageSize: true, printBackground: true });
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    t.after(() => pdf.loadingTask.destroy());
    assert.ok(pdf.numPages > 1, 'fixture must exercise page breaks');
    const printed = new Map();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if (!('str' in item) || !/^[0-9]+-->(?:F1|S1|#)$/.test(item.str)) continue;
        assert.ok(!printed.has(item.str), 'each move is printed once');
        printed.set(item.str, { page: pageNumber, y: item.transform[5], height: item.height });
      }
    }
    assert.equal(printed.size, arrows.length * 3);
    for (const row of arrows) {
      const lines = row.map(text => printed.get(text));
      assert.equal(new Set(lines.map(line => line.page)).size, 1, 'a location cell must not split across pages');
      assert.ok(lines[0].y - lines[1].y >= lines[1].height, 'PDF movement lines have separate vertical positions');
      assert.ok(lines[1].y - lines[2].y >= lines[2].height, 'PDF sheared instruction does not overlap');
    }
  });

  test(`Reclass V7 ${name} prints editable fields in each main row and keeps stacked movement rows`, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const { html, arrows } = reclassPdfV7Fixture();
    await page.setContent(html);
    const report = await page.locator('body').innerText();
    const expectedHeadings = ['Lotcode', 'Location', 'Source', 'Priority', 'OH', 'Rev', 'Loc Note Date', 'Loc PTN1', 'Loc Note',
      'Desig Item', 'Desig Cust', 'Desig Loc', 'Pull', 'OS%', 'Sales Note', 'SUS'];
    const headings = await page.locator('.location-table thead .column-heading-row th').allTextContents();
    assert.deepEqual(headings, expectedHeadings, 'each editable field is its own main-table column with Lot first');
    headings.forEach(label => assert.ok(report.includes(label), `V7 report includes ${label}`));
    for (const forbidden of ['Plant Grp', 'Plant Group', 'PGC', 'Brand Label', 'Int Inv Note']) {
      assert.ok(!report.includes(forbidden), `V7 report omits ${forbidden}`);
    }
    assert.ok(report.includes('Submitted:') && report.includes('By: Synthetic reviewer'));
    assert.ok(!report.includes('Request:') && !report.includes('Edited:'));
    assert.ok(!report.includes('Confirmed Inventory Fields'));
    assert.match(html, /<thead><tr class="page-title-row"><th class="page-title-cell" colspan="\d+"><div class="page-header">TEST PILOT - SYNTHETIC DATA ONLY \| GNC PH Reclass Item Inquiry<\/div><\/th><\/tr><tr class="column-heading-row">/);
    assert.doesNotMatch(html, /@top-center/);
    assert.equal(await page.locator('.page-header').count(), 1, 'the document flow contains one title; pagination repeats it through the table header');
    assert.match(html, /<s>SYN<\/s>/, 'cleared SUS value is shown as struck through');
    assert.match(html, /Yes - SR/, 'blank SUS Yes is rendered with server initials');
    assert.match(report, /By SR \| Eval 10\/8\/2026 \| Updated 10\/8\/2026/, 'server stamps appear as compact row annotations');
    assert.match(html, /class="edited-cell" data-edited="true"/, 'confirmed edits remain highlighted');

    const geometry = await page.locator('.location-table tbody tr[data-location-row="true"]').evaluateAll(rows => rows.map(row => {
      const box = row.getBoundingClientRect();
      const cells = [...row.querySelectorAll('td')].map(cell => {
        const rect = cell.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: cell.clientWidth, scroll: cell.scrollWidth, text: cell.innerText };
      });
      return { top: box.top, bottom: box.bottom, cells };
    }));
    assert.equal(geometry.length, arrows.length, 'each submitted item remains one main table row');
    geometry.forEach(row => {
      assert.equal(row.cells.length, expectedHeadings.length, 'each row contains every displayed main-table column');
      row.cells.forEach(cell => {
        assert.ok(cell.left >= 0 && cell.right <= 1101, 'main table stays within the page width');
        assert.ok(cell.bottom <= row.bottom + 1, 'field cell remains inside its location row');
        assert.ok(cell.scroll <= cell.width + 1, 'long editable values wrap instead of clipping');
      });
    });

    const arrowRows = await page.locator('.movement-cell').evaluateAll(elements => elements.map(element =>
      [...element.querySelectorAll('.proposal-box-movement')].map(line => line.textContent)));
    assert.deepEqual(arrowRows, arrows, 'V7 keeps exact vertically stacked movement arrows');
    await mkdir('.gnc-local/reclass-pdf-layout', { recursive: true });
    await page.screenshot({ path: `.gnc-local/reclass-pdf-layout/${name}-v7.png`, fullPage: true });
    if (name !== 'chromium') return;
    const bytes = await page.pdf({ path: '.gnc-local/reclass-pdf-layout/v7-editable-fields.pdf', preferCSSPageSize: true, printBackground: true });
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    t.after(() => pdf.loadingTask.destroy());
    assert.ok(pdf.numPages > 1, 'V7 fixture exercises natural page breaks');
    const pagesByArrow = new Map();
    let allPdfText = '';
    const pageDimensions = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const pdfPage = await pdf.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      const [x1, y1, x2, y2] = pdfPage.view;
      pageDimensions.push({ width: x2 - x1, height: y2 - y1 });
      for (const item of content.items) {
        if (!('str' in item)) continue;
        allPdfText += `${item.str}\n`;
        if (/^[0-9]+-->(?:F1|S1|#)$/.test(item.str)) {
          assert.ok(!pagesByArrow.has(item.str), 'each V7 movement instruction is printed once');
          pagesByArrow.set(item.str, pageNumber);
        }
      }
    }
    pageDimensions.forEach(dimensions => assert.ok(dimensions.width > dimensions.height, 'printed pages are landscape'));
    const pageTexts = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const content = await (await pdf.getPage(index + 1)).getTextContent();
      return content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
    }));
    pageTexts.forEach((text, index) => assert.ok(text.includes('TEST PILOT - SYNTHETIC DATA ONLY | GNC PH Reclass Item Inquiry'),
      `yellow title header repeats on PDF page ${index + 1}`));
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const pageContent = await (await pdf.getPage(index)).getTextContent();
      const headers = pageContent.items.filter(item => 'str' in item && item.str.includes('TEST PILOT - SYNTHETIC DATA ONLY'));
      assert.equal(headers.length, 1, `page ${index} repeats the yellow title exactly once`);
      assert.ok(headers[0].transform[5] > pageDimensions[index - 1].height - 60, 'yellow header is at the top page margin');
    }
    assert.equal(pagesByArrow.size, arrows.length * 3);
    for (const row of arrows) assert.equal(new Set(row.map(text => pagesByArrow.get(text))).size, 1,
      'each location keeps all movement instructions together in the PDF');
    const normalizedPdfText = allPdfText.replace(/\s+/g, ' ');
    for (const value of ['Confirmed location note 0', 'Confirmed PTN1 0', 'Confirmed customer 0',
      'Confirmed designation location 0', 'Confirmed puller 0', '18%', 'Confirmed sales note 0', 'Yes - SR', 'SYN']) {
      assert.ok(normalizedPdfText.includes(value), `PDF contains confirmed value ${value}`);
    }
    assert.ok(!normalizedPdfText.includes('Confirmed Inventory Fields'));
    assert.ok(normalizedPdfText.includes('By SR') && normalizedPdfText.includes('Eval 10/8/2026') && normalizedPdfText.includes('Updated 10/8/2026'));
    for (const forbidden of ['Plant Grp', 'Plant Group', 'PGC', 'Brand Label', 'Int Inv Note']) {
      assert.ok(!normalizedPdfText.includes(forbidden), `PDF omits ${forbidden}`);
    }
  });
}
