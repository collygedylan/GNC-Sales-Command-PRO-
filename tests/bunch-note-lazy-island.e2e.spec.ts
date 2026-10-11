// @test-group: @release-functional,bunch-notes
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const repo = path.resolve('.');
const entryFile = path.join(repo, 'assets', 'bunch-note-structured.js');
const chunkDirectory = path.join(repo, 'assets', 'bunch-note-chunks');

declare global {
  interface Window {
    bunchBridgeUpdate?: () => void;
    bunchDirectionNode?: HTMLInputElement;
  }
}

async function routeCompiledEntry(context: BrowserContext, failCardChunkOnce = false) {
  const chunks = await readdir(chunkDirectory);
  let cardChunkFailures = 0;
  await context.route('**/assets/bunch-note-structured.js', async route => route.fulfill({
    contentType: 'text/javascript', body: await readFile(entryFile)
  }));
  await context.route('**/assets/bunch-note-chunks/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const name = path.basename(pathname);
    if (!chunks.includes(name)) return route.abort('failed');
    if (failCardChunkOnce && /^CardBoard-[A-Z0-9]{8}\.js$/.test(name) && cardChunkFailures === 0) {
      cardChunkFailures += 1;
      return route.abort('failed');
    }
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(chunkDirectory, name)) });
  });
  return { cardChunkFailureCount: () => cardChunkFailures };
}

async function openFixture(page: Page) {
  await page.goto('/tests/fixtures/bunch-note-lazy-island.html');
}

test('compiled Bunch island defers both views and preserves editor input through bridge revision updates', { tag: ['@release-functional'] }, async ({ page, context }) => {
  let cardRequests = 0;
  let structuredRequests = 0;
  const chunks = await readdir(chunkDirectory);
  await context.route('**/assets/bunch-note-structured.js', async route => {
    structuredRequests += 1;
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(entryFile) });
  });
  await context.route('**/assets/bunch-note-chunks/*', async route => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (!chunks.includes(name)) return route.abort('failed');
    if (/^CardBoard-[A-Z0-9]{8}\.js$/.test(name)) cardRequests += 1;
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(chunkDirectory, name)) });
  });

  await openFixture(page);
  expect(structuredRequests).toBe(0);
  expect(cardRequests).toBe(0);
  await page.evaluate(async () => {
    const api = await import('/assets/bunch-note-structured.js');
    let value: unknown = { direction: '', target_houses: '' };
    let revisionKey = 'draft-1';
    const props = () => ({ accountKey: 'test-user', revisionKey, mode: 'header', value,
      onChange(next: unknown) { value = next; handle.update(props()); } });
    const handle = api.mountStructuredBunchNote(document.querySelector('#structured-host')!, props());
    window.bunchBridgeUpdate = () => { revisionKey = 'draft-2'; handle.update(props()); };
    api.mountBunchNoteCards(document.querySelector('#cards-host')!, {
      accountKey: 'test-user', revisionKey: 'draft-2', rows: [], users: [],
      locations: [{ id: 'loc-1', location_code: 'A.1', cards: [] }]
    });
  });
  await expect(page.getByRole('group', { name: 'House and travel instructions' })).toBeVisible();
  await expect(page.locator('.bn-card-board')).toBeVisible();
  expect(structuredRequests).toBe(1);
  expect(cardRequests).toBe(1);

  const direction = page.getByLabel('Default direction');
  await expect(direction).toBeVisible();
  await direction.evaluate(element => { window.bunchDirectionNode = element as HTMLInputElement; });
  await direction.fill('West to East, keep draft');
  await page.evaluate(() => window.bunchBridgeUpdate?.());
  await expect(direction).toHaveValue('West to East, keep draft');
  expect(await direction.evaluate(element => element === window.bunchDirectionNode)).toBe(true);
});

test('compiled Bunch island recovers when the first card chunk request fails', { tag: ['@release-functional'] }, async ({ page, context }) => {
  const routeState = await routeCompiledEntry(context, true);
  await openFixture(page);
  await page.evaluate(async () => {
    const api = await import('/assets/bunch-note-structured.js');
    api.mountBunchNoteCards(document.querySelector('#cards-host')!, {
      accountKey: 'retry-user', revisionKey: 'job-1', rows: [], users: [],
      locations: [{ id: 'loc-1', location_code: 'A.1', cards: [] }]
    });
  });
  await expect(page.getByRole('alert')).toContainText('could not load');
  await page.getByRole('button', { name: 'Retry view' }).click();
  await expect(page.locator('.bn-card-board')).toBeVisible();
  expect(routeState.cardChunkFailureCount()).toBe(1);
});
