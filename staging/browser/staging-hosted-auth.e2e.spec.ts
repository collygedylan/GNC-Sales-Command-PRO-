import { expect, test } from '@playwright/test';

const username = String(process.env.TEARDOWN_STAGING_USERNAME || '').trim();
const accessCode = String(process.env.TEARDOWN_STAGING_ACCESS_CODE || '');
const appApi = 'https://apztnscvagayslumnalr.supabase.co/functions/v1/teardown-api';

async function signIn(page) {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#gnc-staging-banner')).toContainText('STAGING — SYNTHETIC DATA');
  await page.locator('#username-input').fill(username);
  await page.locator('#pin-code').fill(accessCode);
  await page.locator('#login-button').tap();
  await expect(page.locator('#view-home')).toBeVisible({ timeout: 45_000 });
}

async function openSyntheticDriveRow(page) {
  await page.locator('#footer-drive-btn').tap();
  await expect(page.locator('#view-drive')).toBeVisible();
  const card = page.locator('#drive-content [role="button"]').filter({ hasText: 'GNC Staging Red Maple' }).first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  await card.tap();
  await expect(page.locator('#view-detail')).toBeVisible();
  await page.locator('#dtab-season').tap();
  await expect(page.locator('#ssn-spec')).toBeVisible();
}

test('hosted sandbox supports Drive persistence, recoverable photo upload, captured email and push, and sign-out', async ({ page }) => {
  await page.addInitScript(() => {
    let failFirstPhoto = true;
    window.addEventListener('gnc:staging-fetch', (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const url = typeof detail?.input === 'string' ? detail.input : detail?.input?.url;
      const body = typeof detail?.init?.body === 'string' ? detail.init.body : '';
      if (body.includes('Staging persistence check')) {
        const respond = detail.respond;
        detail.respond = (value: unknown) => {
          const pending = Promise.resolve(value);
          pending.then(async (response: Response) => {
            if (!response.ok) return;
            const payload = await response.clone().json().catch(() => null);
            if (payload?.ok === false || payload?.code?.includes('FAILED')) return;
            window.dispatchEvent(new CustomEvent('staging-test-save-confirmed', { detail: { body } }));
          });
          respond(value);
        };
      }
      if (!failFirstPhoto || !String(url || '').startsWith('https://apztnscvagayslumnalr.supabase.co/functions/v1/teardown-api')
          || !(detail?.init?.body instanceof FormData)) return;
      failFirstPhoto = false;
      event.stopImmediatePropagation();
      detail.respond(new Response(JSON.stringify({ error: 'STAGING_INJECTED_PHOTO_FAILURE' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      }));
    }, { capture: true });
  });
  await signIn(page);
  await expect(page.locator('#footer-request-btn')).toBeVisible();
  await page.locator('#footer-request-btn').tap();
  await expect(page.locator('#view-request')).toContainText('GNC Staging Red Maple', { timeout: 45_000 });

  await openSyntheticDriveRow(page);
  const note = `Staging persistence check ${Date.now()}`;
  const saveConfirmed = page.evaluate((expectedNote) => new Promise<void>((resolve) => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (String(detail?.body || '').includes(expectedNote)) {
        window.removeEventListener('staging-test-save-confirmed', handler);
        resolve();
      }
    };
    window.addEventListener('staging-test-save-confirmed', handler);
  }), note);
  await page.locator('#ssn-comments').fill(note);
  await page.locator('#ssn-comments').evaluate((element: HTMLTextAreaElement) => element.blur());
  await saveConfirmed;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#view-home')).toBeVisible({ timeout: 45_000 });
  await openSyntheticDriveRow(page);
  await expect(page.locator('#ssn-comments')).toHaveValue(note, { timeout: 30_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#view-home')).toBeVisible({ timeout: 45_000 });
  await openSyntheticDriveRow(page);
  await expect(page.locator('#ssn-comments')).toHaveValue(note, { timeout: 30_000 });
  const initialPhotoCount = await page.locator('#ssn-photo-list-container img').count();
  await page.locator('#camera-btn-ssn input[type=file]').setInputFiles({
    name: 'staging-proof.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ5sAAAAASUVORK5CYII=', 'base64'),
  });
  const retryPhoto = page.getByRole('button', { name: 'Retry photo', exact: true });
  await expect(retryPhoto).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#ssn-comments')).toHaveValue(note);
  await retryPhoto.tap();
  await expect(retryPhoto).toHaveCount(0, { timeout: 45_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#view-home')).toBeVisible({ timeout: 45_000 });
  await openSyntheticDriveRow(page);
  await expect(page.locator('#ssn-comments')).toHaveValue(note, { timeout: 30_000 });
  await expect(page.locator('#ssn-photo-list-container img')).toHaveCount(initialPhotoCount + 1, { timeout: 45_000 });

  const email = await page.evaluate(async (endpoint) => {
    const result = await (window as any).postRequestEmailPayload({
      type: 'request_complete', emailType: 'request_complete', table: 'ph_active_request',
      unique_id: 'staging-request-001', customer: 'GNC Staging Test Customer',
      formattedItemsText: 'Synthetic staging email capture; no message is sent.',
    });
    return { endpoint, result };
  }, appApi);
  expect(email.endpoint).toContain('/functions/v1/teardown-api');
  expect(email.result.captured).toBe(true);
  await page.evaluate(async (endpoint) => {
    const headers = await (window as any).getNativeAuthRequestHeaders();
    const response = await (window as any).fetchWithTimeout(endpoint, {
      method: 'POST', headers, body: JSON.stringify({ operation: 'capture_delivery', collection: 'requests',
        rowId: 'staging-request-001', channel: 'push', requestId: crypto.randomUUID() }),
    }, 15_000, 'Staging push capture');
    const payload = await response.json();
    if (!response.ok || payload.state !== 'captured') throw new Error(`Staging push capture failed: ${payload.error || response.status}`);
  }, appApi);

  await page.locator('#footer-menu-btn').tap();
  await page.locator('#drawer-logout-btn').tap();
  await expect(page.locator('#login-button')).toBeVisible({ timeout: 30_000 });
});
