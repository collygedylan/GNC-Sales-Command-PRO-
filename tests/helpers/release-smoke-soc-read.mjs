import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
const columns = name => {
  const match = apiSource.match(new RegExp(`^  ${name}: "([^"]+)"`, 'm'));
  if (!match) throw new Error(`Missing production SOC projection: ${name}`);
  return match[1].split(',');
};
const projections = { soc: columns('ph_soc_master'), suspend_tag: columns('suspend_tag') };
const socFilterFields = new Set('unique_id,tripnumber,stopnumber,dock_num,assignedto,salesrepid,salesrepname,customername,consigneename,transactionnumber,itemcode,locationcode,lotcode,season,source,last_updated,date_completed,planstart,warehouseid,stagename'.split(','));
const socOrderFields = new Set('unique_id,last_updated,date_completed,tripnumber,stopnumber,itemcode,locationcode'.split(','));
const fail = code => { throw new Error(code); };

/** Model the existing SOC read contract against the same rows seed() publishes. */
export function readReleaseSmokeSocPage(sourceRows, dataset, params) {
  if (!projections[dataset]) fail('DATASET_READ_INVALID');
  const projection = params.projection || 'default';
  if (!['default', 'ids'].includes(projection)) fail('DATASET_READ_PROJECTION_INVALID');
  const { offset, limit } = params;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) fail('DATASET_READ_PAGE_INVALID');
  const source = sourceRows.map(row => Object.fromEntries(Object.entries(row)
    .map(([key, value]) => [key.toLowerCase() === 'suspendto' ? 'suspend_to' : key.toLowerCase(), value])));
  const filters = params.filters || [], anyOf = params.anyOf || [], order = params.order || [];
  if (![filters, anyOf, order].every(Array.isArray) || filters.length > 30 || anyOf.length > 30 || order.length > 4) fail('DATASET_READ_FILTER_INVALID');
  const compileFilter = filter => {
    if (!filter || Object.keys(filter).some(key => !['field', 'op', 'value'].includes(key))
        || dataset !== 'soc' || !socFilterFields.has(filter.field)
        || !Object.hasOwn(filter, 'value')) fail('DATASET_READ_FILTER_INVALID');
    const { field, op, value } = filter;
    if (op === 'in' && (!Array.isArray(value) || !value.length || value.length > 100)) fail('DATASET_READ_FILTER_VALUE_INVALID');
    if (['is', 'not.is'].includes(op) && value !== null && typeof value !== 'boolean') fail('DATASET_READ_FILTER_VALUE_INVALID');
    if (['ilike', 'not.ilike'].includes(op) && typeof value !== 'string') fail('DATASET_READ_FILTER_VALUE_INVALID');
    const pattern = ['ilike', 'not.ilike'].includes(op)
      ? new RegExp('^' + value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.') + '$', 'i') : null;
    if (!['eq', 'neq', 'in', 'ilike', 'not.ilike', 'is', 'not.is', 'gte', 'lte', 'gt', 'lt'].includes(op)) fail('DATASET_READ_FILTER_INVALID');
    return row => {
      const actual = row[field] ?? null;
      if (op === 'is') return actual === value;
      if (op === 'not.is') return actual !== value;
      if (actual === null || value === null) return false;
      if (op === 'eq') return String(actual) === String(value);
      if (op === 'neq') return String(actual) !== String(value);
      if (op === 'in') return value.some(candidate => String(actual) === String(candidate));
      if (pattern) return op === 'ilike' ? pattern.test(String(actual)) : !pattern.test(String(actual));
      if (op === 'gte') return actual >= value;
      if (op === 'lte') return actual <= value;
      if (op === 'gt') return actual > value;
      return actual < value;
    };
  };
  const allPredicates = filters.map(compileFilter), anyPredicates = anyOf.map(compileFilter);
  const orders = order.map(entry => {
    if (!entry || Object.keys(entry).some(key => !['field', 'ascending'].includes(key))
        || typeof entry.ascending !== 'boolean'
        || !(dataset === 'soc' ? socOrderFields.has(entry.field) : entry.field === 'unique_id')) fail('DATASET_READ_ORDER_INVALID');
    return entry;
  });
  if (!orders.some(entry => entry.field === 'unique_id')) orders.push({ field: 'unique_id', ascending: true });
  const rows = source.filter(row => (dataset !== 'suspend_tag'
      || String(row.suspend || '').trim().toLowerCase() === 'suspend'
        && String(row.suspend_to || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'dc')
    && allPredicates.every(predicate => predicate(row))
    && (!anyPredicates.length || anyPredicates.some(predicate => predicate(row))));
  rows.sort((left, right) => {
    for (const { field, ascending } of orders) {
      const a = left[field] ?? null, b = right[field] ?? null;
      const difference = a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
      if (difference) return ascending ? difference : -difference;
    }
    return 0;
  });
  const fields = projection === 'ids' ? ['unique_id'] : projections[dataset];
  const result = { rows: rows.slice(offset, offset + limit).map(row => Object.fromEntries(fields.map(field => [field, row[field] ?? null]))),
    total: rows.length, offset, limit, hasMore: offset + limit < rows.length };
  if (dataset === 'suspend_tag' && offset === 0) {
    const newest = source.slice().sort((a, b) => String(b.last_updated || '').localeCompare(String(a.last_updated || ''))
      || String(a.unique_id || '').localeCompare(String(b.unique_id || '')))[0];
    result.sourceFreshness = newest ? { filename: newest.filename, last_updated: newest.last_updated } : null;
  }
  return result;
}
