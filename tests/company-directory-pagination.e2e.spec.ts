import { expect, test, type Page } from '@playwright/test';
import { installHlOrderFixture } from './fixtures/hl-order-state.mjs';
import type { Database } from '../supabase/functions/_shared/database.types';

// @test-group: @home-role
test.use({ trace: 'off', screenshot: 'off' });

function directoryRows(count: number, generation = 1): Database['public']['Tables']['ph_company_directory_contacts']['Row'][] {
  return Array.from({ length: count }, (_, index) => ({
    id: `company-contact-${String(index + 1).padStart(5, '0')}`,
    name: `Employee ${String(index + 1).padStart(5, '0')} generation-${generation}`,
    department: `Department ${index % 12}`,
    extension: String(1000 + index),
    cell_number: `555-${String(index).padStart(4, '0')}`,
    home_number: null,
    location: `Location ${index % 100}`,
    needs_review: index % 97 === 0,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
  }));
}

async function installDirectoryApi(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin;
  let generation = 1;
  let holdNextContacts = false;
  let signalHeldContacts: (() => void) | null = null;
  let releaseHeldContacts: (() => void) | null = null;
  const heldContactsStarted = () => new Promise<void>(resolve => { signalHeldContacts = resolve; });
  const fulfill = async (route: import('@playwright/test').Route, body: unknown) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, prefer, range',
      'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/ph_company_directory_*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').at(-1);
    if (table === 'ph_company_directory_contacts') {
      if (holdNextContacts) {
        holdNextContacts = false;
        signalHeldContacts?.();
        await new Promise<void>(resolve => { releaseHeldContacts = resolve; });
      }
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
      return fulfill(route, directoryRows(10_000, generation).slice(offset, offset + limit));
    }
    return fulfill(route, []);
  });
  return {
    holdNextContacts() { holdNextContacts = true; return heldContactsStarted(); },
    releaseContacts() { const release = releaseHeldContacts; releaseHeldContacts = null; if (!release) throw new Error('DIRECTORY_READ_NOT_HELD'); release(); },
    setGeneration(value: number) { generation = value; },
  };
}

async function openCompanyDirectory(page: Page) {
  await page.locator('#footer-home-btn').click();
  await page.locator('#footer-menu-btn').click();
  await page.locator('#drawer-managers-btn').click();
  await expect(page.locator('#view-managers')).toBeVisible();
  await page.locator('#view-managers .manager-module-card').filter({ hasText: 'Company Directory' }).click();
  await expect(page.locator('#manager-company-directory-root')).toContainText('Company Directory');
  await expect(page.locator('#manager-company-directory-root tbody tr')).toHaveCount(50).catch(async error => {
    const state = await page.evaluate(() => window.eval(`JSON.stringify({
      state: { ...managerCompanyDirectoryState, contacts: managerCompanyDirectoryState.contacts.length },
      owner: getCompanyDirectoryOwner(), cache: companyDirectoryCache.peek(getCompanyDirectoryOwner())?.contacts.length,
      roots: document.querySelectorAll('#manager-company-directory-root').length
    })`));
    throw new Error(`${error.message}\nDIRECTORY_STATE: ${state}`);
  });
}

test('Company Directory keeps 10k rows responsive with stable 50-row pagination', { tag: ['@home-role'] }, async ({ page, baseURL }, info) => {
  if (!baseURL) throw new Error('The Company Directory fixture requires a base URL.');
  await installHlOrderFixture(page, baseURL, { username: 'dylan_collyge', role: 'ADMIN' });
  const api = await installDirectoryApi(page, baseURL);
  await page.goto('/');
  await openCompanyDirectory(page);

  const root = page.locator('#manager-company-directory-root');
  await expect(root).toContainText('10,000 records');
  await expect(root.locator('[aria-label="Company directory pagination"]')).toContainText('Page 1 of 200');
  await expect(root.locator('tbody tr').first()).toContainText('Employee 00001 generation-1');

  const firstRenderMs = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#manager-company-directory-root')!;
    const input = root.querySelector<HTMLInputElement>('[data-company-directory-search]')!;
    const start = performance.now();
    input.value = 'Employee 00999';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('tbody')!.getBoundingClientRect();
    return performance.now() - start;
  });
  expect(firstRenderMs).toBeLessThan(100);
  await expect(root.locator('tbody tr')).toHaveCount(1);
  await expect(root.locator('[aria-label="Company directory pagination"]')).toContainText('Page 1 of 1');

  const warmRenderMs = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#manager-company-directory-root')!;
    const input = root.querySelector<HTMLInputElement>('[data-company-directory-search]')!;
    const start = performance.now();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('tbody')!.getBoundingClientRect();
    return performance.now() - start;
  });
  expect(warmRenderMs).toBeLessThan(100);
  await expect(root.locator('tbody tr')).toHaveCount(50);
  await root.getByRole('button', { name: 'Next page' }).click();
  await expect(root.locator('[aria-label="Company directory pagination"]')).toContainText('Page 2 of 200');
  await expect(root.locator('tbody tr').first()).toContainText('Employee 00051 generation-1');
  const retainedRow = await root.locator('tbody tr').first().elementHandle();

  const held = api.holdNextContacts();
  await root.locator('[data-company-directory-refresh]').click();
  await held;
  await expect(root.locator('tbody tr')).toHaveCount(50);
  await expect(root.locator('tbody tr').first()).toContainText('Employee 00051 generation-1');
  api.setGeneration(2);
  api.releaseContacts();
  await expect(root.locator('tbody tr').first()).toContainText('Employee 00051 generation-2');
  expect(await retainedRow?.evaluate(node => node.isConnected)).toBe(true);
  const modalMs = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#manager-company-directory-root')!;
    const start = performance.now();
    root.querySelector<HTMLButtonElement>('[data-company-directory-add]')!.click();
    root.querySelector('[data-company-directory-form]')!.getBoundingClientRect();
    return performance.now() - start;
  });
  expect(modalMs).toBeLessThanOrEqual(150);
  await info.attach('directory-performance', { contentType: 'application/json', body: JSON.stringify({
    environment: info.project.name, records: 10000, pageSize: 50, networkPageSize: 1000,
    firstLocalFilterRenderMs: firstRenderMs, warmLocalFilterRenderMs: warmRenderMs, cachedModalRenderMs: modalMs,
    cache: 'Empty session cache initially; bounded network hydration completed before local interaction samples',
    retainedRow: true, networkBlockingForInteraction: false
  }) });
});
