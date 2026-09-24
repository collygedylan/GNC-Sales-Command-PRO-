import { expect, test } from '@playwright/test';
import { installHlOrderFixture, hlMaster } from './fixtures/hl-order-state.mjs';

test('compiled bootstrap owns lifecycle before a failed runtime and Reload aborts the old document', async ({ page, baseURL }) => {
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

test('real view and account resets fence a deferred verified read without treating token refresh as an account change', async ({ page, baseURL }) => {
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

  fixture.master.unshift(hlMaster('lifecycle-stale-master', {
    itemcode: 'LIFECYCLE.001',
    commonname: 'Lifecycle stale response',
    locationcode: 'C.99.999',
  }));
  fixture.datasetRevision++;
  fixture.holdNextBackgroundMasterRead();
  await page.evaluate(() => {
    (window as any).__lifecycleHeldCheck = (window as any).eval(
      'getProductionLiveSyncCoordinator().check("lifecycle-held-read")',
    );
  });
  await fixture.waitForHeldBackgroundMasterRead();
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
