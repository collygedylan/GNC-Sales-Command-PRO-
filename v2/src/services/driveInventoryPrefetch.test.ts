// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInventoryPage } from './api';
import { createDriveInventoryPrefetch, DRIVE_INVENTORY_PAGE_SIZE } from './driveInventoryPrefetch';

vi.mock('./api', () => ({ fetchInventoryPage: vi.fn() }));

const fetchPage = vi.mocked(fetchInventoryPage);

afterEach(() => vi.resetAllMocks());

describe('selected Drive page prefetch', () => {
  it('starts only the first unfiltered page with a cancelable signal', () => {
    fetchPage.mockReturnValue(new Promise(() => {}));
    const prefetch = createDriveInventoryPrefetch();
    const options = fetchPage.mock.calls[0]?.[0];
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(options).toMatchObject({ page: 0, pageSize: DRIVE_INVENTORY_PAGE_SIZE, search: '' });
    expect(options?.signal?.aborted).toBe(false);
    prefetch.abort();
    expect(options?.signal?.aborted).toBe(true);
  });

  it('preserves the original promise for the component to consume', () => {
    const promise = Promise.reject(new Error('fixture rejection'));
    fetchPage.mockReturnValue(promise);
    const prefetch = createDriveInventoryPrefetch();
    expect(prefetch.promise).toBe(promise);
  });

  it('defers cancellation through StrictMode effect replay but aborts after the final release', async () => {
    fetchPage.mockReturnValue(new Promise(() => {}));
    const prefetch = createDriveInventoryPrefetch();
    const signal = fetchPage.mock.calls[0]?.[0]?.signal;
    const releaseFirst = prefetch.retain();
    releaseFirst();
    const releaseReplay = prefetch.retain();
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    releaseReplay();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
  });
});
