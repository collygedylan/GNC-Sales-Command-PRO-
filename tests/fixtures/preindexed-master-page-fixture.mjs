import { inventoryReadFixture } from './inventory-list-read-fixture.mjs';

// This accelerated fixture deliberately implements only the exact master-page
// request shape used by the published read-only smoke harness. Other legacy
// readMasterPage modes (season, avOpen, itemCode/locationCode lookups) remain
// covered by the canonical fixture and are rejected here rather than ignored.
const MASTER_PARAMS = new Set(['dataset', 'projection', 'offset', 'limit']);
const LOOKUP_PARAMS = new Set(['dataset', 'projection', 'offset', 'limit', 'uniqueId']);

function invalid(message) { throw new Error(`PREINDEXED_MASTER_FIXTURE_INVALID:${message}`); }
const sourceIndexes = new WeakMap();

/** Validate and sort the snapshot once, then serve immutable bounded pages. */
export function createPreindexedMasterPageFixture(sourceRows) {
  if (!Array.isArray(sourceRows)) invalid('source rows must be an array');
  let index = sourceIndexes.get(sourceRows);
  if (!index) {
    // The canonical read fixture applies PostgREST's unique_id.asc ordering
    // with JavaScript code-unit comparison after its locale sort. Mirror that
    // final ordering exactly, including IDs whose punctuation collates alike.
    const canonical = sourceRows.map(row => inventoryReadFixture.fromFixtureShape(row))
      .sort((a, b) => String(a.unique_id) < String(b.unique_id) ? -1 : String(a.unique_id) > String(b.unique_id) ? 1 : 0);
    const byId = new Map();
    for (const row of canonical) {
      const rows = byId.get(row.unique_id) || [];
      rows.push(row);
      byId.set(row.unique_id, rows);
    }
    const projected = new Map();
    for (const projection of ['browse', 'full']) {
      const columns = inventoryReadFixture.projections[projection];
      projected.set(projection, canonical.map(row => Object.fromEntries(columns.map(column => [column, row[column]]))));
    }
    index = Object.freeze({ rowCount: canonical.length, byId, projected });
    sourceIndexes.set(sourceRows, index);
  }
  const { byId, projected } = index;

  function readPage(options = {}) {
    const dataset = String(options.dataset || 'master');
    const projection = String(options.projection || 'initial');
    if (!['master', 'lookup'].includes(dataset) || !['browse', 'full'].includes(projection)) invalid('unsupported page request');
    const allowed = dataset === 'master' ? MASTER_PARAMS : LOOKUP_PARAMS;
    if (Object.keys(options).some(key => !allowed.has(key))) invalid('unexpected page parameter');
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 500;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) invalid('invalid page bounds');

    let source = projected.get(projection);
    if (dataset === 'lookup') {
      const uniqueId = String(options.uniqueId || '').trim();
      if (!uniqueId) invalid('lookup requires a unique ID');
      const baseRows = byId.get(uniqueId) || [];
      const columns = inventoryReadFixture.projections[projection];
      source = baseRows.map(row => Object.fromEntries(columns.map(column => [column, row[column]])));
    }
    const rows = source.slice(offset, offset + limit);
    const total = source.length;
    return {
      rows,
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
      projection,
      fieldCoverage: projection === 'browse' ? 'browse' : 'full',
      columns: inventoryReadFixture.projections[projection].slice(),
    };
  }

  return Object.freeze({ rowCount: index.rowCount, readPage });
}
