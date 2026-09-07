import { expect, test } from '@playwright/test';

test('Home AV and Bloom open the real, separately authenticated nursery app inside the viewport', async ({ page, baseURL }) => {
  const unexpectedRequests: string[] = [];
  const allowed = new Set([new URL(baseURL!).origin, 'https://apztnscvagayslumnalr.supabase.co']);
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !allowed.has(new URL(request.url()).origin)) unexpectedRequests.push(request.url());
  });

  await page.goto('/v2/');
  await page.getByRole('button', { name: 'AV', exact: true }).click();
  await expect(page).toHaveURL(/#partner-av$/);
  const iframe = page.locator('iframe[title="BloomScapes nursery workspace"]');
  const nursery = page.frameLocator('iframe[title="BloomScapes nursery workspace"]');
  await expect(iframe).toHaveClass(/partner-frame-ready/, { timeout: 20_000 });
  await expect(nursery.getByRole('button', { name: 'Sign in securely' })).toBeVisible();
  await expect(nursery.locator('input[type="email"]')).toBeVisible();
  await expect(page.getByText(/test profile does not grant access/)).toBeVisible();
  expect(await iframe.getAttribute('src')).toBe('partner/nursery/?embedded=1&view=av');

  const frameBounds = await iframe.boundingBox();
  const chromeBounds = await page.locator('.top-chrome').boundingBox();
  const navBounds = await page.locator('.bottom-nav-wrap').boundingBox();
  expect(frameBounds!.y).toBeGreaterThanOrEqual(chromeBounds!.y + chromeBounds!.height);
  expect(frameBounds!.y + frameBounds!.height).toBeLessThanOrEqual(navBounds!.y + 1);
  expect(frameBounds!.height).toBeGreaterThan(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.reload();
  await expect(iframe).toHaveClass(/partner-frame-ready/, { timeout: 20_000 });
  await expect(nursery.getByRole('button', { name: 'Sign in securely' })).toBeVisible();
  await page.getByRole('button', { name: 'Bloom', exact: true }).click();
  await expect(page).toHaveURL(/#bloom$/);
  await expect(iframe).toHaveAttribute('src', 'partner/nursery/?embedded=1&view=orders');
  await expect(iframe).toHaveClass(/partner-frame-ready/, { timeout: 20_000 });
  await expect(nursery.getByRole('button', { name: 'Sign in securely' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#bloom$/);
  await expect(iframe).toHaveClass(/partner-frame-ready/, { timeout: 20_000 });

  for (const name of ['Open full page', 'Storefront', 'Retailer operations']) {
    const link = page.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(iframe).toHaveCount(0);
  await expect(page).toHaveURL(/#tasks$/);
  expect(unexpectedRequests).toEqual([]);
});
