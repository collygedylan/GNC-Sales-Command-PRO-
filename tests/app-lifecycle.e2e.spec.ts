import { expect, test } from '@playwright/test';

import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';
// @test-group: @app-lifecycle


for (const width of [320, 390, 430]) {
  test(`AURA V2 split widget keeps draft choices and review usable at ${width}px`, {"tag":["@app-lifecycle"]}, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/aura-v2-fixture', route => route.fulfill({ contentType: 'text/html', body:
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#050806"></body>' }));
    await page.goto(`${baseURL}/aura-v2-fixture`);
    await page.evaluate(async (moduleUrl) => {
      const { mountAuraWidget } = await import(moduleUrl);
      const globals = window as any;
      globals.auraCalls = [];
      globals.auraBinds = [];
      const verifiedLine = (quantity: number) => ({ unique_id: 'lot-1', itemcode: 'SKU-L', commonname: 'Limelight',
        contsize: '3DP', locationcode: 'A.07.000', lotcode: '27.F1', ptravailable: 120, ptronhand: 140, quantity });
      globals.auraHandle = mountAuraWidget({ isAuthorized: () => true,
        resolveOrderParty: async () => ({ items: [
          { key: 'acme-north', customerName: 'Acme', consigneeName: 'North', label: 'Acme – North', customerIdentityId: 'cust-acme', consigneeIdentityId: 'cons-north' },
          { key: 'acme-south', customerName: 'Acme', consigneeName: 'South', label: 'Acme – South', customerIdentityId: 'cust-acme', consigneeIdentityId: 'cons-south' },
        ], hasMore: false }),
        bindParty: async (party: any) => {
          globals.auraBinds.push(party);
          return { partyRef: `${Date.now() + 5 * 60_000}.mock-party-signature` };
        },
        requestLlm: async (body: any) => {
          globals.auraCalls.push(body);
          return { ok: true, requestId: body.turnId, reply: 'The verified draft is ready for review.', speech: 'The verified draft is ready for review.',
            actions: [{ type: 'draft_update', lines: [verifiedLine(globals.auraCalls.length === 1 ? 50 : 75)] }] };
        },
        openDraft: async (draft: any) => { globals.auraDraft = draft; return { ok: true, message: 'Ready for manual review.' }; },
      });
    }, `${baseURL}/components/common/auraVoiceWidget.js`);
    await page.getByRole('button', { name: 'Open AURA voice assistant' }).click();
    const input = page.getByRole('textbox', { name: 'Type a command for AURA' });
    const submit = async (text: string) => { await input.fill(text); await page.getByRole('button', { name: 'Go', exact: true }).click(); };
    await submit('Start a request for Acme');
    await expect(page.getByRole('button', { name: '1. Acme – North' })).toBeVisible();
    await submit('two');
    await expect(page.locator('.aura-content > .aura-message')).toContainText('Acme – South');
    await submit('fifty three deep pee Limelight for Acme South');
    await expect(page.locator('.aura-content > .aura-message')).toContainText('Nothing has been submitted');
    await submit('twenty five three deep pee Limelight for Acme South');
    await expect(page.locator('.aura-content > .aura-message')).toContainText('Draft updated');
    const privacy = await page.evaluate(() => ({
      calls: (window as any).auraCalls,
      binds: (window as any).auraBinds,
    }));
    expect(privacy.binds).toHaveLength(1);
    expect(privacy.binds[0]).toMatchObject({ customerIdentityId: 'cust-acme', consigneeIdentityId: 'cons-south', customerName: 'Acme', consigneeName: 'South' });
    expect(privacy.calls).toHaveLength(2);
    for (const call of privacy.calls) {
      expect(call.text).not.toMatch(/Acme|South/i);
      expect(JSON.stringify(call.context)).not.toMatch(/Acme|South/i);
      expect(call.partyRef).toMatch(/^\d{13}\.mock-party-signature$/);
    }
    expect(privacy.calls[1].context.draftLines).toEqual([{ itemcode: 'SKU-L', commonname: 'Limelight', contsize: '3DP', locationcode: 'A.07.000', quantity: 50 }]);
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      buttons: Array.from(document.querySelectorAll('.aura-panel button')).filter(button => (button as HTMLElement).offsetParent !== null).map(button => {
        const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height };
      }),
      panel: document.querySelector('.aura-panel')!.getBoundingClientRect().toJSON(),
    }));
    expect(geometry.overflow).toBe(false);
    expect(geometry.panel.x).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(width);
    for (const button of geometry.buttons) { expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); }
    await page.getByRole('button', { name: 'Review request', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).auraDraft?.lines?.[0]?.quantity)).toBe(75);
    expect(await page.evaluate(() => (window as any).auraDraft.party.key)).toBe('acme-south');
    expect(await page.evaluate(() => (window as any).auraCalls.length)).toBe(2);
    await page.evaluate(() => (window as any).auraHandle.destroy());
    await expect(page.locator('[data-aura-root]')).toHaveCount(0);
  });
}

test('compiled bootstrap owns lifecycle before a failed runtime and Reload aborts the old document', {"tag":["@app-lifecycle"]}, async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, {
    username: 'lifecycle_start_admin',
    role: 'ADMIN',
    startupMode: 'cold',
    runtimeRequest: async (route: any, control: any) => control.runtimeRequests === 1
      ? route.abort('failed')
      : route.continue(),
    beforeLogin: async (control: any) => {
      await expect(page.locator('#login-runtime-status')).toHaveText('App could not load');
      await expect(page.locator('#login-button')).toBeDisabled();
      const reload = page.locator('#login-runtime-reload');
      await expect(reload).toBeVisible();
      await expect(reload).toHaveAccessibleName('Reload app');
      expect(await page.evaluate(() => {
        const owner = (window as any).AgMetricLifecycle;
        const script = document.getElementById('app-lifecycle-owner');
        if (!owner || !script || !script.textContent?.includes('installAppLifecycle')) return false;
        sessionStorage.removeItem('lifecycle-old-document-aborted');
        owner.getSignal('document').addEventListener('abort', () => {
          sessionStorage.setItem('lifecycle-old-document-aborted', 'true');
        }, { once: true });
        return (window as any).getShellMaintenanceSignal() === owner.getSignal('document')
          && (window as any).suspendShellMaintenanceForNavigation === owner.suspendNavigation
          && !document.querySelector('script[data-app-lifecycle][src]');
      })).toBe(true);
      expect(control.authTokenRequests).toBe(0);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        reload.click(),
      ]);
      expect(await page.evaluate(() => sessionStorage.getItem('lifecycle-old-document-aborted'))).toBe('true');
      await expect.poll(() => control.runtimeRequests).toBe(2);
      await expect(page.locator('#login-button')).toBeEnabled();
      await expect(page.locator('#login-runtime-reload')).toBeHidden();
      expect(await page.evaluate(() => !!(window as any).AgMetricLifecycle
        && !(window as any).AgMetricLifecycle.getSignal('document').aborted)).toBe(true);
      expect(control.authTokenRequests).toBe(0);
    },
  });
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/role-access-ready/);
  expect(fixture.authTokenRequests).toBe(1);
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});

test('real view and account resets fence a deferred verified read without treating token refresh as an account change', {"tag":["@app-lifecycle"]}, async ({ page, baseURL }) => {
  const fixture = await installHlOrderFixture(page, baseURL!, {
    username: 'dylan_collyge',
    role: 'ADMIN',
    startupMode: 'restored',
  });
  await fixture.waitForRevisionIdle();
  const initial = await page.evaluate(() => {
    const owner = (window as any).AgMetricLifecycle;
    (window as any).__lifecycleSessionSignal = owner.getSignal('session');
    (window as any).__lifecycleViewSignal = owner.getSignal('view');
    (window as any).__lifecycleSessionScope = owner.createScope({ lifetime: 'session' });
    return {
      present: !!owner,
      sessionAborted: owner.getSignal('session').aborted,
      viewAborted: owner.getSignal('view').aborted,
    };
  });
  expect(initial).toEqual({ present: true, sessionAborted: false, viewAborted: false });

  const tokenReads = fixture.authTokenRequests;
  const refreshed = await page.evaluate(async () => {
    const client = (window as any).eval('getSupabaseBrowserClient()');
    const result = await client.auth.refreshSession();
    await new Promise(resolve => setTimeout(resolve, 0));
    return {
      error: result.error?.message || '',
      sameSignal: (window as any).__lifecycleSessionSignal === (window as any).AgMetricLifecycle.getSignal('session'),
      aborted: (window as any).__lifecycleSessionSignal.aborted,
      scopeCurrent: (window as any).__lifecycleSessionScope.isCurrent(),
    };
  });
  expect(refreshed).toEqual({ error: '', sameSignal: true, aborted: false, scopeCurrent: true });
  expect(fixture.authTokenRequests).toBeGreaterThan(tokenReads);

  const viewChange = await page.evaluate(() => (window as any).eval(`(() => {
    const before = window.__lifecycleViewSignal;
    showOnlyPrimaryView('drive');
    return {
      oldViewAborted: before.aborted,
      sessionAborted: window.__lifecycleSessionSignal.aborted,
      freshView: before !== window.AgMetricLifecycle.getSignal('view')
    };
  })()`));
  expect(viewChange).toEqual({ oldViewAborted: true, sessionAborted: false, freshView: true });

  const staleRow = hlMaster('lifecycle-stale-master', {
    itemcode: 'LIFECYCLE.001',
    commonname: 'Lifecycle stale response',
    locationcode: 'C.99.999',
    last_updated: '2099-01-01T00:00:00Z',
  });
  fixture.datasetRevision++;
  // Only the held response contains this row. Any unrelated refresh sees the
  // unchanged source, so it cannot race this cancellation assertion.
  fixture.holdNextBackgroundMasterRead([staleRow, ...fixture.master]);
  await page.evaluate(() => {
    (window as any).__lifecycleHeldCheck = (window as any).eval(
      'getProductionLiveSyncCoordinator().check("lifecycle-held-read")',
    );
  });
  await fixture.waitForHeldBackgroundMasterRead();
  expect(fixture.heldMasterReadRows.some(row => row.unique_id === 'lifecycle-stale-master')).toBe(true);
  expect(await page.evaluate(() => (window as any).eval(
    `fullInventory.some(row => row.UNIQUE_ID === 'lifecycle-stale-master')`,
  ))).toBe(false);

  const reset = await page.evaluate(() => (window as any).eval(`(() => {
    const oldSession = window.__lifecycleSessionSignal;
    const oldScope = window.__lifecycleSessionScope;
    resetProductionLiveSync();
    return {
      oldSessionAborted: oldSession.aborted,
      oldScopeAborted: oldScope.signal.aborted,
      freshSession: oldSession !== window.AgMetricLifecycle.getSignal('session')
    };
  })()`));
  expect(reset).toEqual({ oldSessionAborted: true, oldScopeAborted: true, freshSession: true });
  fixture.releaseHeldBackgroundMasterRead();
  await page.evaluate(async () => {
    try { await (window as any).__lifecycleHeldCheck; } catch { /* cancellation is expected */ }
  });
  expect(await page.evaluate(() => (window as any).eval(
    `fullInventory.some(row => row.UNIQUE_ID === 'lifecycle-stale-master')`,
  ))).toBe(false);

  const identityReset = await page.evaluate(() => (window as any).eval(`(() => {
    const session = window.AgMetricLifecycle.getSignal('session');
    const scope = window.AgMetricLifecycle.createScope({ lifetime: 'session' });
    clearInMemorySessionIdentity();
    return { sessionAborted: session.aborted, scopeAborted: scope.signal.aborted };
  })()`));
  expect(identityReset).toEqual({ sessionAborted: true, scopeAborted: true });
  expect(fixture.errors).toEqual([]);
  expect(fixture.blockedMutations).toEqual([]);
});
