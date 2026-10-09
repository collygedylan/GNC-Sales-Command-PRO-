import { expect, test, type Page } from '@playwright/test';
import { installDriveCardLayoutFixture, settleDriveLayoutShell } from './fixtures/drive-card-layout';
// @test-group: @local-e2e,@release-functional

// Live-renderer regression with synthetic in-memory rows. App reads use the
// existing fixture and no business mutation or email is accepted.
const makeRows = (today: string) => [
  {
    UNIQUE_ID: 'prompt2-card-a', DOM_ID: 'prompt2-card-a', ITEMCODE: 'P2-SHARED',
    COMMONNAME: 'Synthetic Prompt Two Plant', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001',
    LOTCODE: '27.F1', PRIORITY: '2', PTRONHAND: 2, PTRREVIEWED: 1, PTRAVAILABLE: 1,
    S_LTS: 4, FIELDTAGCOLOR: 'Cerise', SOURCE: 'Synthetic Master', MATCH: '100', INITIAL_PTR: 1,
    LISTPRICE: 12.5, SPEC: 'Synthetic specimen', AV_NOTE: 'Synthetic AV note',
    HOLDSTOPCODE: 'H', HOLDSTOPREASON: 'Synthetic hold reason', HOLDSTOPBEGINDATE: '2026-10-08',
    PHOTO_LINK: `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${today}/prompt2.webp`,
    PHOTO_NAME: `${today}-prompt2.webp`, DATE_COMPLETED: `${today}T12:00:00Z`,
  },
  {
    UNIQUE_ID: 'prompt2-card-b', DOM_ID: 'prompt2-card-b', ITEMCODE: 'p2-shared',
    COMMONNAME: 'Synthetic Prompt Two Plant', CONTSIZE: '#7', LOCATIONCODE: ' a.01.001 ',
    LOTCODE: '27.S1', PTRONHAND: 3, PTRREVIEWED: 0, PTRAVAILABLE: 3, S_LTS: 5,
    SOURCE: 'Synthetic Master',
  },
  {
    UNIQUE_ID: 'prompt2-card-other-location', DOM_ID: 'prompt2-card-other-location', ITEMCODE: 'P2-SHARED',
    COMMONNAME: 'Synthetic Prompt Two Plant', CONTSIZE: '#3', LOCATIONCODE: 'B.01.001',
    LOTCODE: '27.F1', PTRONHAND: 100, PTRREVIEWED: 0, PTRAVAILABLE: 100, S_LTS: 100,
    SOURCE: 'Synthetic Master',
  },
  {
    UNIQUE_ID: 'prompt2-card-other-item', DOM_ID: 'prompt2-card-other-item', ITEMCODE: 'P2-OTHER',
    COMMONNAME: 'Synthetic Unrelated Plant', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001',
    LOTCODE: '27.F1', PTRONHAND: 200, PTRREVIEWED: 0, PTRAVAILABLE: 200, S_LTS: 200,
    SOURCE: 'Synthetic Master',
  },
];

async function installRows(page: Page, completeness: 'partial' | 'full') {
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate(({ fixtureRows, completeness }) => window.eval(`(() => {
    if (!window.__prompt2DriveFixtureMounted) {
      if (!window.__prompt2OriginalRenderDrive) window.__prompt2OriginalRenderDrive = renderDrive;
      renderDrive = () => {};
      switchView('drive');
      window.__prompt2DriveFixtureMounted = true;
    }
    // This fixture models a complete legacy full read. Keep the native session
    // inactive so the test does not claim synthetic rows have a coordinator proof.
    nativeAuthSessionActive = false;
    nativeAuthProfile = null;
    nativeAuthReadRequired = false;
    window.__prompt2SyntheticRows = ${JSON.stringify(fixtureRows)};
    fullInventory = window.__prompt2SyntheticRows;
    window.__prompt2InventoryCompleteness = ${JSON.stringify(completeness)};
    datasetLoadState.master.fullLoaded = ${JSON.stringify(completeness === 'full')};
    datasetLoadState.master.initialLoaded = true;
    datasetLoadState.master.rowCompleteness = ${JSON.stringify(completeness === 'full' ? 'complete' : 'partial')};
    datasetLoadState.master.fieldCoverage = ${JSON.stringify(completeness === 'full' ? 'full' : 'browse')};
    rebuildMasterInventoryIndexes();
    return true;
  })()`), { fixtureRows: makeRows(today), completeness });
}

async function renderCard(page: Page, sourceView: 'drive' | 'av-photo', theme: 'light' | 'dark') {
  await page.evaluate(({ sourceView, theme }) => window.eval(`(() => {
    // App boot may restore the native session while the test is idle. This
    // fixture remains a complete synthetic legacy read; native proof is tested
    // separately by inventory-card-location-on-hand.test.mjs.
    nativeAuthSessionActive = false;
    nativeAuthProfile = null;
    nativeAuthReadRequired = false;
    fullInventory = window.__prompt2SyntheticRows;
    const complete = window.__prompt2InventoryCompleteness === 'full';
    datasetLoadState.master.fullLoaded = complete;
    datasetLoadState.master.initialLoaded = true;
    datasetLoadState.master.rowCompleteness = complete ? 'complete' : 'partial';
    datasetLoadState.master.fieldCoverage = complete ? 'full' : 'browse';
    rebuildMasterInventoryIndexes();
    document.body.classList.add('ops-precision-pilot');
    document.body.dataset.opsTheme = ${JSON.stringify(theme)};
    const row = fullInventory.find((entry) => entry.UNIQUE_ID === 'prompt2-card-a');
    if (!row) throw new Error('Synthetic target row is missing');
    const markup = generateCard(row, ${JSON.stringify(sourceView)}, 'status-green', {
      preserveUnknownAvailability: true, verifiedQuantityRow: row
    });
    let host;
    if (${JSON.stringify(sourceView)} === 'drive') {
      host = document.getElementById('drive-content');
      if (!host) throw new Error('Drive content host is missing');
      host.innerHTML = markup;
      host.dataset.driveDetailedRecords = 'true';
    } else {
      host = document.getElementById('prompt2-av-card-fixture');
      if (!host) {
        host = document.createElement('div');
        host.id = 'prompt2-av-card-fixture';
        host.style.cssText = 'display:block;width:100%;max-width:1100px;margin:0 auto';
        document.body.appendChild(host);
      }
      host.innerHTML = markup;
    }
    return true;
  })()`), { sourceView, theme });
}

async function readCardMetrics(page: Page, sourceView: 'drive' | 'av-photo') {
  return page.evaluate((view) => {
    const selector = view === 'drive' ? '#drive-content .app-drive-compact-card' : '#prompt2-av-card-fixture .app-av-catalog-card';
    const card = document.querySelector(selector);
    if (!card) throw new Error(`Missing ${view} synthetic card`);
    const quantity = [...card.querySelectorAll('.app-card-qty-chip')].map((chip) => ({
      label: chip.querySelector('.app-card-qty-label')?.textContent?.trim() || '',
      value: chip.querySelector('.app-card-qty-value')?.textContent?.trim() || '',
    }));
    const metricValue = (name: string) => card.querySelector(`[data-inventory-card-metric="${name}"] .app-card-qty-value`)?.textContent?.trim() || '';
    const box = card.getBoundingClientRect();
    const holdCells = [...card.querySelectorAll('.app-inventory-card-hold-data > span')].map((cell) => {
      const bounds = cell.getBoundingClientRect();
      return {
        label: cell.querySelector('b')?.textContent?.trim() || '',
        value: cell.querySelector('strong')?.textContent?.trim() || '',
        top: bounds.top,
        left: bounds.left,
        right: bounds.right,
        width: bounds.width,
        scrollWidth: cell.scrollWidth,
        clientWidth: cell.clientWidth,
      };
    });
    return {
      quantity,
      locPhotoMatch: metricValue('loc-photo-match'),
      locOnHand: metricValue('loc-on-hand'),
      fieldTag: card.querySelector('[data-inventory-card-field="fieldtagcolor"]')?.textContent?.trim() || '',
      source: card.querySelector('.app-drive-card-source-row')?.textContent?.trim() || '',
      price: card.querySelector('.app-av-catalog-price')?.textContent?.trim() || card.querySelector('.app-drive-card-list-price')?.textContent?.trim() || '',
      reclassIndex: [...card.querySelectorAll('.app-card-bottom-btn--argos-reclass')].map((node) => node.textContent?.trim() || ''),
      sourceRowIndex: [...card.querySelectorAll('.app-drive-card-source-row')].map((node) => node.getBoundingClientRect().top),
      reclassTop: card.querySelector('.app-card-bottom-btn--argos-reclass')?.getBoundingClientRect().top ?? null,
      sourceTop: card.querySelector('.app-av-catalog-reclass .app-drive-card-source-row')?.getBoundingClientRect().top ?? null,
      quantityGridColumns: (() => {
        const row = card.querySelector('.app-card-qty-row');
        return row ? getComputedStyle(row).gridTemplateColumns.split(' ').length : 0;
      })(),
      avInfoText: card.querySelector('.app-av-catalog-info')?.textContent?.trim() || '',
      cardText: card.textContent?.trim() || '',
      holdCells,
      holdColumns: card.querySelector('.app-inventory-card-hold-data')
        ? getComputedStyle(card.querySelector('.app-inventory-card-hold-data')).gridTemplateColumns.split(' ').length : 0,
      cardBounds: { left: box.left, right: box.right, width: box.width },
      overflow: card.scrollWidth - card.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      theme: document.body.dataset.opsTheme || '',
      sourceRowsLoaded: Number(window.eval('window.__prompt2SyntheticRows.length')),
      renderedCardCount: document.querySelectorAll(selector).length,
    };
  }, sourceView);
}

test('live Drive and AV cards show scoped quantities and Drive-only tag color on phones', { tag: ['@local-e2e', '@release-functional'] }, async ({ page, baseURL }, testInfo) => {
  const fixture = await installDriveCardLayoutFixture(page, baseURL!);
  await settleDriveLayoutShell(page, testInfo.project.name);
  await page.setViewportSize({ width: 360, height: 780 });

  await installRows(page, 'partial');
  await renderCard(page, 'drive', 'light');
  const partial = await readCardMetrics(page, 'drive');
  expect(partial.locOnHand, 'a partial inventory page must not claim a location total').toBe('Unknown');

  await installRows(page, 'full');
  await page.evaluate(() => window.eval(`(() => {
    window.__prompt2SyntheticRows[1].PTRONHAND = null;
    fullInventory = window.__prompt2SyntheticRows;
    rebuildMasterInventoryIndexes();
    return true;
  })()`));
  await renderCard(page, 'drive', 'light');
  expect((await readCardMetrics(page, 'drive')).locOnHand,
    'a blank quantity in the complete matching scope must not be counted as zero').toBe('Unknown');
  await page.evaluate(() => window.eval(`(() => {
    window.__prompt2SyntheticRows[1].PTRONHAND = 3;
    fullInventory = window.__prompt2SyntheticRows;
    rebuildMasterInventoryIndexes();
    return true;
  })()`));

  for (const theme of ['light', 'dark'] as const) {
    for (const sourceView of ['drive', 'av-photo'] as const) {
      await test.step(`${sourceView} card in ${theme} theme at 360px`, async () => {
        await renderCard(page, sourceView, theme);
        const metrics = await readCardMetrics(page, sourceView);
        expect(metrics.quantity.map((entry) => entry.label)).toEqual([
          'On Hand', 'Review', 'Available', 'Open Stock', 'Loc Photo Match', 'Loc On Hand',
        ]);
        expect(metrics.locOnHand, 'sum same item code and normalized location across lots only').toBe('5');
        expect(metrics.locPhotoMatch).not.toBe('');
        expect(metrics.cardBounds.left).toBeGreaterThanOrEqual(-1);
        expect(metrics.cardBounds.right).toBeLessThanOrEqual(361);
        expect(metrics.overflow).toBeLessThanOrEqual(1);
        expect(metrics.documentOverflow).toBeLessThanOrEqual(1);
        expect(metrics.theme).toBe(theme);
        expect(metrics.sourceRowsLoaded).toBe(4);
        expect(metrics.renderedCardCount).toBe(1);
        expect(metrics.cardText).toContain('Synthetic specimen');
        expect(metrics.cardText).toContain('Synthetic AV note');
        expect(metrics.cardText).toContain('Add To Bloom Picker');
        expect(metrics.cardText).toContain('Synthetic hold reason');
        expect(metrics.cardText).toContain('2026-10-08');
        expect(metrics.holdColumns).toBe(3);
        expect(metrics.holdCells.map((cell) => cell.label)).toEqual(['Code', 'Reason', 'Since']);
        expect(metrics.holdCells.map((cell) => cell.value)).toEqual(['H', 'Synthetic hold reason', '2026-10-08']);
        expect(Math.max(...metrics.holdCells.map((cell) => cell.top)) - Math.min(...metrics.holdCells.map((cell) => cell.top))).toBeLessThanOrEqual(1);
        expect(metrics.holdCells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1)).toBe(true);
        expect(metrics.holdCells[0].right).toBeLessThanOrEqual(metrics.holdCells[1].left + 1);
        expect(metrics.holdCells[1].right).toBeLessThanOrEqual(metrics.holdCells[2].left + 1);
        if (sourceView === 'drive') {
          expect(metrics.fieldTag).toContain('Cerise');
          expect(metrics.source).toContain('Synthetic Master');
        } else {
          expect(metrics.fieldTag, 'AV cards must not repeat the Drive field-tag chip').toBe('');
          expect(metrics.reclassIndex).toEqual(['Reclass']);
          expect(metrics.source).toContain('Synthetic Master');
          expect(metrics.reclassTop).not.toBeNull();
          expect(metrics.sourceTop).not.toBeNull();
          expect(metrics.sourceTop!).toBeGreaterThan(metrics.reclassTop!);
          expect(metrics.quantityGridColumns).toBe(3);
          expect(metrics.price).toContain('List price');
          expect(metrics.price).toContain('$12.50');
          const orderedFields = ['Spec', 'AV Note', 'Add To Bloom Picker', 'Code']
            .map(label => metrics.avInfoText.indexOf(label));
          expect(orderedFields.every(index => index >= 0)).toBe(true);
          expect(orderedFields).toEqual([...orderedFields].sort((left, right) => left - right));
        }
        if (theme === 'light') {
          const selector = sourceView === 'drive' ? '#drive-content .app-drive-compact-card' : '#prompt2-av-card-fixture .app-av-catalog-card';
          await page.locator(selector).screenshot({ path: testInfo.outputPath(`prompt2-${sourceView}-phone.png`) });
        }
      });
    }
  }

  expect(fixture.blockedMutations).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
