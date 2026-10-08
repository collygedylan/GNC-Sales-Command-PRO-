import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import test from 'node:test';
import { chromium, webkit } from 'playwright';
import { getDocumentProxy } from 'unpdf';
import { reclassPdfFixture } from './helpers/reclass-pdf-fixture.mjs';

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
}
