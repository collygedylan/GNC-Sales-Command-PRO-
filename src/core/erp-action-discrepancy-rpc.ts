import { executeManagerTableManagement as executeExistingManagerTable } from "../../supabase/functions/_shared/table-management.ts";

type Client = Parameters<typeof executeExistingManagerTable>[0];
type Payload = Record<string, unknown>;

function record(value: unknown): value is Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function discrepancyArguments(operation: unknown, payload: unknown): Payload {
  if (!record(payload)) throw new Error("MANAGER_TABLE_PAYLOAD_INVALID");
  const keys = Object.keys(payload);
  if (operation === "read" && keys.every(key => ["before_id", "limit"].includes(key))
    && (payload.before_id === undefined || positiveInteger(payload.before_id))
    && (payload.limit === undefined || positiveInteger(payload.limit) && Number(payload.limit) <= 200)) return payload;
  if ((operation === "teach" || operation === "review") && keys.length === 1 && positiveInteger(payload.id)) return payload;
  throw new Error("MANAGER_TABLE_OPERATION_INVALID");
}

export async function executeManagerTableManagement(client: Client, actorId: string, input: unknown) {
  if (!record(input) || input.table !== "action-discrepancy") return executeExistingManagerTable(client, actorId, input);
  if (input.action !== "manager_table_management" || Object.keys(input).some(key =>
    !["action", "table", "operation", "payload"].includes(key))) throw new Error("MANAGER_TABLE_REQUEST_INVALID");
  const payload = discrepancyArguments(input.operation, input.payload);
  const {data, error} = await client.rpc("manager_action_discrepancies_v3070", {
    p_actor_id: actorId, p_operation: input.operation, p_payload: payload
  });
  if (error) throw new Error(error.code === "42501" ? "MANAGER_TABLE_ACCESS_REQUIRED" : error.message || "MANAGER_TABLE_UNAVAILABLE");
  if (!record(data)) throw new Error("MANAGER_TABLE_RESPONSE_INVALID");
  return data;
}
