import { suspendTagRowsFromResult } from "./suspend-tag-read.ts";

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
