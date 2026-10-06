import { expect, test } from '@playwright/test';

test('compiled staging shell stays synthetic, isolated and usable on mobile', async ({ page }) => {
  const externalOrigins: string[] = [];
  const productionRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost', 'collygedylan.github.io', 'apztnscvagayslumnalr.supabase.co'].includes(url.hostname)) externalOrigins.push(url.origin);
    if (/kzrnyjsosryejjejliii|agmetricapp\.com|script\.google\.com/i.test(request.url())) productionRequests.push(request.url());
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#gnc-staging-banner')).toContainText('STAGING — SYNTHETIC DATA');
  await expect(page.locator('#login-button')).toBeVisible();
  await expect(page.locator('#username-input')).toBeVisible();
  await expect(page.locator('#pin-code')).toBeVisible();
  const boundary = await page.evaluate(() => ({
    commit: JSON.parse(document.getElementById('gnc-staging-config')?.textContent || '{}').commitSha,
    policy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '',
    overflow: document.documentElement.scrollWidth > innerWidth,
    serviceWorkerPolicy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')?.includes("worker-src 'none'") || false,
  }));
  expect(boundary.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(boundary.policy).toContain('apztnscvagayslumnalr.supabase.co');
  expect(boundary.serviceWorkerPolicy).toBe(true);
  expect(boundary.overflow).toBe(false);
  expect(externalOrigins).toEqual([]);
  expect(productionRequests).toEqual([]);
});
