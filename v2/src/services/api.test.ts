import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  response: null as unknown,
  cachedRows: null as unknown[] | null,
  cacheKeys: [] as string[],
  readKeys: [] as string[]
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      harness.calls.push(['from', table]);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'range', 'or', 'abortSignal', 'update', 'insert', 'eq', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          harness.calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) =>
        Promise.resolve(harness.response).then(resolve, reject);
      return builder;
    }
  }))
}));
vi.mock('./runtime', () => ({ loadRuntimeConfig: vi.fn().mockResolvedValue({
  environment: 'sandbox', projectRef: 'gnc-sandbox-006', productionProjectRef: 'kzrnyjsosryejjejliii',
  supabaseUrl: 'https://gnc-sandbox-006.supabase.co', publishableKey: 'sb_publishable_test'
}) }));
vi.mock('./cache', () => ({
  cacheInventoryPage: vi.fn((key: string) => { harness.cacheKeys.push(key); return Promise.resolve(); }),
  readCachedInventoryPage: vi.fn((key: string) => { harness.readKeys.push(key); return Promise.resolve(harness.cachedRows); }),
  savePreference: vi.fn()
}));

import { dbRows, fetchInventoryPage, INVENTORY_CARD_COLUMN_NAMES, INVENTORY_TABLE, storeSession, patchRow, REQUEST_TABLE, isAdminSession, isEvalSession } from './api';

describe('Eval data access boundary', () => {
  it('recognizes Eval role variants while leaving explicit Admin roles distinct', () => {
    expect(isEvalSession({ username: 'eval-user', token: 'eval-token', role: 'Evaluator' })).toBe(true);
    expect(isEvalSession({ username: 'eval-user', token: 'eval-token', role: 'Eval Admin' })).toBe(true);
    expect(isAdminSession({ username: 'admin-user', token: 'admin-token', role: 'Admin' })).toBe(true);
    expect(isEvalSession({ username: 'admin-user', token: 'admin-token', role: 'Admin' })).toBe(false);
  });

  it('uses a safe projection and removes nested pricing or administrative fields', async () => {
    harness.response = { data: [{ unique_id: 'cav-1', itemcode: '100.1', unitprice: 19, source_payload: { listprice: 22, available: 4 }, available: 4, amountMoved: 3, amountThrownAway: 1 }], error: null };

    const rows = await dbRows({ username: 'eval-user', token: 'eval-token', role: 'Evaluator' }, 'ph_cav_import', 'limit=10');

    const select = harness.calls.find(([method]) => method === 'select');
    expect(select?.[1]).toContain('available');
    expect(select?.[1]).not.toContain('unitprice');
    expect(select?.[1]).not.toContain('source_payload');
    expect(rows).toEqual([{ unique_id: 'cav-1', itemcode: '100.1', available: 4, amountMoved: 3, amountThrownAway: 1 }]);
    await expect(patchRow({ username: 'eval-user', token: 'eval-token', role: 'Eval' }, 'ph_cav_import', 'cav-1', { unitprice: 25 }))
      .rejects.toThrow(/cannot be changed by Eval/i);
    expect(harness.calls.some(([method]) => method === 'update')).toBe(false);
  });

  it('blocks Eval access to administrative tables and leaves explicit Admin data unrestricted', async () => {
    await expect(dbRows({ username: 'eval-user', token: 'eval-token', role: 'Eval' }, 'sandbox_profiles', ''))
      .rejects.toThrow(/administrative data is not available/i);
    harness.response = { data: [{ unitprice: 19, source_payload: { listprice: 22 } }], error: null };

    const rows = await dbRows({ username: 'admin-user', token: 'admin-token', role: 'Admin' }, 'ph_cav_import', '');

    expect(harness.calls).toContainEqual(['select', '*']);
    expect(rows).toEqual([{ unitprice: 19, source_payload: { listprice: 22 } }]);
  });
});

describe('schema-checked request updates', () => {
  it('converts input quantities and blanks to native database values', async () => {
    harness.response = { data: [{ unique_id: 'request-1' }], error: null };
    await patchRow({ username: 'fixture', token: 'fixture-token' }, REQUEST_TABLE, 'request-1', { REQ_QTY: '12', LOC_MATCH: '', REQ_ARCHIVED: false });
    expect(harness.calls).toContainEqual(['update', { req_qty: 12, req_match: null, req_archived: false }]);
    expect(harness.calls).toContainEqual(['eq', 'unique_id', 'request-1']);
  });
  it('rejects invalid numeric inputs and columns absent from the schema', async () => {
    await expect(patchRow({ username: 'fixture', token: 'fixture-token' }, REQUEST_TABLE, 'request-1', { REQ_QTY: 'twelve' })).rejects.toThrow(/enter a number/);
    await expect(patchRow({ username: 'fixture', token: 'fixture-token' }, REQUEST_TABLE, 'request-1', { missing_column: true })).rejects.toThrow(/database schema/);
    expect(harness.calls.some(([method]) => method === 'update')).toBe(false);
  });
});

afterEach(() => {
  harness.calls = [];
  harness.response = null;
  harness.cachedRows = null;
  harness.cacheKeys = [];
  harness.readKeys = [];
  vi.resetModules();
});

describe('sandbox inventory projection', () => {
  it('uses a schema-backed narrow projection, count, stable order, bounded page, search, and cancellation', async () => {
    const signal = new AbortController().signal;
    harness.response = { data: [{ unique_id: 'sandbox-1', commonname: 'Pear', photo_link: null }], count: 501, error: null };

    const result = await fetchInventoryPage({ page: 2, pageSize: 100, search: 'pear', signal });

    expect(INVENTORY_TABLE).toBe('ph_master_inventory');
    expect([...INVENTORY_CARD_COLUMN_NAMES]).toEqual([
      'unique_id', 'itemcode', 'commonname', 'contsize', 'locationcode', 'lotcode',
      'ptravailable', 'ptronhand', 'ptrreviewed', 'priority', 'season', 'season_supply',
      'saleyear', 'blockalpha', 'blocknumber', 'holdstopcode', 'photo_link', 'photo_name'
    ]);
    expect(harness.calls).toContainEqual(['from', 'ph_master_inventory']);
    expect(harness.calls).toContainEqual(['select', INVENTORY_CARD_COLUMN_NAMES.join(','), { count: 'exact' }]);
    expect(harness.calls).toContainEqual(['order', 'commonname', { ascending: true }]);
    expect(harness.calls).toContainEqual(['order', 'unique_id', { ascending: true }]);
    expect(harness.calls).toContainEqual(['range', 200, 299]);
    expect(harness.calls).toContainEqual(['abortSignal', signal]);
    expect(harness.calls.some(([method]) => method === 'or')).toBe(true);
    expect(result).toMatchObject({ rows: [{ unique_id: 'sandbox-1' }], page: 2, pageSize: 100, total: 501, source: 'sandbox' });
    expect(harness.cacheKeys).toHaveLength(1);
    expect(harness.cacheKeys[0]).toContain('pear');
    expect(harness.cacheKeys[0]).toContain('2');
    expect(harness.cacheKeys[0]).not.toContain('sandbox:dylan_collyge');
  });

  it('uses only the exact identity, search, page, and projection snapshot after a failed read', async () => {
    harness.response = { data: null, count: null, error: new Error('offline') };
    harness.cachedRows = [{ unique_id: 'cached-pear', commonname: 'Pear' }];
    const first = await fetchInventoryPage({ page: 1, pageSize: 100, search: 'pear' });
    expect(first).toMatchObject({ rows: harness.cachedRows, page: 1, source: 'cache' });
    expect(harness.readKeys[0]).toContain('pear');
    expect(harness.readKeys[0]).toContain('1');

    harness.cachedRows = null;
    await expect(fetchInventoryPage({ page: 1, pageSize: 100, search: 'maple' })).rejects.toThrow('offline');
    expect(harness.readKeys[1]).toContain('maple');
    expect(harness.readKeys[1]).not.toBe(harness.readKeys[0]);
  });

  it('does not use cached rows for terminal permission errors', async () => {
    harness.response = { data: null, count: null, error: Object.assign(new Error('denied'), { status: 403, code: '42501' }) };
    harness.cachedRows = [{ unique_id: 'cached-pear', commonname: 'Pear' }];
    await expect(fetchInventoryPage({ search: 'pear' })).rejects.toMatchObject({ status: 403, code: '42501' });
    expect(harness.readKeys).toEqual([]);
  });

  it('rejects an inventory response that completes after the sandbox session changes', async () => {
    let resolveResponse!: (value: unknown) => void;
    harness.response = new Promise(resolve => { resolveResponse = resolve; });
    const pending = fetchInventoryPage({ search: 'pear' });
    await new Promise(resolve => setTimeout(resolve, 0));
    storeSession(null);
    resolveResponse({ data: [{ unique_id: 'stale-account-row' }], count: 1, error: null });
    await expect(pending).rejects.toThrow('account changed');
  });
});
