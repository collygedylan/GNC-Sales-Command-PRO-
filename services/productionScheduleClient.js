import { getScheduleCardColumnIndexes } from './productionScheduleSheets.js';

const MAX_PAGE_SIZE = 500;

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

export function createProductionScheduleClient(request) {
  if (typeof request !== 'function') throw new TypeError('A session-aware request function is required.');

  const send = async (operation, params = {}, signal) => {
    const response = requireObject(await request({ action: 'production_schedule', operation, ...params }, signal),
      'Production Schedule returned an invalid response.');
    if (response.ok !== true) {
      const error = new Error(response.error || 'Production Schedule is unavailable.');
      error.status = Number(response.status || 0);
      error.code = String(response.code || '').trim().toUpperCase();
      error.payload = response;
      throw error;
    }
    return response;
  };

  return {
    metadata(signal) { return send('metadata', {}, signal); },
    status(signal) { return send('status', {}, signal); },
    refresh(signal) { return send('refresh', {}, signal); },
    rows({ sheet, sheetId, snapshotId, q = '', filters = {}, cursor = null, limit = 20 }, signal) {
      if (sheetId == null || !Number.isInteger(Number(sheetId)) || Number(sheetId) < 0 || Number(sheetId) > 6) throw new TypeError('A worksheet index is required.');
      const snapshot = String(snapshotId || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot)) throw new TypeError('A published workbook snapshot is required.');
      const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(limit) || 20)));
      // Empty-header worksheets are valid. They still get source-row cards and
      // can load all fields lazily from the detail endpoint.
      const columnIndexes = getScheduleCardColumnIndexes(sheet);
      return send('rows', { sheetId: Number(sheetId), snapshotId: snapshot, q: String(q).slice(0, 200), filters, cursor,
        limit: safeLimit, projection: 'cards', columnIndexes }, signal);
    },
    rowDetail({ snapshotId, sheetId, sourceRow }, signal) {
      if (!String(snapshotId || '').trim() || !Number.isInteger(Number(sheetId)) || !Number.isInteger(Number(sourceRow))) {
        throw new TypeError('A complete workbook row reference is required.');
      }
      return send('row_detail', { snapshotId: String(snapshotId), sheetId: Number(sheetId), sourceRow: Number(sourceRow) }, signal);
    },
  };
}
