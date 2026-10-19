// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mountBunchQueue } from '../components/bunch-queue/mount';
import { createBunchQueueClient } from '../services/bunchQueue';

const baseCard = {
  stablecard_id: 'job-1:card-1', job_id: 'job-1', card_id: 'card-1', revision: 4, job_revision: 9,
  status: 'open', can_complete: true, itemcode: 'BN-1', variety: 'Bunch Plant', contsize: '#3',
  source_location: 'D.05.000', lot: '', ptravailable: 18, action: 'Move', destination: 'D.06.000', notes: 'Keep lots separate',
  assignees: [{ id: 'worker-1', username: 'worker', display_name: 'Worker One' }],
  sources: [
    { row_id: 'row-1', location: 'D.05.000', lot: 'LOT-A', ptravailable: 8, actual_qty: null },
    { row_id: 'row-2', location: 'D.05.000', lot: 'LOT-B', ptravailable: 10, actual_qty: null },
  ],
};
const queuePage = { cards: [baseCard], total: 1, active_count: 1, review_count: 0, can_review: false, counters: [] };
const reviewPage = {
  reviews: [{ id: 'review-1', revision: 3, status: 'needs_review', job_id: 'job-1', card_id: 'card-1', itemcode: 'BN-1', variety: 'Bunch Plant', contsize: '#3', source_location: 'D.05.000', destination: 'D.06.000', completed_by: 'Worker One', actual_qty: 11, ptravailable: 8, variance: 3, assigned_counter_id: null, recount_qty: null, can_assign: true, can_complete: true, sources: [{row_id:'row-1',location:'D.05.000',lot:'LOT-A',ptravailable:8,actual_qty:null},{row_id:'row-2',location:'D.05.000',lot:'LOT-B',ptravailable:10,actual_qty:null}] }],
  total: 1, review_count: 1, can_review: true,
  counters: [{ id: 'counter-1', username: 'counter', display_name: 'Counter One' }],
};
const hosts: HTMLElement[] = [];
function host() { const node = document.createElement('div'); document.body.append(node); hosts.push(node); return node; }
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
afterEach(() => { hosts.splice(0).forEach(node => node.remove()); });

describe('Bunch Notes queue cards', () => {
  it('opens all server-authorized work and filters assigned users from a complete cached queue without another RPC', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const cards = [
      { ...baseCard, stablecard_id: 'job-1:card-1', card_id: 'card-1', assignees: [{ id: 'worker-1', username: 'alex_worker', display_name: 'Alex Worker' }] },
      { ...baseCard, stablecard_id: 'job-1:card-2', card_id: 'card-2', assignees: [{ id: 'worker-1', username: 'alex_worker', display_name: 'Alex Worker' }, { id: 'worker-2', username: 'bea_worker', display_name: 'Bea Worker' }] },
      { ...baseCard, stablecard_id: 'job-1:card-3', card_id: 'card-3', assignees: [] },
    ];
    const page = {
      cards, total: 3, active_count: 3, review_count: 0, can_review: true,
      counters: [],
      assignee_options: [
        { id: 'worker-1', username: 'alex_worker', display_name: 'Alex Worker', count: 2 },
        { id: 'worker-2', username: 'bea_worker', display_name: 'Bea Worker', count: 1 },
      ],
      unassigned_count: 1,
    };
    const transport = vi.fn(async () => ({ ok: true, data: page }));
    const client = createBunchQueueClient({ scopeKey: 'dylan_collyge', transport, storage: storage(), online: () => true });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });

    const filter = await screen.findByRole('combobox', { name: 'Bunch Notes filter' }) as HTMLSelectElement;
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({ operation: 'queue', payload: expect.objectContaining({ filter: 'all' }) }), expect.any(AbortSignal)));
    expect(Array.from(filter.options).slice(0, 4).map(option => option.textContent)).toEqual([
      'All authorized work', 'My assigned work', 'Assigned: alex_worker (2)', 'Assigned: bea_worker (1)',
    ]);
    expect(Array.from(filter.options).some(option => option.textContent === 'Unassigned (1)')).toBe(true);
    expect(screen.getAllByRole('article')).toHaveLength(3);

    fireEvent.change(filter, { target: { value: 'assignee:worker-2' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(/Assigned:.*Bea Worker/)).toBeTruthy();
    expect(transport).toHaveBeenCalledTimes(1);
    fireEvent.change(filter, { target: { value: 'unassigned' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(/Assigned: Unassigned/)).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'all' } });
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('shows assigned work and submits actual quantities for every source row', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const transport = vi.fn(async (request: Record<string, unknown>) => {
      const operation = request.operation;
      if (operation === 'queue') return { ok: true, data: queuePage };
      if (operation === 'complete_card') return { ok: true, data: { saved: true } };
      throw new Error(`Unexpected operation ${String(operation)}`);
    });
    const client = createBunchQueueClient({ scopeKey: 'worker-1', transport, storage: storage(), online: () => true, uuid: () => 'card-receipt' });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    expect(await screen.findByRole('heading', { name: 'Bunch Notes' })).toBeTruthy();
    expect(screen.getByText(/Worker One/)).toBeTruthy();
    expect(screen.getByText(/Keep lots separate/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByText(/D\.05\.000 · Lot LOT-A/)).toBeNull();
    const summary = screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(screen.getByRole('region', { name: 'Bunch Notes entry Bunch Plant' })).toBeTruthy();
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/D\.05\.000 · Lot LOT-A/)).toBeTruthy();
    expect(screen.getByText(/D\.05\.000 · Lot LOT-B/)).toBeTruthy();
    const sourceRows = screen.getAllByText(/Drive PTRAVAILABLE:/);
    expect(sourceRows).toHaveLength(3); // Aggregate summary plus each distinct source value in the opened entry panel.
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '9' } });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }) as HTMLInputElement).value).toBe('7');
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }) as HTMLInputElement).value).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'complete_card',
      payload: { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 7, 'row-2': 9 } },
      commandId: 'card-receipt', expectedRevision: 4,
    }), expect.any(AbortSignal)));
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('does not repeat source location, lot, or Drive PTRAVAILABLE when a single-source row duplicates the card summary', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const singleSourceCard = {
      ...baseCard,
      lot: 'LOT-A',
      ptravailable: 8,
      sources: [{ row_id: 'row-1', location: 'D.05.000', lot: 'LOT-A', ptravailable: 8, actual_qty: null }],
    };
    const transport = vi.fn(async () => ({ ok: true, data: { ...queuePage, cards: [singleSourceCard], total: 1, active_count: 1 } }));
    const client = createBunchQueueClient({ scopeKey: 'single-source-summary', transport, storage: storage(), online: () => true });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });

    const card = await screen.findByRole('article');
    expect(card.querySelector('.bq-id')?.textContent).toContain('D.05.000 · Lot LOT-A');
    expect(card.querySelectorAll('.bq-source')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    expect(card.querySelectorAll('.bq-source')).toHaveLength(1);
    const source = card.querySelector('.bq-source');
    expect(source?.textContent).not.toContain('D.05.000');
    expect(source?.textContent).not.toContain('LOT-A');
    expect(source?.textContent).not.toContain('Drive PTRAVAILABLE');
    expect(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeNull();
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('renders cached assignment work and saved quantities while offline', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const saved = storage();
    saved.setItem('gnc:bunch-queue:v232:worker-offline:all:0', JSON.stringify(queuePage));
    saved.setItem('gnc:bunch-queue:v230:worker-offline:draft:job-1:card-1', JSON.stringify({ 'row-1': '5', 'row-2': '6' }));
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'worker-offline', transport, storage: saved, online: () => false });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    expect((await screen.findByRole('status')).textContent).toMatch(/Offline/);
    expect(screen.queryByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }) as HTMLInputElement).value).toBe('5');
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }) as HTMLInputElement).value).toBe('6');
    expect(transport).not.toHaveBeenCalled();
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('opens the compact summary with Enter or Space keyboard activation', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const transport = vi.fn(async () => ({ ok: true, data: queuePage }));
    const client = createBunchQueueClient({ scopeKey: 'keyboard-open', transport, storage: storage(), online: () => true });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });

    const summary = await screen.findByRole('button', { name: 'Open Bunch Notes card Bunch Plant' });
    fireEvent.keyDown(summary, { key: 'Enter' });
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeTruthy();
    fireEvent.keyDown(summary, { key: ' ' });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Actual Qty Completed row-1' })).toBeNull();

    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('optimistically hides Done work, ignores stale queue commits, and keeps success available in Completed', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const completeReply = deferred<{ ok: boolean; data: { saved: boolean } }>();
    const completedPage = {
      ...queuePage,
      active_count: 0,
      cards: [{ ...baseCard, status: 'complete', can_complete: false, sources: baseCard.sources.map(source => ({ ...source, actual_qty: 7 })) }],
    };
    const transport = vi.fn(async (request: Record<string, unknown>) => {
      if (request.operation === 'complete_card') return completeReply.promise;
      if (request.operation === 'queue' && (request.payload as { filter?: string }).filter === 'completed') return { ok: true, data: completedPage };
      if (request.operation === 'queue' || request.operation === 'list_discrepancies') return { ok: true, data: queuePage };
      throw new Error(`Unexpected operation ${String(request.operation)}`);
    });
    const countEvents: Array<{ active: number; review: number; canReview: boolean }> = [];
    const client = createBunchQueueClient({ scopeKey: 'optimistic-done', transport, storage: storage(), online: () => true, uuid: () => 'held-done', onCounts: value => countEvents.push(value) });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    await screen.findByRole('article');
    const staleQueue = await client.stage();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(countEvents.at(-1)).toMatchObject({ active: 0 });
    expect(client.getSnapshot().message).not.toMatch(/Work completed/i);
    client.commit(staleQueue);
    expect(screen.queryByRole('article')).toBeNull();
    expect(countEvents.at(-1)).toMatchObject({ active: 0 });

    await act(async () => { completeReply.resolve({ ok: true, data: { saved: true } }); await completeReply.promise; });
    await waitFor(() => expect(client.getSnapshot().message).toMatch(/Work completed/i));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({ operation: 'queue', payload: expect.objectContaining({ filter: 'all' }) }), expect.any(AbortSignal)));
    expect(screen.queryByRole('article')).toBeNull();
    client.commit(staleQueue);
    expect(screen.queryByRole('article')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Bunch Notes filter' }), { target: { value: 'completed' } });
    expect(await screen.findByText(/Completed work/)).toBeTruthy();
    expect((await screen.findByRole('article')).getAttribute('data-bunch-card')).toBe('card-1');
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('restores a definitely rejected completion with its saved draft and active badge count', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const transport = vi.fn(async (request: Record<string, unknown>) => {
      if (request.operation === 'queue') return { ok: true, data: queuePage };
      if (request.operation === 'complete_card') return { ok: false, message: 'BUNCH_NOTE_REVISION_CONFLICT' };
      throw new Error(`Unexpected operation ${String(request.operation)}`);
    });
    const countEvents: Array<{ active: number; review: number; canReview: boolean }> = [];
    const client = createBunchQueueClient({ scopeKey: 'rejected-done', transport, storage: storage(), online: () => true, uuid: () => 'rejected-done', onCounts: value => countEvents.push(value) });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '13' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '17' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByRole('article')).toBeTruthy();
    expect(countEvents.at(-1)).toMatchObject({ active: 1 });
    expect((screen.getByRole('alert')).textContent).toContain('BUNCH_NOTE_REVISION_CONFLICT');
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }) as HTMLInputElement).value).toBe('13');
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }) as HTMLInputElement).value).toBe('17');
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('keeps an offline Done request in durable outbox across remount without claiming completion', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const values = new Map<string, string>([[`gnc:bunch-queue:v232:offline-done:all:0`, JSON.stringify(queuePage)]]);
    const saved = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'offline-done', transport, storage: saved, online: () => false, uuid: () => 'offline-receipt' });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '21' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(values.get('gnc:bunch-queue:v230:offline-done:outbox')).toContain('offline-receipt');
    expect(client.getSnapshot().message).not.toMatch(/Work completed/i);
    expect(transport).not.toHaveBeenCalled();
    await act(async () => { mounted.destroy(); client.dispose(); });

    const remountedClient = createBunchQueueClient({ scopeKey: 'offline-done', transport, storage: saved, online: () => false });
    await act(async () => { mounted = mountBunchQueue(host(), remountedClient); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByRole('article')).toBeNull());
    expect(remountedClient.getSnapshot().pending).toHaveLength(1);
    expect(remountedClient.getSnapshot().message).not.toMatch(/Work completed/i);
    expect(values.get('gnc:bunch-queue:v230:offline-done:outbox')).toContain('offline-receipt');
    expect(transport).not.toHaveBeenCalled();
    await act(async () => { mounted.destroy(); remountedClient.dispose(); });
  });

  it('does not optimistically hide a card when the required outbox write fails', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const saved = {
      getItem: (_key: string) => null,
      setItem: (key: string, _value: string) => { if (key.endsWith(':outbox')) throw new Error('disk full'); },
    };
    const transport = vi.fn(async (request: Record<string, unknown>) => request.operation === 'queue'
      ? { ok: true, data: queuePage }
      : { ok: true, data: { saved: true } });
    const countEvents: Array<{ active: number; review: number; canReview: boolean }> = [];
    const client = createBunchQueueClient({ scopeKey: 'storage-failure', transport, storage: saved, online: () => true, onCounts: value => countEvents.push(value) });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    await screen.findByRole('article');
    fireEvent.click(screen.getByRole('button', { name: 'Open Bunch Notes card Bunch Plant' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByRole('article')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(countEvents.at(-1)).toMatchObject({ active: 1 });
    expect(transport.mock.calls.some(call => call[0].operation === 'complete_card')).toBe(false);
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('retains confirmed removal across offline restart but permits a newer authorized open revision', async () => {
    const saved = storage();
    const transport = vi.fn(async (request: Record<string, unknown>) => ({ ok: true, data: request.operation === 'queue' ? queuePage : { saved: true } }));
    const client = createBunchQueueClient({ scopeKey: 'confirmed-restart', transport, storage: saved, online: () => true, uuid: () => 'confirmed-receipt' });
    await client.load();
    await client.mutate('complete_card', { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 8, 'row-2': 10 } }, 4, 'job-1:card-1');
    expect(client.getSnapshot().page?.active_count).toBe(0);
    client.dispose();
    const restarted = createBunchQueueClient({ scopeKey: 'confirmed-restart', transport, storage: saved, online: () => false });
    expect(restarted.getSnapshot().page?.cards).toHaveLength(0);
    expect(restarted.getSnapshot().pending).toHaveLength(0);
    saved.setItem('gnc:bunch-queue:v232:confirmed-restart:all:0', JSON.stringify({ ...queuePage, cards: [{ ...baseCard, revision: 6 }] }));
    await restarted.load();
    expect(restarted.getSnapshot().page?.cards).toHaveLength(1);
    restarted.dispose();
  });

  it('surfaces rejected-receipt storage failure without discarding the original request', async () => {
    const saved = storage();
    const failingStorage = { getItem: saved.getItem, setItem: (key: string, value: string) => {
      if (key.endsWith(':last-rejected')) throw new Error('Full device');
      saved.setItem(key, value);
    } };
    const transport = vi.fn(async (request: Record<string, unknown>) => request.operation === 'queue'
      ? { ok: true, data: queuePage } : { ok: false, message: 'BUNCH_NOTE_REVISION_CONFLICT' });
    const client = createBunchQueueClient({ scopeKey: 'rejection-storage', transport, storage: failingStorage, online: () => true, uuid: () => 'recovery-receipt' });
    await client.load();
    await expect(client.mutate('complete_card', {}, 4, 'job-1:card-1')).rejects.toThrow(/could not retain this work/);
    expect(client.getSnapshot().error).toContain('BUNCH_NOTE_REVISION_CONFLICT');
    expect(client.getSnapshot().pending[0].commandId).toBe('recovery-receipt');
    expect(saved.getItem('gnc:bunch-queue:v230:rejection-storage:outbox')).toContain('recovery-receipt');
    client.dispose();
  });

  it('shows a legacy v230 assigned-work cache offline as partial while retaining drafts and tolerating missing facets', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const saved = storage();
    saved.setItem('gnc:bunch-queue:v230:worker-upgrade-offline:mine:0', JSON.stringify({
      cards: [{ ...baseCard, can_complete: null }], total: 1, active_count: 1, review_count: 0, can_review: null, counters: [],
    }));
    saved.setItem('gnc:bunch-queue:v230:worker-upgrade-offline:draft:job-1:card-1', JSON.stringify({ 'row-1': '6', 'row-2': '8' }));
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'worker-upgrade-offline', transport, storage: saved, online: () => false });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });

    expect(await screen.findByText(/saved assigned-work snapshot only/i)).toBeTruthy();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect((screen.getByRole('combobox', { name: 'Bunch Notes filter' }) as HTMLSelectElement).value).toBe('mine');
    expect(client.getSnapshot()).toMatchObject({ filter: 'mine', loadedFilter: 'mine', page: { assignee_options: [], unassigned_count: 0, cards: [{ can_complete: false }] } });
    expect(client.draft('job-1:card-1')).toEqual({ 'row-1': '6', 'row-2': '8' });
    expect(screen.queryByRole('button', { name: 'Complete Work' })).toBeNull();
    expect(transport).not.toHaveBeenCalled();
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('keeps the Count Review badge actionable when the original queue page is empty', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onCounts = vi.fn();
    const transport = vi.fn(async () => ({ ok: true, data: { cards: [], total: 0, active_count: 0, review_count: 1, can_review: false, counters: [] } }));
    const client = createBunchQueueClient({ scopeKey: 'assigned-counter', transport, storage: storage(), online: () => true, onCounts });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    await waitFor(() => expect(client.getSnapshot().page).toMatchObject({ cards: [], active_count: 0, review_count: 1, can_review: false }));
    expect(onCounts).toHaveBeenLastCalledWith({ active: 0, review: 1, canReview: true });
    expect(await screen.findByText('No Bunch Notes in this filter.')).toBeTruthy();
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('assigns mismatch review to a counter and accepts a recount quantity', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let currentReview = reviewPage.reviews[0];
    const transport = vi.fn(async (request: Record<string, unknown>) => {
      if (request.operation === 'assign_counter') currentReview = { ...currentReview, revision: 4, assigned_counter_id: 'counter-1', can_assign: false };
      if (request.operation === 'complete_recount') currentReview = { ...currentReview, revision: 5, status: 'resolved', recount_qty: 9, can_complete: false };
      if (request.operation === 'list_discrepancies') return { ok: true, data: { ...reviewPage, reviews: [currentReview] } };
      return { ok: true, data: { saved: true } };
    });
    const client = createBunchQueueClient({ scopeKey: 'reviewer', transport, storage: storage(), online: () => true, uuid: () => 'review-receipt' });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client, true); await Promise.resolve(); });
    expect(await screen.findByText('Discrepancy:')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Assign Recount To review-1' }), { target: { value: 'counter-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Counter' }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'assign_counter', payload: { review_id: 'review-1', counter_id: 'counter-1', expected_revision: 3 }, commandId: 'review-receipt', expectedRevision: 3,
    }), expect.any(AbortSignal)));
    fireEvent.change(screen.getByRole('textbox', { name: 'Recount Qty row-1' }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Recount Qty row-2' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Recount' }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({ operation: 'complete_recount', payload: { review_id: 'review-1', recount_qty_by_row: { 'row-1': 4, 'row-2': 5 }, expected_revision: 4 }, expectedRevision: 4 }), expect.any(AbortSignal)));
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('offers Sharon and Dylan first, then submits a custom username as a tag', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const counters = [
      { id: 'worker-z', username: 'worker_z', display_name: 'Worker Z' },
      { id: 'dylan-id', username: 'dylan_collyge', display_name: 'Dylan' },
      { id: 'sharon-id', username: 'sharon_combs', display_name: 'Sharon' },
    ];
    const transport = vi.fn(async (request: Record<string, unknown>) => request.operation === 'list_discrepancies'
      ? { ok: true, data: { ...reviewPage, counters } }
      : { ok: true, data: { saved: true } });
    const client = createBunchQueueClient({ scopeKey: 'reviewer-custom', transport, storage: storage(), online: () => true, uuid: () => 'custom-counter-receipt' });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client, true); await Promise.resolve(); });
    const selector = await screen.findByRole('combobox', { name: 'Assign Recount To review-1' });
    expect(Array.from((selector as HTMLSelectElement).options).slice(1, 4).map(option => option.textContent)).toEqual(['Sharon', 'Dylan', 'Worker Z']);
    fireEvent.change(selector, { target: { value: '__custom_username__' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom Count Team username review-1' }), { target: { value: 'seasonal_counter' } });
    expect(screen.getByText(/An unmatched name is saved as a tag; it does not create an account/)).toBeTruthy();
    const customInput = screen.getByRole('textbox', { name: 'Custom Count Team username review-1' }) as HTMLInputElement;
    expect(customInput.maxLength).toBe(64);
    fireEvent.change(customInput, { target: { value: 'seasonal counter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Counter' }));
    expect((await screen.findByRole('alert')).textContent).toMatch('Use 1–64 characters: letters, numbers, periods, underscores, or hyphens.');
    expect(transport.mock.calls.some(call => call[0].operation === 'assign_counter')).toBe(false);
    fireEvent.change(customInput, { target: { value: 'seasonal_counter' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Recount Qty row-1' }), { target: { value: '4' } });
    expect(client.draft('review:review-1')).toMatchObject({ counter: '__custom_username__', counter_username: 'seasonal_counter', 'row-1': '4' });
    fireEvent.click(screen.getByRole('button', { name: 'Assign Counter' }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({ operation: 'assign_counter', payload: { review_id: 'review-1', counter_username: 'seasonal_counter', expected_revision: 3 }, expectedRevision: 3 }), expect.any(AbortSignal)));
    expect(client.draft('review:review-1')).toMatchObject({ counter: '__custom_username__', counter_username: 'seasonal_counter' });
    await act(async () => { mounted.destroy(); client.dispose(); });
  });
});
