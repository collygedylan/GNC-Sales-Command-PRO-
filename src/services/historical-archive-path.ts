import type { HistoricalArchiveFolder, HistoricalArchiveQuery, HistoricalArchiveRecord } from '../../components/historical-requests/contract';

export function parseRequestArchivePath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 5 || value.some(part => typeof part !== 'string' || !part.trim() || part.length > 500)) {
    throw new Error('Invalid Request archive record path.');
  }
  return value;
}

export function validateRequestArchiveQuery(query: HistoricalArchiveQuery) {
  if (query.recordKind !== 'requests' || query.operation === 'archive-search') return;
  const depth = query.path?.length || 0;
  if (query.operation === 'archive-folders' && depth >= 5) throw new Error('Select an archive folder before loading more folders.');
  if (query.operation === 'archive-records' && depth !== 5) throw new Error('Select the complete protected Request archive path first.');
}

export function validateArchiveResponsePath(query: HistoricalArchiveQuery, path: string[], maxDepth: number) {
  if (query.operation !== 'archive-search' && JSON.stringify(path) !== JSON.stringify(query.path || [])) {
    throw new Error('Historical archive response does not match the selected folder.');
  }
  if (query.recordKind === 'requests' && maxDepth !== 5) throw new Error('Invalid Request archive hierarchy.');
}

export function validateRequestArchiveRows(query: HistoricalArchiveQuery, rows: Array<HistoricalArchiveRecord | HistoricalArchiveFolder>) {
  if (query.recordKind !== 'requests') return;
  const folders = query.operation === 'archive-folders';
  for (const row of rows) {
    if ((row.kind === 'folder') !== folders) throw new Error('Request archive returned the wrong row kind for the selected level.');
    if (row.kind === 'folder') continue;
    const path = parseRequestArchivePath(row.archivePath);
    if (query.operation === 'archive-records' && JSON.stringify(path) !== JSON.stringify(query.path)) {
      throw new Error('Request archive record does not match the selected folder.');
    }
  }
}
