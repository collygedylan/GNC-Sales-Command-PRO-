import { expect, test, type Page } from '@playwright/test';
import { installHlOrderFixture, hlUserId } from './fixtures/hl-order-state.mjs';
import type { BunchPerson, BunchWorkCard } from '../components/bunch-queue/contract';

// @test-group: @bunch-note,bunch-notes

const id = (n: number) => `23200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const one: BunchPerson = { id: id(1), username: 'counter_one', display_name: 'Counter One' };
const two: BunchPerson = { id: id(2), username: 'counter_two', display_name: 'Counter Two' };
const legacy: BunchPerson = { id: id(3), username: 'legacy_owner', display_name: 'Legacy Owner' };

async function fixture(page: Page, baseURL: string, username: string, large = false) {
  await installHlOrderFixture(page, baseURL, { username, role: 'ADMIN' });
  const actor = { id: hlUserId, username, display_name: 'Dylan' };
  const assignments = [[one], [one], [one, two], [two], [two], [two], [actor], [legacy], []];
  const cards: BunchWorkCard[] = assignments.map((assignees, i) => ({
    stablecard_id: `${id(10)}:${id(20 + i)}`, job_id: id(10), card_id: id(20 + i), revision: 1, job_revision: 1,
    status: 'open', can_complete: true, itemcode: `BN-${i}`, variety: `Queue Plant ${i}`, contsize: '#1',
    source_location: 'D.05.000', lot: '27.F1', ptravailable: 10, action: 'move', destination: 'D.06.000', notes: '', assignees,
    sources: [{ row_id: `source-${i}`, location: 'D.05.000', lot: '27.F1', ptravailable: 10, actual_qty: null }],
  }));
  const requests: { operation: string; payload: Record<string, unknown> }[] = [];
  const options = [one, two, actor, legacy].map((person, index) => ({ ...person, count: [3, 4, 1, 1][index] }));
  await page.route('**/functions/v1/app-api', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as { action?: string; operation: string; payload?: Record<string, unknown> };
    if (body.action !== 'bunch_note_workflow') return route.fallback();
    const payload = body.payload || {};
    requests.push({ operation: body.operation, payload });
    let data: unknown;
    if (body.operation === 'queue') {
      const filter = String(payload.filter || 'all');
      let selected = cards;
      if (filter === 'mine') selected = cards.filter(card => card.assignees.some(person => person.id === hlUserId));
      else if (filter === 'unassigned') selected = cards.filter(card => !card.assignees.length);
      else if (filter.startsWith('assignee:')) selected = cards.filter(card => card.assignees.some(person => person.id === filter.slice(9)));
      else if (filter === 'completed') selected = [];
      if (large && filter === 'all') selected = Array.from({ length: 100 }, (_, index) => ({ ...cards[index % 7], stablecard_id: `large:${index}`, card_id: id(1000 + index) }));
      data = { cards: selected, total: large && filter === 'all' ? 10001 : selected.length, active_count: large ? 10001 : 9, review_count: 1,
        can_review: true, counters: [], assignee_options: options, unassigned_count: 1 };
    } else if (body.operation === 'list_discrepancies') {
      data = { reviews: [{ id: id(40), revision: 1, status: 'needs_review', job_id: id(10), card_id: id(20), itemcode: 'BN-0', variety: 'Queue Plant 0', contsize: '#1', source_location: 'D.05.000', destination: 'D.06.000', completed_by: 'counter_one', actual_qty: 8, ptravailable: 10, variance: -2, sources: cards[0].sources, assigned_counter_id: null, assigned_counter_username: null, recount_qty: null, can_assign: true, can_complete: true }], total: 1, review_count: 1, can_review: true, counters: [actor, one, two] };
    } else if (body.operation === 'complete_card') {
      expect(payload.job_id).toBe(id(10));
      data = { saved: true, review_created: false };
    } else throw new Error(`Unexpected operation ${body.operation}`);
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': new URL(baseURL).origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ ok: true, data }) });
  });
  return requests;
}

async function openQueue(page: Page) {
  const action = test.info().project.use.isMobile ? 'tap' : 'click';
  await page.locator('#footer-request-btn')[action]();
  await page.locator('[data-request-category="bunch-notes"]')[action]();
  await expect(page.locator('#bunch-queue-host')).toBeVisible();
}

for (const username of ['dylan_collyge', 'Dylan_College']) {
  test(`${username} opens all nine Bunch cards and filters each assignee without a permission error`, { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
    const requests = await fixture(page, baseURL!, username);
    await openQueue(page);
    const select = page.getByRole('combobox', { name: 'Bunch Notes filter' });
    const cards = page.locator('[data-bunch-card]');
    await expect(select).toHaveValue('all');
    await expect(cards).toHaveCount(9);
    await expect(page.getByText('Invalid Bunch Notes permission.', { exact: true })).toHaveCount(0);
    await expect(select.locator('option').nth(0)).toHaveText('All authorized work');
    await expect(select.locator('option').nth(1)).toHaveText('My assigned work');
    const cases: [string, number][] = [[one.id, 3], [two.id, 4], [hlUserId, 1], [legacy.id, 1]];
    const initialRequests = requests.filter(request => request.operation === 'queue').length;
    const timings: number[] = [];
    for (const [assignee, count] of cases) {
      await expect(select.locator(`option[value="assignee:${assignee}"]`)).toContainText(`(${count})`);
      const elapsed = await page.evaluate(async ({ value, count }) => {
        const input = document.querySelector<HTMLSelectElement>('select[aria-label="Bunch Notes filter"]')!;
        const start = performance.now(); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (document.querySelectorAll('[data-bunch-card]').length !== count) throw new Error('Filter was not applied from cached work');
        return performance.now() - start;
      }, { value: `assignee:${assignee}`, count });
      timings.push(elapsed); expect(elapsed).toBeLessThanOrEqual(1500);
      await expect(cards).toHaveCount(count);
    }
    await select.selectOption('unassigned'); await expect(cards).toHaveCount(1);
    expect(requests.filter(request => request.operation === 'queue')).toHaveLength(initialRequests);
    await expect(cards.first().getByRole('button', { name: 'Complete Work' })).toBeEnabled();
    await cards.first().getByRole('textbox', { name: 'Actual Qty Completed source-8' }).fill('10');
    await cards.first().getByRole('button', { name: 'Complete Work' }).click();
    await expect.poll(() => requests.filter(request => request.operation === 'complete_card').length).toBe(1);
    await select.selectOption('all'); await expect(cards).toHaveCount(9);
    await page.locator('[data-request-category="bunch-count-review"]').click();
    await expect(page.locator('[data-bunch-review]')).toHaveCount(1);
    await expect(page.getByRole('combobox', { name: `Assign Recount To ${id(40)}` })).toBeEnabled();
    await expect(page.getByText('Invalid Bunch Notes permission.', { exact: true })).toHaveCount(0);
    await test.info().attach('assignee-filter-metrics.json', { body: Buffer.from(JSON.stringify({ username, project: test.info().project.name, cards: 9, cache: 'complete authorized queue cached', filterMs: timings, limitMs: 1500, trace: 'off', osCaches: 'uncontrolled' })), contentType: 'application/json' });
  });
}

test('supervisor queue keeps global assignee counts while paging 10,001 cards', { tag: ['@bunch-note'] }, async ({ page, baseURL }) => {
  const requests = await fixture(page, baseURL!, 'DYLAN_COLLYGE', true);
  await openQueue(page);
  await expect(page.locator('[data-bunch-card]')).toHaveCount(100);
  const select = page.getByRole('combobox', { name: 'Bunch Notes filter' });
  await expect(select.locator(`option[value="assignee:${legacy.id}"]`)).toContainText('(1)');
  await select.selectOption(`assignee:${legacy.id}`);
  await expect(page.locator('[data-bunch-card]')).toHaveCount(1);
  expect(requests.some(request => request.operation === 'queue' && request.payload.filter === `assignee:${legacy.id}` && request.payload.limit === 100)).toBe(true);
  expect(requests.filter(request => request.operation === 'queue').every(request => request.payload.limit === 100)).toBe(true);
});
