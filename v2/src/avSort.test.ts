import { describe, expect, it } from 'vitest';
import { normalizeItemcode, selectAndSortAvRows } from './avSort';
import type { InventoryRow } from './types';

function row(
  id: string,
  salesYear: number,
  blockAlpha: string,
  blockNumber: number,
  locationcode: string,
  itemcode = '003746.030.1',
): InventoryRow {
  return {
    unique_id: id,
    itemcode,
    saleyear: salesYear,
    blockalpha: blockAlpha,
    blocknumber: blockNumber,
    locationcode,
  };
}

describe('AV option ordering', () => {
  it('normalizes item codes before matching', () => {
    expect(normalizeItemcode(' 003746.030.1 ')).toBe('003746.030.1');
  });

  it('places the selected year first, older years descending, and future years last', () => {
    const rows = [
      row('future', 28, 'A', 1, 'A.01.000'),
      row('older-25', 25, 'A', 1, 'A.01.000'),
      row('selected-b10', 27, 'B', 10, 'B.10.000'),
      row('older-26', 26, 'A', 1, 'A.01.000'),
      row('selected-a2', 27, 'A', 2, 'A.02.000'),
      row('selected-a10', 27, 'A', 10, 'A.10.000'),
      row('other-item', 27, 'A', 1, 'A.01.000', 'OTHER'),
    ];

    expect(selectAndSortAvRows(rows, '003746.030.1', 27).map(option => option.unique_id)).toEqual([
      'selected-a2',
      'selected-a10',
      'selected-b10',
      'older-26',
      'older-25',
      'future',
    ]);
  });
});
