import { contracts } from './database-contracts.generated.ts';
import { matchesSchema } from './database-contract-runtime.ts';

type JsonRecord = Record<string, unknown>;
const ROW_ENCODING = 'master-null-elision-v1';
const masterRowSchema = contracts.tables.ph_master_inventory.row;
const masterFields = typeof masterRowSchema === 'object' && 'object' in masterRowSchema ? masterRowSchema.object : null;
const masterColumns = masterFields ? Object.freeze(Object.keys(masterFields).sort()) : [];
const nullMasterRow: Readonly<JsonRecord> = Object.freeze(Object.fromEntries(masterColumns.map(column => [column, null])));
const requiredMasterColumns = masterFields
  ? Object.freeze(masterColumns.filter(column => !matchesSchema(masterFields[column].schema, null))) : [];

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(): never {
  throw new Error('INVENTORY_RECLASS_RECEIPT_ENCODING_INVALID');
}

/** Restore complete rows before receipt validation; omitted fields explicitly mean null only in this codec. */
export function decodeInventoryReclassReceipt(value: unknown): JsonRecord {
  if (!record(value)) return invalid();
  const hasEncoding = Object.hasOwn(value, 'rowEncoding');
  const hasColumns = Object.hasOwn(value, 'rowColumns');
  if (!hasEncoding && !hasColumns) return value;
  if (value.rowEncoding !== ROW_ENCODING || !hasColumns) return invalid();

  const fields = masterFields;
  if (!fields) return invalid();
  const columns = masterColumns;
  const rowColumns = value.rowColumns;
  if (!Array.isArray(rowColumns) || rowColumns.length !== columns.length
    || !columns.every((column, index) => rowColumns[index] === column)
    || !Array.isArray(value.rows) || value.rows.length < 2 || value.rows.length > 200) return invalid();

  const rows = value.rows.map((entry) => {
    if (!record(entry) || entry.table !== 'ph_master_inventory' || !record(entry.values)
      || Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'table') || !Object.hasOwn(entry, 'values')) return invalid();
    const values = entry.values;
    for (const [key, field] of Object.entries(values)) {
      if (!Object.hasOwn(fields, key) || field === null || field === undefined || !matchesSchema(fields[key].schema, field)) return invalid();
    }
    // Every omitted field is restored as null, so only fields whose schema
    // accepts null may be omitted. Supplied values use the same recursive
    // schema validator without cloning and revalidating 213 restored entries.
    if (requiredMasterColumns.some(column => !Object.hasOwn(values, column))
      || typeof values.unique_id !== 'string' || !values.unique_id.trim()) return invalid();
    const row: JsonRecord = { ...nullMasterRow, ...values };
    return { table: 'ph_master_inventory', row };
  });
  // Removing transport metadata makes decoding a confirmed receipt idempotent.
  const decoded: JsonRecord = { ...value, rows };
  delete decoded.rowEncoding;
  delete decoded.rowColumns;
  return decoded;
}
