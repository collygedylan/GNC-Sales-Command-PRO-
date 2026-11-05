import { jsonObject } from "../../../services/database-contract-runtime.ts";
import type { Json } from "../_shared/database.types.ts";

export function suspendTagRowsFromResult(input: unknown): Array<Record<string, Json | undefined>> {
  const result = jsonObject(input);
  if (!Array.isArray(result.rows)) throw new Error("SUSPEND_TAG_ROWS_INVALID");
  return result.rows.map((row) => jsonObject(row));
}

export interface SuspendSourceFreshness {
  filename: string;
  last_updated: string;
}

export function suspendSourceFreshnessQuery(): string {
  const query = new URLSearchParams();
  query.set("select", "filename,last_updated");
  query.set("order", "last_updated.desc.nullslast,unique_id.asc");
  query.set("limit", "1");
  return query.toString();
}

export function suspendSourceFreshnessFromRows(input: unknown): SuspendSourceFreshness | null {
  if (!Array.isArray(input) || input.length > 1) throw new Error("SUSPEND_TAG_SOURCE_FRESHNESS_INVALID");
  if (input.length === 0) return null;
  const row = jsonObject(input[0]);
  const filename = typeof row.filename === "string" ? row.filename.trim() : "";
  const lastUpdated = typeof row.last_updated === "string" ? row.last_updated : "";
  if (!filename || !lastUpdated || !Number.isFinite(Date.parse(lastUpdated))) {
    throw new Error("SUSPEND_TAG_SOURCE_FRESHNESS_INVALID");
  }
  return { filename, last_updated: lastUpdated };
}
