import { readFileSync } from 'node:fs';

const inventorySchema = JSON.parse(readFileSync(new URL('./inventory-list-schema.json', import.meta.url), 'utf8'));
const projectionSource = readFileSync(new URL('../../supabase/functions/_shared/inventory-projections.ts', import.meta.url), 'utf8');

function extractProjectionFieldList(name) {
  const match = projectionSource.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const satisfies`));
  if (!match) throw new Error(`Missing inventory projection fixture source: ${name}`);
  return [...match[1].matchAll(/\"([a-z0-9_]+)\"/g)].map((field) => field[1]);
}
const apiProjections = {
  initial: extractProjectionFieldList('INVENTORY_MASTER_INITIAL_COLUMNS'),
  full: extractProjectionFieldList('INVENTORY_MASTER_FULL_COLUMNS'),
  browse: extractProjectionFieldList('INVENTORY_MASTER_BROWSE_COLUMNS')
};
apiProjections.initial_base = apiProjections.initial.filter((field) => !field.startsWith('hold_release_') && !field.startsWith('av_rule_'));

/** The function is self-contained so the same strict read boundary can be
 * installed in a browser fixture or used by a Node-side route handler. */
export function createInventoryReadFixture(schema, projections = apiProjections) {
  const columns = new Map(schema.map(column => [column.name, column]));
  const fail = message => { throw new Error(`INVENTORY_READ_FIXTURE_INVALID: ${message}`); };
  const immutableRows = new WeakMap();
  const derivedFields = new Set(['source_table', 'saved_photo_link', 'saved_photo_name']);
  function row(values = {}) {
    if (immutableRows.has(values)) return immutableRows.get(values);
    const result = Object.fromEntries(schema.map(column => [column.name, null]));
    const supplied = new Set();
    for (const [key, raw] of Object.entries(values)) {
      const name = key.toLowerCase();
      // These are known formatter outputs, never physical database columns.
      if (derivedFields.has(name)) continue;
      if (name === 'salesyear') {
        const physical = values.saleyear ?? values.SALEYEAR;
        if (physical == null || String(physical) !== String(raw)) fail('SALESYEAR must agree with physical SALEYEAR');
        continue;
      }
      const column = columns.get(name);
      if (!column) fail(`nonphysical field ${key}`);
      if (supplied.has(name)) fail(`duplicate physical field ${name}`);
      supplied.add(name);
      let value = raw;
      // Existing UI fixtures use numbers for physical text quantities. Model
      // their database representation here, not in the production decoder.
      if (column.type === 'text' && typeof value === 'number' && Number.isFinite(value)) value = String(value);
      if (value !== null && (column.type === 'numeric'
        ? typeof value !== 'number' || !Number.isFinite(value)
        : typeof value !== 'string')) fail(`incorrect physical type for ${name}`);
      result[name] = value;
    }
    if (typeof result.unique_id !== 'string' || !result.unique_id.trim()) fail('missing unique_id');
    if (Object.isFrozen(values)) immutableRows.set(values, Object.freeze(result));
    return result;
  }
  function idsFromFilter(filter) {
    if (filter.startsWith('eq.')) {
      const value = filter.slice(3);
      if (!value) fail('empty exact ID');
      return [value.startsWith('"') ? JSON.parse(value) : value];
    }
    if (!filter.startsWith('in.(') || !filter.endsWith(')')) fail(`unsupported identity filter ${filter}`);
    const source = filter.slice(4, -1), values = [];
    let cursor = 0;
    while (cursor < source.length) {
      while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++;
      let value;
      if (source[cursor] === '"') {
        const start = cursor++;
        let escaped = false, closed = false;
        while (cursor < source.length) {
          const character = source[cursor++];
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') { closed = true; break; }
        }
        if (!closed) fail('unterminated quoted ID');
        value = JSON.parse(source.slice(start, cursor));
      } else {
        const start = cursor;
        while (cursor < source.length && source[cursor] !== ',') cursor++;
        value = source.slice(start, cursor).trim();
      }
      if (typeof value !== 'string' || !value) fail('empty ID in scope');
      values.push(value);
      while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++;
      if (cursor === source.length) break;
      if (source[cursor++] !== ',' || cursor === source.length) fail('malformed ID scope');
    }
    if (!values.length) fail('empty ID scope');
    return values;
  }
  function read(source, query = '') {
    if (!Array.isArray(source)) fail('expected source rows');
    const params = new URLSearchParams(query);
    for (const key of params.keys()) {
      if (!['select', 'order', 'unique_id', 'itemcode', 'commonname', 'contsize', 'season', 'offset', 'limit'].includes(key)) fail(`unsupported query parameter ${key}`);
      if (params.getAll(key).length !== 1) fail(`duplicate query parameter ${key}`);
    }
    const select = params.get('select') || '*';
    const selected = select === '*' ? null : select.split(',').map(field => {
      const match = /^(?:([A-Za-z]\w*):)?([a-z_]\w*)$/.exec(field);
      if (!match || !columns.has(match[2])) fail(`nonphysical select ${field}`);
      return { alias: match[1] || match[2], name: match[2] };
    });
    if (selected && new Set(selected.map(field => field.alias)).size !== selected.length) fail('duplicate select aliases');
    let matching = source.map(row);
    const filter = params.get('unique_id');
    if (filter) {
      const ids = new Set(idsFromFilter(filter));
      matching = matching.filter(item => ids.has(item.unique_id));
    }
    // Drive detail also searches common names with PostgREST ILIKE. Model its
    // wildcard semantics while retaining exact item/size and schema checks.
    for (const name of ['itemcode', 'commonname', 'contsize', 'season']) {
      const scopedFilter = params.get(name);
      if (scopedFilter === null) continue;
      if (!columns.has(name)) fail(`nonphysical filter ${name}`);
      if (name === 'season' && scopedFilter.startsWith('in.(')) {
        const seasons = new Set(idsFromFilter(scopedFilter));
        matching = matching.filter(item => seasons.has(item.season));
        continue;
      }
      if (name === 'commonname' && scopedFilter.startsWith('ilike.')) {
        let pattern = scopedFilter.slice(6);
        if (pattern.startsWith('"')) pattern = JSON.parse(pattern);
        if (typeof pattern !== 'string') fail('invalid commonname pattern');
        // PostgREST translates * to the SQL percent wildcard before ILIKE.
        pattern = pattern.replaceAll('*', '%');
        let expression = '';
        const literal = character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (let index = 0; index < pattern.length; index++) {
          const character = pattern[index];
          if (character === '\\') {
            if (++index >= pattern.length) fail('unterminated commonname escape');
            expression += literal(pattern[index]);
          } else expression += character === '%' ? '[\\s\\S]*' : character === '_' ? '[\\s\\S]' : literal(character);
        }
        const matcher = new RegExp(`^(?:${expression})(?![\\s\\S])`, 'iu');
        matching = matching.filter(item => typeof item[name] === 'string' && matcher.test(item[name]));
        continue;
      }
      if (!scopedFilter.startsWith('eq.')) fail(`unsupported exact filter ${name}`);
      const [value] = idsFromFilter(scopedFilter);
      matching = matching.filter(item => item[name] === value);
    }
    const order = params.get('order');
    if (order) {
      if (!/^unique_id\.(asc|desc)$/.test(order)) fail(`unsupported order ${order}`);
      const direction = order.endsWith('.desc') ? -1 : 1;
      matching.sort((left, right) => (left.unique_id < right.unique_id ? -direction : left.unique_id > right.unique_id ? direction : 0));
    }
    const integer = (name, fallback) => {
      const value = params.get(name);
      if (value === null) return fallback;
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail(`invalid ${name}`);
      return Number(value);
    };
    const offset = integer('offset', 0), limit = integer('limit', matching.length);
    const page = matching.slice(offset, offset + limit);
    const rows = selected ? page.map(item => Object.fromEntries(selected.map(field => [field.alias, item[field.name]]))) : page;
    return { rows, offset, total: matching.length, select, exact: !!filter, uniqueIds: page.map(item => item.unique_id) };
  }
  function readMasterPage(source, options = {}) {
    const dataset = String(options.dataset || 'master');
    const requestedProjection = String(options.projection || 'initial');
    if (!['master', 'avOpen', 'lookup'].includes(dataset) || !['initial', 'initial_base', 'browse', 'full'].includes(requestedProjection)) {
      fail('unsupported master projection');
    }
    const projection = dataset === 'avOpen' && requestedProjection !== 'browse' ? 'full' : requestedProjection;
    const selectedColumns = projections[projection];
    if (!selectedColumns || selectedColumns.some(field => !columns.has(field))) fail(`projection ${projection} is not physical`);
    const selectedRows = source.map(row);
    let matching = selectedRows;
    if (dataset === 'avOpen') matching = matching.filter(item => ['F1', 'S1', 'U1', 'U2'].includes(String(item.season || '').toUpperCase()));
    if (dataset === 'lookup') {
      const uniqueId = String(options.uniqueId || '').trim();
      const itemCode = String(options.itemCode || '').trim();
      if (!uniqueId && !itemCode) fail('lookup requires a unique ID or item code');
      matching = matching.filter(item => uniqueId ? item.unique_id === uniqueId : item.itemcode === itemCode);
      for (const [optionKey, column] of [['locationCode', 'locationcode'], ['lotCode', 'lotcode'], ['source', 'source']]) {
        const value = String(options[optionKey] || '').trim();
        if (value) matching = matching.filter(item => item[column] === value);
      }
    }
    if (options.season) matching = matching.filter(item => item.season === options.season);
    matching.sort((a, b) => String(a.unique_id).localeCompare(String(b.unique_id)));
    const params = new URLSearchParams({
      select: selectedColumns.join(','), order: 'unique_id.asc',
      offset: String(Math.max(0, Number(options.offset) || 0)),
      limit: String(Math.min(500, Math.max(1, Number(options.limit) || 500)))
    });
    const result = read(matching, params.toString());
    return {
      rows: result.rows,
      total: result.total,
      offset: result.offset,
      limit: Math.min(500, Math.max(1, Number(options.limit) || 500)),
      hasMore: result.offset + result.rows.length < result.total,
      projection,
      fieldCoverage: projection === 'browse' ? 'browse' : dataset === 'avOpen' || projection === 'full' ? 'full' : 'initial',
      columns: selectedColumns.slice()
    };
  }
  // Dock/Drive browser fixtures sometimes reuse order-shaped input records.
  // Convert only their known physical inventory keys, and pass that projection
  // through `row` so the schema/type/identity checks remain authoritative.
  function fromFixtureShape(values = {}) {
    const physical = {};
    for (const column of columns.keys()) {
      if (Object.prototype.hasOwnProperty.call(values, column)) physical[column] = values[column];
      else if (Object.prototype.hasOwnProperty.call(values, column.toUpperCase())) physical[column] = values[column.toUpperCase()];
    }
    return row(physical);
  }
  return Object.freeze({ row, read, readMasterPage, fromFixtureShape, projections,
    physicalColumns: Object.freeze(schema.map(column => column.name)) });
}

export const inventoryReadFixture = createInventoryReadFixture(inventorySchema.schema);

export async function installInventoryReadFixture(page) {
  await page.evaluate(({ factory, schema, projections }) => {
    window.__inventoryReadFixture = window.eval(`(${factory})`)(schema, projections);
  }, { factory: createInventoryReadFixture.toString(), schema: inventorySchema.schema, projections: apiProjections });
}
