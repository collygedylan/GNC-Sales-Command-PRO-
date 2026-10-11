import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue } from "../../../services/database-contract-runtime.ts";

type AuraInventoryInput = {
  operation: string;
  itemcode?: string;
  commonName?: string;
  contSize?: string;
  locationCode?: string;
  metric?: string;
  openStockOnly?: boolean;
  quantity?: number | null;
  season?: string | null;
  cursor?: unknown;
  limit?: number;
  lines?: unknown[];
};

type AuraClient = Pick<SupabaseClient<Database>, "rpc">;

export function auraInventoryV2Rpc(client: AuraClient, input: AuraInventoryInput, signal?: AbortSignal) {
  const rpc = input.operation === "match"
    ? client.rpc("aura_inventory_v2_match_v1", {
      p_common_name: input.commonName || "",
      ...(input.contSize ? { p_contsize: input.contSize } : {}),
      ...(input.locationCode ? { p_locationcode: input.locationCode } : {}),
      p_metric: input.metric || "ptravailable",
      p_open_stock_only: input.openStockOnly === true,
      ...(input.season ? { p_expected_season: input.season } : {}),
    })
    : client.rpc("aura_inventory_v2_read_v1", {
      p_operation: input.operation,
      ...(input.itemcode ? { p_itemcode: input.itemcode } : {}),
      ...(input.contSize ? { p_contsize: input.contSize } : {}),
      ...(input.locationCode ? { p_locationcode: input.locationCode } : {}),
      p_metric: input.metric || "ptravailable",
      p_open_stock_only: input.openStockOnly === true,
      ...(typeof input.quantity === "number" ? { p_quantity: input.quantity } : {}),
      ...(input.season ? { p_expected_season: input.season } : {}),
      ...(input.cursor !== undefined ? { p_cursor: jsonValue(input.cursor) } : {}),
      p_limit: input.limit ?? 100,
      p_lines: jsonValue(input.lines ?? []),
    });
  return signal ? rpc.abortSignal(signal) : rpc;
}

export function auraInventoryLotLookupRpc(client: AuraClient, lotcode: string, limit = 100, signal?: AbortSignal) {
  const rpc = client.rpc("aura_inventory_lot_lookup_v1", {
    p_lotcode: lotcode,
    p_limit: limit,
  });
  return signal ? rpc.abortSignal(signal) : rpc;
}
