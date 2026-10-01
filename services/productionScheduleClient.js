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
    if (response.ok !== true) throw new Error(response.error || 'Production Schedule is unavailable.');
    return response;
  };

  return {
    metadata(signal) { return send('metadata', {}, signal); },
    status(signal) { return send('status', {}, signal); },
    refresh(signal) { return send('refresh', {}, signal); },
    rows({ sheetId, q = '', filters = {}, cursor = null, limit = 100 }, signal) {
      if (!Number.isInteger(Number(sheetId))) throw new TypeError('A sheet ID is required.');
      const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(limit) || 100)));
      return send('rows', { sheetId: Number(sheetId), q: String(q).slice(0, 200), filters, cursor, limit: safeLimit }, signal);
    },
  };
}
