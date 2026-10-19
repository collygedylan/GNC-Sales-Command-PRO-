import { expect, test } from '@playwright/test';
import { installHlOrderFixture, hlUserId } from './fixtures/hl-order-state.mjs';

// @test-group: @bunch-note,bunch-notes

const queueCard = {
  stablecard_id: 'job-1:card-1', job_id: 'job-1', card_id: 'card-1', revision: 4, job_revision: 9,
  status: 'open', can_complete: true, itemcode: 'BN-1', variety: 'Bunch Plant', contsize: '#3',
  source_location: 'D.05.000', lot: '', ptravailable: 18, action: 'Move', destination: 'D.06.000', notes: 'Keep lots separate',
  assignees: [{ id: hlUserId, username: 'dylan_collyge', display_name: 'Dylan' }],
  sources: [
    { row_id: 'row-1', location: 'D.05.000', lot: 'LOT-A', ptravailable: 8, actual_qty: null },
    { row_id: 'row-2', location: 'D.05.000', lot: 'LOT-B', ptravailable: 10, actual_qty: null },
  ],
};
const reviewSources = queueCard.sources;
const initialReview = {
  id: 'review-1', revision: 3, status: 'needs_review', job_id: 'job-1', card_id: 'card-1', itemcode: 'BN-1',
  variety: 'Bunch Plant', contsize: '#3', source_location: 'D.05.000', destination: 'D.06.000',
  completed_by: 'Dylan', actual_qty: 11, ptravailable: 8, variance: 3,
  assigned_counter_id: null, assigned_counter_username: null, can_assign: true, can_complete: false, sources: reviewSources,
};

async function installQueueFixture(page: any, baseURL: string, options: { worker?: boolean; failFirstCompletion?: boolean; largeQueue?: boolean; startEmpty?: boolean } = {}) {
  const control = await installHlOrderFixture(page, baseURL, { username: options.worker ? 'bn_worker' : 'dylan_collyge', role: options.worker ? 'EVAL' : 'ADMIN' });
  const headers = { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' };
  const commands: any[] = [];
  let completionFailures = options.failFirstCompletion ? 1 : 0;
  let review = initialReview;
  let publishedCard: any = null, draftBody: any = null;
  await page.route('**/functions/v1/app-api', async (route: any) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    if (body?.action === 'bunch_note') {
      commands.push(body);
      const payload = body.payload || {};
      let data: any;
      switch (body.operation) {
        case 'blocks': data = { blocks: ['D'] }; break;
        case 'directory': data = { users: [{ id: hlUserId, username: 'dylan_collyge', display: 'Dylan', email: 'dylan_collyge@greenleafnursery.com' }] }; break;
        case 'drafts': data = { drafts: [] }; break;
        case 'catalog': data = { options: [], locations: ['D.05.000'] }; break;
        case 'inventory': data = { rows: [{ unique_id: 'source-1', blockalpha: 'D', locationcode: 'D.05.000', itemcode: 'BN-1', commonname: 'Bunch Plant', contsize: '#3', lotcode: 'LOT-A', stock: '10', review: '0', available: '10' }] }; break;
        case 'save': draftBody = payload.body; data = { draft: { id: 'draft-1', revision: 1, body: draftBody } }; break;
        case 'preview': data = { preview: { id: 'preview-1', reports: draftBody?.locations || [], recipients: [] } }; break;
        case 'pdf_preview': data = { pdfs: (payload.reports || draftBody?.locations || []).map((report: any, index: number) => ({ job_id: `published-job-${index}`, filename: `BN-${index}.pdf`, base64: 'JVBERi0xLjQK' })) }; break;
        case 'publish': {
          const location = draftBody?.locations?.[0], card = location?.cards?.find((item: any) => item.kind === 'inventory');
          if (!card) throw new Error('The publish fixture requires an inventory card.');
          publishedCard = {
            ...queueCard, stablecard_id: `published-job:${card.id}`, job_id: 'published-job', card_id: card.id,
            itemcode: card.itemcode || 'BN-1', variety: card.commonname || 'Bunch Plant', contsize: card.contsize || '#3',
            source_location: location.location, action: card.workflow_action || 'Work', destination: card.destination_location || card.destination_house || '', notes: card.notes || '',
            sources: card.row_ids.map((rowId: string, index: number) => ({ row_id: rowId, location: location.location, lot: `LOT-${index + 1}`, ptravailable: 10, actual_qty: null })),
            assignees: [],
          };
          data = { published: true, job_id: 'published-job' };
          break;
        }
        default: throw new Error(`Unexpected Bunch Note operation: ${body.operation}`);
      }
      await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
      return;
    }
    if (body?.action !== 'bunch_note_workflow') return route.fallback();
    commands.push(body);
    const payload = body.payload || {};
    let data: any;
    switch (body.operation) {
      case 'queue':
        if (options.largeQueue) {
          const cards = Array.from({ length: 100 }, (_, cardIndex) => ({
            ...queueCard, stablecard_id: `job-${cardIndex}:card-${cardIndex}`, job_id: `job-${cardIndex}`, card_id: `card-${cardIndex}`,
            sources: Array.from({ length: cardIndex % 2 === 0 ? 2 : 1 }, (_, sourceIndex) => ({
              row_id: `row-${cardIndex}-${sourceIndex}`, location: `D.${String(cardIndex + 1).padStart(2, '0')}.000`, lot: `LOT-${sourceIndex}`,
              ptravailable: 10, actual_qty: null,
            })),
          }));
          data = { cards, total: 10001, active_count: 10001, review_count: 0, can_review: false, counters: [] };
        } else if (options.startEmpty && !publishedCard) data = { cards: [], total: 0, active_count: 0, review_count: 0, can_review: false, counters: [] };
        else data = { cards: [publishedCard || queueCard], total: 1, active_count: 1, review_count: publishedCard ? 0 : 1, can_review: !publishedCard, counters: [] };
        break;
      case 'list_discrepancies':
        data = { reviews: [review], total: 1, review_count: 1, can_review: true, counters: [
          { id: 'worker-z', username: 'worker_z', display_name: 'Worker Z' },
          { id: 'dylan-id', username: 'dylan_collyge', display_name: 'Dylan' },
          { id: 'sharon-id', username: 'sharon_combs', display_name: 'Sharon' },
          { id: 'counter-1', username: 'counter', display_name: 'Count Team One' },
        ] };
        break;
      case 'complete_card':
        expect(body.commandId).toBeTruthy();
        expect(body.expectedRevision).toBe(queueCard.revision);
        expect(payload.actual_qty_by_row).toEqual(options.largeQueue ? { 'row-0-0': 7, 'row-0-1': 9 } : { 'row-1': 7, 'row-2': 9 });
        if (completionFailures > 0) {
          completionFailures -= 1;
          await route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'Temporary connection failure. Retry saved update.' }) });
          return;
        }
        data = { saved: true, review_created: true };
        break;
      case 'assign_counter':
        expect(payload.review_id).toBe(review.id);
        review = { ...review, revision: review.revision + 1, assigned_counter_id: typeof payload.counter_id === 'string' ? payload.counter_id : null, assigned_counter_username: typeof payload.counter_username === 'string' ? payload.counter_username : null, can_assign: false, can_complete: true };
        data = { saved: true };
        break;
      case 'complete_recount':
        expect(payload.review_id).toBe(review.id);
        expect(payload.recount_qty_by_row).toEqual({ 'row-1': 4, 'row-2': 5 });
        review = { ...review, revision: review.revision + 1, status: 'resolved', can_complete: false };
        data = { saved: true, resolved: true };
        break;
      default: throw new Error(`Unexpected Bunch queue operation: ${body.operation}`);
    }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  return { control, commands };
}

async function openQueue(page: any, category: 'bunch-notes' | 'bunch-count-review' = 'bunch-notes') {
  const press = test.info().project.use.isMobile ? 'tap' : 'click';
  await page.locator('#footer-request-btn')[press]();
  await page.locator(`[data-request-category="${category}"]`)[press]();
  await expect(page.locator('#bunch-queue-host')).toBeVisible();
}

test('Que Bunch Notes shows assigned cards and completes all source quantities', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const fixture = await installQueueFixture(page, baseURL!, { worker: true });
  await openQueue(page);
  const card = page.locator('[data-bunch-card="card-1"]');
  await expect(card).toContainText('Bunch Plant');
  await expect(card).toContainText('Assigned: Dylan');
  await expect(card).toContainText('Keep lots separate');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-1' }).fill('7');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-2' }).fill('9');
  await card.getByRole('button', { name: 'Complete Work' }).click();
  await expect(page.getByText(/Work completed|Completion queued/)).toBeVisible();
  expect(fixture.commands.filter((command: any) => command.operation === 'complete_card')).toHaveLength(1);
  expect(fixture.commands.some((command: any) => command.operation.includes('email') || command.operation === 'publish')).toBe(false);
});

test('Que Bunch Notes paginates 10,001 authorized rows as 100 cards and keeps render/mutation under 1,500 ms', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const fixture = await installQueueFixture(page, baseURL!, { worker: true, largeQueue: true });
  await openQueue(page);
  await expect(page.locator('[data-bunch-card]')).toHaveCount(100);
  const press = test.info().project.use.isMobile ? 'tap' : 'click';
  await page.locator('[data-request-category="pending"]')[press]();
  await expect(page.locator('[data-request-category="bunch-notes"]')).toBeVisible();
  await expect(page.locator('#bunch-queue-host [data-bunch-card]')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__queueRender = new Promise<number>(resolve => {
      let startedAt: number | null = null;
      const observer = new MutationObserver(() => {
        const host = document.getElementById('bunch-queue-host');
        if (startedAt !== null && host?.querySelectorAll('[data-bunch-card]').length === 100 && host.querySelectorAll('input[aria-label^="Actual Qty Completed"]').length === 150) {
          observer.disconnect();
          document.removeEventListener('click', startOnUserAction, true);
          document.removeEventListener('touchend', startOnUserAction, true);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - startedAt)));
        }
      });
      const startOnUserAction = (event: Event) => {
        const target = event.target;
        if (startedAt === null && target instanceof Element && target.closest('[data-request-category="bunch-notes"]')) startedAt = performance.now();
      };
      observer.observe(document.body, { childList: true, subtree: true });
      document.addEventListener('click', startOnUserAction, true);
      document.addEventListener('touchend', startOnUserAction, true);
    });
  });
  await page.locator('[data-request-category="bunch-notes"]')[press]();
  const elapsed = await page.evaluate(() => (window as any).__queueRender);
  expect(await page.locator('[data-bunch-card]').count()).toBe(100);
  expect(await page.locator('input[aria-label^="Actual Qty Completed"]').count()).toBe(150);
  const queueRequests = fixture.commands.filter((command: any) => command.operation === 'queue');
  expect(queueRequests[0]?.payload).toMatchObject({ filter: 'mine', offset: 0, limit: 100 });
  const mountedQueueRequest = queueRequests.find((command: any) => command.payload.filter === 'all');
  expect(mountedQueueRequest?.payload).toMatchObject({ filter: 'all', offset: 0, limit: 100 });
  expect(fixture.commands.some((command: any) => /master|hydrate|inventory/i.test(command.operation))).toBe(false);

  const card = page.locator('[data-bunch-card="card-0"]');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-0-0' }).fill('7');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-0-1' }).fill('9');
  const mutation = await page.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('[data-bunch-card="card-0"] button')].find(item => item.textContent?.includes('Complete Work'));
    if (!button) throw new Error('Complete Work button not found');
    const start = performance.now();
    (window as any).__queueMutation = new Promise<number>(resolve => {
      const observer = new MutationObserver(() => {
        const status = document.querySelector('.bq-success, .bq-error');
        if (status?.textContent?.includes('Work completed')) { observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start))); }
      });
      observer.observe(document.getElementById('bunch-queue-host')!, { childList: true, subtree: true, characterData: true });
    });
    button.click();
    return true;
  });
  expect(mutation).toBe(true);
  const mutationElapsed = await page.evaluate(() => (window as any).__queueMutation);
  expect(fixture.commands.some((command: any) => command.operation === 'queue' && command.payload.limit !== 100)).toBe(false);
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight } }));
  await test.info().attach('queue-render-and-mutation-metrics.json', {
    body: Buffer.from(JSON.stringify({
      browserProject: test.info().project.name,
      environment,
      dataset: { authorizedTotal: 10001, renderedCards: 100, renderedSourceInputs: 150, sourcesPerCard: '1–2' },
      cache: 'warm cached reopening after initial queue load',
      trace: 'off',
      osCaches: 'uncontrolled',
      operations: { cachedQueueRenderMs: elapsed, completeCardMutationMs: mutationElapsed, inclusiveLimitMs: 1500 },
    }, null, 2)),
    contentType: 'application/json',
  });
  expect(elapsed).toBeLessThanOrEqual(1500);
  expect(mutationElapsed).toBeLessThanOrEqual(1500);
});

test('Count Review assigns a recount counter then records per-source actual counts', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const fixture = await installQueueFixture(page, baseURL!);
  await openQueue(page, 'bunch-count-review');
  const card = page.locator('[data-bunch-review="review-1"]');
  await expect(card).toContainText('+3');
  await card.getByRole('combobox', { name: 'Assign Recount To review-1' }).selectOption('counter-1');
  await card.getByRole('button', { name: 'Assign Counter' }).click();
  await expect(fixture.commands.filter((command: any) => command.operation === 'assign_counter')).toHaveLength(1);
  await card.getByRole('textbox', { name: 'Recount Qty row-1' }).fill('4');
  await card.getByRole('textbox', { name: 'Recount Qty row-2' }).fill('5');
  await card.getByRole('button', { name: 'Complete Recount' }).click();
  await expect(fixture.commands.filter((command: any) => command.operation === 'complete_recount')).toHaveLength(1);
  expect(fixture.commands.some((command: any) => command.operation.includes('email') || command.operation === 'publish')).toBe(false);
});

test('Count Review offers Sharon and Dylan first and saves unmatched names as tags', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const fixture = await installQueueFixture(page, baseURL!);
  await openQueue(page, 'bunch-count-review');
  const card = page.locator('[data-bunch-review="review-1"]');
  const selector = card.getByRole('combobox', { name: 'Assign Recount To review-1' });
  await expect(selector.locator('option').nth(1)).toHaveText('Sharon');
  await expect(selector.locator('option').nth(2)).toHaveText('Dylan');
  await selector.selectOption('__custom_username__');
  await card.getByRole('textbox', { name: 'Custom Count Team username review-1' }).fill('seasonal_counter');
  await expect(card).toContainText('An unmatched name is saved as a tag; it does not create an account.');
  await card.getByRole('button', { name: 'Assign Counter' }).click();
  await expect.poll(() => fixture.commands.filter((command: any) => command.operation === 'assign_counter').length).toBe(1);
  expect(fixture.commands.find((command: any) => command.operation === 'assign_counter')?.payload).toMatchObject({ review_id: 'review-1', counter_username: 'seasonal_counter' });
  await expect(card).toContainText('Assigned counter: seasonal_counter');
});

test('offline card completion remains in the local outbox and replays the same receipt after reconnect', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const fixture = await installQueueFixture(page, baseURL!, { worker: true, failFirstCompletion: true });
  await openQueue(page);
  const card = page.locator('[data-bunch-card="card-1"]');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-1' }).fill('7');
  await card.getByRole('textbox', { name: 'Actual Qty Completed row-2' }).fill('9');
  await page.context().setOffline(true);
  await card.getByRole('button', { name: 'Complete Work' }).click();
  await expect(page.getByText(/saved update\(s\) awaiting confirmation/i)).toBeVisible();
  const saved = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(value => value.startsWith('gnc:bunch-queue:v230:') && value.endsWith(':outbox'));
    return key ? JSON.parse(localStorage.getItem(key) || '[]')[0] : null;
  });
  expect(saved?.commandId).toBeTruthy();
  await page.context().setOffline(false);
  await expect.poll(() => fixture.commands.filter((command: any) => command.operation === 'complete_card').length).toBe(1);
  await expect(page.getByText(/saved update\(s\) awaiting confirmation/i)).toBeVisible();
  await page.getByRole('button', { name: 'Retry saved updates' }).click();
  await expect.poll(() => fixture.commands.filter((command: any) => command.operation === 'complete_card').length).toBe(2);
  const retried = fixture.commands.filter((command: any) => command.operation === 'complete_card');
  expect(retried[0].commandId).toBe(saved.commandId);
  expect(retried[1].commandId).toBe(retried[0].commandId);
  expect(retried[1].payload).toEqual(retried[0].payload);
  expect(fixture.commands.some((command: any) => command.operation.includes('email') || command.operation === 'publish')).toBe(false);
});
