import { contracts } from '../../services/database-contracts.generated.ts';
import { matchesSchema } from '../../services/database-contract-runtime.ts';

type JsonRecord = Record<string, unknown>;
function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Encode only already-complete physical rows, independently of the production decoder. */
export function compactReclassReceiptFixture(receipt: JsonRecord): JsonRecord {
  const schema = contracts.tables.ph_master_inventory.row;
  if (typeof schema !== 'object' || !('object' in schema)) throw new Error('RECLASS_FIXTURE_SCHEMA_INVALID');
  const rowColumns = Object.keys(schema.object).sort();
  if (!Array.isArray(receipt.rows) || receipt.rows.length < 2 || receipt.rows.length > 200) {
    throw new Error('RECLASS_FIXTURE_RECEIPT_INVALID');
  }
  const rows = receipt.rows.map(entry => {
    if (!record(entry) || entry.table !== 'ph_master_inventory' || !record(entry.row)
      || !matchesSchema(schema, entry.row)) throw new Error('RECLASS_FIXTURE_ROW_INVALID');
    return { table: 'ph_master_inventory', values: Object.fromEntries(Object.entries(entry.row).filter(([, value]) => value !== null)) };
  });
  return { ...receipt, rowEncoding: 'master-null-elision-v1', rowColumns, rows };
}
