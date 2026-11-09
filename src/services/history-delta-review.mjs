import { isDeepStrictEqual } from 'node:util';

export const historyProvenanceFields = Object.freeze([
  'unique_id', 'history_key', 'order_line_key', 'reserve_history_key',
  'source_unique_id', 'source_file_id', 'source_file_name', 'file_id', 'file_name',
  'report_date', 'file_date', 'row_number', 'row_hash', 'row_state_hash',
  'created_at', 'updated_at', 'archived_at', 'search_text', 'first_seen_at',
  'last_seen_at', 'first_file_id', 'last_file_id', 'first_file_name',
  'last_file_name', 'last_report_date', 'last_unchanged_report_date', 'seen_count',
]);

export function historicalBusinessState(row, additionalProvenance = []) {
  const omitted = new Set([...historyProvenanceFields, ...additionalProvenance]);
  return Object.fromEntries(Object.entries(row).filter(([name]) => !omitted.has(name)));
}

function historicalIdentity(row, keyFields) {
  const parts = keyFields.map(name => row[name] ?? null);
  if (parts.every(value => value === null || value === '')) throw new Error('HISTORY_ENTITY_KEY_REQUIRED');
  return JSON.stringify(parts);
}

function validateObservation(row, idField, sequenceField, dateField) {
  if (!String(row[idField] || '')) throw new Error('HISTORY_ROW_ID_REQUIRED');
  if (!Number.isSafeInteger(row[sequenceField]) || row[sequenceField] < 0) {
    throw new Error('HISTORY_AUTHORITATIVE_FILE_SEQUENCE_REQUIRED');
  }
  if (!Number.isFinite(Date.parse(row[dateField]))) throw new Error('HISTORY_OBSERVATION_DATE_REQUIRED');
}

// Review only: the manifest is required before applying any deletion or changing
// a per-file reader. File sequence comes from the complete published file list.
export function planConsecutiveHistoricalStates(rows, {
  keyFields, idField = 'unique_id', sequenceField = 'file_sequence', dateField = 'report_date',
  additionalProvenance = [],
}) {
  if (!keyFields?.length) throw new Error('HISTORY_ENTITY_FIELDS_REQUIRED');
  const states = new Map(), kept = [], coverage = [], duplicates = [], ids = new Set();
  for (const row of rows) {
    validateObservation(row, idField, sequenceField, dateField);
    if (ids.has(row[idField])) throw new Error('HISTORY_DUPLICATE_OBSERVATION_ID');
    ids.add(row[idField]);
    const entity = historicalIdentity(row, keyFields), prior = states.get(entity);
    const sequence = row[sequenceField], state = historicalBusinessState(row, [...additionalProvenance, sequenceField]);
    if (prior && sequence < prior.sequence) throw new Error('HISTORY_ENTITY_ORDER_INVALID');
    if (prior && sequence === prior.sequence) throw new Error('HISTORY_ENTITY_SNAPSHOT_AMBIGUOUS');
    const unchanged = prior && sequence === prior.sequence + 1 && isDeepStrictEqual(prior.state, state);
    const retainedId = unchanged ? prior.retainedId : row[idField];
    if (unchanged) duplicates.push(row[idField]);
    else kept.push(row);
    coverage.push({ observationId: row[idField], retainedId, fileId: row.file_id ?? row.source_file_id,
      observedAt: row[dateField], sequence });
    states.set(entity, { state, sequence, retainedId });
  }
  return { kept, duplicateIds: duplicates, coverage };
}

export function requestArchivePath(row) {
  const first = (...values) => values.map(value => String(value ?? '').trim()).find(Boolean);
  const consignee = first(row.consignee_name, row.consigneename) || '';
  const date = first(row.requested_at, row.created_at, row.date_completed)?.slice(0, 10) || 'Unknown-date';
  const request = first(row.client_batch_id, row.unique_id, row.id);
  if (!request) throw new Error('REQUEST_ARCHIVE_ID_REQUIRED');
  return [first(row.sales_rep, row.request_selected_rep_username, row.requested_by) || 'Unassigned',
    first(row.customer_name, row.customername, row.req_customer, row.request_customer) || 'Unknown customer',
    ['', 'n/a', 'na', 'direct_or_na'].includes(consignee.toLowerCase()) ? 'Direct_or_NA' : consignee,
    `${date}_${request}`, first(row.itemcode) || 'Unknown-item'];
}
