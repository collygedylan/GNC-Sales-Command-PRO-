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

type AuraClient = {
  rpc: (name: string, args: Record<string, unknown>) => any;
};

export function auraInventoryV2Rpc(client: AuraClient, input: AuraInventoryInput, signal?: AbortSignal) {
  const rpc = input.operation === "match"
    ? client.rpc("aura_inventory_v2_match_v1", {
      p_common_name: input.commonName,
      p_contsize: input.contSize || null,
      p_locationcode: input.locationCode || null,
      p_metric: input.metric || "ptravailable",
      p_open_stock_only: input.openStockOnly === true,
      p_expected_season: input.season || null,
    })
    : client.rpc("aura_inventory_v2_read_v1", {
      p_operation: input.operation,
      p_itemcode: input.itemcode || null,
      p_contsize: input.contSize || null,
      p_locationcode: input.locationCode || null,
      p_metric: input.metric || "ptravailable",
      p_open_stock_only: input.openStockOnly === true,
      p_quantity: input.quantity ?? null,
      p_expected_season: input.season || null,
      p_cursor: input.cursor ?? null,
      p_limit: input.limit ?? 100,
      p_lines: input.lines ?? [],
    });
  return signal ? rpc.abortSignal(signal) : rpc;
}

export function auraInventoryLotLookupRpc(client: AuraClient, lotcode: string, limit = 100, signal?: AbortSignal) {
  const rpc = client.rpc("aura_inventory_lot_lookup_v1", {
    p_lotcode: lotcode,
    p_after_uid: null,
    p_limit: limit,
  });
  return signal ? rpc.abortSignal(signal) : rpc;
}
