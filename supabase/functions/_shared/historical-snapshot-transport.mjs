const SNAPSHOT_VIEWS = Object.freeze({
  ph_drive_around_report_rows: 'ph_drive_around_report_rows_snapshot_v3039',
  ph_hold_stop_itemcode_snapshots: 'ph_hold_stop_itemcode_snapshots_snapshot_v3039',
});

export function historicalSnapshotReadUrl(input, method) {
  const effectiveMethod = method || (input instanceof Request ? input.method : 'GET');
  if (!['GET', 'HEAD'].includes(effectiveMethod.toUpperCase())) return input;
  const url = new URL(input instanceof Request ? input.url : input);
  const match = url.pathname.match(/^(.*\/rest\/v1\/)([^/]+)$/);
  const view = match && SNAPSHOT_VIEWS[match[2]];
  if (!view) return input;
  url.pathname = match[1] + view;
  return input instanceof Request ? new Request(url, input) : url.toString();
}

async function missingSnapshotRelation(response) {
  if (response.status !== 404) return false;
  try { return (await response.clone().json()).code === 'PGRST205'; }
  catch { return false; }
}

export async function fetchHistoricalSnapshot(fetcher, input, init) {
  const mapped = historicalSnapshotReadUrl(input, init?.method);
  const response = await fetcher(mapped, init);
  if (mapped !== input && await missingSnapshotRelation(response)) return fetcher(input, init);
  return response;
}

export function createHistoricalSnapshotFetch(fetcher) {
  return (input, init, timeout) => fetchHistoricalSnapshot(fetcher, input,
    { ...init, signal: AbortSignal.timeout(timeout) });
}
