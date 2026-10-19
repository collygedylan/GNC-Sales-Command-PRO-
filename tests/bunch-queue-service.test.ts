import { describe, expect, it, vi } from 'vitest';
import { actualQuantity, createBunchQueueClient, parseBunchQueue, parseBunchReviews } from '../services/bunchQueue';

const card = {
  stablecard_id: 'job-1:card-1', job_id: 'job-1', card_id: 'card-1', revision: 4, job_revision: 9,
  status: 'open', can_complete: true, itemcode: 'BN-1', variety: 'Bunch Plant', contsize: '#3',
  source_location: 'D.05.000', lot: '', ptravailable: 18, action: 'Move', destination: 'D.06.000', notes: 'Keep lots separate',
  assignees: [{ id: 'worker-1', username: 'worker', display_name: 'Worker One' }],
  sources: [
    { row_id: 'row-1', location: 'D.05.000', lot: 'LOT-A', ptravailable: 8, actual_qty: null },
    { row_id: 'row-2', location: 'D.05.000', lot: 'LOT-B', ptravailable: 10, actual_qty: null },
  ],
};
const queue = { cards: [card], total: 1, active_count: 1, review_count: 0, can_review: false, counters: [] };
const review = {
  id: 'review-1', revision: 3, status: 'needs_review', job_id: 'job-1', card_id: 'card-1', itemcode: 'BN-1',
  variety: 'Bunch Plant', contsize: '#3', source_location: 'D.05.000', destination: 'D.06.000',
  completed_by: 'Worker One', actual_qty: 11, ptravailable: 8, variance: 3,
  assigned_counter_id: null, recount_qty: null, can_assign: true, can_complete: false,
  sources: [
    { row_id: 'row-1', location: 'D.05.000', lot: 'LOT-A', ptravailable: 8, actual_qty: null },
    { row_id: 'row-2', location: 'D.05.000', lot: 'LOT-B', ptravailable: 10, actual_qty: null },
  ],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
}

describe('Bunch Notes work queue contracts', () => {
  it('parses assigned multi-source cards and rejects duplicate source identities', () => {
    expect(parseBunchQueue(queue).cards[0].sources.map(source => source.row_id)).toEqual(['row-1', 'row-2']);
    expect(parseBunchQueue(queue).cards[0].assignees[0].display_name).toBe('Worker One');
    expect(() => parseBunchQueue({ ...queue, cards: [{ ...card, sources: [card.sources[0], card.sources[0]] }] })).toThrow(/Duplicate Bunch Notes source rows/);
    expect(() => parseBunchQueue({ ...queue, cards: [card, card] })).toThrow(/Duplicate Bunch Notes cards/);
  });

  it('fails closed for nullable SQL permission predicates while retaining the authorized card', () => {
    const parsed = parseBunchQueue({ ...queue, cards: [{ ...card, can_complete: null }], can_review: null });
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].can_complete).toBe(false);
    expect(parsed.can_review).toBe(false);
    expect(() => parseBunchQueue({ ...queue, can_review: 'true' })).toThrow('Invalid Bunch Notes permission.');
    expect(parseBunchReviews({ reviews: [{ ...review, can_assign: null, can_complete: null }], total: 1, review_count: 1, can_review: null, counters: [] }).reviews[0]).toMatchObject({ can_assign: false, can_complete: false });
  });

  it('uses a legacy assigned-work cache as a partial offline fallback without treating it as all work', () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:worker-upgrade:mine:0', JSON.stringify({
      cards: [{ ...card, can_complete: null }], total: 1, active_count: 1, review_count: 0, can_review: null, counters: [],
    }));
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'worker-upgrade', transport, storage: saved, online: () => false });
    expect(client.getSnapshot()).toMatchObject({ filter: 'mine', loadedFilter: 'mine', offline: true, page: { cards: [{ card_id: 'card-1', can_complete: false }], assignee_options: [], unassigned_count: 0 } });
    void client.load('mine', 0);
    expect(client.getSnapshot()).toMatchObject({ filter: 'mine', loadedFilter: 'mine', offline: true });
    expect(transport).not.toHaveBeenCalled();
    client.dispose();
  });

  it('refreshes a legacy mine fallback from the all-authorized queue by default when online', async () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:worker-upgrade-online:mine:0', JSON.stringify(queue));
    const fullPage = { ...queue, assignee_options: [{ id: 'worker-1', username: 'worker', display_name: 'Worker One', count: 1 }], unassigned_count: 0 };
    const transport = vi.fn().mockResolvedValue({ ok: true, data: fullPage });
    const client = createBunchQueueClient({ scopeKey: 'worker-upgrade-online', transport, storage: saved, online: () => true });
    expect(client.getSnapshot()).toMatchObject({ filter: 'mine', loadedFilter: 'mine' });
    await client.load('all', 0);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ operation: 'queue', payload: { filter: 'all', offset: 0, limit: 100 } }), expect.any(AbortSignal));
    expect(client.getSnapshot()).toMatchObject({ filter: 'all', loadedFilter: 'all', page: { assignee_options: [{ id: 'worker-1', count: 1 }] } });
    client.dispose();
  });

  it('keeps the legacy partial page visible when the default all-authorized refresh fails', async () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:worker-refresh-failure:mine:0', JSON.stringify(queue));
    const client = createBunchQueueClient({ scopeKey: 'worker-refresh-failure', transport: vi.fn().mockRejectedValue(new Error('network unavailable')), storage: saved, online: () => true });
    await client.load('all', 0);
    expect(client.getSnapshot()).toMatchObject({
      filter: 'all', loadedFilter: 'mine', page: { cards: [{ card_id: 'card-1' }], total: 1 },
      error: 'network unavailable',
    });
    client.dispose();
  });

  it('retains same-user legacy Count Review snapshots for offline upgrade access', async () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:reviewer-upgrade:permission-v2:reviews:0', JSON.stringify({
      reviews: [{ ...review, can_assign: null, can_complete: null }], total: 1, review_count: 1, can_review: true, counters: [],
    }));
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'reviewer-upgrade', cacheScopeKey: 'reviewer-upgrade:permission-v2', transport, storage: saved, online: () => false });
    await client.load('all', 0, true);
    expect(client.getSnapshot()).toMatchObject({ offline: true, reviews: { reviews: [{ id: 'review-1', can_assign: false, can_complete: false }], total: 1 } });
    expect(transport).not.toHaveBeenCalled();
    client.dispose();
  });

  it('does not hydrate Count Review from a legacy cache outside the current permission scope', async () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:reviewer-upgrade:reviews:0', JSON.stringify({ reviews: [review], total: 1, review_count: 1, can_review: true, counters: [] }));
    const client = createBunchQueueClient({ scopeKey: 'reviewer-upgrade', cacheScopeKey: 'reviewer-upgrade:permission-v2', transport: vi.fn(), storage: saved, online: () => false });
    await client.load('all', 0, true);
    expect(client.getSnapshot().reviews).toBeNull();
    client.dispose();
  });

  it('invalidates an in-flight server filter when a cached assigned filter is selected', async () => {
    const cards = [
      { ...card, stablecard_id: 'job-1:card-1', card_id: 'card-1', assignees: [{ id: 'worker-1', username: 'worker_1', display_name: 'Worker One' }] },
      { ...card, stablecard_id: 'job-1:card-2', card_id: 'card-2', assignees: [{ id: 'worker-2', username: 'worker_2', display_name: 'Worker Two' }] },
    ];
    const allPage = { ...queue, cards, total: 2, active_count: 2, assignee_options: [{ id: 'worker-1', username: 'worker_1', display_name: 'Worker One', count: 1 }, { id: 'worker-2', username: 'worker_2', display_name: 'Worker Two', count: 1 }], unassigned_count: 0 };
    let resolveMine: (value: unknown) => void = () => undefined;
    const mineResponse = new Promise<unknown>(resolve => { resolveMine = resolve; });
    const transport = vi.fn((request: Record<string, unknown>) => request.operation === 'queue' && (request.payload as Record<string, unknown>).filter === 'mine'
      ? mineResponse
      : Promise.resolve({ ok: true, data: allPage }));
    const client = createBunchQueueClient({ scopeKey: 'supervisor', transport, storage: memoryStorage(), online: () => true });
    await client.load('all', 0);
    const pendingMine = client.load('mine', 0);
    client.setFilter('assignee:worker-2');
    resolveMine({ ok: true, data: { ...queue, cards: [cards[0]], total: 1 } });
    await pendingMine;
    expect(client.getSnapshot()).toMatchObject({ filter: 'assignee:worker-2', loadedFilter: 'all', loading: false, page: { cards: [{ card_id: 'card-1' }, { card_id: 'card-2' }] } });
    client.dispose();
  });

  it('keeps retained outbox recovery warnings visible while applying local assignee filters', async () => {
    const saved = memoryStorage();
    saved.setItem('gnc:bunch-queue:v230:supervisor-outbox:outbox', '{malformed');
    const client = createBunchQueueClient({ scopeKey: 'supervisor-outbox', transport: vi.fn().mockResolvedValue({ ok: true, data: { ...queue, assignee_options: [{ id: 'worker-1', username: 'worker', display_name: 'Worker One', count: 1 }], unassigned_count: 0 } }), storage: saved, online: () => true });
    await client.load('all', 0);
    const warning = client.getSnapshot().error;
    client.setFilter('assignee:worker-1');
    expect(client.getSnapshot().error).toBe(warning);
    expect(warning).toMatch(/retained on this device/);
    client.dispose();
  });

  it('validates whole actual quantities while preserving explicit zero', () => {
    expect(actualQuantity('0')).toBe(0);
    expect(actualQuantity(' 12 ')).toBe(12);
    for (const value of ['', '-1', '1.5', '1e2', '1000000000']) expect(() => actualQuantity(value)).toThrow();
  });

  it('retains multi-source quantities offline and retries with the original idempotency receipt', async () => {
    const storage = memoryStorage();
    let online = false;
    const transport = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ ok: true, data: { saved: true } });
    const client = createBunchQueueClient({ scopeKey: 'worker-1', transport, storage, online: () => online, uuid: () => 'receipt-1' });
    client.saveDraft(card.stablecard_id, { 'row-1': '7', 'row-2': '9' });
    await client.mutate('complete_card', { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 7, 'row-2': 9 } }, card.revision, card.stablecard_id);
    expect(client.getSnapshot().pending).toHaveLength(1);
    expect(client.getSnapshot().offline).toBe(true);
    expect(transport).not.toHaveBeenCalled();

    online = true;
    await client.flush();
    expect(client.getSnapshot().pending).toHaveLength(1);
    const savedCommand = JSON.parse(storage.values.get('gnc:bunch-queue:v230:worker-1:outbox') || '[]')[0];
    expect(savedCommand.commandId).toBe('receipt-1');
    expect(savedCommand.payload.actual_qty_by_row).toEqual({ 'row-1': 7, 'row-2': 9 });

    await client.flush();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][0]).toEqual(transport.mock.calls[1][0]);
    expect(transport.mock.calls[1][0]).toMatchObject({ operation: 'complete_card', commandId: 'receipt-1', expectedRevision: 4 });
    expect(client.getSnapshot().pending).toHaveLength(0);
    expect(client.getSnapshot().message).toMatch(/Work completed/);
    client.dispose();
  });

  it('assigns a discrepancy recount and later saves the recount against the review revision', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, data: { saved: true } });
    const client = createBunchQueueClient({ scopeKey: 'reviewer-1', transport, storage: memoryStorage(), online: () => true, uuid: () => 'review-receipt' });
    const parsed = parseBunchReviews({ reviews: [review], total: 1, review_count: 1, can_review: true, counters: [{ id: 'counter-1', username: 'counter', display_name: 'Counter One' }] });
    expect(parsed.reviews[0].variance).toBe(3);
    expect(parsed.reviews[0].sources.map(source => source.row_id)).toEqual(['row-1', 'row-2']);
    await client.mutate('assign_counter', { review_id: review.id, counter_id: 'counter-1', expected_revision: review.revision }, review.revision, `review:${review.id}`);
    expect(transport.mock.calls[0][0]).toMatchObject({ operation: 'assign_counter', payload: { review_id: 'review-1', counter_id: 'counter-1' }, expectedRevision: 3 });
    await client.mutate('complete_recount', { review_id: review.id, recount_qty_by_row: { 'row-1': 4, 'row-2': 5 }, expected_revision: 4 }, 4, `review:${review.id}`);
    expect(transport.mock.calls[1][0]).toMatchObject({ operation: 'complete_recount', payload: { review_id: 'review-1', recount_qty_by_row: { 'row-1': 4, 'row-2': 5 } }, expectedRevision: 4 });
    client.dispose();
  });

  it('parses and submits a custom counter username as a tag without inventing an account id', async () => {
    const parsed = parseBunchReviews({ reviews: [{ ...review, assigned_counter_id: null, assigned_counter_username: 'seasonal_counter' }], total: 1, review_count: 1, can_review: true, counters: [] });
    expect(parsed.reviews[0]).toMatchObject({ assigned_counter_id: null, assigned_counter_username: 'seasonal_counter' });
    const transport = vi.fn().mockResolvedValue({ ok: true, data: { saved: true } });
    const client = createBunchQueueClient({ scopeKey: 'reviewer-tag', transport, storage: memoryStorage(), online: () => true, uuid: () => 'tag-receipt' });
    await client.mutate('assign_counter', { review_id: review.id, counter_username: 'seasonal_counter', expected_revision: review.revision }, review.revision, `review:${review.id}`);
    expect(transport.mock.calls[0][0]).toMatchObject({ operation: 'assign_counter', payload: { review_id: 'review-1', counter_username: 'seasonal_counter' }, expectedRevision: 3 });
    client.dispose();
  });

  it('fences cached queue pages by permission epoch while retaining user drafts and outbox', async () => {
    const storage = memoryStorage();
    storage.setItem('gnc:bunch-queue:v230:actor-1:mine:0', JSON.stringify(queue));
    storage.setItem('gnc:bunch-queue:v230:actor-1:outbox', JSON.stringify([{ operation: 'complete_card', payload: { job_id: 'job-1' }, commandId: 'saved-1', expectedRevision: 4, target: card.stablecard_id }]));
    storage.setItem(`gnc:bunch-queue:v230:actor-1:draft:${card.stablecard_id}`, JSON.stringify({ 'row-1': '6' }));
    const client = createBunchQueueClient({ scopeKey: 'actor-1', cacheScopeKey: 'actor-1:permission-v2', transport: vi.fn(), storage, online: () => false });
    expect(client.getSnapshot().page).toBeNull();
    expect(client.getSnapshot().pending[0].commandId).toBe('saved-1');
    expect(client.draft(card.stablecard_id)).toEqual({ 'row-1': '6' });
    client.dispose();
  });

  it('preserves malformed outbox bytes and blocks new writes for recovery', async () => {
    const storage = memoryStorage(), raw = '{invalid json';
    const transport = vi.fn();
    storage.setItem('gnc:bunch-queue:v230:actor-corrupt:outbox', raw);
    const client = createBunchQueueClient({ scopeKey: 'actor-corrupt', transport, storage, online: () => true });
    expect(client.getSnapshot().error).toMatch(/retained on this device/);
    await expect(client.mutate('complete_card', { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 7 } }, 4, card.stablecard_id)).rejects.toThrow(/recovery/);
    expect(storage.values.get('gnc:bunch-queue:v230:actor-corrupt:outbox')).toBe(raw);
    expect(transport).not.toHaveBeenCalled();
    client.dispose();
  });

  it('preserves the receipt and draft of an explicitly rejected HTTP conflict without retrying forever', async () => {
    const storage = memoryStorage();
    const transport = vi.fn().mockRejectedValue(Object.assign(new Error('BUNCH_NOTE_REVISION_CONFLICT'), {
      status: 409, payload: { error: 'BUNCH_NOTE_REVISION_CONFLICT', code: 'BUNCH_NOTE_REVISION_CONFLICT' },
    }));
    const client = createBunchQueueClient({ scopeKey: 'worker-conflict', storage, transport, online: () => true, uuid: () => 'rejected-receipt' });
    client.saveDraft(card.stablecard_id, { 'row-1': '7', 'row-2': '9' });
    await expect(client.mutate('complete_card', { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 7, 'row-2': 9 } }, 4, card.stablecard_id)).rejects.toThrow('BUNCH_NOTE_REVISION_CONFLICT');
    expect(client.getSnapshot().pending).toHaveLength(0);
    expect(client.draft(card.stablecard_id)).toEqual({ 'row-1': '7', 'row-2': '9' });
    const retained = JSON.parse(storage.values.get('gnc:bunch-queue:v230:worker-conflict:last-rejected') || '{}');
    expect(retained.command.commandId).toBe('rejected-receipt');
    await client.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('keeps a recount badge visible when assigned card count is zero and permission flag is false', async () => {
    const counts = vi.fn();
    const transport = vi.fn(async (request: Record<string, unknown>) => request.operation === 'queue'
      ? { ok: true, data: { cards: [], total: 0, active_count: 0, review_count: 1, can_review: false, counters: [] } }
      : { ok: true, data: { reviews: [review], total: 1, review_count: 1, can_review: false, counters: [{ id: 'counter-1', username: 'counter', display_name: 'Counter One' }] } });
    const client = createBunchQueueClient({ scopeKey: 'assigned-counter', transport, storage: memoryStorage(), onCounts: counts, online: () => true });
    await client.load('mine', 0);
    expect(client.getSnapshot().page).toMatchObject({ cards: [], active_count: 0, review_count: 1, can_review: false });
    expect(counts).toHaveBeenLastCalledWith({ active: 0, review: 1, canReview: true });
    await client.stage(true);
    expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({ operation: 'list_discrepancies', payload: { filter: 'mine', offset: 0, limit: 100 } }), expect.any(AbortSignal));
    client.dispose();
  });
});
