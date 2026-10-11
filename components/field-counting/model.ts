import type { CountingLotRow, CountRow, CountingOption } from './contract';

export type CountInputState = Record<string, string>;
export const MAX_COUNT_QUANTITY = 999_999_999;

export function parseWholeCount(value: unknown): { value: number | null; valid: boolean } {
  const text = String(value ?? '').trim();
  if (!text) return { value: null, valid: true };
  if (!/^\d+$/.test(text)) return { value: null, valid: false };
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_COUNT_QUANTITY
    ? { value: parsed, valid: true }
    : { value: null, valid: false };
}

export function countInputKey(countType: string, sourceUid: string): string {
  return `${countType}:${sourceUid}`;
}

export function stableCommandId<T>(mode: string, payload: T, pending: Map<string, string>, createId = () => crypto.randomUUID()): { fingerprint: string; commandId: string } {
  const fingerprint = JSON.stringify([mode, payload]);
  return { fingerprint, commandId: pending.get(fingerprint) || createId() };
}

export function countInputValue(
  row: CountingLotRow,
  countType: string,
  drafts: CountInputState,
  saved: Map<string, CountRow>
): string {
  const key = countInputKey(countType, row.sourceUid);
  if (Object.prototype.hasOwnProperty.call(drafts, key)) return drafts[key];
  const existing = saved.get(row.sourceUid)?.countedQty;
  return existing == null ? '' : String(existing);
}

export function availableCountOptions(options: CountingOption[]): CountingOption[] {
  return options.filter(option => String(option.value || '').trim());
}

export function moveRowOrder<T extends CountingLotRow>(rows: T[], sourceUid: string, delta: -1 | 1): T[] {
  const index = rows.findIndex(row => row.sourceUid === sourceUid);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return rows;
  const next = rows.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

export function rowsWithSavedCounts(rows: CountingLotRow[], counts: CountRow[]): CountingLotRow[] {
  const savedUids = new Set(counts.filter(row => row.countedQty !== null).map(row => row.sourceUid));
  return rows.filter(row => savedUids.has(row.sourceUid));
}
