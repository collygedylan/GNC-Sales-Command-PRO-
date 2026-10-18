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
afterEach(() => { hosts.splice(0).forEach(node => node.remove()); });

describe('Bunch Notes queue cards', () => {
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }), { target: { value: '7' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Work' }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'complete_card',
      payload: { job_id: 'job-1', card_id: 'card-1', actual_qty_by_row: { 'row-1': 7, 'row-2': 9 } },
      commandId: 'card-receipt', expectedRevision: 4,
    }), expect.any(AbortSignal)));
    await act(async () => { mounted.destroy(); client.dispose(); });
  });

  it('renders cached assignment work and saved quantities while offline', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const saved = storage();
    saved.setItem('gnc:bunch-queue:v230:worker-offline:mine:0', JSON.stringify(queuePage));
    saved.setItem('gnc:bunch-queue:v230:worker-offline:draft:job-1:card-1', JSON.stringify({ 'row-1': '5', 'row-2': '6' }));
    const transport = vi.fn();
    const client = createBunchQueueClient({ scopeKey: 'worker-offline', transport, storage: saved, online: () => false });
    let mounted!: ReturnType<typeof mountBunchQueue>;
    await act(async () => { mounted = mountBunchQueue(host(), client); await Promise.resolve(); });
    expect((await screen.findByRole('status')).textContent).toMatch(/Offline/);
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-1' }) as HTMLInputElement).value).toBe('5');
    expect((screen.getByRole('textbox', { name: 'Actual Qty Completed row-2' }) as HTMLInputElement).value).toBe('6');
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
