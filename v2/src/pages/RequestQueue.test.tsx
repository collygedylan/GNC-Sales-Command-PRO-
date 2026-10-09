// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestQueue } from './RequestQueue';
import type { RequestQueueProps } from './RequestQueue';
import type { RequestRow } from '../services/api';
import type { RequestColumnKey } from './requestQueueConfig';

afterEach(() => cleanup());

const row: RequestRow = {
  unique_id: 'queue-1',
  COMMONNAME: 'Blue Atlas Cedar',
  ITEMCODE: '100.010.1',
  LOCATIONCODE: 'A.01.002',
  LOTCODE: '27.F1',
  CONTSIZE: '#3',
  QTY: 4
};
const rows = [row];

describe('Que rendering boundary', () => {
  it('does not rerender unchanged list rows for shell-only updates', () => {
    const commits = vi.fn();
    const props: RequestQueueProps = {
      rows,
      allRows: rows,
      activeTab: 'request',
      displayMode: 'cards',
      columnKeys: ['item', 'common', 'loc'],
      loading: false,
      onTab: vi.fn(),
      onOpen: vi.fn(),
      onRemove: vi.fn(),
      onRefresh: vi.fn()
    };
    function ShellHarness() {
      const [toast, setToast] = useState(false);
      return <>
        <button type="button" onClick={() => setToast(value => !value)}>Toggle shell toast</button>
        {toast ? <output>Saved</output> : null}
        <Profiler id="queue" onRender={commits}><RequestQueue {...props} /></Profiler>
      </>;
    }

    render(<ShellHarness />);
    const settledQueueCommitCount = commits.mock.calls.length;
    expect(settledQueueCommitCount).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle shell toast' }));
    expect(screen.getByText('Saved')).toBeTruthy();
    const [, , actualDuration, baseDuration] = commits.mock.calls[commits.mock.calls.length - 1];
    expect(commits.mock.calls.length).toBeGreaterThanOrEqual(settledQueueCommitCount);
    expect(actualDuration).toBeLessThan(baseDuration * 0.1);
    expect(screen.getByText('Blue Atlas Cedar')).toBeTruthy();
  });

  it('keeps the existing open and remove actions bound to their row', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(<RequestQueue
      rows={rows}
      allRows={rows}
      activeTab="request"
      displayMode="cards"
      columnKeys={['item', 'common', 'loc']}
      loading={false}
      onTab={vi.fn()}
      onOpen={onOpen}
      onRemove={onRemove}
      onRefresh={vi.fn()}
    />);
    const card = screen.getByRole('article');
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(row);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(row);
  });

  it('does not read or rerender unchanged grid rows when one row is updated', () => {
    const trackedRow = () => {
      const reads = { item: 0, common: 0, location: 0 };
      const value = {
        unique_id: 'grid-stable',
        REQ_STATUS: 'Pending',
        REQ_ARCHIVED: false,
        ITEMCODE: '200.010.1',
        COMMONNAME: 'Stable cedar',
        LOCATIONCODE: 'B.02.003'
      } as RequestRow;
      for (const [key, property] of [['item', 'ITEMCODE'], ['common', 'COMMONNAME'], ['location', 'LOCATIONCODE']] as const) {
        const current = value[property];
        Object.defineProperty(value, property, { configurable: true, enumerable: true, get: () => { reads[key]++; return current; } });
      }
      return { value, reads };
    };
    const stable = trackedRow();
    const changed = trackedRow();
    const onTab = vi.fn(), onOpen = vi.fn(), onRemove = vi.fn(), onRefresh = vi.fn();
    const columnKeys: RequestColumnKey[] = ['item', 'common', 'loc'];
    function GridHarness() {
      const [currentRows, setCurrentRows] = useState<RequestRow[]>([stable.value, changed.value]);
      return <>
        <button type="button" onClick={() => setCurrentRows(([first, second]) => [first, { ...second, COMMONNAME: 'Updated cedar' }])}>Update second row</button>
        <RequestQueue rows={currentRows} allRows={currentRows} activeTab="request" displayMode="grid" columnKeys={columnKeys}
          loading={false} onTab={onTab} onOpen={onOpen} onRemove={onRemove} onRefresh={onRefresh} />
      </>;
    }

    render(<GridHarness />);
    const initialReads = { ...stable.reads };
    expect(initialReads).toEqual({ item: 1, common: 1, location: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Update second row' }));
    expect(screen.getByText('Updated cedar')).toBeTruthy();
    expect(stable.reads).toEqual(initialReads);
  });
});
