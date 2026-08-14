import type { AvOptionRow, InventoryRow } from './types';

export function normalizeItemcode(value: unknown) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function numericYear(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function numericBlock(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function avYearRank(year: number, selectedYear: number) {
  if (year === selectedYear) return [0, 0] as const;
  if (year < selectedYear) return [1, -year] as const;
  return [2, year] as const;
}

export function compareAvRows(a: InventoryRow, b: InventoryRow, selectedYear = 27) {
  const ay = numericYear(a.saleyear ?? a.SALESYEAR);
  const by = numericYear(b.saleyear ?? b.SALESYEAR);
  const ar = avYearRank(ay, selectedYear);
  const br = avYearRank(by, selectedYear);
  if (ar[0] !== br[0]) return ar[0] - br[0];
  if (ar[1] !== br[1]) return ar[1] - br[1];
  const alpha = String(a.blockalpha ?? a.BLOCKALPHA ?? '').localeCompare(String(b.blockalpha ?? b.BLOCKALPHA ?? ''), undefined, { sensitivity: 'base' });
  if (alpha) return alpha;
  const block = numericBlock(a.blocknumber ?? a.BLOCKNUMBER) - numericBlock(b.blocknumber ?? b.BLOCKNUMBER);
  if (block) return block;
  const location = String(a.locationcode ?? a.LOCATIONCODE ?? '').localeCompare(String(b.locationcode ?? b.LOCATIONCODE ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  if (location) return location;
  return String(a.unique_id).localeCompare(String(b.unique_id), undefined, { numeric: true });
}

export function selectAndSortAvRows(rows: InventoryRow[], itemcode: unknown, selectedYear = 27): AvOptionRow[] {
  const normalizedItemcode = normalizeItemcode(itemcode);
  return rows
    .filter(row => normalizeItemcode(row.itemcode ?? row.ITEMCODE) === normalizedItemcode)
    .map(row => ({ ...row, normalizedItemcode }))
    .sort((a, b) => compareAvRows(a, b, selectedYear));
}
