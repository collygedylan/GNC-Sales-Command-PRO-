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

  test(`Reclass V7 ${name} prints confirmed editable fields, stamps, and stacked movement rows`, async t => {
    const browser = await engine.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    const { html, arrows } = reclassPdfV7Fixture();
    await page.setContent(html);
    const report = await page.locator('body').innerText();
    const headings = ['Loc Note', 'Loc PTN1', 'Desig Item', 'Desig Customer', 'Desig Location', 'Pull', 'OS%', 'Sales Note', 'SUS'];
    headings.forEach(label => assert.ok(report.includes(label), `V7 report includes ${label}`));
    for (const forbidden of ['Plant Grp', 'Plant Group', 'PGC', 'Brand Label', 'Int Inv Note']) {
      assert.ok(!report.includes(forbidden), `V7 report omits ${forbidden}`);
    }
    assert.match(report, /Pri By: SR/);
    assert.match(report, /Eval Date: 10\/8\/2026/);
    assert.match(report, /Pri Update: 10\/8\/2026 9:00 AM/);
    assert.match(report, /Note Date: 10\/8\/2026 9:00 AM/);
    assert.match(html, /<s>SYN<\/s>/, 'cleared SUS value is shown as struck through');
    assert.match(html, /Yes — SR/, 'blank SUS Yes is rendered with server initials');
    assert.match(html, /class="edited-cell" data-edited="true"/, 'confirmed edits remain highlighted');

    const geometry = await page.locator('.v7-inventory-row').evaluateAll(sections => sections.map(section => {
      const box = section.getBoundingClientRect();
      const cells = [...section.querySelectorAll('th,td')].map(cell => {
        const rect = cell.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: cell.clientWidth, scroll: cell.scrollWidth };
      });
      return { top: box.top, bottom: box.bottom, cells };
    }));
    assert.equal(geometry.length, arrows.length, 'one supplemental field section is rendered per submitted row');
    geometry.forEach(section => section.cells.forEach(cell => {
      assert.ok(cell.left >= 0 && cell.right <= 1101, 'field table stays within the page width');
      assert.ok(cell.bottom <= section.bottom + 1, 'field cell remains inside its location section');
      assert.ok(cell.scroll <= cell.width + 1, 'long editable values wrap instead of clipping');
    }));

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
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        allPdfText += `${item.str}\n`;
        if (/^[0-9]+-->(?:F1|S1|#)$/.test(item.str)) {
          assert.ok(!pagesByArrow.has(item.str), 'each V7 movement instruction is printed once');
          pagesByArrow.set(item.str, pageNumber);
        }
      }
    }
    assert.equal(pagesByArrow.size, arrows.length * 3);
    for (const row of arrows) assert.equal(new Set(row.map(text => pagesByArrow.get(text))).size, 1,
      'each location keeps all movement instructions together in the PDF');
    for (const value of ['Confirmed location note 0', 'Confirmed PTN1 0', 'Confirmed customer 0',
      'Confirmed designation location 0', 'Confirmed puller 0', '18%', 'Confirmed sales note 0', 'Yes — SR', 'SYN']) {
      assert.ok(allPdfText.includes(value), `PDF contains confirmed value ${value}`);
    }
    for (const forbidden of ['Plant Grp', 'Plant Group', 'PGC', 'Brand Label', 'Int Inv Note']) {
      assert.ok(!allPdfText.includes(forbidden), `PDF omits ${forbidden}`);
    }
  });
}
