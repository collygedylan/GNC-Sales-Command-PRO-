import { jsonObject } from "../../../services/database-contract-runtime.ts";
import type { Json } from "../_shared/database.types.ts";

export function suspendTagRowsFromResult(input: unknown): Array<Record<string, Json | undefined>> {
  const result = jsonObject(input);
  if (!Array.isArray(result.rows)) throw new Error("SUSPEND_TAG_ROWS_INVALID");
  return result.rows.map((row) => jsonObject(row));
}
