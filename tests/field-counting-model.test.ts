import { describe, expect, it } from 'vitest';
import { countInputValue, moveRowOrder, parseWholeCount, rowsWithSavedCounts, stableCommandId } from '../components/field-counting/model';
import type { CountRow, CountingLotRow } from '../components/field-counting/contract';

const rows: CountingLotRow[] = [
  { sourceUid: 'a', block: 'A', location: 'A.1', itemcode: 'I', commonname: 'Plant A', contsize: '#3', lotcode: '27.F1', season: 'F1', onHand: '10' },
  { sourceUid: 'b', block: 'A', location: 'A.1', itemcode: 'I', commonname: 'Plant B', contsize: '#5', lotcode: '27.F1', season: 'F1', onHand: null }
];

describe('field counting model', () => {
  it('accepts zero and nonnegative whole counts, while rejecting fractions and invalid text', () => {
    expect(parseWholeCount('0')).toEqual({ value: 0, valid: true });
    expect(parseWholeCount(' 23 ')).toEqual({ value: 23, valid: true });
    expect(parseWholeCount('')).toEqual({ value: null, valid: true });
    expect(parseWholeCount('-1')).toEqual({ value: null, valid: false });
    expect(parseWholeCount('1.5')).toEqual({ value: null, valid: false });
    expect(parseWholeCount('2e3')).toEqual({ value: null, valid: false });
    expect(parseWholeCount('9007199254740992')).toEqual({ value: null, valid: false });
    expect(parseWholeCount('999999999')).toEqual({ value: 999999999, valid: true });
    expect(parseWholeCount('1000000000')).toEqual({ value: null, valid: false });
  });

  it('uses unsaved input before saved quantity and keeps unknown on-hand distinct', () => {
    const saved: CountRow = { sourceUid: 'a', countedQty: 0, direction: 'north_south', rowOrder: 1, note: '', updatedAt: '2026-10-10T10:00:00Z', actor: 'Dylan' };
    expect(countInputValue(rows[0], 'bunch', {}, new Map([['a', saved]]))).toBe('0');
    expect(countInputValue(rows[0], 'bunch', { 'bunch:a': '4' }, new Map([['a', saved]]))).toBe('4');
    expect(rows[1].onHand).toBeNull();
  });

  it('reorders only existing rows and keeps all rows with saved counts', () => {
    expect(moveRowOrder(rows, 'b', -1).map(row => row.sourceUid)).toEqual(['b', 'a']);
    expect(moveRowOrder(rows, 'missing', -1)).toBe(rows);
    expect(rowsWithSavedCounts(rows, [{ sourceUid: 'b', countedQty: 0, direction: '', rowOrder: 1, note: '', updatedAt: '', actor: '' }])).toEqual([rows[1]]);
  });

  it('keeps the same command id for an identical uncertain retry and changes it when the payload changes', () => {
    const pending = new Map<string, string>();
    let next = 0;
    const createId = () => `command-${++next}`;
    const payload = { countType: 'bunch', entries: [{ sourceUid: 'a', countedQty: 0 }] };
    const first = stableCommandId('complete', payload, pending, createId);
    pending.set(first.fingerprint, first.commandId);
    const retry = stableCommandId('complete', payload, pending, createId);
    expect(retry.commandId).toBe(first.commandId);
    expect(stableCommandId('complete', { ...payload, entries: [{ sourceUid: 'a', countedQty: 1 }] }, pending, createId).commandId).not.toBe(first.commandId);
  });
});
