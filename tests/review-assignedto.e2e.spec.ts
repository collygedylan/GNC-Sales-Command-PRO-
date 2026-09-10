import { expect, test, type Page } from '@playwright/test';

async function prepareAssignedToReview(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  // Use the generated runtime and extracted styles. The shell builder leaves
  // unchanged assets in the repository, so serve those from their root.
  await page.route('**/_site/**', async route => {
    const url = new URL(route.request().url());
    const builtAsset = /\/(live-app-runtime-|live-app-styles-|live-sync-(registry|adapters|coordinator)\.js)/.test(url.pathname);
    const builtDocument = url.pathname === '/_site/' || url.pathname === '/_site/index.html';
    await route.continue(builtAsset || builtDocument ? {} : { url: url.toString().replace('/_site/', '/') });
  });
  await page.goto('/_site/?e2e=review-assignedto&post_deploy_access_canary=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).openEvalWorkSetupFromReclass === 'function');
  await page.evaluate(() => window.eval(`(() => {
    installMutationBlockedAccessCanaryIdentity('dylan_collyge', 'Dylan Collyge', 'ADMIN');
    isEvalWorkManagerUser = () => true;
    ensureAssignableAppUsers = async () => [];
    assignableAppUsersLoaded = true;
    const options = [
      { username:'josh_vann', display:'Josh Vann', email:'josh@example.test' },
      { username:'jorge_colunga', display:'Jorge Colunga', email:'jorge@example.test' },
      { username:'sharon_combs', display:'Sharon Combs', email:'sharon@example.test' }
    ];
    getAssignableAppUserOptions = () => options;
    resolveRequestRecipientEmail = value => options.find(user => user.username === value || user.email === value)?.email || value;
    argosInventoryTransactionState = {
      idempotencyToken:'review-browser-token-0001',
      snapshot:{ commonName:'Synthetic Review Item', itemCode:'TEST.001', contSize:'#3', uniqueId:'review-origin', locationCode:'A.01.001', lotCode:'27.F1' },
      item:{ UNIQUE_ID:'review-origin', ITEMCODE:'TEST.001', GENUSNAME:'Rosa', COMMONNAME:'Synthetic Review Item', CONTSIZE:'#3', LOCATIONCODE:'A.01.001', LOTCODE:'27.F1', ASSIGNEDTO:'stale_client_user' }
    };
    const source = { unique_id:'review-origin', source_table:'ph_master_inventory', itemcode:'TEST.001', locationcode:'A.01.001', lotcode:'27.F1' };
    window.__review = {
      setup:{ source, evaluator:{username:'josh_vann',displayName:'Josh Vann',email:'josh@example.test'}, assignmentRevision:'assignment-josh-1', completionRecipients:['josh@example.test'], completionRecipientNames:['Josh Vann'] },
      calls:[], confirmations:[], toasts:[], pending:[], setupError:null, createError:null, deferSetup:false,
      inquiry:{ type:'reclass_inquiry_email', source, transaction:{ requestActions:[],holdStopProposals:[] }, rowOverlays:[{ unique_id:'review-origin',proposals:[{action:'recount',quantity:17}] }] }
    };
    buildEvalWorkSetupInquiry = () => structuredClone(window.__review.inquiry);
    const realConfirm = showAppConfirm;
    showAppConfirm = async (message, options) => {
      window.__review.confirmations.push({message,options});
      return realConfirm(message, options);
    };
    showToast = (...args) => window.__review.toasts.push(args);
    syncRequestTabButtons = () => {};
    postAppFunctionJson = async (url, payload, options) => {
      if (payload.action !== 'eval_work') throw new Error('Unexpected protected action: ' + payload.action);
      const operation = payload.operation;
      const fixture = window.__review;
      fixture.calls.push({ operation, payload:structuredClone(payload), options });
      if (operation === 'review_setup') {
        if (fixture.deferSetup) return new Promise(resolve => fixture.pending.push({resolve,payload}));
        if (fixture.setupError) return {ok:false,error:fixture.setupError.message,code:fixture.setupError.code};
        return {ok:true,setup:structuredClone(fixture.setup)};
      }
      if (operation === 'create') {
        if (fixture.createError) return {ok:false,error:fixture.createError.message,code:fixture.createError.code};
        return {ok:true,data:{id:'created-review',contract_version:'eval-work-v1',itemcode:'TEST.001',origin_unique_id:'review-origin',assignee_username:fixture.setup.evaluator.username,completion_recipients:[fixture.setup.evaluator.email,...payload.additionalCompletionRecipients]}};
      }
      throw new Error('Unexpected review operation: ' + operation);
    };
  })()`));
}

async function openAssignedToReview(page: Page) {
  await page.evaluate(() => window.eval('openEvalWorkSetupFromReclass()'));
  await expect(page.locator('#eval-work-setup-modal')).toBeVisible();
}

async function confirmAssignedToReview(page: Page) {
  await page.locator('#eval-work-setup-create').click();
  const prompt = page.locator('#app-prompt-dialog');
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Assign Review', exact: true }).click();
}

for (const width of [390, 1280]) {
  test(`Reclass AssignedTo review fixes the evaluator and required recipient at ${width}px`, async ({ page }) => {
    await prepareAssignedToReview(page, width);
    await openAssignedToReview(page);
    const modal = page.locator('#eval-work-setup-modal');
    await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('Josh Vann');
    await expect(page.locator('#eval-work-setup-required-recipient')).toContainText('Josh Vann');
    await expect(page.locator('#eval-work-setup-assignee-button')).toHaveCount(0);
    await expect(modal.getByRole('button', { name: /select evaluator|choose evaluator/i })).toHaveCount(0);
    await expect(page.locator('#eval-work-setup-create')).toBeEnabled();
    await expect(page.locator('#eval-work-setup-recipient-copy')).toContainText('No additional recipients');
    expect(await modal.locator('.eval-work-setup-panel').evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    await page.locator('#eval-work-setup-instructions').fill('Verify the current location.');
    await confirmAssignedToReview(page);
    await expect(modal).toBeHidden();
    const calls = await page.evaluate(() => (window as any).__review.calls);
    expect(calls.map((call: any) => call.operation)).toEqual(['review_setup', 'create']);
    expect(calls[0].payload.source.unique_id).toBe('review-origin');
    expect(calls[1].payload).toMatchObject({
      source:{unique_id:'review-origin',itemcode:'TEST.001'},
      expectedAssignmentRevision:'assignment-josh-1',
      additionalCompletionRecipients:[],
      instructions:'Verify the current location.',
      inquiry:{rowOverlays:[{unique_id:'review-origin',proposals:[{action:'recount',quantity:17}]}]}
    });
    expect(calls[1].payload).not.toHaveProperty('assigneeUsernames');
    expect(calls[1].payload).not.toHaveProperty('assigneeUsername');
    expect(calls[1].payload).not.toHaveProperty('completionRecipients');
  });
}

test('Reclass AssignedTo review deduplicates optional recipients without making the required evaluator removable', async ({ page }) => {
  await prepareAssignedToReview(page);
  await openAssignedToReview(page);
  await page.evaluate(() => window.eval(`(() => {
    openGroupedBloomNcrRecipientModal = async (items, selected, options) => {
      window.__review.picker = {selected,options};
      return ['JOSH@example.test','sharon@example.test','SHARON@example.test'];
    };
  })()`));
  await page.locator('#eval-work-setup-recipient-button').click();
  await expect(page.locator('#eval-work-setup-required-recipient')).toContainText('Josh Vann');
  await expect(page.locator('#eval-work-setup-recipient-copy')).toContainText('Sharon');
  const extras = await page.evaluate(() => window.eval('evalWorkSetupState.additionalCompletionRecipients'));
  expect(extras).toEqual(['sharon@example.test']);
  await confirmAssignedToReview(page);
  await expect(page.locator('#eval-work-setup-modal')).toBeHidden();
  const payload = await page.evaluate(() => (window as any).__review.calls.find((call: any) => call.operation === 'create').payload);
  expect(payload.additionalCompletionRecipients).toEqual(['sharon@example.test']);
});

test('Reclass AssignedTo review preserves instructions, recipients, and proposals after a create failure', async ({ page }) => {
  await prepareAssignedToReview(page);
  await openAssignedToReview(page);
  await page.locator('#eval-work-setup-instructions').fill('Keep this note while retrying.');
  await page.evaluate(() => window.eval(`(() => {
    evalWorkSetupState.additionalCompletionRecipients = ['sharon@example.test'];
    window.__review.createError = {code:'TEMPORARY_UNAVAILABLE',message:'The server is temporarily unavailable.'};
    syncEvalWorkSetupSummary();
  })()`));
  await confirmAssignedToReview(page);
  await expect(page.locator('#eval-work-setup-create')).toBeEnabled();
  await expect(page.locator('#eval-work-setup-modal')).toBeVisible();
  await expect(page.locator('#eval-work-setup-instructions')).toHaveValue('Keep this note while retrying.');
  expect(await page.evaluate(() => window.eval('evalWorkSetupState.additionalCompletionRecipients'))).toEqual(['sharon@example.test']);
  expect(await page.evaluate(() => (window as any).__review.inquiry.rowOverlays[0].proposals)).toEqual([{action:'recount',quantity:17}]);
  expect(await page.evaluate(() => (window as any).__review.calls.filter((call: any) => call.operation === 'create').length)).toBe(1);
});

test('Reclass AssignedTo review refreshes a changed assignment and requires another explicit confirmation', async ({ page }) => {
  await prepareAssignedToReview(page);
  await openAssignedToReview(page);
  await page.locator('#eval-work-setup-instructions').fill('Preserve this review instruction.');
  await page.evaluate(() => window.eval(`(() => {
    evalWorkSetupState.additionalCompletionRecipients = ['sharon@example.test'];
    window.__review.setup.evaluator = {username:'jorge_colunga',displayName:'Jorge Colunga',email:'jorge@example.test'};
    window.__review.setup.assignmentRevision = 'assignment-jorge-2';
    window.__review.setup.completionRecipients = ['jorge@example.test'];
    window.__review.setup.completionRecipientNames = ['Jorge Colunga'];
    window.__review.createError = {code:'REVIEW_ASSIGNMENT_CHANGED',message:'AssignedTo changed. Review the current evaluator.'};
    syncEvalWorkSetupSummary();
  })()`));
  await confirmAssignedToReview(page);
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('Jorge Colunga');
  await expect(page.locator('#eval-work-setup-required-recipient')).toContainText('Jorge Colunga');
  await expect(page.locator('#eval-work-setup-instructions')).toHaveValue('Preserve this review instruction.');
  await expect(page.locator('#eval-work-setup-status')).toContainText(/changed/i);
  await expect(page.locator('#app-prompt-dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__review.calls.map((call: any) => call.operation))).toEqual(['review_setup','create','review_setup']);
  await page.evaluate(() => { (window as any).__review.createError = null; });
  await confirmAssignedToReview(page);
  await expect(page.locator('#eval-work-setup-modal')).toBeHidden();
  const result = await page.evaluate(() => ({
    calls:(window as any).__review.calls.filter((call: any) => call.operation === 'create'),
    confirmations:(window as any).__review.confirmations
  }));
  expect(result.confirmations).toHaveLength(2);
  expect(result.confirmations[1].message).toContain('Jorge');
  expect(result.calls[1].payload).toMatchObject({expectedAssignmentRevision:'assignment-jorge-2',additionalCompletionRecipients:['sharon@example.test'],instructions:'Preserve this review instruction.'});
});

test('Reclass AssignedTo review blocks unavailable assignments and retains entered instructions through retry', async ({ page }) => {
  await prepareAssignedToReview(page);
  await page.evaluate(() => { (window as any).__review.setupError = {code:'REVIEW_ASSIGNMENT_UNAVAILABLE',message:'AssignedTo has no active evaluator with an email address.'}; });
  await openAssignedToReview(page);
  await expect(page.locator('#eval-work-setup-create')).toBeDisabled();
  await expect(page.locator('#eval-work-setup-status')).toContainText('AssignedTo');
  await page.locator('#eval-work-setup-instructions').fill('Retain this while assignment is repaired.');
  await page.evaluate(() => { (window as any).__review.setupError = null; });
  await page.locator('#eval-work-setup-retry').click();
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('Josh Vann');
  await expect(page.locator('#eval-work-setup-instructions')).toHaveValue('Retain this while assignment is repaired.');
  await expect(page.locator('#eval-work-setup-create')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__review.calls.some((call: any) => call.operation === 'create'))).toBe(false);
});

test('Reclass AssignedTo review ignores lookup responses after changing the source or closing setup', async ({ page }) => {
  await prepareAssignedToReview(page);
  await page.evaluate(() => window.eval(`(() => {
    window.__review.deferSetup = true;
    window.__review.firstOpen = openEvalWorkSetupFromReclass();
  })()`));
  await expect.poll(() => page.evaluate(() => (window as any).__review.pending.length)).toBe(1);
  await expect(page.locator('#eval-work-setup-create')).toBeDisabled();
  await page.evaluate(() => window.eval(`(() => {
    closeEvalWorkSetup();
    argosInventoryTransactionState = {
      ...argosInventoryTransactionState,
      idempotencyToken:'review-browser-token-0002',
      snapshot:{...argosInventoryTransactionState.snapshot,uniqueId:'review-origin-2',itemCode:'TEST.002',commonName:'Second Review Item'}
    };
    window.__review.secondOpen = openEvalWorkSetupFromReclass();
  })()`));
  await expect.poll(() => page.evaluate(() => (window as any).__review.pending.length)).toBe(2);
  await page.evaluate(() => window.eval(`(() => {
    const setup = structuredClone(window.__review.setup);
    setup.source = {...setup.source,unique_id:'review-origin-2',itemcode:'TEST.002'};
    setup.evaluator = {username:'jorge_colunga',displayName:'Jorge Colunga',email:'jorge@example.test'};
    setup.assignmentRevision = 'assignment-source-2';
    setup.completionRecipients = ['jorge@example.test'];
    setup.completionRecipientNames = ['Jorge Colunga'];
    window.__review.pending[1].resolve({ok:true,setup});
  })()`));
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('Jorge Colunga');
  await page.evaluate(() => window.eval(`(async () => {
    window.__review.pending[0].resolve({ok:true,setup:structuredClone(window.__review.setup)});
    await window.__review.firstOpen;
    await window.__review.secondOpen;
  })()`));
  await expect(page.locator('#eval-work-setup-assignee-copy')).toContainText('Jorge Colunga');
  await expect(page.locator('#eval-work-setup-identity')).toContainText('TEST.002');
  await page.evaluate(() => window.eval(`(() => {
    closeEvalWorkSetup();
    window.__review.closedOpen = openEvalWorkSetupFromReclass();
  })()`));
  await expect.poll(() => page.evaluate(() => (window as any).__review.pending.length)).toBe(3);
  await page.evaluate(() => window.eval(`(async () => {
    closeEvalWorkSetup();
    window.__review.pending[2].resolve({ok:true,setup:structuredClone(window.__review.setup)});
    await window.__review.closedOpen;
  })()`));
  await expect(page.locator('#eval-work-setup-modal')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__review.calls.some((call: any) => call.operation === 'create'))).toBe(false);
});

test('Reclass AssignedTo review displays saved completion names while preserving batch and Report #2 routing', async ({ page }) => {
  await prepareAssignedToReview(page);
  const result = await page.evaluate(() => window.eval(`(() => {
    const completionRecipients = [
      {username:'josh_vann',displayName:'Josh Vann at Assignment',email:'josh@example.test'},
      {username:'sharon_combs',displayName:'Sharon Combs at Assignment',email:'sharon@example.test'}
    ];
    const review = {
      contract_version:'eval-work-v1',
      completion_recipients:['josh@example.test','sharon@example.test'],
      source_context:{reviewAssignment:{completionRecipients}}
    };
    const batch = {contract_version:'eval-work-v2-multi-origin',source_context:{report:{sourceMode:'drive',reportId:'drive-mode'}}};
    const report2 = {contract_version:'eval-work-v2-multi-origin',source_context:{scopeContract:'itemcode-all-rows-v1',report:{sourceMode:'eval-report-2',reportId:'u1'}}};
    const batchModal = ensureManagerEvalReport2BatchSetupModal();
    return {
      review:getEvalWorkCompletionRecipientCopy(review),
      legacyUnknown:getEvalWorkCompletionRecipientCopy({contract_version:'eval-work-v1',completion_recipients:['historical@example.test']}),
      batch:getEvalWorkCompletionRecipientCopy(batch),
      report2:getEvalWorkCompletionRecipientCopy(report2,'josh_vann'),
      report2Jd:getEvalWorkCompletionRecipientCopy(report2,'jd_jones'),
      batchPickerRetained:!!batchModal.querySelector('#manager-eval2-batch-assignee-button')
    };
  })()`));
  expect(result).toEqual({
    review:'Josh Vann at Assignment, Sharon Combs at Assignment',
    legacyUnknown:'historical@example.test',
    batch:'Dylan and Megan',
    report2:'Dylan, Megan, Sharon',
    report2Jd:'Dylan, Megan, Sharon, JD',
    batchPickerRetained:true
  });
});
