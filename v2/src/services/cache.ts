import Dexie, { type EntityTable } from 'dexie';
import type { InventoryRow, UploadJob, UserPreferences } from '../types';

export type CachedRow = InventoryRow & { cachedAt: number };
export type CachedInventoryPage = { cacheKey: string; rows: InventoryRow[]; cachedAt: number };
export type DraftRecord = { id: string; moduleKey: string; payload: Record<string, unknown>; updatedAt: number };
export type OutboxRecord = { id: string; operation: string; payload: Record<string, unknown>; attempts: number; createdAt: number };

export const sandboxDb = new Dexie('gnc-field-v2-sandbox') as Dexie & {
  inventory: EntityTable<CachedRow, 'unique_id'>;
  inventoryPages: EntityTable<CachedInventoryPage, 'cacheKey'>;
  preferences: EntityTable<UserPreferences, 'username'>;
  drafts: EntityTable<DraftRecord, 'id'>;
  outbox: EntityTable<OutboxRecord, 'id'>;
  uploads: EntityTable<UploadJob, 'id'>;
};

sandboxDb.version(1).stores({
  inventory: 'unique_id,itemcode,locationcode,saleyear,blockalpha,cachedAt',
  preferences: 'username,updatedAt',
  drafts: 'id,moduleKey,updatedAt',
  outbox: 'id,operation,createdAt',
  uploads: 'id,requestId,state,updatedAt'
});

sandboxDb.version(2).stores({
  inventory: 'unique_id,itemcode,locationcode,saleyear,blockalpha,cachedAt',
  inventoryPages: 'cacheKey,cachedAt',
  preferences: 'username,updatedAt',
  drafts: 'id,moduleKey,updatedAt',
  outbox: 'id,operation,createdAt',
  uploads: 'id,requestId,state,updatedAt'
});

export async function cacheInventoryRows(rows: InventoryRow[]) {
  const cachedAt = Date.now();
  await sandboxDb.inventory.bulkPut(rows.map(row => ({ ...row, cachedAt })));
}

export async function readCachedInventory(limit = 100) {
  return sandboxDb.inventory.orderBy('cachedAt').reverse().limit(limit).toArray();
}

export async function cacheInventoryPage(cacheKey: string, scopeKey: string, rows: InventoryRow[]) {
  await sandboxDb.inventoryPages.put({ cacheKey, rows, cachedAt: Date.now() });
  const scoped = await sandboxDb.inventoryPages
    .where('cacheKey').startsWith(scopeKey).toArray();
  if (scoped.length > 12) {
    const stale = scoped.sort((a, b) => a.cachedAt - b.cachedAt).slice(0, scoped.length - 12);
    await sandboxDb.inventoryPages.bulkDelete(stale.map(page => page.cacheKey));
  }
}

export async function readCachedInventoryPage(cacheKey: string): Promise<InventoryRow[] | null> {
  const cached = await sandboxDb.inventoryPages.get(cacheKey);
  return cached?.rows ?? null;
}

export async function savePreference(preferences: UserPreferences) {
  await sandboxDb.preferences.put(preferences);
}
