import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearImportHistorySessions, createImportHistoryService, IMPORT_HISTORY_PAGE_SIZE, type ImportHistoryDataset } from '../services/importHistory';

const snapshotId = '71000000-0000-4000-8000-000000000001';
const row = (index: number) => ({ rowNumber: index, values: [`ITEM-${index}`, index] });
const snapshot = (dataset: ImportHistoryDataset = 'drive') => ({
  snapshotId, dataset, displayLabel: '2026-10-14 01', reportDate: '2026-10-14', sequence: 1,
  rowCount: 60, columns: ['itemcode', 'quantityordered']
});
const filePage = (dataset: ImportHistoryDataset = 'drive') => ({ files: [snapshot(dataset)], hasMore: false, nextCursor: null });

function service(transport: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>,
  owner: { scope: string; permission: string } = { scope: 'account-a', permission: 'p1' }) {
  return createImportHistoryService({ scopeKey: () => owner.scope, permissionVersion: () => owner.permission,
    transport: transport as never });
}

afterEach(() => clearImportHistorySessions());

describe('import history service', () => {
  it('requests bounded manifest and row cursors and caches snapshot choices and row pages by session', async () => {
    const transport = vi.fn(async (name: string, args: Record<string, unknown>) => name === 'list_import_history_v1'
      ? filePage(args.p_dataset as ImportHistoryDataset)
      : { snapshotId, rows: [row(1), row(2)], hasMore: true, nextRow: 2 });
    const first = service(transport), revisited = service(transport);
    await expect(first.listSnapshots('drive')).resolves.toEqual(filePage());
    await expect(revisited.listSnapshots('drive')).resolves.toEqual(filePage());
    await expect(first.readRows(snapshotId, ['itemcode', 'quantityordered'])).resolves.toMatchObject({ rows: [row(1), row(2)], hasMore: true, nextRow: 2 });
    await expect(revisited.readRows(snapshotId, ['itemcode', 'quantityordered'])).resolves.toMatchObject({ rows: [row(1), row(2)] });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][1]).toEqual({ p_dataset: 'drive', p_before_date: null, p_before_sequence: null, p_limit: 50 });
    expect(transport.mock.calls[1][1]).toEqual({ p_snapshot_id: snapshotId, p_after_row: 0, p_limit: IMPORT_HISTORY_PAGE_SIZE });
  });

  it('prefetches choices for all supported datasets and keeps their caches separate', async () => {
    const transport = vi.fn(async (_name: string, args: Record<string, unknown>) => filePage(args.p_dataset as ImportHistoryDataset));
    const instance = service(transport);
    const results = await instance.prefetchSnapshotChoices();
    expect(results).toHaveLength(3);
    expect(transport.mock.calls.map(call => call[1].p_dataset).sort()).toEqual(['drive', 'reserves', 'soc']);
    await instance.listSnapshots('soc');
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('preserves positional source headers including blank, duplicate, long, and wide schemas', async () => {
    const columns = ['', 'duplicate', 'duplicate', 'x'.repeat(300), ...Array.from({ length: 260 }, (_, index) => `source_${index}`)];
    const widePage = { ...filePage(), files: [{ ...snapshot(), columns }] };
    const instance = service(async () => widePage);
    await expect(instance.listSnapshots('drive')).resolves.toMatchObject({ files: [{ columns }] });
  });

  it('rejects malformed snapshot labels, cross-dataset responses, oversized pages, and forged row cursors', async () => {
    const wrongLabel = { ...filePage(), files: [{ ...snapshot(), displayLabel: 'Latest' }] };
    const wrongDataset = filePage('soc');
    const oversizedRows = { snapshotId, rows: Array.from({ length: 51 }, (_, index) => row(index + 1)), hasMore: false, nextRow: null };
    const badCursor = { snapshotId, rows: [row(1)], hasMore: true, nextRow: 2 };
    const transport = vi.fn(async (name: string) => name === 'list_import_history_v1'
      ? (transport.mock.calls.length === 1 ? wrongLabel : wrongDataset)
      : (transport.mock.calls.length === 3 ? oversizedRows : badCursor));
    const instance = service(transport);
    await expect(instance.listSnapshots('drive')).rejects.toThrow('snapshot metadata is invalid');
    await expect(instance.listSnapshots('drive')).rejects.toThrow('snapshot metadata is invalid');
    await expect(instance.readRows(snapshotId, ['itemcode', 'quantityordered'])).rejects.toThrow('row page is invalid');
    await expect(instance.readRows(snapshotId, ['itemcode', 'quantityordered'])).rejects.toThrow('cursor is incomplete');
  });

  it('deduplicates overlapping refresh clicks for the same page', async () => {
    let finish!: (value: unknown) => void;
    const transport = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const instance = service(transport);
    const first = instance.listSnapshots('drive', null, true);
    const second = instance.listSnapshots('drive', null, true);
    expect(transport).toHaveBeenCalledTimes(1);
    finish(filePage());
    await expect(first).resolves.toEqual(filePage());
    await expect(second).resolves.toEqual(filePage());
  });

  it('cancels in-flight reads and refuses replies after the account permission scope changes', async () => {
    const owner = { scope: 'account-a', permission: 'p1' };
    let finish!: (value: unknown) => void;
    let requestSignal: AbortSignal | undefined;
    const instance = service((_name, _args, signal) => {
      requestSignal = signal;
      return new Promise(resolve => { finish = resolve; });
    }, owner);
    const pending = instance.listSnapshots('drive').catch(error => error);
    await Promise.resolve();
    owner.scope = 'account-b';
    owner.permission = 'p2';
    await expect(instance.listSnapshots('drive')).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);
    finish(filePage());
    expect((await pending).name).toBe('AbortError');
    const otherAccount = service(async () => filePage(), owner);
    await expect(otherAccount.listSnapshots('drive')).resolves.toEqual(filePage());
  });

  it('aborts and clears cached choices when its owner explicitly clears the session', async () => {
    let signal: AbortSignal | undefined;
    const instance = service((_name, _args, requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => requestSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }));
    });
    const pending = instance.listSnapshots('drive').catch(error => error);
    await Promise.resolve();
    instance.clear();
    expect(signal?.aborted).toBe(true);
    expect((await pending).name).toBe('AbortError');
  });
});
