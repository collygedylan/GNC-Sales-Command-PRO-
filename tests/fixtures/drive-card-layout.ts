import { hlMaster, installHlOrderFixture } from './hl-order-state.mjs';
import type { Page } from '@playwright/test';

export type DriveLayoutOptions = {
  theme: 'light' | 'dark' | 'outdoor';
  photo?: boolean;
  longContent?: boolean;
  knownQuantities?: boolean;
  rep?: boolean;
};

/**
 * Install a synthetic, mutation-blocked account and mount a card from the real
 * Drive renderer. The rows contain no production data and no write is sent.
 */
export async function installDriveCardLayoutFixture(page: Page, baseURL: string) {
  const fixture = await installHlOrderFixture(page, baseURL, { role: 'ADMIN', username: 'dylan_collyge' });
  const imageRoute = async (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="12" fill="#d1fae5"/><circle cx="48" cy="40" r="20" fill="#08784a"/><path d="M20 82c8-18 48-18 56 0" fill="#145c3f"/></svg>' });
  };
  await page.route('**/storage/v1/object/public/request_photos/**', imageRoute);
  await page.route('**/storage/v1/render/image/public/request_photos/**', imageRoute);
  return fixture;
}

export async function settleDriveLayoutShell(page: Page, projectName: string) {
  if (!projectName.includes('iphone')) return;
  const version = await page.evaluate(() => String((window as any).__APP_SHELL_VERSION__ || ''));
  if (!version) throw new Error('Drive layout fixture requires a compiled app shell');
  await page.goto(`/?shellv=${encodeURIComponent(version)}`, { waitUntil: 'load' });
  await page.locator('#view-login').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.body.classList.contains('role-access-ready')
    && window.eval('hasAppliedInitialHomeView === true'));
}

export async function renderDriveLayoutCard(page: Page, options: DriveLayoutOptions, fixtureControl?: { master: Record<string, unknown>[] }) {
  const photoDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const row = {
    UNIQUE_ID: `drive-layout-synthetic-1-${options.photo ? 'photo' : 'no-photo'}`,
    // The HL REST fixture assigns deterministic array-index DOM ids. Keeping
    // this stable across the local card and hydrated row lets real click
    // handlers resolve the same synthetic item after a refresh.
    DOM_ID: 'fi_0',
    ITEMCODE: `LAYOUT.001-${options.photo ? 'PHOTO' : 'NO-PHOTO'}`,
    COMMONNAME: options.longContent ? 'Synthetic Long Drive Card Name for Natural Wrapping' : 'Synthetic Drive Card',
    CONTSIZE: '#3', GENUSNAME: 'Rosa', LOCATIONCODE: 'A.01.001', LOTCODE: '27.F1', PRIORITY: '2',
    PTRONHAND: options.knownQuantities ? 15 : null,
    PTRREVIEWED: options.knownQuantities ? 2 : null,
    PTRAVAILABLE: options.knownQuantities ? 13 : null,
    S_LTS: options.knownQuantities ? 8 : null,
    HOLDSTOPCODE: options.longContent ? 'H' : '',
    HOLDSTOPREASON: options.longContent ? 'Synthetic hold reason that remains readable when the card is compacted' : '',
    SALES_NOTE: options.longContent ? 'Synthetic long sales note used to confirm the compact card can grow naturally without clipping or overlap. '.repeat(3) : '',
    ...(options.photo ? {
      PHOTO_LINK: `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${photoDate}/compact.webp`,
      PHOTO_NAME: `${photoDate}-compact.webp`, DATE_COMPLETED: `${photoDate}T12:00:00Z`,
    } : {}),
  };
  if (fixtureControl && Array.isArray(fixtureControl.master)) {
    const masterRow = hlMaster(row.UNIQUE_ID, {
      itemcode: row.ITEMCODE, commonname: row.COMMONNAME, contsize: row.CONTSIZE, genusname: row.GENUSNAME,
      locationcode: row.LOCATIONCODE, lotcode: row.LOTCODE, priority: row.PRIORITY,
      ptronhand: row.PTRONHAND == null ? null : String(row.PTRONHAND),
      ptrreviewed: row.PTRREVIEWED == null ? null : String(row.PTRREVIEWED),
      ptravailable: row.PTRAVAILABLE == null ? null : String(row.PTRAVAILABLE),
      s_lts: row.S_LTS == null ? null : String(row.S_LTS),
      season: 'F1', saleyear: '27', warehouseid: '10', warehousei: '10',
      holdstopcode: row.HOLDSTOPCODE, holdstopreason: row.HOLDSTOPREASON,
      sales_note: row.SALES_NOTE || null,
      photo_link: row.PHOTO_LINK || null, photo_name: row.PHOTO_NAME || null,
      date_completed: row.DATE_COMPLETED || null,
    });
    fixtureControl.master.splice(0, fixtureControl.master.length, masterRow);
  }
  const script = `(async () => {
    const row = ${JSON.stringify(row)};
    document.body.classList.add('ops-precision-pilot');
    document.body.dataset.opsTheme = ${JSON.stringify(options.theme === 'dark' ? 'dark' : 'light')};
    document.documentElement.classList.toggle('outdoor-mode', ${JSON.stringify(options.theme === 'outdoor')});
    document.body.classList.toggle('outdoor-mode', ${JSON.stringify(options.theme === 'outdoor')});
    // Replace rather than merge the in-memory fixture so the photo/no-photo
    // variants cannot inherit stale fields from a previous render iteration.
    fullInventory = [row];
    selectedItems.clear();
    rebuildMasterInventoryIndexes();
    // The mounted synthetic row is the entire fixture scope; mark row coverage
    // complete so Loc On Hand is a deterministic one-row total, while keeping
    // field coverage at browse because this fixture does not model full details.
    const masterState = getDatasetState('master');
    masterState.initialLoaded = true;
    masterState.rowCompleteness = 'complete';
    masterState.fieldCoverage = 'browse';
    const source = fullInventory[0];
    source.DOM_ID = source.DOM_ID || source.UNIQUE_ID;
    // Keep the navigation shell on Drive while mounting exactly one synthetic
    // generated card, independent of the async common-name drill renderer.
    if (!window.__driveLayoutOriginalRenderDrive) window.__driveLayoutOriginalRenderDrive = renderDrive;
    renderDrive = () => {};
    switchView('drive');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const host = document.getElementById('drive-content');
    const identity = { currentUser, currentUserDisplay, currentRole, safeRole };
    if (${JSON.stringify(options.rep === true)}) {
      currentUser = 'drive_layout_unassigned_rep';
      currentUserDisplay = 'Synthetic Unassigned Rep';
      currentRole = 'REP';
      safeRole = 'REP';
    }
    try {
      host.innerHTML = generateCard(source, 'drive', 'status-green', {
        preserveUnknownAvailability: true, verifiedQuantityRow: row
      });
      host.querySelectorAll('img[data-deferred-card-photo]').forEach((image) => hydrateDeferredCardPhoto(image));
    } finally {
      currentUser = identity.currentUser;
      currentUserDisplay = identity.currentUserDisplay;
      currentRole = identity.currentRole;
      safeRole = identity.safeRole;
    }
    host.dataset.driveDetailedRecords = 'true';
    return { itemCode: source.ITEMCODE, theme: document.body.dataset.opsTheme };
  })()`;
  await page.evaluate((source) => window.eval(source), script);
}

export async function restoreDriveLayoutRenderer(page: Page) {
  await page.evaluate(() => window.eval(`(() => {
    if (window.__driveLayoutOriginalRenderDrive) {
      renderDrive = window.__driveLayoutOriginalRenderDrive;
      delete window.__driveLayoutOriginalRenderDrive;
    }
    return true;
  })()`));
}

/** Render the real shared HL Drive card outside Drive Mode for scope checks. */
export async function renderSharedHlDriveLayoutCard(page: Page) {
  await page.evaluate(() => window.eval(`(() => {
    let host = document.getElementById('hl-order-detail');
    if (!host) {
      host = document.createElement('section');
      host.id = 'hl-order-detail';
      host.style.cssText = 'display:block;width:100%;max-width:1100px;margin:0 auto';
      document.body.appendChild(host);
    }
    host.innerHTML = renderManagerOrderDriveCard({
      itemcode: 'SHARED.001', commonname: 'Synthetic Shared HL Card', contsize: '#3',
      locationcode: 'A.01.001', lotcode: '27.F1', ptravailable: 5, ptronhand: 5,
      assignedto: 'dylan_collyge'
    });
    return true;
  })()`));
}
