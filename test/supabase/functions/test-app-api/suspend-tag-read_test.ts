import { suspendSourceFreshnessFromRows, suspendSourceFreshnessQuery, suspendTagRowsFromResult } from "./suspend-tag-read.ts";

Deno.test("Suspend Tag row RPC wrapper preserves its rows array", () => {
  const rows = suspendTagRowsFromResult({ rows: [{ unique_id: "soc-1", suspend_tag_status: "pending" }] });
  if (rows.length !== 1 || rows[0].unique_id !== "soc-1" || rows[0].suspend_tag_status !== "pending") {
    throw new Error("Suspend Tag rows were not extracted from the RPC wrapper.");
  }
});

Deno.test("Suspend Tag row overlay rejects malformed RPC results", () => {
  for (const value of [null, {}, { rows: [null] }]) {
    let rejected = false;
    try { suspendTagRowsFromResult(value); }
    catch { rejected = true; }
    if (!rejected) throw new Error("Malformed Suspend Tag result was accepted.");
  }
});

Deno.test("Suspend Tag freshness reads only the newest filename and timestamp", () => {
  const query = new URLSearchParams(suspendSourceFreshnessQuery());
  if (query.get("select") !== "filename,last_updated" || query.get("limit") !== "1"
    || query.get("order") !== "last_updated.desc.nullslast,unique_id.asc") {
    throw new Error("Suspend Tag freshness query is not a bounded latest-row projection.");
  }
  const freshness = suspendSourceFreshnessFromRows([{
    filename: "SOC current.xlsx", last_updated: "2026-10-20T12:00:00Z",
  }]);
  if (freshness?.filename !== "SOC current.xlsx" || freshness.last_updated !== "2026-10-20T12:00:00Z") {
    throw new Error("Suspend Tag source freshness was not normalized to its public contract.");
  }
  if (suspendSourceFreshnessFromRows([]) !== null) throw new Error("An empty SOC source must produce null freshness.");
  for (const invalid of [null, {}, [{ filename: "", last_updated: "2026-10-20T12:00:00Z" }],
    [{ filename: "SOC.xlsx", last_updated: "not-a-date" }], [{ filename: "a", last_updated: "2026-10-20T12:00:00Z" }, { filename: "b", last_updated: "2026-10-20T12:00:00Z" }]]) {
    let rejected = false;
    try { suspendSourceFreshnessFromRows(invalid); } catch { rejected = true; }
    if (!rejected) throw new Error("Malformed Suspend Tag source freshness was accepted.");
  }
});
