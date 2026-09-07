import { expect, test } from '@playwright/test';

const localOrigin = 'http://127.0.0.1:43126';
const partnerUrl = `${localOrigin}/v2/#bloom`;

test('root worker activation preserves the open AgMetric partner workspace, its caches, and native sign-in', async ({ context, page, request, browserName }) => {
  // Confirm the supplied fixture server, before allowing any browser navigation.
  const fixture = await request.get(`${localOrigin}/`);
  expect(fixture.ok()).toBe(true);
  const html = await fixture.text();
  expect(html).toContain('Local test fixture only');
  expect(html).not.toContain('<script');
  const workerResponse = await request.get(`${localOrigin}/sw.js`);
  expect(workerResponse.ok()).toBe(true);
  expect(await workerResponse.text()).toContain("const APP_SHELL_RUNTIME_REVISION = 'photo-egress-r1-scope-r1'");

  const unexpectedNetwork: string[] = [];
  const checkRequest = (url: string) => {
    if (new URL(url).origin !== localOrigin) unexpectedNetwork.push(new URL(url).origin);
  };
  context.on('request', req => checkRequest(req.url()));
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== localOrigin) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await context.addInitScript(() => {
    (window as any).__rootWorkerMessages = [];
    navigator.serviceWorker?.addEventListener('message', event => {
      if (typeof event.data?.type === 'string' && event.data.type.startsWith('GNC_')) {
        (window as any).__rootWorkerMessages.push(event.data.type);
      }
    });
  });

  await page.goto(partnerUrl);
  await expect(page.getByRole('heading', { name: 'BloomScapes orders', exact: true })).toBeVisible();
  const nursery = page.frameLocator('iframe[title="BloomScapes nursery workspace"]');
  await expect(nursery.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'serviceWorker' in navigator)).toBe(true);

  const root = await context.newPage();
  await root.goto(`${localOrigin}/index.html`);
  await expect(root.getByRole('heading', { name: 'Local test fixture only' })).toBeVisible();
  if (browserName === 'chromium') {
    // Playwright normally forces every page to appear focused. Remove that
    // Chromium automation override so the worker sees a real background client.
    const session = await context.newCDPSession(page);
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  } else {
    test.info().annotations.push({
      type: 'limitation',
      description: 'WebKit automation forces pages active/focused; actual activation/cache/message/reload isolation is tested, while inactive-client routing is covered by Chromium and the VM suite.',
    });
  }
  await root.bringToFront();
  if (browserName === 'chromium') await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
  const backgroundClientVerified = await page.evaluate(() => !document.hasFocus());

  const keep = [`gnc-v2-isolation-fixture-${browserName}`, `unrelated-isolation-fixture-${browserName}`];
  const retired = `ag-data-v4.3-rebuild-isolation-retired-${browserName}`;
  await page.evaluate(async ({ keep, retired }) => {
    for (const name of [...keep, retired]) {
      const cache = await caches.open(name);
      await cache.put('/v2/__isolation_sentinel__', new Response(`synthetic:${name}`));
    }
  }, { keep, retired });

  await root.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js?isolation-browser-test=1', {
      scope: '/', updateViaCache: 'none',
    });
    if (registration.scope !== `${location.origin}/`) throw new Error('Unexpected root worker scope');
    await navigator.serviceWorker.ready;
  });
  // Activation finishes after cleanup, claim(), and its scoped root broadcast.
  await expect.poll(() => root.evaluate(() => (window as any).__rootWorkerMessages)).toContain('GNC_SHELL_ACTIVATED');
  expect(page.url()).toBe(partnerUrl);
  await expect(nursery.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rootWorkerMessages)).toEqual([]);
  const partnerFrame = page.frames().find(frame => frame.url().includes('/v2/partner/nursery/'));
  expect(partnerFrame).toBeTruthy();
  expect(await partnerFrame!.evaluate(() => (window as any).__rootWorkerMessages)).toEqual([]);

  const cacheResult = await page.evaluate(async ({ keep, retired }) => {
    const names = await caches.keys();
    const values: Record<string, string | null> = {};
    for (const name of keep) {
      const entry = await (await caches.open(name)).match('/v2/__isolation_sentinel__');
      values[name] = entry ? await entry.text() : null;
    }
    return { names, values, retired: names.includes(retired) };
  }, { keep, retired });
  expect(cacheResult.retired).toBe(false);
  for (const name of keep) {
    expect(cacheResult.names).toContain(name);
    expect(cacheResult.values[name]).toBe(`synthetic:${name}`);
  }

  await page.reload();
  expect(page.url()).toBe(partnerUrl);
  await expect(page.getByRole('heading', { name: 'BloomScapes orders', exact: true })).toBeVisible();
  await expect(nursery.getByRole('button', { name: 'Sign in securely', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__rootWorkerMessages)).toEqual([]);
  expect(unexpectedNetwork).toEqual([]);
  await test.info().attach('worker-isolation-proof', {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      browserName, backgroundClientVerified, urlAfterReload: page.url(),
      preservedCaches: keep, retiredRootCacheRemoved: !cacheResult.retired,
      rootMessagesToPartner: [], nativeSignInVisible: true, unexpectedNetwork,
    }, null, 2)),
  });
});
