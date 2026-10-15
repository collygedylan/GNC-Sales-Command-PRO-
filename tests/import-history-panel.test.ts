// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderImportedFilesPanel, type ImportedFilesPanelState } from '../components/import-history/ImportedFilesPanel';
import type { ImportHistorySnapshot } from '../services/importHistory';

const snapshot: ImportHistorySnapshot = {
  snapshotId: '71000000-0000-4000-8000-000000000001', dataset: 'drive',
  displayLabel: '2026-10-14 01', reportDate: '2026-10-14', sequence: 1, rowCount: 12000,
  columns: Array.from({ length: 171 }, (_, index) => `column_${index}`)
};

function state(overrides: Partial<ImportedFilesPanelState> = {}): ImportedFilesPanelState {
  return {
    dataset: 'drive', files: [snapshot], hasMoreFiles: true, hasPreviousFiles: false, filePageNumber: 1,
    filesLoading: false, rows: Array.from({ length: 50 }, (_, index) => ({ rowNumber: index + 1,
      values: ['<img src=x onerror=alert(1)>', ...Array.from({ length: 170 }, () => index)] })),
    rowsLoading: false, rowsRefreshing: false, rowsError: '', filesError: '', selectedSnapshotId: snapshot.snapshotId,
    selectedSnapshot: snapshot, selectedColumnIndexes: snapshot.columns.slice(0, 8).map((_, index) => index), columnSearch: '', columnError: '',
    rowCount: 12000, pageNumber: 1, pageCount: 240, hasPrevious: false, hasMoreRows: true,
    ...overrides
  };
}

describe('Imported Files panel', () => {
  it('shows stable snapshot labels and renders only a bounded page with selected columns', () => {
    const host = document.createElement('div');
    host.innerHTML = renderImportedFilesPanel(state());
    expect(host.textContent).toContain('Drive');
    expect(host.textContent).toContain('2026-10-14 01');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
    expect(host.querySelectorAll('tbody td')).toHaveLength(400);
    expect(host.querySelectorAll('[data-import-column]')).toHaveLength(32);
    expect(host.textContent).toContain('Rows 1–50 of 12,000');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps cached rows visible beside a retryable refresh error', () => {
    const host = document.createElement('div');
    host.innerHTML = renderImportedFilesPanel(state({ rowsError: 'Refresh unavailable', rowsRefreshing: false }));
    expect(host.textContent).toContain('Refresh unavailable');
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(host.querySelector('[role="alert"] button')?.textContent).toContain('Retry');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(50);
  });

  it('keeps imported column names out of executable inline handler source', () => {
    const hostileSnapshot = { ...snapshot, columns: ["name'); alert(1); ('"] };
    const host = document.createElement('div');
    host.innerHTML = renderImportedFilesPanel(state({ files: [hostileSnapshot], selectedSnapshot: hostileSnapshot,
      selectedSnapshotId: hostileSnapshot.snapshotId, selectedColumnIndexes: [] }));
    const checkbox = host.querySelector('input[type="checkbox"]');
    expect(checkbox?.getAttribute('onchange')).not.toContain("alert(1)");
    expect(checkbox?.closest('label')?.getAttribute('data-column-index')).toBe('0');
    expect(host.textContent).toContain("name'); alert(1); ('");
  });

  it('keeps blank and duplicate headers independently selectable by position', () => {
    const unusual = { ...snapshot, columns: ['', 'duplicate', 'duplicate'] };
    const host = document.createElement('div');
    host.innerHTML = renderImportedFilesPanel(state({ files: [unusual], selectedSnapshot: unusual,
      selectedSnapshotId: unusual.snapshotId, selectedColumnIndexes: [0, 2],
      rows: [{ rowNumber: 1, values: ['blank-value', 'first-duplicate', 'second-duplicate'] }] }));
    const labels = [...host.querySelectorAll('[data-column-index]')];
    expect(labels.map(label => label.getAttribute('data-column-index'))).toEqual(['0', '1', '2']);
    expect(labels.map(label => label.textContent?.trim())).toEqual(['Column 1', 'duplicate', 'duplicate']);
    expect(labels[0].querySelector('input')?.checked).toBe(true);
    expect(labels[1].querySelector('input')?.checked).toBe(false);
    expect(labels[2].querySelector('input')?.checked).toBe(true);
    expect([...host.querySelectorAll('thead th')].map(cell => cell.textContent)).toEqual(['Column 1', 'duplicate']);
    expect([...host.querySelectorAll('tbody td')].map(cell => cell.textContent)).toEqual(['blank-value', 'second-duplicate']);
    expect(labels[2].querySelector('input')?.getAttribute('onchange')).toContain('toggleManagerImportedHistoryColumn(Number');
  });

  it('renders disabled pagination while a page is in flight and exposes older snapshot paging', () => {
    const host = document.createElement('div');
    host.innerHTML = renderImportedFilesPanel(state({ rowsLoading: true }));
    const next = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Loading…');
    expect(next?.hasAttribute('disabled')).toBe(true);
    expect(host.textContent).toContain('Older snapshots');
    expect(host.querySelector('select[onchange*="setManagerImportedHistoryDataset"]')).not.toBeNull();
  });
});
