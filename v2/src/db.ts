import Dexie, { type EntityTable } from 'dexie';
import type { InventoryRow, UploadJob, UserPreferences } from './types';

export type CachedRow = InventoryRow & { cachedAt: number };
export type DraftRecord = { id: string; moduleKey: string; payload: Record<string, unknown>; updatedAt: number };
export type OutboxRecord = { id: string; operation: string; payload: Record<string, unknown>; attempts: number; createdAt: number };

export const sandboxDb = new Dexie('gnc-field-v2-sandbox') as Dexie & {
  inventory: EntityTable<CachedRow, 'unique_id'>;
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

export async function cacheInventoryRows(rows: InventoryRow[]) {
  const cachedAt = Date.now();
  await sandboxDb.inventory.bulkPut(rows.map(row => ({ ...row, cachedAt })));
}

export async function readCachedInventory(limit = 100) {
  return sandboxDb.inventory.orderBy('cachedAt').reverse().limit(limit).toArray();
}

export async function cacheInventoryPage(_page: number, _pageSize: number, rows: InventoryRow[]) {
  await cacheInventoryRows(rows);
}

export async function readCachedInventoryPage(page = 0, pageSize = 100) {
  const offset = Math.max(0, page) * Math.max(1, pageSize);
  return sandboxDb.inventory
    .orderBy('commonname')
    .offset(offset)
    .limit(Math.max(1, pageSize))
    .toArray();
}

export async function savePreference(preferences: UserPreferences) {
  await sandboxDb.preferences.put(preferences);
}
