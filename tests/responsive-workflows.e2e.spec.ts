import { expect, test } from '@playwright/test';

const fixtureUrl = '/tests/fixtures/ops-precision-browser.html';

test('phone login keeps both fields and the submit action visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'load' });

  const username = page.locator('#username-input');
  const accessCode = page.locator('#pin-code');
  const submit = page.locator('#login-button');
  await expect(username).toBeVisible();
  await expect(accessCode).toBeVisible();
  await expect(submit).toBeVisible();

  const controls = await Promise.all([username, accessCode, submit].map((control) => control.boundingBox()));
  expect(controls.every((box) => box && box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844), JSON.stringify(controls)).toBe(true);
});

test('Eval assignment dropdown exposes the full managed roster and composite key', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerEvalAssigneeOptionsHtml === 'function');
  const result = await page.evaluate(() => {
    const select = document.createElement('select');
    select.innerHTML = (window as any).getManagerEvalAssigneeOptionsHtml('');
    return {
      values: Array.from(select.options).map((option) => option.value),
      labels: Array.from(select.options).map((option) => option.textContent),
      key: (window as any).buildManagerEvalAssignmentKey(' 001668.030.1 ', ' Buddleia '),
      alias: (window as any).normalizeEvalAssignableUser('charey_robertson'),
      sheetTypoAlias: (window as any).normalizeEvalAssignableUser('Boby'),
    };
  });
  expect(result.values).toEqual([
    '',
    'josh_vann',
    'jorge_colunga',
    'abigail_vazquez',
    'bobby_adair',
    'charley_robertson',
    'ellen_ward',
    'zoe_green',
    'mitch_kaiser',
    'dylan_collyge',
    'megan_kelly',
  ]);
  expect(result.labels).toEqual(result.values.map((value) => value || 'Unassigned'));
  expect(result.key).toBe('001668.030.1|buddleia');
  expect(result.alias).toBe('charley_robertson');
  expect(result.sheetTypoAlias).toBe('bobby_adair');
});

test('Dylan and Megan alone receive cached Manager Eval Reports without an inventory refetch', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.21.01', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerEvalReportIndex === 'function');
  const result = await page.evaluate(() => window.eval(`(() => {
    processAndLoadData({ data: [
      { ITEMCODE: 'A', COMMONNAME: 'Alpha', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '1', S_LTS: 20, ASSIGNEDTO: 'dylan_collyge', LOCATIONCODE: 'A.01.001' },
      { ITEMCODE: 'A', COMMONNAME: 'Alpha', SEASON: 'U1', SALEYEAR: 27, PRIORITY: '', S_LTS: 300, ASSIGNEDTO: 'dylan_collyge', LOCATIONCODE: 'A.01.002' },
      { ITEMCODE: 'B', COMMONNAME: 'Beta', SEASON: 'X', SALEYEAR: 27, PRIORITY: '', S_LTS: 300, ASSIGNEDTO: 'megan_kelly', LOCATIONCODE: 'B.01.001' }
    ], _fromCache: true });
    invalidateManagerEvalReportCache();
    const first = getManagerEvalReportIndex();
    const second = getManagerEvalReportIndex();
    let inventoryFetches = 0;
    const originalEnsureDatasetLoaded = ensureDatasetLoaded;
    ensureDatasetLoaded = function(){ inventoryFetches += 1; return Promise.resolve(fullInventory); };
    setManagerEvalReport('culls');
    const afterSwitch = getManagerEvalReportIndex();
    ensureDatasetLoaded = originalEnsureDatasetLoaded;
    return {
      access: {
        dylan: canViewManagerEvalReports('dylan_collyge'),
        megan: canViewManagerEvalReports('megan_kelly'),
        other: canViewManagerEvalReports('jd_jones')
      },
      reportIds: GncEvalReports.REPORT_IDS.slice(),
      counts: first.counts,
      cached: first === second && first === afterSwitch,
      inventoryFetches
    };
  })()`));

  expect(result.access).toEqual({ dylan: true, megan: true, other: false });
  expect(result.reportIds).toEqual([
    's1-with-pri', 'od-loc-note-date', 'hs-plus-5-days', 'get-off-hold',
    'low-stock', 'no-pri', 'culls', 'not-in-f1',
  ]);
  expect(result.counts['s1-with-pri']).toBe(1);
  expect(result.counts['low-stock']).toBe(1);
  expect(result.counts.culls).toBe(1);
  expect(result.cached).toBe(true);
  expect(result.inventoryFetches).toBe(0);
});

test('Eval Reports #2 requires a complete snapshot and keeps its inquiry controls phone friendly', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerEvalReports2Panel === 'function');
  const result = await page.evaluate(() => window.eval(`(async () => {
    const access = {
      dylan: canViewManagerEvalReports('dylan_collyge'),
      megan: canViewManagerEvalReports('megan_kelly'),
      other: canViewManagerEvalReports('jd_jones')
    };
    const originalCanViewManagerEvalReports = canViewManagerEvalReports;
    canViewManagerEvalReports = () => true;
    currentUser = 'dylan_collyge';
    currentUserDisplay = 'Dylan Collyge';
    const roster = ['abigail_vazquez', 'bobby_adair', 'charley_robertson', 'dylan_collyge', 'ellen_ward', 'jorge_colunga', 'josh_vann', 'megan_kelly', 'mitch_kaiser', 'zoe_green'];
    processAndLoadData({ data: [
      { UNIQUE_ID: 'eval2-a-f1', ITEMCODE: 'A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha', CONTSIZE: '#3', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '1', S_LTS: 20, ASSIGNEDTO: 'stale_master_user', LOCATIONCODE: 'A.01.001', LAST_UPDATED: '2026-08-24T12:00:00Z' },
      { UNIQUE_ID: 'eval2-a-u1', ITEMCODE: 'A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha', CONTSIZE: '#3', SEASON: 'U1', SALEYEAR: 27, PRIORITY: '', S_LTS: 300, ASSIGNEDTO: 'stale_master_user', LOCATIONCODE: 'A.01.002', LAST_UPDATED: '2026-08-24T12:00:00Z' },
      { UNIQUE_ID: 'eval2-b-f1', ITEMCODE: 'B', GENUSNAME: 'Acer', COMMONNAME: 'Beta', CONTSIZE: '#5', SEASON: 'F1', SALEYEAR: 27, PRIORITY: '2', S_LTS: 20, ASSIGNEDTO: 'stale_master_user', LOCATIONCODE: 'B.01.000', LAST_UPDATED: '2026-08-24T12:00:00Z' },
      { UNIQUE_ID: 'eval2-b-x', ITEMCODE: 'B', GENUSNAME: 'Acer', COMMONNAME: 'Beta', CONTSIZE: '#5', SEASON: 'X', SALEYEAR: 27, PRIORITY: '2', S_LTS: 300, ASSIGNEDTO: 'stale_master_user', LOCATIONCODE: 'B.01.001', LAST_UPDATED: '2026-08-24T12:00:00Z' }
    ], warehouseAssignedItemsData: [
      { UNIQUE_ID: 'assign-a', ITEMCODE: ' a ', GENUSNAME: ' ROSA ', ASSIGNEDTO: 'dylan_collyge', UPDATED_AT: '2026-08-24T12:05:00Z' },
      { UNIQUE_ID: 'assign-b', ITEMCODE: 'B', GENUSNAME: 'Acer', ASSIGNEDTO: 'megan_kelly', UPDATED_AT: '2026-08-24T12:05:00Z' },
      ...roster.filter((name) => name !== 'dylan_collyge' && name !== 'megan_kelly').map((name, index) => ({ UNIQUE_ID: 'roster-' + index, ITEMCODE: 'ROSTER-' + index, GENUSNAME: 'Genus ' + index, ASSIGNEDTO: name })),
      { UNIQUE_ID: 'assign-blank', ITEMCODE: 'BLANK', GENUSNAME: 'Blank', ASSIGNEDTO: '' }
    ], _fromCache: true });
    const state = getDatasetState('master');
    const assignmentState = getDatasetState('warehouseAssignedItems');
    state.initialLoaded = true;
    state.fullLoaded = true;
    assignmentState.initialLoaded = true;
    assignmentState.fullLoaded = false;
    invalidateManagerEvalReport2Cache();
    const partialHtml = renderManagerEvalReports2Panel();
    assignmentState.fullLoaded = true;
    const index = getManagerEvalReport2Index();
    setManagerEvalReport2Mode('reports');
    setManagerEvalReport2('culls');
    setManagerEvalReport2Filter('assignedTo', 'dylan_collyge');
    setManagerEvalReport2('low-stock');
    const locationOptions = getManagerEvalReport2LocationOptions();
    setManagerEvalReport2Filter('locationCode', 'A.01.002');
    const reportRows = getFilteredManagerEvalReport2Rows();
    setManagerEvalReport2Mode('inquiry');
    setManagerEvalReport2('low-stock');
    setManagerEvalReport2InquiryFilter('assignedTo', 'dylan_collyge');
    setManagerEvalReport2InquiryFilter('locationCode', 'A.01.002');
    setManagerEvalReport2InquiryFilter('commonName', 'Alpha');
    setManagerEvalReport2InquiryFilter('contSize', '#3');
    const model = getManagerEvalReport2InquiryModel();
    const host = document.createElement('div');
    host.id = 'eval-reports-2-test-host';
    host.style.width = '390px';
    host.innerHTML = renderManagerEvalReports2Panel();
    document.body.appendChild(host);
    const controls = Array.from(host.querySelectorAll('select,button')).map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    const initialAssignedToOptions = getManagerEvalReport2AssignedToOptions();
    const beforeAssignmentEdit = getManagerEvalReport2Index();
    applyAcknowledgedEvalAssignmentResults(
      [{ itemcode: 'A', genusname: 'Rosa' }],
      [{ itemcode: 'A', genusname: 'Rosa', assignedto: 'megan_kelly' }],
      'megan_kelly'
    );
    const afterAssignmentEdit = getManagerEvalReport2Index();
    const editedRows = getManagerEvalReport2Rows('low-stock').filter((row) => row.ITEMCODE === 'A');
    const originalEnsureDatasetLoaded = ensureDatasetLoaded;
    const originalLoadManagerEvalReportSettings = loadManagerEvalReportSettings;
    ensureDatasetLoaded = (key) => key === 'warehouseAssignedItems'
      ? Promise.reject(new Error('assignment load unavailable'))
      : Promise.resolve([]);
    loadManagerEvalReportSettings = () => Promise.resolve({});
    await loadManagerEvalReports2(true);
    ensureDatasetLoaded = originalEnsureDatasetLoaded;
    loadManagerEvalReportSettings = originalLoadManagerEvalReportSettings;
    const retainedAfterFailure = getManagerEvalReport2Index();
    const staleHtml = renderManagerEvalReports2Panel();
    const output = {
      access,
      partialGate: !partialHtml.includes('inventory rows') && (partialHtml.includes('Retry') || partialHtml.includes('Loading complete inventory and assignments')),
      assignedToOptions: initialAssignedToOptions,
      assignmentStats: index.assignmentStats,
      counts: index.counts,
      drilldown: {
        locationOptions,
        reportRows: reportRows.length
      },
      inquiryRows: model.matchedRows.length,
      sections: {
        item: model.sections.item.length,
        season: model.sections.season.length,
        location: model.sections.location.length
      },
      hasReportsMode: host.textContent.includes('Reports'),
      hasInquiryMode: host.textContent.includes('Item Inquiry'),
      hasReset: host.textContent.includes('Reset'),
      controlsFit: controls.length > 0 && controls.every((box) => box.left >= 0 && box.right <= 390.5 && box.width <= 390.5),
      hostOverflow: host.scrollWidth <= 391,
      immediateAssignmentRefresh: beforeAssignmentEdit !== afterAssignmentEdit && editedRows.length > 0 && editedRows.every((row) => row.ASSIGNEDTO === 'megan_kelly'),
      retainsLastCompleteOnAssignmentFailure: retainedAfterFailure === afterAssignmentEdit && staleHtml.includes('last complete results remain visible')
    };
    canViewManagerEvalReports = originalCanViewManagerEvalReports;
    return output;
  })()`));

  expect(result.access).toEqual({ dylan: true, megan: true, other: false });
  expect(result.partialGate).toBe(true);
  expect(result.assignedToOptions).toEqual(['(Unassigned)', 'abigail_vazquez', 'bobby_adair', 'charley_robertson', 'dylan_collyge', 'ellen_ward', 'jorge_colunga', 'josh_vann', 'megan_kelly', 'mitch_kaiser', 'zoe_green']);
  expect(result.assignmentStats.matchedCount).toBe(4);
  expect(result.counts['low-stock']).toBe(2);
  expect(result.counts.culls).toBe(1);
  expect(result.drilldown).toEqual({
    locationOptions: ['A.01.002'],
    reportRows: 1,
  });
  expect(result.inquiryRows).toBe(1);
  expect(result.sections).toEqual({ item: 1, season: 1, location: 1 });
  expect(result.hasReportsMode).toBe(true);
  expect(result.hasInquiryMode).toBe(true);
  expect(result.hasReset).toBe(true);
  expect(result.controlsFit).toBe(true);
  expect(result.hostOverflow).toBe(true);
  expect(result.immediateAssignmentRefresh).toBe(true);
  expect(result.retainsLastCompleteOnAssignmentFailure).toBe(true);
});

test('Eval Reports #2 selects cards and sends only selected rows as Excel to chosen recipients', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).emailSelectedManagerEvalReport2Rows === 'function');
  const result = await page.evaluate(() => window.eval(`(async () => {
    const originalCanViewManagerEvalReports = canViewManagerEvalReports;
    const originalRecipientModal = openGroupedBloomNcrRecipientModal;
    const originalPostEmail = postGoogleScriptEmailPayload;
    let sentPayload = null;
    try {
      canViewManagerEvalReports = () => true;
      currentUser = 'dylan_collyge';
      currentUserDisplay = 'Dylan Collyge';
      processAndLoadData({ data: [
        { UNIQUE_ID: 'mail-a', ITEMCODE: 'A', GENUSNAME: 'Rosa', COMMONNAME: 'Alpha', CONTSIZE: '#3', SEASON: 'X', SALEYEAR: 27, PRIORITY: '1', S_LTS: 20, LOCATIONCODE: 'A.01.001' },
        { UNIQUE_ID: 'mail-b', ITEMCODE: 'B', GENUSNAME: 'Acer', COMMONNAME: 'Beta', CONTSIZE: '#5', SEASON: 'X', SALEYEAR: 27, PRIORITY: '2', S_LTS: 30, LOCATIONCODE: 'B.01.001' },
        { UNIQUE_ID: 'mail-c', ITEMCODE: 'C', GENUSNAME: 'Cornus', COMMONNAME: 'Gamma', CONTSIZE: '#7', SEASON: 'X', SALEYEAR: 27, PRIORITY: '3', S_LTS: 40, LOCATIONCODE: 'C.01.001' }
      ], warehouseAssignedItemsData: [
        { UNIQUE_ID: 'assign-a', ITEMCODE: 'A', GENUSNAME: 'Rosa', ASSIGNEDTO: 'dylan_collyge' },
        { UNIQUE_ID: 'assign-b', ITEMCODE: 'B', GENUSNAME: 'Acer', ASSIGNEDTO: 'dylan_collyge' },
        { UNIQUE_ID: 'assign-c', ITEMCODE: 'C', GENUSNAME: 'Cornus', ASSIGNEDTO: 'megan_kelly' }
      ], _fromCache: true });
      const masterState = getDatasetState('master');
      const assignmentState = getDatasetState('warehouseAssignedItems');
      masterState.initialLoaded = true;
      masterState.fullLoaded = true;
      assignmentState.initialLoaded = true;
      assignmentState.fullLoaded = true;
      invalidateManagerEvalReport2Cache();
      clearManagerEvalReport2Filters();
      setManagerEvalReport2Mode('reports');
      setManagerEvalReport2DisplayMode('cards');
      setManagerEvalReport2('culls');
      const rows = getManagerEvalReport2Rows();
      toggleManagerEvalReport2RowSelection(encodeURIComponent(getManagerEvalReport2RowKey(rows[0], 0)));
      toggleManagerEvalReport2RowSelection(encodeURIComponent(getManagerEvalReport2RowKey(rows[1], 1)));
      const selectedBefore = getManagerEvalReport2SelectedRows().map((row) => row.UNIQUE_ID);
      setHomeTab('eval-reports-2');
      const host = document.createElement('div');
      host.id = 'eval2-email-test-host';
      host.style.width = '390px';
      host.innerHTML = renderManagerEvalReports2Panel();
      document.body.appendChild(host);
      renderManagerEvalReport2Records();
      const selectButtons = host.querySelectorAll('[data-role="manager-eval2-select"]').length;
      const emailButtonVisible = !!host.querySelector('#manager-eval-report-2-email-button');
      openGroupedBloomNcrRecipientModal = async () => ['megan_kelly@greenleafnursery.com', 'jd_jones@greenleafnursery.com', 'MEGAN_KELLY@greenleafnursery.com'];
      postGoogleScriptEmailPayload = async (payload) => {
        sentPayload = payload;
        return { ok: true, status: 200, recipients: payload.recipientEmails.slice() };
      };
      await emailSelectedManagerEvalReport2Rows();
      return {
        rowsBefore: rows.map((row) => row.UNIQUE_ID),
        selectedBefore,
        selectedAfter: getManagerEvalReport2SelectedRows().length,
        selectButtons,
        emailButtonVisible,
        recipients: sentPayload && sentPayload.recipientEmails,
        itemsCount: sentPayload && sentPayload.itemsCount,
        format: sentPayload && sentPayload.shiftReportFormat,
        subtype: sentPayload && sentPayload.emailSubType,
        exactRecipientOverride: !!(sentPayload && sentPayload.recipientsSelectedInApp && sentPayload.dylanRecipientOverride),
        attachment: sentPayload && sentPayload.shiftReportAttachment ? {
          filename: sentPayload.shiftReportAttachment.filename,
          mimeType: sentPayload.shiftReportAttachment.mimeType,
          hasWorkbookData: String(sentPayload.shiftReportAttachment.contentBase64 || '').startsWith('UEsDB')
        } : null,
        controlsFit: host.scrollWidth <= 391
      };
    } finally {
      canViewManagerEvalReports = originalCanViewManagerEvalReports;
      openGroupedBloomNcrRecipientModal = originalRecipientModal;
      postGoogleScriptEmailPayload = originalPostEmail;
    }
  })()`));

  expect(result.rowsBefore).toEqual(['mail-a', 'mail-b', 'mail-c']);
  expect(result.selectedBefore).toEqual(['mail-a', 'mail-b']);
  expect(result.selectedAfter).toBe(0);
  expect(result.selectButtons).toBe(3);
  expect(result.emailButtonVisible).toBe(true);
  expect(result.recipients).toEqual(['megan_kelly@greenleafnursery.com', 'jd_jones@greenleafnursery.com']);
  expect(result.itemsCount).toBe(2);
  expect(result.format).toBe('excel');
  expect(result.subtype).toBe('eval_reports_2_excel');
  expect(result.exactRecipientOverride).toBe(true);
  expect(result.attachment.filename).toMatch(/\.xlsx$/);
  expect(result.attachment.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  expect(result.attachment.hasWorkbookData).toBe(true);
  expect(result.controlsFit).toBe(true);
});

test('Assigned Items uses touch-friendly cards on phones and preserves the desktop grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerAssignedItemsPreviewTable === 'function');
  const phone = await page.evaluate(() => window.eval(`(() => {
    const originalCanManage = canManageEvalItemcodeAssignments;
    const originalSave = setSingleEvalItemcodeAssignment;
    let saved = null;
    try {
      canManageEvalItemcodeAssignments = () => true;
      setSingleEvalItemcodeAssignment = (itemcode, genusname, assignedto) => {
        saved = { itemcode, genusname, assignedto };
        return false;
      };
      const rows = [
        { ITEMCODE: '007140.030.1', GENUSNAME: 'Yucca', COMMONNAME: 'Adams Needle Yucca', CONTSIZE: '#3', LOCATIONCODE: 'A.01.001', WAREHOUSEI: 'PH', SOURCE: 'ASSIGNMENTS', ASSIGNEDTO: 'dylan_collyge' },
        { ITEMCODE: '006404.031.1', GENUSNAME: 'Angyo', COMMONNAME: 'Angyo Star Tree Ivy', CONTSIZE: '3DP', LOCATIONCODE: 'B.02.001', WAREHOUSEI: 'PH', SOURCE: 'ASSIGNMENTS', ASSIGNEDTO: 'megan_kelly' },
        { ITEMCODE: '000724.070.1', GENUSNAME: 'Acer', COMMONNAME: 'Armstrong Maple', CONTSIZE: '#7', LOCATIONCODE: 'C.03.001', WAREHOUSEI: 'PH', SOURCE: 'ASSIGNMENTS', ASSIGNEDTO: '' }
      ];
      window.__assignedItemsResponsiveRows = rows;
      const host = document.createElement('div');
      host.id = 'assigned-items-phone-test-host';
      host.style.width = '390px';
      host.innerHTML = renderManagerAssignedItemsPreviewTable(getManagerAssignedItemsDisplayRows(rows));
      document.body.appendChild(host);
      const mobileList = host.querySelector('[data-manager-assigned-mobile-list]');
      const controls = Array.from(mobileList.querySelectorAll('select,input')).map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width, height: box.height };
      });
      const firstSelect = mobileList.querySelector('select');
      firstSelect.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        cardCount: mobileList.querySelectorAll('[data-manager-assigned-item-card]').length,
        mobileDisplay: getComputedStyle(mobileList).display,
        desktopPresent: !!host.querySelector('[data-manager-assigned-desktop-table]'),
        hasVisibleTable: host.querySelectorAll('table').length > 0,
        controlsFit: controls.length > 0 && controls.every((box) => box.left >= 0 && box.right <= 390.5 && box.width <= 390.5),
        touchSelect: controls.filter((box) => box.height > 30).every((box) => box.height >= 44),
        hostFits: host.scrollWidth <= 391,
        checkedBulkCount: mobileList.querySelectorAll('input[type="checkbox"]:checked').length,
        groupSequence: Array.from(mobileList.querySelectorAll('[data-manager-assigned-group]')).map((element) => element.getAttribute('data-manager-assigned-group')),
        saved
      };
    } finally {
      canManageEvalItemcodeAssignments = originalCanManage;
      setSingleEvalItemcodeAssignment = originalSave;
    }
  })()`));

  expect(phone.cardCount).toBe(3);
  expect(phone.mobileDisplay).not.toBe('none');
  expect(phone.desktopPresent).toBe(false);
  expect(phone.hasVisibleTable).toBe(false);
  expect(phone.controlsFit).toBe(true);
  expect(phone.touchSelect).toBe(true);
  expect(phone.hostFits).toBe(true);
  expect(phone.checkedBulkCount).toBe(0);
  expect(phone.groupSequence).toEqual(['unassigned', 'assigned']);
  expect(phone.saved).toEqual({ itemcode: '000724.070.1', genusname: 'Acer', assignedto: '' });

  await page.setViewportSize({ width: 1024, height: 844 });
  const desktop = await page.evaluate(() => window.eval(`(() => {
    const host = document.getElementById('assigned-items-phone-test-host');
    host.innerHTML = renderManagerAssignedItemsPreviewTable(getManagerAssignedItemsDisplayRows(window.__assignedItemsResponsiveRows || []));
    const desktopTable = host?.querySelector('[data-manager-assigned-desktop-table]');
    return {
      mobilePresent: !!host?.querySelector('[data-manager-assigned-mobile-list]'),
      desktopDisplay: desktopTable ? getComputedStyle(desktopTable).display : '',
      tableCount: desktopTable ? desktopTable.querySelectorAll('table').length : 0,
      rowCount: desktopTable ? desktopTable.querySelectorAll('[data-manager-assigned-item-row]').length : 0
    };
  })()`));
  expect(desktop.mobilePresent).toBe(false);
  expect(desktop.desktopDisplay).not.toBe('none');
  expect(desktop.tableCount).toBe(1);
  expect(desktop.rowCount).toBe(3);
});

test('Assigned Items shows and searches the complete list beyond the former 100-row cap', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 844 });
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderManagerAssignedItemsPreviewTable === 'function');

  const desktop = await page.evaluate(() => window.eval(`(() => {
    const originalCanManage = canManageEvalItemcodeAssignments;
    try {
      canManageEvalItemcodeAssignments = () => false;
      const rows = Array.from({ length: 125 }, (_, index) => ({
        UNIQUE_ID: 'full-' + index,
        ITEMCODE: 'SKU-' + String(index).padStart(3, '0'),
        GENUSNAME: index % 2 ? 'Rosa' : 'Acer',
        COMMONNAME: 'Needle Plant ' + index,
        CONTSIZE: '#' + ((index % 7) + 1),
        LOCATIONCODE: 'A.' + String(index).padStart(3, '0'),
        WAREHOUSEI: 'PH',
        SOURCE: 'assignment-test',
        ASSIGNEDTO: index % 5 === 0 ? '' : 'dylan_collyge'
      }));
      window.__assignedItemsFullRows = getManagerAssignedItemsDisplayRows(rows);
      const host = document.createElement('div');
      host.id = 'assigned-items-full-list-test-host';
      host.innerHTML = renderManagerAssignedItemsPreviewTable(window.__assignedItemsFullRows, rows.length);
      document.body.appendChild(host);
      return {
        rowCount: host.querySelectorAll('[data-manager-assigned-item-row]').length,
        mobilePresent: !!host.querySelector('[data-manager-assigned-mobile-list]'),
        status: host.querySelector('[data-manager-assigned-full-list-status]')?.textContent || '',
        oldCapMessagePresent: /first 100/i.test(host.textContent || '')
      };
    } finally {
      canManageEvalItemcodeAssignments = originalCanManage;
    }
  })()`));

  expect(desktop.rowCount).toBe(125);
  expect(desktop.mobilePresent).toBe(false);
  expect(desktop.status).toContain('Showing all 125 matching rows');
  expect(desktop.oldCapMessagePresent).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneSearch = await page.evaluate(() => window.eval(`(() => {
    const originalCanManage = canManageEvalItemcodeAssignments;
    const searchInput = document.getElementById('managers-search');
    const originalSearch = searchInput ? searchInput.value : '';
    try {
      canManageEvalItemcodeAssignments = () => false;
      const host = document.getElementById('assigned-items-full-list-test-host');
      host.innerHTML = renderManagerAssignedItemsPreviewTable(window.__assignedItemsFullRows, window.__assignedItemsFullRows.length);
      const fullCardCount = host.querySelectorAll('[data-manager-assigned-item-card]').length;
      if (!searchInput) throw new Error('Managers search input is unavailable');
      searchInput.value = 'SKU-124';
      handleManagersSearch();
      const filteredRows = getFilteredManagerAssignedItemsExportRows(window.__assignedItemsFullRows);
      host.innerHTML = renderManagerAssignedItemsPreviewTable(filteredRows, window.__assignedItemsFullRows.length);
      return {
        fullCardCount,
        filteredCount: filteredRows.length,
        filteredCardCount: host.querySelectorAll('[data-manager-assigned-item-card]').length,
        desktopPresent: !!host.querySelector('[data-manager-assigned-desktop-table]'),
        status: host.querySelector('[data-manager-assigned-full-list-status]')?.textContent || ''
      };
    } finally {
      canManageEvalItemcodeAssignments = originalCanManage;
      if (searchInput) {
        searchInput.value = originalSearch;
        handleManagersSearch();
      }
    }
  })()`));

  expect(phoneSearch.fullCardCount).toBe(125);
  expect(phoneSearch.filteredCount).toBe(1);
  expect(phoneSearch.filteredCardCount).toBe(1);
  expect(phoneSearch.desktopPresent).toBe(false);
  expect(phoneSearch.status).toContain('Search checks the complete 125-row list');
});

test('Assigned Items single-row changes save immediately and remain stable inside assignment groups', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getManagerAssignedItemsDisplayRows === 'function');
  const result = await page.evaluate(() => window.eval(`(async () => {
    const originalAssign = assignEvalItemcodes;
    let releaseSave = null;
    const calls = [];
    const control = document.createElement('select');
    document.body.appendChild(control);
    try {
      const rows = [
        { UNIQUE_ID: 'stable-1', ITEMCODE: '200', GENUSNAME: 'Beta', COMMONNAME: 'Beta Plant', CONTSIZE: '#3', LOCATIONCODE: 'B.01', WAREHOUSEI: 'PH', ASSIGNEDTO: '' },
        { UNIQUE_ID: 'stable-2', ITEMCODE: '100', GENUSNAME: 'Alpha', COMMONNAME: 'Alpha Plant', CONTSIZE: '#1', LOCATIONCODE: 'A.01', WAREHOUSEI: 'PH', ASSIGNEDTO: 'zoe_green' },
        { UNIQUE_ID: 'stable-3', ITEMCODE: '300', GENUSNAME: 'Gamma', COMMONNAME: 'Gamma Plant', CONTSIZE: '#5', LOCATIONCODE: 'C.01', WAREHOUSEI: 'PH', ASSIGNEDTO: 'abigail_vazquez' }
      ];
      const before = getManagerAssignedItemsDisplayRows(rows).map((row) => row.ITEMCODE);
      assignEvalItemcodes = (assignments, assignedto) => {
        calls.push({ assignments: JSON.parse(JSON.stringify(assignments)), assignedto });
        return new Promise((resolve) => { releaseSave = resolve; });
      };
      const savePromise = setSingleEvalItemcodeAssignment('100', 'Alpha', 'dylan_collyge', control);
      await Promise.resolve();
      const disabledDuring = control.disabled;
      const busyDuring = control.getAttribute('aria-busy');
      releaseSave(false);
      await savePromise;
      const changedRows = rows.map((row) => row.ITEMCODE === '100' ? Object.assign({}, row, { ASSIGNEDTO: 'dylan_collyge' }) : row);
      const after = getManagerAssignedItemsDisplayRows(changedRows).map((row) => row.ITEMCODE);
      const completedRows = rows.map((row) => row.ITEMCODE === '200' ? Object.assign({}, row, { ASSIGNEDTO: 'dylan_collyge' }) : row);
      const afterCompletingUnassigned = getManagerAssignedItemsDisplayRows(completedRows).map((row) => row.ITEMCODE);
      setManagerAssignedItemsAssigneeFilter('assigned');
      const assignedOnly = getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows(rows)).map((row) => row.ITEMCODE);
      setManagerAssignedItemsAssigneeFilter('unassigned');
      const unassignedOnly = getFilteredManagerAssignedItemsExportRows(getManagerAssignedItemsDisplayRows(rows)).map((row) => row.ITEMCODE);
      setManagerAssignedItemsAssigneeFilter('all');
      return {
        before,
        after,
        afterCompletingUnassigned,
        assignedOnly,
        unassignedOnly,
        calls,
        disabledDuring,
        busyDuring,
        disabledAfter: control.disabled,
        busyAfter: control.hasAttribute('aria-busy')
      };
    } finally {
      control.remove();
      assignEvalItemcodes = originalAssign;
      setManagerAssignedItemsAssigneeFilter('all');
    }
  })()`));

  expect(result.before).toEqual(['200', '100', '300']);
  expect(result.after).toEqual(result.before);
  expect(result.afterCompletingUnassigned).toEqual(['100', '200', '300']);
  expect(result.assignedOnly).toEqual(['100', '300']);
  expect(result.unassignedOnly).toEqual(['200']);
  expect(result.calls).toEqual([{
    assignments: [{ itemcode: '100', genusname: 'Alpha' }],
    assignedto: 'dylan_collyge'
  }]);
  expect(result.disabledDuring).toBe(true);
  expect(result.busyDuring).toBe('true');
  expect(result.disabledAfter).toBe(false);
  expect(result.busyAfter).toBe(false);
});

test('Manager Historical Report loads Common Names immediately, drills to ContSize, and sends only chosen columns', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).loadManagerHistoricalRows === 'function');
  const result = await page.evaluate(() => window.eval(`(async () => {
    const originalSupabaseRpc = supabaseRpc;
    const originalCanViewManagerHistoricalReport = canViewManagerHistoricalReport;
    const calls = [];
    try {
      canViewManagerHistoricalReport = () => true;
      activeHomeTab = 'historical-report';
      managersSearchTerm = 'feather';
      supabaseRpc = async (name, body) => {
        calls.push({ name, body: JSON.parse(JSON.stringify(body || {})) });
        if (name === 'search_historical_inventory_common_names') return [{
          commonname: 'Karl Foerster Feather Reed Grass', contsize_count: 1, historical_row_count: 2
        }];
        if (name === 'get_historical_inventory_container_sizes') return [{
          contsize: '#1', itemcode_count: 1, historical_row_count: 2
        }];
        if (name === 'get_historical_inventory_rows') return {
          rows: [{
            unique_id: 'history-1', report_date: '2026-08-20',
            commonname: 'Karl Foerster Feather Reed Grass', contsize: '#1',
            values: Object.fromEntries((body.selected_columns || []).map((key) => [key, key === 'holdstopcode' ? 'H' : 'test']))
          }],
          selected_columns: body.selected_columns,
          has_more: false,
          next_cursor: null
        };
        throw new Error('unexpected rpc');
      };

      const defaultNames = await loadManagerHistoricalCommonNames('', true);
      const browseCall = calls.filter((call) => call.name === 'search_historical_inventory_common_names').at(-1);
      const browseMarkup = renderManagerHistoricalReportPanel();
      const names = await loadManagerHistoricalCommonNames('feather', true);
      managersSearchTerm = 'feather';
      const nameMarkup = renderManagerHistoricalReportPanel();
      await selectManagerHistoricalCommonName('Karl Foerster Feather Reed Grass');
      const sizeMarkup = renderManagerHistoricalReportPanel();
      await selectManagerHistoricalContSize('#1');
      toggleManagerHistoricalColumn('locationcode', false);
      toggleManagerHistoricalColumn('lotcode', false);
      toggleManagerHistoricalColumn('ptravailable', false);
      toggleManagerHistoricalColumn('holdstopreason', false);
      setManagerHistoricalDateRange('start', '2026-08-01');
      setManagerHistoricalDateRange('end', '2026-08-21');
      await loadManagerHistoricalRows(true);
      const rowCall = calls.filter((call) => call.name === 'get_historical_inventory_rows').at(-1);
      const rows = getFilteredManagerHistoricalRows();
      const rendered = renderManagerHistoricalReportPanel();
      return {
        names: names.map((row) => row.commonname),
        defaultNames: defaultNames.map((row) => row.commonname),
        browseArgs: browseCall && browseCall.body,
        browseMarkup,
        values: rows[0] ? rows[0].values : null,
        calls,
        rowArgs: rowCall && rowCall.body,
        nameMarkup,
        sizeMarkup,
        rendered,
        canDylan: originalCanViewManagerHistoricalReport('dylan_collyge'),
        canOther: originalCanViewManagerHistoricalReport('jd_jones')
      };
    } finally {
      supabaseRpc = originalSupabaseRpc;
      canViewManagerHistoricalReport = originalCanViewManagerHistoricalReport;
    }
  })()`));

  expect(result.names).toEqual(['Karl Foerster Feather Reed Grass']);
  expect(result.defaultNames).toEqual(['Karl Foerster Feather Reed Grass']);
  expect(result.browseArgs).toEqual({ search_text: '', result_limit: 100 });
  expect(result.browseMarkup).toContain('Browse Common Name');
  expect(result.browseMarkup).toContain('manager-historical-drive-card');
  expect(result.values).toEqual({ report_date: 'test', itemcode: 'test', holdstopcode: 'H' });
  expect(result.rowArgs.selected_columns).toEqual(['report_date', 'itemcode', 'holdstopcode']);
  expect(result.rowArgs.start_date).toBe('2026-08-01');
  expect(result.rowArgs.end_date).toBe('2026-08-21');
  expect(result.rendered).toContain('Karl Foerster Feather Reed Grass');
  expect(result.rendered).toContain('#1');
  expect(result.rendered).toContain('Columns (3)');
  expect(result.rendered).toContain('HOLDSTOPCODE');
  expect(result.nameMarkup).toContain('manager-historical-drive-card');
  expect(result.nameMarkup).toContain('manager-historical-drive-crumb');
  expect(result.nameMarkup).not.toContain('manager-module-grid');
  expect(result.sizeMarkup).toContain('manager-historical-drive-card');
  expect(result.rendered).toContain('manager-historical-drive-record');
  expect(result.rendered).toContain('app-smart-card--inventory');
  expect(result.canDylan).toBe(true);
  expect(result.canOther).toBe(false);
});

test('an acknowledged assignment immediately leaves the Unassigned filter', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).applyAcknowledgedEvalAssignmentResults === 'function');
  const result = await page.evaluate(() => window.eval(`(() => {
    processAndLoadData({ warehouseAssignedItemsData: [{
      UNIQUE_ID: 'eval-test-1', ITEMCODE: '011364.070.1', GENUSNAME: 'Decumaria',
      ASSIGNEDTO: '', assignedto: '', COMMONNAME: 'Barbara Ann Climbing Hydrangea Espalier'
    }] });
    setManagerAssignedItemsAssigneeFilter('unassigned');
    const activeBefore = getManagerAssignedItemsActiveAssigneeKey();
    const before = getFilteredManagerAssignedItemsExportRows().map((row) => row.ITEMCODE);
    const applied = applyAcknowledgedEvalAssignmentResults(
      [{ itemcode: '011364.070.1', genusname: 'Decumaria' }],
      [{ itemcode: '011364.070.1', genusname: 'Decumaria', assignedto: 'megan_kelly', source: 'supabase_assignment_manager' }],
      'megan_kelly'
    );
    const activeAfter = getManagerAssignedItemsActiveAssigneeKey();
    const unassignedAfter = getFilteredManagerAssignedItemsExportRows().map((row) => row.ITEMCODE);
    setManagerAssignedItemsAssigneeFilter('megan_kelly');
    const meganAfter = getFilteredManagerAssignedItemsExportRows().map((row) => ({ itemcode: row.ITEMCODE, assignedto: row.ASSIGNEDTO }));
    return { activeBefore, before, applied, activeAfter, unassignedAfter, meganAfter };
  })()`));

  expect(result).toEqual({
    activeBefore: 'unassigned',
    before: ['011364.070.1'],
    applied: 1,
    activeAfter: 'unassigned',
    unassignedAfter: [],
    meganAfter: [{ itemcode: '011364.070.1', assignedto: 'megan_kelly' }],
  });
});

test('iPhone Request Queue renders all 19 rows instead of only the first adaptive chunk', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(() => {
    const appWindow = window as typeof window & {
      isIOSDevice?: () => boolean;
      getRequestChunkRenderOptions?: (options?: Record<string, unknown>) => Record<string, unknown>;
      renderMarkupChunkedByKey?: (
        key: string,
        container: HTMLElement,
        crumb: HTMLElement,
        rows: Array<{ id: number }>,
        crumbText: string,
        renderRow: (row: { id: number }) => string,
        options: Record<string, unknown>
      ) => boolean;
    };
    appWindow.isIOSDevice = () => true;
    document.body.classList.add('ios-device', 'viewport-phone', 'current-view-request');
    const container = document.createElement('div');
    const crumb = document.createElement('div');
    document.body.append(container, crumb);
    const rows = Array.from({ length: 19 }, (_, index) => ({ id: index + 1 }));
    const options = appWindow.getRequestChunkRenderOptions?.({ onComplete: () => {} }) || {};
    appWindow.renderMarkupChunkedByKey?.(
      'request-main-test',
      container,
      crumb,
      rows,
      'All Request Que',
      (row) => `<div data-request-uid="REQ-${row.id}">Row ${row.id}</div>`,
      options
    );
    return {
      configuredSyncLimit: Number(options.iosSyncRowLimit || 0),
      renderedRows: container.querySelectorAll('[data-request-uid]').length,
    };
  });

  expect(result.configuredSyncLimit).toBeGreaterThanOrEqual(19);
  expect(result.renderedRows).toBe(19);
});

test('Queue tab changes load only the canonical datasets needed by that tab', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getRequestViewLoadingConfig === 'function');
  const configs = await page.evaluate(() => {
    const getConfig = (window as any).getRequestViewLoadingConfig;
    const summarize = (tab: string) => {
      const config = getConfig(tab);
      return {
        required: config.required.map((item: any) => `${item.key}:${item.mode}`),
        background: config.background.map((item: any) => `${item.key}:${item.mode}`),
      };
    };
    return {
      query: (window as any).buildActiveRequestLiveRowsQuery('*'),
      pending: summarize('pending'),
      reps: summarize('reps'),
      suspendTag: summarize('suspend-tag'),
      recount: summarize('recount'),
      avCheck: summarize('av-check'),
    };
  });

  expect(configs.query).toBe('select=*&order=unique_id.desc');
  expect(configs.query).not.toContain('date_completed=is.null');
  expect(configs.pending).toEqual({ required: ['requests:full'], background: [] });
  expect(configs.reps.required).toEqual(['requests:full', 'requestHistory:full', 'salesCredits:full']);
  expect(configs.suspendTag.required).toEqual(['requests:full', 'soc:full']);
  expect(configs.recount).toEqual({ required: ['salesOffice:full'], background: ['requests:full'] });
  expect(configs.avCheck).toEqual({ required: [], background: ['requests:full'] });
});

test('Kayla keeps request photo and save access without gaining other sales-rep row edits', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  const permissions = await page.evaluate(() => {
    window.eval("window.__qaOriginalGetRoleAccessState=getRoleAccessState; window.__qaOriginalRequestIdentityTokens=getRequestRepScopedIdentityTokens; getRequestRepScopedIdentityTokens=function(){ return new Set(['kayla_knepp']); }; getRoleAccessState=function(){ return window.__qaOriginalGetRoleAccessState('SALESREP','kayla_knepp'); };");
    const result = window.eval(`({
      repReadOnly: isRepReadOnlyUser(),
      globalRequestManager: canUseGlobalRequestAccess(),
      requestEditable: canEditRowDetails('req-', { SOURCE_TABLE: 'ph_active_request' }),
      driveEditable: canEditRowDetails('ssn-', { SOURCE_TABLE: 'ph_master_inventory' }),
      requestPhotoLabel: getTaskDetailQuickPhotoLabel('req-')
    })`);
    window.eval("getRoleAccessState=window.__qaOriginalGetRoleAccessState; getRequestRepScopedIdentityTokens=window.__qaOriginalRequestIdentityTokens; delete window.__qaOriginalGetRoleAccessState; delete window.__qaOriginalRequestIdentityTokens;");
    return result;
  });

  expect(permissions).toEqual({
    repReadOnly: true,
    globalRequestManager: true,
    requestEditable: true,
    driveEditable: false,
    requestPhotoLabel: 'Take Request Photo',
  });
});

test('saved Dark theme owns the first two seconds without a white frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('gnc_last_theme_v1', 'dark'));
  await page.addInitScript(() => {
    (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples = [];
    const sample = () => {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = document.body ? getComputedStyle(document.body) : null;
      (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples?.push({
        root: rootStyle.backgroundColor,
        body: bodyStyle?.backgroundColor || '',
        theme: document.documentElement.dataset.opsPrepaintTheme || document.body?.dataset.opsTheme || '',
      });
    };
    window.setInterval(sample, 25);
  });
  await page.goto('/?e2e=V2026.08.20.10&theme=dark', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => ({
    saved: localStorage.getItem('gnc_last_theme_v1'),
    bodyTheme: document.body.dataset.opsTheme,
    samples: (window as typeof window & { __themePaintSamples?: Array<{ root: string; body: string; theme: string }> }).__themePaintSamples || [],
  }));
  const visibleSamples = result.samples.filter((sample) => sample.body);
  expect(result.saved).toBe('dark');
  expect(result.bodyTheme).toBe('dark');
  expect(visibleSamples.length).toBeGreaterThan(10);
  expect(visibleSamples.some((sample) => /rgb\(255, 255, 255\)|rgba\(255, 255, 255, 1\)/.test(`${sample.root}|${sample.body}`)), JSON.stringify(visibleSamples.slice(0, 12))).toBe(false);
  expect(visibleSamples.every((sample) => sample.theme === 'dark')).toBe(true);
});

test('Drive Common Name search preserves grouped drill results', async ({ page }) => {
  await page.goto('/?e2e=V2026.08.20.10', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    const appWindow = window as typeof window & {
      shouldRenderDriveUniversalDetailedSearch?: () => boolean;
      renderDriveCommonNameDrill?: () => void;
      selectDriveName?: (name: string) => void;
    };
    return {
      detailedSearchOnDefaultCommonNameTab: appWindow.shouldRenderDriveUniversalDetailedSearch?.(),
      hasGroupedRenderer: typeof appWindow.renderDriveCommonNameDrill === 'function',
      hasDrillSelection: typeof appWindow.selectDriveName === 'function',
    };
  });
  expect(result).toEqual({
    detailedSearchOnDefaultCommonNameTab: false,
    hasGroupedRenderer: true,
    hasDrillSelection: true,
  });
});

test('Android keyboard viewport changes retain Drive search focus, node identity, value, and caret', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=drive&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  const search = page.locator('#drive-search');
  await search.focus();
  await search.fill('Karl Foerster');
  await search.evaluate((input) => {
    const typed = input as HTMLInputElement;
    typed.setSelectionRange(4, 4);
    (window as typeof window & { __qaDriveSearchNode?: HTMLInputElement }).__qaDriveSearchNode = typed;
  });

  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(280);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(280);

  const result = await search.evaluate((input) => {
    const typed = input as HTMLInputElement;
    return {
      sameNode: (window as typeof window & { __qaDriveSearchNode?: HTMLInputElement }).__qaDriveSearchNode === typed,
      connected: typed.isConnected,
      focused: document.activeElement === typed,
      value: typed.value,
      selectionStart: typed.selectionStart,
      selectionEnd: typed.selectionEnd,
      mountedInCommandSlot: !!typed.closest('#global-header-search-slot'),
    };
  });
  expect(result).toEqual({
    sameNode: true,
    connected: true,
    focused: true,
    value: 'Karl Foerster',
    selectionStart: 4,
    selectionEnd: 4,
    mountedInCommandSlot: true,
  });
});

test('Home adaptively fits all 12 launch modules without scrolling or quick-bar overlap', async ({ page }) => {
  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1900, height: 990 },
    { width: 1920, height: 1080 },
  ];

  for (const theme of ['light', 'dark']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=home&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#view-home')).toHaveAttribute('data-home-fit-complete', 'true');
      const layout = await page.locator('#home-dashboard-grid > *').evaluateAll((tiles) => {
        const visible = tiles.filter((tile) => (tile as HTMLElement).offsetWidth > 0) as HTMLElement[];
        const rects = visible.map((tile) => tile.getBoundingClientRect());
        const main = document.getElementById('main-scroll-area')!;
        const nav = document.getElementById('bottom-nav')!;
        const navRect = nav.getBoundingClientRect();
        const lastBottom = rects.length ? Math.max(...rects.map((rect) => rect.bottom)) : 0;
        const overlaps = rects.some((rect, index) => rects.slice(index + 1).some((other) => (
          Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1
          && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
        )));
        const labels = visible.map((tile) => tile.querySelector('span') as HTMLElement).filter(Boolean);
        return {
          count: rects.length,
          columns: new Set(rects.map((rect) => Math.round(rect.left))).size,
          rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
          clearance: Math.round((navRect.top - lastBottom) * 100) / 100,
          minWidth: Math.min(...rects.map((rect) => rect.width)),
          minHeight: Math.min(...rects.map((rect) => rect.height)),
          lastBottom,
          navTop: navRect.top,
          overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          mainScrollDelta: Math.max(0, main.scrollHeight - main.clientHeight),
          mainOverflowY: getComputedStyle(main).overflowY,
          navPosition: getComputedStyle(nav).position,
          navBottom: getComputedStyle(nav).bottom,
          overlaps,
          clipped: rects.some((rect) => rect.left < -1 || rect.right > window.innerWidth + 1 || rect.top < -1 || rect.bottom > navRect.top + 1),
          unreadableLabel: labels.some((label) => label.getBoundingClientRect().height < 9 || Number.parseFloat(getComputedStyle(label).fontSize) < 9),
          fitData: { ...(document.getElementById('view-home') as HTMLElement).dataset },
          fitTile: getComputedStyle(document.getElementById('view-home')!).getPropertyValue('--home-fit-tile-height'),
          fitAvailable: getComputedStyle(document.getElementById('view-home')!).getPropertyValue('--home-fit-available-height'),
          gridTop: document.getElementById('home-dashboard-grid')!.getBoundingClientRect().top,
          firstTileStyle: (() => { const style = getComputedStyle(visible[0]); return { height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight, padding: style.padding, boxSizing: style.boxSizing, aspectRatio: style.aspectRatio, alignSelf: style.alignSelf }; })(),
          gridStyle: (() => { const style = getComputedStyle(document.getElementById('home-dashboard-grid')!); return { rows: style.gridTemplateRows, autoRows: style.gridAutoRows, align: style.alignContent }; })(),
        };
      });

      expect(layout.count, `${theme} ${viewport.width}x${viewport.height}`).toBe(12);
      expect(layout.minWidth).toBeGreaterThanOrEqual(44);
      expect(layout.minHeight).toBeGreaterThanOrEqual(44);
      expect(layout.lastBottom, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.navTop + 1);
      expect(layout.clearance).toBeGreaterThanOrEqual(-1);
      expect(layout.overflowX, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
      expect(layout.mainScrollDelta).toBeLessThanOrEqual(2);
      expect(layout.mainOverflowY).toBe('hidden');
      expect(layout.navPosition).toBe('fixed');
      expect(layout.navBottom).toBe('0px');
      expect(layout.overlaps).toBe(false);
      expect(layout.clipped).toBe(false);
      expect(layout.unreadableLabel).toBe(false);

      if (viewport.width >= 1100) {
        expect(layout.columns).toBe(6);
        expect(layout.rows).toBe(2);
        expect(layout.clearance).toBeGreaterThanOrEqual(20);
        expect(layout.clearance).toBeLessThanOrEqual(52);
      } else if (viewport.width < 640 && viewport.height >= viewport.width) {
        expect(layout.columns).toBe(2);
        expect(layout.rows).toBe(6);
      } else {
        expect(layout.columns).toBeGreaterThanOrEqual(3);
        expect(layout.columns).toBeLessThanOrEqual(6);
      }
    }
  }
});

test('Home refits after resize, orientation, and 125–200 percent viewport reflow', async ({ page }) => {
  const reflowViewports = [
    { width: 1536, height: 864 },
    { width: 1097, height: 617 },
    { width: 960, height: 540 },
  ];
  await page.goto(`${fixtureUrl}?view=home&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  for (const viewport of reflowViewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#view-home')).toHaveAttribute('data-home-fit-complete', 'true');
    await expect.poll(async () => page.locator('#view-home').getAttribute('data-home-fit-columns')).not.toBeNull();
    await expect.poll(async () => page.locator('#home-dashboard-grid').evaluate((grid) => {
      const tiles = Array.from(grid.children).filter((tile) => (tile as HTMLElement).offsetWidth) as HTMLElement[];
      const navTop = document.getElementById('bottom-nav')!.getBoundingClientRect().top;
      return navTop - Math.max(...tiles.map((tile) => tile.getBoundingClientRect().bottom));
    }), { timeout: 3_000 }).toBeGreaterThanOrEqual(-1);
    const state = await page.locator('#view-home').evaluate((home) => {
      const tiles = Array.from(document.querySelectorAll('#home-dashboard-grid > *')).filter((tile) => (tile as HTMLElement).offsetWidth) as HTMLElement[];
      const rects = tiles.map((tile) => tile.getBoundingClientRect());
      const navTop = document.getElementById('bottom-nav')!.getBoundingClientRect().top;
      const main = document.getElementById('main-scroll-area')!;
      return {
        count: rects.length,
        columns: Number((home as HTMLElement).dataset.homeFitColumns || 0),
        minHeight: Math.min(...rects.map((rect) => rect.height)),
        clearance: navTop - Math.max(...rects.map((rect) => rect.bottom)),
        scrollDelta: main.scrollHeight - main.clientHeight,
      };
    });
    expect(state.count).toBe(12);
    expect(state.columns).toBeGreaterThanOrEqual(4);
    expect(state.minHeight).toBeGreaterThanOrEqual(44);
    expect(state.clearance).toBeGreaterThanOrEqual(-1);
    expect(state.scrollDelta).toBeLessThanOrEqual(2);
  }
});

test('phone Chat composer fills the shell and never overlaps quick navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=chat&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });

  const composer = page.locator('.chat-thread-composer');
  const nav = page.locator('#bottom-nav');
  await expect(composer).toBeVisible();
  await expect(page.locator('.android-chat-input')).toBeVisible();
  const composerBox = await composer.boundingBox();
  const navBox = await nav.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(composerBox!.width).toBeGreaterThanOrEqual(388);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(navBox!.y);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(composer).toBeVisible();
  const desktopComposer = await composer.boundingBox();
  const desktopNav = await nav.boundingBox();
  expect(desktopComposer).not.toBeNull();
  expect(desktopNav).not.toBeNull();
  expect(desktopComposer!.y + desktopComposer!.height).toBeLessThanOrEqual(desktopNav!.y);
});

test('Item Inquiry preserves the compact desktop and tablet worksheet', async ({ page }) => {
  test.setTimeout(90_000);
  const viewports = [
    { width: 768, height: 1024 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  const itemFields = ['PLANTGROUPCODE', 'COMMONNAME', 'CONTSIZE', 'ITEMCODE', 'GENUSNAME', 'FIELDTAGCOLOR', 'ITEMSPEC', 'PULLERRESPONSIBILITY', 'HOLDSTOPCODE', 'HOLDSTOPREASON', 'PTRONHAND', 'PTRREVIEWED', 'PTRAVAILABLE'];
  const seasonFields = ['SALEYEAR', 'SEASON', 'S_LTS', 'SUPPLY', 'ON HAND', 'DEMAND'];
  const rowFields = ['LOTCODE', 'LOCATIONCODE', 'SOURCE', 'PRIORITY', 'DesigItem', 'DesigCust', 'DesigLoc', 'LOCATIONNOTEDATE', 'LOCATIONNOTE', 'PULLTAGNOTE1', 'LOCATIONPTN1'];

  for (const theme of ['light', 'dark']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=item-inquiry&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#item-inquiry-panel')).toBeVisible();
      await expect(page.locator('#view-detail > .freeze-panel > .mb-4')).toBeHidden();
      await expect(page.locator('#detail-shared-panels')).toBeHidden();
      await expect(page.locator('[data-item-inquiry-summary] [data-item-inquiry-field]')).toHaveCount(itemFields.length);
      expect(await page.locator('[data-item-inquiry-summary] [data-item-inquiry-field]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-item-inquiry-field')))).toEqual(itemFields);
      await expect(page.locator('[data-item-inquiry-field="PTRONHAND"] .item-inquiry-summary-value')).toHaveText('2,186');
      await expect(page.locator('[data-item-inquiry-field="PTRREVIEWED"] .item-inquiry-summary-value')).toHaveText('105');
      await expect(page.locator('[data-item-inquiry-field="PTRAVAILABLE"] .item-inquiry-summary-value')).toHaveText('2,081');
      await expect(page.locator('[data-item-inquiry-field="HOLDSTOPCODE"] .item-inquiry-summary-value')).toHaveText('H');
      await expect(page.locator('[data-item-inquiry-field="HOLDSTOPREASON"] .item-inquiry-summary-value')).toContainText('Review before release');
      await expect(page.locator('[data-item-inquiry-season-summary] .item-inquiry-season-row')).toHaveCount(12);
      expect(await page.locator('[data-item-inquiry-season-summary] .item-inquiry-season-header [role="columnheader"]').allTextContents()).toEqual(seasonFields);
      await expect(page.locator('[data-item-inquiry-location]')).toHaveCount(2);
      const f19 = page.locator('[data-item-inquiry-location="F.19.000"]');
      await expect(f19.locator('[data-item-inquiry-row-line]')).toHaveCount(3);
      await expect(f19.locator('[data-item-inquiry-row-line]').first().locator('[data-item-inquiry-column="LOTCODE"] .item-inquiry-cell-value')).toHaveText('27.F1');
      await expect(f19.locator('.item-inquiry-location-totals')).toHaveCount(0);
      await expect(f19.locator('[data-item-inquiry-column="PULLTAGNOTE2"], [data-item-inquiry-column="LOCATIONPTN2"]')).toHaveCount(0);
      const firstRowLabels = await f19.locator('[data-item-inquiry-row-line]').first().locator('[data-item-inquiry-column]').evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-item-inquiry-column')));
      expect(firstRowLabels).toEqual(rowFields);

      const layout = await page.locator('#item-inquiry-panel').evaluate((panel) => {
        const panelRect = panel.getBoundingClientRect();
        const detailFreezePanel = document.querySelector('#view-detail > .freeze-panel') as HTMLElement;
        const freezeRect = detailFreezePanel.getBoundingClientRect();
        const ledger = panel.querySelector('.item-inquiry-ledger') as HTMLElement;
        const ledgerScroll = panel.querySelector('.item-inquiry-ledger-scroll') as HTMLElement;
        const firstRow = panel.querySelector('.item-inquiry-ledger-row') as HTMLElement;
        const cellValues = Array.from(panel.querySelectorAll('.item-inquiry-cell-value')) as HTMLElement[];
        const navRect = (document.querySelector('#bottom-nav') as HTMLElement).getBoundingClientRect();
        const seasonPanel = panel.querySelector('.item-inquiry-season-summary') as HTMLElement;
        const seasonGrid = panel.querySelector('.item-inquiry-season-grid') as HTMLElement;
        const seasonHeaders = Array.from(panel.querySelectorAll('.item-inquiry-season-header > div')) as HTMLElement[];
        const firstSeasonCells = Array.from((panel.querySelector('.item-inquiry-season-row') as HTMLElement).children) as HTMLElement[];
        const identityCells = Array.from(panel.querySelectorAll('.item-inquiry-summary-cell')) as HTMLElement[];
        const content = document.querySelector('#det-item-inquiry-content') as HTMLElement;
        const contentRect = content.getBoundingClientRect();
        const main = document.querySelector('#main-scroll-area') as HTMLElement;
        const mainRect = main.getBoundingClientRect();
        const detail = document.querySelector('#view-detail') as HTMLElement;
        const detailRect = detail.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          panelLeft: panelRect.left,
          panelRight: panelRect.right,
          panelWidth: panelRect.width,
          panelTop: panelRect.top,
          panelBottom: panelRect.bottom,
          bottomGap: navRect.top - panelRect.bottom,
          contentTop: contentRect.top,
          contentBottom: contentRect.bottom,
          contentHeight: contentRect.height,
          contentComputedHeight: getComputedStyle(content).height,
          availableHeight: getComputedStyle(document.documentElement).getPropertyValue('--ops-content-available-height'),
          mainTop: mainRect.top,
          mainBottom: mainRect.bottom,
          mainPaddingBottom: getComputedStyle(main).paddingBottom,
          detailTop: detailRect.top,
          detailBottom: detailRect.bottom,
          detailHeight: detailRect.height,
          detailComputedHeight: getComputedStyle(detail).height,
          freezeBottom: freezeRect.bottom,
          freezePosition: getComputedStyle(detailFreezePanel).position,
          ledgerClientWidth: ledger.clientWidth,
          ledgerClientHeight: ledger.clientHeight,
          ledgerScrollClientWidth: ledgerScroll.clientWidth,
          ledgerScrollWidth: ledgerScroll.scrollWidth,
          rowColumns: getComputedStyle(firstRow).gridTemplateColumns.split(' ').filter(Boolean).length,
          headerDisplay: getComputedStyle(panel.querySelector('.item-inquiry-ledger-header')!).display,
          seasonPanelWidth: seasonPanel.getBoundingClientRect().width,
          seasonGridWidth: seasonGrid.getBoundingClientRect().width,
          seasonColumnsAligned: seasonHeaders.every((header, index) => Math.abs(header.getBoundingClientRect().width - firstSeasonCells[index].getBoundingClientRect().width) < 1),
          identityWidthSpread: Math.max(...identityCells.map((cell) => cell.getBoundingClientRect().width)) - Math.min(...identityCells.map((cell) => cell.getBoundingClientRect().width)),
          smallestFont: Math.min(...cellValues.map((cell) => Number.parseFloat(getComputedStyle(cell).fontSize))),
          verticalWord: cellValues.some((cell) => getComputedStyle(cell).wordBreak === 'break-all'),
        };
      });
      expect(layout.documentOverflowX, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
      expect(layout.freezePosition, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe('relative');
      expect(layout.panelTop, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeGreaterThanOrEqual(layout.freezeBottom - 1);
      expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
      expect(layout.panelRight).toBeLessThanOrEqual(viewport.width + 1);
      expect(layout.panelWidth).toBeGreaterThan(250);
      expect(layout.bottomGap, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(16);
      expect(layout.bottomGap, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBeGreaterThanOrEqual(-2);
      expect(layout.ledgerClientHeight).toBeGreaterThan(24);
      expect(layout.seasonColumnsAligned).toBe(true);
      expect(layout.seasonGridWidth).toBeLessThan(layout.seasonPanelWidth);
      expect(layout.smallestFont).toBeGreaterThanOrEqual(8);
      expect(layout.verticalWord).toBe(false);
      if (viewport.width >= 1100) {
        expect(layout.headerDisplay).toBe('grid');
        expect(layout.rowColumns).toBe(11);
        expect(layout.identityWidthSpread).toBeGreaterThan(10);
        expect(layout.ledgerScrollWidth).toBeLessThanOrEqual(layout.ledgerScrollClientWidth + 1);
      } else {
        expect(layout.headerDisplay).toBe('none');
        expect(layout.rowColumns).toBe(4);
        expect(layout.ledgerScrollWidth).toBeLessThanOrEqual(layout.ledgerScrollClientWidth + 1);
      }
    }
  }
});

test('Phone Item Inquiry uses one readable summary-first scroll with synchronized tabs', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 430, height: 932 },
  ];
  for (const theme of ['light', 'dark', 'outdoor']) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${fixtureUrl}?view=item-inquiry&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
      const panel = page.locator('#item-inquiry-panel');
      const mobile = panel.locator('.item-inquiry-mobile-view');
      await expect(panel).toBeVisible();
      await expect(mobile).toBeVisible();
      await expect(panel.locator('.item-inquiry-desktop-view')).toBeHidden();
      await expect(page.locator('#det-tabs-container')).toBeHidden();
      await expect(page.locator('#det-mobile-tab-select-wrap')).toBeVisible();
      const tabSelect = page.locator('#det-mobile-tab-select');
      await expect(tabSelect).toHaveValue('item-inquiry');
      expect(await tabSelect.locator('option').allTextContents()).toEqual(['Request', 'Inventory Edits', 'This Location', 'Item Details', 'Item Inquiry']);
      await tabSelect.selectOption('overview');
      await expect(page.locator('body')).toHaveAttribute('data-qa-detail-tab', 'overview');
      await tabSelect.selectOption('item-inquiry');

      await expect(mobile.locator('.item-inquiry-mobile-hero h2')).toHaveText('Karl Foerster Feather Reed Grass');
      await expect(mobile.locator('.item-inquiry-mobile-stats > div')).toHaveCount(3);
      await expect(mobile.locator('.item-inquiry-mobile-stats')).toContainText('2,186');
      await expect(mobile.locator('.item-inquiry-mobile-hold')).toContainText('Review before release');
      await expect(mobile.locator('.item-inquiry-mobile-item-details')).not.toHaveAttribute('open', '');
      await expect(mobile.locator('.item-inquiry-mobile-season-card')).toHaveCount(12);

      const currentLocation = mobile.locator('[data-item-inquiry-mobile-location="F.19.000"]');
      const otherLocation = mobile.locator('[data-item-inquiry-mobile-location="H.06.000"]');
      const currentLot = currentLocation.locator('[data-item-inquiry-mobile-lot="27.F1"]');
      await expect(currentLocation).toHaveAttribute('open', '');
      await expect(currentLot).toHaveAttribute('open', '');
      await expect(otherLocation).not.toHaveAttribute('open', '');
      await otherLocation.locator(':scope > summary').click();
      await expect(otherLocation).toHaveAttribute('open', '');
      const otherLot = otherLocation.locator('[data-item-inquiry-mobile-lot="27.F1"]');
      await otherLot.locator(':scope > summary').click();
      await expect(otherLot).toHaveAttribute('open', '');
      await otherLot.getByRole('button', { name: 'Open in Drive Mode' }).click();
      await expect(page.locator('body')).toHaveAttribute('data-qa-drive-target', 'H.06.000|27.F1');

      const layout = await panel.evaluate((root) => {
        const mobileView = root.querySelector('.item-inquiry-mobile-view') as HTMLElement;
        const workspace = root.querySelector('.item-inquiry-mobile-workspace') as HTMLElement;
        const nav = document.querySelector('#bottom-nav') as HTMLElement;
        const content = document.querySelector('#det-item-inquiry-content') as HTMLElement;
        const summary = document.querySelector('#det-mobile-tab-select-wrap') as HTMLElement;
        const reportOverflowers = Array.from(root.querySelectorAll('.item-inquiry-mobile-view, .item-inquiry-mobile-workspace, .item-inquiry-mobile-seasons, .item-inquiry-mobile-locations, .item-inquiry-mobile-location-body, .item-inquiry-mobile-lot-body'))
          .filter((element) => (element as HTMLElement).scrollWidth > (element as HTMLElement).clientWidth + 1)
          .map((element) => (element as HTMLElement).className);
        const nestedVerticalScrollers = Array.from(root.querySelectorAll('.item-inquiry-mobile-workspace *'))
          .filter((element) => {
            const node = element as HTMLElement;
            const overflowY = getComputedStyle(node).overflowY;
            return node.scrollHeight > node.clientHeight + 1 && ['auto', 'scroll'].includes(overflowY);
          })
          .map((element) => (element as HTMLElement).className);
        const wrappedText = Array.from(root.querySelectorAll('.item-inquiry-mobile-hold strong, .item-inquiry-mobile-lot-field strong')) as HTMLElement[];
        return {
          documentOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          reportOverflowers,
          nestedVerticalScrollers,
          mobileOverflowX: getComputedStyle(mobileView).overflowX,
          mobileOverflowY: getComputedStyle(mobileView).overflowY,
          mobileScrollable: mobileView.scrollHeight > mobileView.clientHeight,
          workspaceWidth: workspace.getBoundingClientRect().width,
          contentBottom: content.getBoundingClientRect().bottom,
          navTop: nav.getBoundingClientRect().top,
          selectorWidth: summary.getBoundingClientRect().width,
          selectorRight: summary.getBoundingClientRect().right,
          smallestWrappedFont: Math.min(...wrappedText.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))),
          clippedWrappedText: wrappedText.some((node) => node.scrollWidth > node.clientWidth + 1),
        };
      });
      expect(layout.documentOverflowX, `${theme} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
      expect(layout.reportOverflowers).toEqual([]);
      expect(layout.nestedVerticalScrollers).toEqual([]);
      expect(layout.mobileOverflowX).toBe('hidden');
      expect(layout.mobileOverflowY).toBe('auto');
      expect(layout.mobileScrollable).toBe(true);
      expect(layout.workspaceWidth).toBeGreaterThan(300);
      expect(layout.contentBottom).toBeLessThanOrEqual(layout.navTop + 1);
      expect(layout.selectorWidth).toBeGreaterThan(300);
      expect(layout.selectorRight).toBeLessThanOrEqual(viewport.width + 1);
      expect(layout.smallestWrappedFont).toBeGreaterThanOrEqual(12);
      expect(layout.clippedWrappedText).toBe(false);
    }
  }
});

test('Phone Reclass editor keeps large inquiries responsive and every row editable', async ({ page }) => {
  test.setTimeout(90_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?e2e=V2026.08.24.12', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (
      typeof (window as any).ensureArgosInventoryTransactionModal === 'function'
      && typeof (window as any).renderArgosReclassInquiryEditor === 'function'
    ));
    await page.evaluate(() => {
      const longNote = 'Field review note with enough detail to verify that mobile text wraps without clipping or horizontal scrolling.';
      const model = {
        identity: {
          plantgroupcode: '130_SHRUB',
          commonname: 'Baby Gem Boxwood With A Long Descriptive Common Name',
          contsize: '3DP',
          itemcode: '001884.031.1',
          genusname: 'Buxus',
          fieldtagcolor: 'No I.D.',
          itemspec: '12-15 inches',
          pullerresponsibility: 'Shipping',
        },
        seasons: Array.from({ length: 12 }, (_, index) => ({
          saleyear: String(2028 - Math.floor(index / 4)),
          season: ['F1', 'S1', 'U2', 'Y'][index % 4],
          s_lts: String(1200 + index),
          season_supply: String(2200 + index),
          season_oh: String(2100 + index),
          season_demand: String(100 + index),
        })),
        locationRows: Array.from({ length: 41 }, (_, index) => ({
          unique_id: `row-${index}`,
          sourceRow: { ITEMCODE: '001884.031.1' },
          values: {
            lotcode: index % 2 ? '27.F1' : '26.Y',
            locationcode: `A.${String(index + 1).padStart(2, '0')}.000`,
            source: index % 2 ? 'SH' : 'LD',
            priority: String((index % 9) + 1),
            desigitem: '',
            desigcust: '',
            desigloc: '',
            ptronhand: String(100 + index),
            ptrreviewed: String(index),
            ptravailable: String(100),
            locationnotedate: '8/22/2026, 2:15:00 PM',
            locationnote: index === 0 ? longNote : '',
            pulltagnote1: index === 0 ? longNote : '',
            pulltagnote2: '',
            locationptn1: index === 0 ? longNote : '',
            locationptn2: '',
            holdstopcode: index === 0 ? 'H' : '',
            holdstopreason: index === 0 ? longNote : '',
          },
        })),
      };
      (window as any).__reclassResponsiveModel = model;
      (window as any).eval('argosInventoryTransactionState = { inquiryModel: window.__reclassResponsiveModel };');
      const modal = (window as any).ensureArgosInventoryTransactionModal();
      modal.querySelector('#argos-reclass-item-inquiry').innerHTML = (window as any).renderArgosReclassInquiryEditor(model, 'row-0');
      modal.classList.remove('hidden');
    });

    const modal = page.locator('#argos-inventory-transaction-modal');
    const cards = modal.locator('[data-reclass-row-card]');
    const origin = modal.locator('[data-reclass-row-card="row-0"]');
    const second = modal.locator('[data-reclass-row-card="row-1"]');
    await expect(modal).toBeVisible();
    await expect(cards).toHaveCount(41);
    await expect(origin).toHaveAttribute('data-reclass-row-expanded', 'true');
    await expect(origin.locator('[data-reclass-row-hydrated="true"]')).toHaveCount(1);
    await expect(second).toHaveAttribute('data-reclass-row-expanded', 'false');
    await expect(second.locator('[data-reclass-row-hydrated="false"]')).toHaveCount(1);
    await expect(second.locator('[data-reclass-field]')).toHaveCount(0);

    await second.locator('.argos-reclass-row-toggle').click();
    await expect(second).toHaveAttribute('data-reclass-row-expanded', 'true');
    await expect(second.locator('[data-reclass-row-hydrated="true"]')).toHaveCount(1);
    const secondNote = second.locator('[data-reclass-field="locationnote"]');
    await secondNote.fill('Mobile draft is preserved');
    await second.locator('.argos-reclass-row-toggle').click();
    await expect(second).toHaveAttribute('data-reclass-row-expanded', 'false');
    await second.locator('.argos-reclass-row-toggle').click();
    await expect(secondNote).toHaveValue('Mobile draft is preserved');

    const overlays = await page.evaluate(() => (window as any).eval('collectArgosReclassInquiryOverlays()'));
    expect(overlays).toHaveLength(41);
    expect(overlays[1].values.locationnote).toBe('Mobile draft is preserved');
    expect(overlays[40].values.ptronhand).toBe('140');

    const layout = await modal.evaluate((root) => {
      const panel = root.querySelector('.argos-tx-panel') as HTMLElement;
      const body = root.querySelector('.argos-tx-body') as HTMLElement;
      const footer = root.querySelector('.argos-tx-footer') as HTMLElement;
      const visibleInputs = Array.from(root.querySelectorAll('.argos-reclass-row-card[data-reclass-row-expanded="true"] .argos-reclass-row-input')) as HTMLElement[];
      const overflowers = Array.from(root.querySelectorAll('.argos-tx-panel, .argos-tx-body, .argos-tx-form, .argos-reclass-inquiry, .argos-reclass-row-list, .argos-reclass-row-card, .argos-reclass-row-grid'))
        .filter((element) => (element as HTMLElement).scrollWidth > (element as HTMLElement).clientWidth + 1)
        .map((element) => (element as HTMLElement).className);
      const panelRect = panel.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        documentOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        overflowers,
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        bodyOverflowY: getComputedStyle(body).overflowY,
        bodyBottom: bodyRect.bottom,
        footerTop: footerRect.top,
        footerBottom: footerRect.bottom,
        minInputHeight: Math.min(...visibleInputs.map((input) => input.getBoundingClientRect().height)),
        minInputFont: Math.min(...visibleInputs.map((input) => Number.parseFloat(getComputedStyle(input).fontSize))),
        clippedInput: visibleInputs.some((input) => {
          const rect = input.getBoundingClientRect();
          return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1;
        }),
      };
    });
    expect(layout.documentOverflowX, `${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(0);
    expect(layout.overflowers).toEqual([]);
    expect(layout.panelLeft).toBeGreaterThanOrEqual(-1);
    expect(layout.panelRight).toBeLessThanOrEqual(viewport.width + 1);
    expect(layout.panelTop).toBeGreaterThanOrEqual(-1);
    expect(layout.panelBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.bodyScrollable).toBe(true);
    expect(layout.bodyOverflowY).toBe('auto');
    expect(layout.bodyBottom).toBeLessThanOrEqual(layout.footerTop + 1);
    expect(layout.footerBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(layout.minInputHeight).toBeGreaterThanOrEqual(44);
    expect(layout.minInputFont).toBeGreaterThanOrEqual(16);
    expect(layout.clippedInput).toBe(false);
  }
});

test('Drive Grid is a readable spreadsheet and every control stays on one rail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?view=drive&display=grid&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.drive-grid-table')).toHaveCount(0);
  await expect(page.locator('#drive-content .inv-card')).toHaveCount(4);
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeDisabled();
  await expect(page.locator('button[data-ops-display-mode="cards"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#ops-display-note')).toContainText('Cards are always used on phones');

  for (const viewport of [{ width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=drive&display=grid&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.drive-grid-table')).toBeVisible();
    await expect(page.locator('.drive-grid-table thead')).toBeVisible();
    await expect(page.locator('.drive-grid-header-row > th')).toHaveCount(14);
    await expect(page.locator('.drive-grid-filter-row [data-drive-grid-filter]')).toHaveCount(14);
    await expect(page.getByLabel('Filter Common Name')).toBeVisible();
    await page.getByLabel('Filter Common Name').fill('Baby Gem');
    await expect(page.locator('.drive-grid-table tbody > tr:not([hidden])')).toHaveCount(1);
    await expect(page.locator('.drive-grid-visible-count')).toHaveText('1 of 4 rows');
    await page.getByRole('button', { name: 'Clear column filters' }).click();
    await expect(page.locator('.drive-grid-table tbody > tr:not([hidden])')).toHaveCount(4);
    const gridState = await page.locator('.drive-grid-sheet').evaluate((sheet) => {
      const cells = Array.from(sheet.querySelectorAll('tbody :is(th,td)')) as HTMLElement[];
      return {
        sheetWidth: sheet.getBoundingClientRect().width,
        tableWidth: sheet.querySelector('table')!.getBoundingClientRect().width,
        narrowestCell: Math.min(...cells.map((cell) => cell.getBoundingClientRect().width)),
        verticalWords: cells.some((cell) => getComputedStyle(cell).wordBreak === 'break-all'),
      };
    });
    expect(gridState.sheetWidth).toBeLessThanOrEqual(viewport.width);
    expect(gridState.tableWidth).toBeGreaterThanOrEqual(gridState.sheetWidth - 3);
    expect(gridState.narrowestCell).toBeGreaterThan(30);
    expect(gridState.verticalWords).toBe(false);

    const railState = await page.locator('#drive-toolbar-rail').evaluate((rail) => {
      const controls = Array.from(rail.querySelectorAll('.task-tab,.task-top-control-shell,.drive-mode-export-button,.drive-filter-reset-button')) as HTMLElement[];
      const tops = controls.filter((control) => control.offsetWidth).map((control) => Math.round(control.getBoundingClientRect().top));
      return {
        topSpread: Math.max(...tops) - Math.min(...tops),
        scrollable: rail.scrollWidth >= rail.clientWidth,
      };
    });
    expect(railState.topSpread).toBeLessThanOrEqual(2);
    expect(railState.scrollable).toBe(true);
  }
  await expect(page.getByText('Season Sales Notes', { exact: true })).toHaveCount(0);
});

test('Request detail fits the visible shell without outer scrolling or hidden actions', async ({ page }) => {
  const viewports = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=detail&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#view-detail')).toBeVisible();
    await expect(page.locator('#req-spec')).toBeVisible();
    await expect(page.locator('#req-comments')).toBeVisible();
    await expect(page.locator('#req-btn-save-complete')).toBeVisible();
    await expect(page.locator('#req-shear-action')).toBeVisible();
    await expect(page.locator('#req-matching-inventory-container')).toHaveAttribute('aria-expanded', 'false');

    const state = await page.locator('#view-detail').evaluate((detail) => {
      const main = document.getElementById('main-scroll-area')!;
      const nav = document.getElementById('bottom-nav')!;
      const form = document.getElementById('det-request-content')!;
      const summary = detail.querySelector(':scope > .freeze-panel') as HTMLElement;
      const save = document.getElementById('req-btn-save-complete')!;
      const shear = document.getElementById('req-shear-action')!;
      const rect = (element: Element) => element.getBoundingClientRect();
      return {
        outerScroll: main.scrollHeight - main.clientHeight,
        horizontalOverflow: main.scrollWidth - main.clientWidth,
        detailTop: rect(detail).top,
        detailBottom: rect(detail).bottom,
        navTop: rect(nav).top,
        formVisible: rect(form).height > 0 && rect(form).bottom <= rect(nav).top + 1,
        summaryVisible: rect(summary).height > 0,
        saveVisible: rect(save).top >= rect(form).top && rect(save).bottom <= rect(nav).top + 1,
        shearVisible: rect(shear).top >= rect(form).top && rect(shear).bottom <= rect(nav).top + 1,
        columns: getComputedStyle(detail).gridTemplateColumns.split(' ').length,
      };
    });
    expect(state.outerScroll, `${viewport.width}x${viewport.height}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(2);
    expect(state.horizontalOverflow).toBeLessThanOrEqual(2);
    expect(state.detailBottom, `${viewport.width}x${viewport.height}: ${JSON.stringify(state)}`).toBeLessThanOrEqual(state.navTop + 1);
    expect(state.formVisible).toBe(true);
    expect(state.summaryVisible).toBe(true);
    expect(state.saveVisible).toBe(true);
    expect(state.shearVisible).toBe(true);
    expect(state.columns).toBe(viewport.width >= 900 ? 2 : 1);
  }
});

test('module filters sit below the command search with responsive breathing room', async ({ page }) => {
  const cases = [
    { width: 390, height: 844, minGap: 20, maxGap: 44 },
    { width: 768, height: 1024, minGap: 42, maxGap: 62 },
    { width: 1366, height: 768, minGap: 68, maxGap: 98 },
    { width: 1920, height: 1080, minGap: 84, maxGap: 120 },
  ];
  for (const viewport of cases) {
    await page.setViewportSize(viewport);
    await page.goto(`${fixtureUrl}?view=drive&theme=dark&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await page.locator('#side-drawer').evaluate((drawer) => { (drawer as HTMLElement).style.display = 'none'; });
    await page.locator('#fixture-layout').evaluate((layout) => { (layout as HTMLElement).style.gridTemplateColumns = 'minmax(0, 1fr)'; });
    const spacing = await page.locator('#view-drive .ops-module-filter-band').evaluate((rail) => {
      const search = document.getElementById('global-header-search-row')!;
      const searchRect = search.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      const gapToken = Number.parseFloat(getComputedStyle(rail).marginTop);
      return {
        gap: Math.round((railRect.top - searchRect.bottom) * 100) / 100,
        gapToken,
        railTop: railRect.top,
        searchBottom: searchRect.bottom,
      };
    });
    expect(spacing.railTop, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeGreaterThan(spacing.searchBottom);
    expect(spacing.gapToken).toBeGreaterThan(0);
    expect(spacing.gap, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeGreaterThanOrEqual(viewport.minGap);
    expect(spacing.gap, `${viewport.width}x${viewport.height}: ${JSON.stringify(spacing)}`).toBeLessThanOrEqual(viewport.maxGap);
  }
});

test('light and dark navigation use explicit semantic fallback colors', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(`${fixtureUrl}?view=drive&theme=${theme}&monitoring=0`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('body').getAttribute('data-ops-theme')).toBe(theme);
    await expect.poll(() => page.locator('#bottom-nav').getAttribute('data-resolved-theme')).toBe(theme);
    await page.locator('body').evaluate((body) => body.removeAttribute('data-ops-theme'));
    const navState = await page.locator('#bottom-nav').evaluate((nav) => {
      const toRgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const channels = toRgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const contrast = (foreground: string, background: string) => {
        const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const inactive = nav.querySelector('.footer-nav-btn:not(.active)') as HTMLElement;
      const active = nav.querySelector('.footer-nav-btn.active') as HTMLElement;
      const label = inactive.querySelector('span') as HTMLElement;
      const navStyle = getComputedStyle(nav);
      const inactiveStyle = getComputedStyle(inactive);
      const activeStyle = getComputedStyle(active);
      return {
        background: navStyle.backgroundColor,
        border: navStyle.borderTopColor,
        inactiveColor: inactiveStyle.color,
        activeColor: activeStyle.color,
        activeBackground: activeStyle.backgroundColor,
        inactiveContrast: contrast(inactiveStyle.color, navStyle.backgroundColor),
        activeContrast: contrast(activeStyle.color, activeStyle.backgroundColor),
        labelOpacity: getComputedStyle(label).opacity,
        resolvedTheme: (nav as HTMLElement).dataset.resolvedTheme,
      };
    });
    expect(navState.background).toBe(theme === 'dark' ? 'rgb(11, 28, 22)' : 'rgb(255, 255, 255)');
    expect(navState.border).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
    expect(navState.inactiveContrast).toBeGreaterThanOrEqual(4.5);
    expect(navState.activeContrast).toBeGreaterThanOrEqual(4.5);
    expect(navState.activeBackground).not.toBe(navState.background);
    expect(navState.labelOpacity).toBe('1');
    expect(navState.resolvedTheme).toBe(theme);
  }
});

test('anonymous monitoring activates for non-Dylan sessions without PII', async ({ page }) => {
  await page.goto(`${fixtureUrl}?pilot=0&monitoring=1&theme=dark`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('body').getAttribute('data-qa-ready')).toBe('true');
  expect(await page.locator('body').getAttribute('data-qa-sentry-pii')).toBe('false');
  expect(await page.locator('body').getAttribute('data-qa-error-sample')).toBe('1');
  expect(await page.locator('body').getAttribute('data-qa-trace-sample')).toBe('0.1');
  const payload = String(await page.locator('body').getAttribute('data-qa-monitoring-events'));
  expect(payload).not.toContain('dylan_collyge');
  expect(payload).not.toContain('private note');
  expect(payload).not.toContain('ABC-123456');
});

test('non-Dylan users receive Appearance controls with phone-safe Grid behavior', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixtureUrl}?pilot=1&monitoring=0&theme=light&display=cards&reset=1`, { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('body').getAttribute('data-qa-ready')).toBe('true');
  await expect(page.locator('#ops-pilot-settings')).toBeVisible();
  await expect(page.locator('button[data-ops-theme-mode="light"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeDisabled();
  await page.locator('button[data-ops-theme-mode="dark"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-ops-theme', 'dark');

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.locator('button[data-ops-display-mode="grid"]')).toBeEnabled();
  await page.locator('button[data-ops-display-mode="grid"]').click();
  await expect(page.locator('body')).toHaveClass(/ops-grid-effective/);
});
