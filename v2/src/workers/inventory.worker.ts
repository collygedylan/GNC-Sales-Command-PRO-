/// <reference lib="webworker" />
import { compareAvRows, normalizeItemcode } from '../avSort';
import type { InventoryRow } from '../types';

type WorkerRequest = {
  id: string;
  rows: InventoryRow[];
  search?: string;
  selectedYear?: number;
  itemcode?: string;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, rows, search = '', selectedYear = 27, itemcode } = event.data;
  const term = search.trim().toLowerCase();
  const normalizedItem = normalizeItemcode(itemcode);
  const result = rows
    .filter(row => !normalizedItem || normalizeItemcode(row.itemcode ?? row.ITEMCODE) === normalizedItem)
    .filter(row => !term || [row.itemcode, row.commonname, row.locationcode, row.lotcode].some(value => String(value ?? '').toLowerCase().includes(term)))
    .sort((a, b) => compareAvRows(a, b, selectedYear));
  self.postMessage({ id, rows: result });
};

export {};
