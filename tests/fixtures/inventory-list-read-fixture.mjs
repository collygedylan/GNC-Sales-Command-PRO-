import { readFileSync } from 'node:fs';

const inventorySchema = JSON.parse(readFileSync(new URL('./inventory-list-schema.json', import.meta.url), 'utf8'));

/** The function is self-contained so the same strict read boundary can be
 * installed in a browser fixture or used by a Node-side route handler. */
export function createInventoryReadFixture(schema) {
  const columns = new Map(schema.map(column => [column.name, column]));
  const fail = message => { throw new Error(`INVENTORY_READ_FIXTURE_INVALID: ${message}`); };
  const derivedFields = new Set(['source_table', 'saved_photo_link', 'saved_photo_name']);
  function row(values = {}) {
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
      if (!['select', 'order', 'unique_id', 'itemcode', 'contsize', 'offset', 'limit'].includes(key)) fail(`unsupported query parameter ${key}`);
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
    for (const name of ['itemcode', 'contsize']) {
      const scopedFilter = params.get(name);
      if (scopedFilter === null) continue;
      if (!columns.has(name) || !scopedFilter.startsWith('eq.')) fail(`unsupported exact filter ${name}`);
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
  return Object.freeze({ row, read, physicalColumns: Object.freeze(schema.map(column => column.name)) });
}

export const inventoryReadFixture = createInventoryReadFixture(inventorySchema.schema);

export async function installInventoryReadFixture(page) {
  await page.evaluate(({ factory, schema }) => {
    window.__inventoryReadFixture = window.eval(`(${factory})`)(schema);
  }, { factory: createInventoryReadFixture.toString(), schema: inventorySchema.schema });
}
