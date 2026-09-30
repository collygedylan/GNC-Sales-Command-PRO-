// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveInventory, aggregateDriveRows, safeInventoryPhotoUrl } from './DriveInventory';
import { fetchInventoryPage } from '../services/api';
import type { InventoryRow, PageResult } from '../types';

vi.mock('../services/api', () => ({ fetchInventoryPage: vi.fn() }));
vi.mock('../services/runtime', () => ({ loadRuntimeConfig: vi.fn().mockResolvedValue({ supabaseUrl: 'https://sandbox-project.supabase.co' }) }));

const fetchPage = vi.mocked(fetchInventoryPage);

function page(rows: InventoryRow[], options: Partial<PageResult<InventoryRow>> = {}): PageResult<InventoryRow> {
  return { rows, page: 0, pageSize: 100, total: rows.length, source: 'sandbox', ...options };
}

function inventoryRow(overrides: Partial<InventoryRow> = {}): InventoryRow {
  return {
    unique_id: 'uid-1',
    itemcode: '100.030.1',
    commonname: 'Precision Pear',
    contsize: '#3',
    locationcode: 'A.02.001',
    lotcode: '27.F1',
    ptravailable: 12,
    ptronhand: 15,
    ...overrides
  };
}

beforeEach(() => {
  fetchPage.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Drive Mode sandbox inventory', () => {
  it('aggregates available and on-hand values for item and compact location rows', async () => {
    fetchPage.mockResolvedValue(page([
      inventoryRow(),
      inventoryRow({ unique_id: 'uid-2', locationcode: 'B.04.003', lotcode: '27.S1', ptravailable: 8, ptronhand: 9 })
    ]));
    render(<DriveInventory />);

    const card = await screen.findByRole('article');
    expect(card.textContent).toContain('20');
    expect(card.textContent).toContain('24');
    fireEvent.click(within(card).getByRole('button', { name: 'Show Precision Pear locations' }));
    expect(card.textContent).toContain('A.02.001');
    expect(card.textContent).toContain('Available');
    expect(card.textContent).toContain('On Hand');
    expect(card.textContent).toContain('B.04.003');
  });

  it('leaves absent inventory counts blank instead of inventing zero', () => {
    const [group] = aggregateDriveRows([inventoryRow({ ptravailable: undefined, ptronhand: undefined })]);
    expect(group.available).toBeNull();
    expect(group.onHand).toBeNull();
  });

  it('loads only same-origin or configured sandbox-storage photos', () => {
    const row = inventoryRow({ photo_url: 'https://storage-sandbox.supabase.co/storage/v1/object/public/test/photo.jpg' });
    expect(safeInventoryPhotoUrl(row, 'storage-sandbox.supabase.co')).toContain('storage-sandbox.supabase.co');
    expect(safeInventoryPhotoUrl(row, 'other-sandbox.supabase.co')).toBe('');
    expect(safeInventoryPhotoUrl(inventoryRow({ photo_url: 'https://image-tracker.invalid/photo.jpg' }), 'storage-sandbox.supabase.co')).toBe('');
  });

  it('debounces search and aborts the previous read when the term changes', async () => {
    fetchPage.mockResolvedValue(page([inventoryRow()]));
    render(<DriveInventory />);
    await screen.findByRole('article');
    const search = screen.getByRole('textbox', { name: 'Search inventory' });
    fireEvent.change(search, { target: { value: 'pear' } });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage.mock.calls[0][0]?.signal?.aborted).toBe(true);
    expect(fetchPage.mock.calls[1][0]).toMatchObject({ search: 'pear', page: 0, pageSize: 100 });
  });

  it('keeps the last complete card visible and reports a failed replacement search', async () => {
    fetchPage.mockResolvedValueOnce(page([inventoryRow()])).mockRejectedValueOnce(new Error('Sandbox inventory unavailable'));
    render(<DriveInventory />);
    await screen.findByRole('article');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search inventory' }), { target: { value: 'missing' } });
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toContain('Sandbox inventory unavailable');
    expect(screen.getByRole('article').textContent).toContain('Precision Pear');
    expect(screen.getByText(/previous complete results/)).toBeTruthy();
  });

  it('labels a cached snapshot and does not imply the cache is a complete inventory', async () => {
    fetchPage.mockResolvedValueOnce(page([inventoryRow()], { source: 'cache' }));
    render(<DriveInventory />);
    expect(await screen.findByText(/Cached snapshot/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Load .* more rows/ })).toBeNull();
  });

  it('pages sandbox results on demand and keeps the page count bounded', async () => {
    fetchPage.mockResolvedValueOnce(page([inventoryRow()], { total: 201, source: 'sandbox' }))
      .mockResolvedValueOnce(page([inventoryRow({ unique_id: 'uid-2', itemcode: '200.020.1', commonname: 'Second Pear' })], { page: 1, total: 201, source: 'sandbox' }));
    render(<DriveInventory />);
    await screen.findByText(/Sandbox inventory/);
    const more = screen.getByRole('button', { name: 'Load 100 more rows' });
    await waitFor(() => expect(more.hasAttribute('disabled')).toBe(false));
    fireEvent.click(more);
    expect(await screen.findByText('Second Pear')).toBeTruthy();
    expect(fetchPage.mock.calls[1][0]).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('stops after ten pages and asks the user to narrow a larger search', async () => {
    fetchPage.mockImplementation(async options => {
      const pageIndex = options?.page || 0;
      return page([inventoryRow({ unique_id: `uid-${pageIndex}`, itemcode: `item-${pageIndex}`, commonname: `Plant ${pageIndex}` })], {
        page: pageIndex,
        total: 1200,
        source: 'sandbox'
      });
    });
    render(<DriveInventory />);
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    for (let expectedCalls = 2; expectedCalls <= 10; expectedCalls += 1) {
      const more = await screen.findByRole('button', { name: 'Load 100 more rows' });
      await waitFor(() => expect(more.hasAttribute('disabled')).toBe(false));
      fireEvent.click(more);
      await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(expectedCalls));
    }
    expect(screen.queryByRole('button', { name: 'Load 100 more rows' })).toBeNull();
    expect(screen.getByText(/narrow the search/i)).toBeTruthy();
  });

  it('cancels its active request on unmount', () => {
    fetchPage.mockReturnValue(new Promise(() => {}));
    const view = render(<DriveInventory />);
    const signal = fetchPage.mock.calls[0][0]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
