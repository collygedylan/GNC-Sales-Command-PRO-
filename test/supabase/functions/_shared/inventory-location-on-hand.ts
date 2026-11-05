import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database, Json } from "./database.types.ts";

type Client = Pick<SupabaseClient<Database>, "rpc">;
type Row = { [key: string]: Json | undefined };
const normalize = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : "";
const pairKey = (itemcode: string, locationcode: string) => JSON.stringify([itemcode, locationcode]);
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("LOC_ON_HAND_RESPONSE_INVALID");

async function read(client: Client, actorId: string, pairs: Row[], expectedRevision: string | null) {
  const { data, error } = await client.rpc("inventory_location_on_hand_read_v1", {
    p_actor_id: actorId, p_pairs: pairs, p_expected_revision: expectedRevision ?? undefined,
  });
  if (error) throw new Error(/LOC_ON_HAND/i.test(error.message) ? error.message : "LOC_ON_HAND_READ_FAILED");
  if (!object(data) || typeof data.inventoryRevision !== "string" || !/^[1-9]\d*$/.test(data.inventoryRevision)
    || !Array.isArray(data.rows)) throw invalid();
  if (expectedRevision !== null && data.inventoryRevision !== expectedRevision) throw new Error("LOC_ON_HAND_REVISION_CHANGED");
  return { revision: data.inventoryRevision, rows: data.rows };
}

/** Capture before the page query; the second RPC refuses a different source snapshot. */
export async function captureInventoryLocationRevision(client: Client, actorId: string): Promise<string> {
  return (await read(client, actorId, [], null)).revision;
}

/** Keys come exclusively from a page that has already passed its dataset authorization. */
export async function enrichInventoryLocationRows(client: Client, actorId: string, rows: Json[], revision: string): Promise<Json[]> {
  if (rows.length > 500 || rows.some(row => !object(row))) throw invalid();
  const pairs = new Map<string, Row>();
  for (const row of rows as Row[]) {
    const itemcode = normalize(row.itemcode), locationcode = normalize(row.locationcode);
    if (itemcode && locationcode) pairs.set(pairKey(itemcode, locationcode), { itemcode, locationcode });
  }
  const result = await read(client, actorId, [...pairs.values()], revision);
  const totals = new Map<string, number | null>();
  for (const row of result.rows) {
    if (!object(row) || typeof row.itemcode !== "string" || typeof row.locationcode !== "string"
      || row.loc_on_hand_revision !== revision
      || !(row.loc_on_hand === null || typeof row.loc_on_hand === "number" && Number.isFinite(row.loc_on_hand))) throw invalid();
    const key = pairKey(normalize(row.itemcode), normalize(row.locationcode));
    if (!pairs.has(key) || totals.has(key)) throw invalid();
    totals.set(key, row.loc_on_hand);
  }
  if (totals.size !== pairs.size) throw invalid();
  return (rows as Row[]).map(row => ({ ...row,
    loc_on_hand: totals.get(pairKey(normalize(row.itemcode), normalize(row.locationcode))) ?? null,
    loc_on_hand_revision: revision,
  }));
}
