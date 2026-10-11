import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "./database.types.ts";
import { jsonValue, type Json } from "../../../services/database-contract-runtime.ts";
import { contracts } from "../../../services/database-contracts.generated.ts";
import { isAppAccountActive, normalizeUsername, readSupabaseOrAppSessionFromRequest } from "./app-auth.ts";
import { auraInventoryV2ProfileMatches } from "./aura-auth.ts";
import { AURA_MODULE_CAPABILITIES, AURA_READ_CAPABILITIES, capabilityForIntent, escapeAuraLike, resolveAuraIntent, type AuraCapability, type AuraIntent } from "./aura-query.ts";

type QueryClient = SupabaseClient<Database>;
export type AuraQueryDeps = {
  adminClient?: QueryClient;
  userClient?: QueryClient;
  env?: (name: string) => string | undefined;
};
type AuthResult = { actorId: string; username: "dylan_collyge"; session: Record<string, unknown> };
type QueryAction = Record<string, unknown>;
type QueryContext = Record<string, unknown>;
function jsonRecord(value: unknown): Json { return jsonValue(record(value)); }

const MAX_BODY_BYTES = 64_000;
const MAX_TEXT_CHARS = 2_000;
const MAX_PAGE = 50;
const INVENTORY_FILTER_KEYS = new Set(["productText", "commonName", "itemcode", "genus", "contSize", "locationCode", "locationMode", "zone", "assignee", "assigneeText", "selectionId", "metric", "season", "salesYear", "seasonReference", "lotcode", "openStockOnly", "countMode"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-gnc-session, x-app-session, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};
const MODULE_VIEW: Record<string, string> = {
  drive: "drive", tasks: "tasks", docks: "docks", av: "av", request: "request", reserves: "reserves",
  reports: "reports", review: "review", hours: "hours", calendar: "department-calendar", chat: "chat",
  "sales-office": "sales-office", production: "production-workflow",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, ...headers, "Content-Type": "application/json" } });
}
function fail(error: string, status: number, code: string) {
  return json({ ok: false, error, status, code }, status);
}
function sourceInfo(kind: string) {
  return { kind, checkedAt: new Date().toISOString(), sourceUpdatedAt: null, freshness: "unknown" };
}
type SeasonScope = { seasonCode: string; salesYear: number; settingRevision: number; reference: string };
type SeasonalReadInfo = { season?: string; salesYear?: number; settingRevision?: number; yearCoverage?: string; unresolvedCount?: number };
function isSeasonalIntent(intent: AuraIntent) {
  const capability = capabilityForIntent(intent)[0];
  return capability?.reader === "inventory" || capability?.seasonal === true
    || ["inventory", "ownership", "unassigned", "lot"].includes(intent.mode);
}
async function resolveSeasonScope(admin: QueryClient, actorId: string, intent: AuraIntent, signal?: AbortSignal): Promise<SeasonScope> {
  const reference = intent.filters.seasonReference === "next" ? "next" : "current";
  const settings = await rpc(admin, "aura_resolve_season_v1", { p_actor_id: actorId, p_reference: reference }, signal);
  if (!["F1", "S1"].includes(String(settings.seasonCode)) || !Number.isInteger(settings.salesYear)
    || Number(settings.salesYear) < 1 || Number(settings.salesYear) > 99
    || !Number.isSafeInteger(settings.revision) || Number(settings.revision) < 0) throw new Error("AURA_SEASON_SETTINGS_UNAVAILABLE");
  return { seasonCode: String(intent.filters.season || settings.seasonCode),
    salesYear: Number(intent.filters.salesYear ?? settings.salesYear), settingRevision: Number(settings.revision),
    reference: intent.filters.season ? "explicit" : reference };
}
function seasonalReadInfo(data: Record<string, unknown>): SeasonalReadInfo {
  if (data.code === "AURA_INVENTORY_IMPORT_INCOMPLETE" && data.complete === false) return {};
  if (!Number.isSafeInteger(data.settingRevision) || Number(data.settingRevision) < 0) throw new Error("AURA_SEASON_SETTINGS_UNAVAILABLE");
  return { season: String(data.season || ""), salesYear: Number(data.salesYear),
    settingRevision: Number(data.settingRevision), yearCoverage: String(data.yearCoverage || "inventory-cutoff"),
    unresolvedCount: Number(data.unresolvedCount || 0) };
}
function resetContinuation(context: QueryContext): QueryContext {
  const next: QueryContext = { ...context, pendingChoices: [], nextCursor: null };
  for (const key of ["selectedChoice", "selectedAssignee", "selectionId"]) delete next[key];
  return next;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}
type PublicTableName = keyof Database["public"]["Tables"] & string;
function isPublicTableName(value: string): value is PublicTableName { return Object.hasOwn(contracts.tables, value); }
function text(value: unknown, max: number) {
  const valueText = String(value || "").normalize("NFKC").split("").map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("").replace(/\s+/g, " ").trim();
  if (!valueText || valueText.length > max) throw new Error("AURA_QUERY_REQUEST_INVALID");
  return valueText;
}
function responseFields(result: Record<string, unknown>) {
  return {
    conversationId: result.conversationId ?? result.conversation_id ?? null,
    revision: Number(result.revision || 0),
    // Internal parser choices/cursors can retain data from an older result; the UI does not need them.
    context: {},
    conversations: Array.isArray(result.conversations) ? result.conversations.map(normalizeConversation) : [],
    turns: Array.isArray(result.turns) ? result.turns.map(normalizeTurn) : [],
    hasMore: result.hasMore === true || result.has_more === true,
    nextCursor: result.nextCursor ?? result.next_cursor ?? null,
  };
}
function normalizeConversation(value: unknown) {
  const item = record(value);
  return { id: item.id ?? item.conversationId ?? item.conversation_id, title: item.title ?? "AURA conversation", updatedAt: item.updatedAt ?? item.updated_at ?? null };
}
function normalizeTurn(value: unknown) {
  const item = record(value);
  const response = record(item.response);
  const reply = response.reply ?? item.reply ?? "";
  const actions = Array.isArray(response.actions) ? response.actions.map(record)
    .filter((action) => action.type === "records" || action.type === "inventory_result") : [];
  return { text: String(item.text ?? item.userText ?? item.user_text ?? ""), response: { reply: String(reply || ""), actions } };
}
function boundedCursor(value: unknown) {
  if (value == null) return null;
  const cursor = record(value);
  if (Object.keys(cursor).length > 8 || JSON.stringify(cursor).length > 500) throw new Error("AURA_QUERY_REQUEST_INVALID");
  return jsonValue(cursor);
}
function inventoryFilters(filters: Record<string, unknown>) {
  if (filters.status || filters.dateFrom || filters.dateTo || filters.bay || filters.recordId || filters.quantity != null) {
    throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  }
  for (const key of Object.keys(filters)) if (!INVENTORY_FILTER_KEYS.has(key)) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  return filters;
}

function envValue(deps: AuraQueryDeps, name: string) {
  return String((deps.env || Deno.env.get.bind(Deno.env))(name) || "").trim();
}
function clients(deps: AuraQueryDeps, bearer: string) {
  if (deps.adminClient && deps.userClient) return { admin: deps.adminClient, user: deps.userClient };
  const url = envValue(deps, "SUPABASE_URL");
  const serviceKey = envValue(deps, "SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = envValue(deps, "SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) throw new Error("AURA_QUERY_CONFIGURATION_UNAVAILABLE");
  return {
    admin: createClient<Database>(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    user: createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    }),
  };
}
function bearerFrom(request: Request) {
  const value = String(request.headers.get("authorization") || "").trim();
  return /^Bearer\s+\S+$/i.test(value) ? value.replace(/^Bearer\s+/i, "").trim() : "";
}
async function legacyTurnId(request: Request) {
  const idempotencyKey = String(request.headers.get("idempotency-key") || request.headers.get("x-request-id") || "").trim();
  if (!idempotencyKey) return crypto.randomUUID();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(idempotencyKey)));
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function authorize(request: Request, admin: QueryClient): Promise<AuthResult | null> {
  const bearer = bearerFrom(request);
  if (!bearer) return null;
  const { data, error } = await admin.auth.getUser(bearer);
  const actorId = String(data?.user?.id || "");
  if (error || !UUID.test(actorId)) return null;
  const session = await readSupabaseOrAppSessionFromRequest(request, admin);
  if (!session || String(session.authUserId || "") !== actorId || session.mustChangePassword
    || normalizeUsername(session.username) !== "dylan_collyge") return null;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,username,display_name,role,disabled_at,locked_until,must_change_password")
    .eq("id", actorId).maybeSingle();
  const lockedUntil = Date.parse(String(profile?.locked_until || ""));
  if (profileError || !profile || String(profile.username || "") !== "dylan_collyge"
    || String(profile.id || "") !== actorId || profile.disabled_at || profile.must_change_password
    || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())
    || !auraInventoryV2ProfileMatches(session, profile)
    || !await isAppAccountActive(admin, { id: actorId })) return null;
  return { actorId, username: "dylan_collyge", session: { ...session } };
}
async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("AURA_QUERY_REQUEST_INVALID");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); throw new Error("AURA_QUERY_REQUEST_INVALID"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return record(JSON.parse(new TextDecoder().decode(bytes))); }
  catch { throw new Error("AURA_QUERY_REQUEST_INVALID"); }
}
function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(signal.reason || new DOMException("AURA request timed out.", "AbortError"));
    signal.addEventListener("abort", () => reject(signal.reason || new DOMException("AURA request timed out.", "AbortError")), { once: true });
  });
}
function safeErrorCode(error: unknown) {
  const value = record(error);
  const candidate = String(value.code || (error instanceof Error ? error.message : ""));
  return /^[A-Z0-9_]{2,80}$/.test(candidate) ? candidate : "AURA_QUERY_UNAVAILABLE";
}
type RpcName = keyof Database["public"]["Functions"];
async function rpc<N extends RpcName>(client: QueryClient, name: N, args: Database["public"]["Functions"][N]["Args"] | undefined, signal?: AbortSignal) {
  return record(await rpcValue(client, name, args, signal));
}
async function rpcValue<N extends RpcName>(client: QueryClient, name: N, args: Database["public"]["Functions"][N]["Args"] | undefined, signal?: AbortSignal): Promise<unknown> {
  let query = client.rpc(name, args);
  if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function moduleAllowed(admin: QueryClient, actorId: string, module: string) {
  const view = MODULE_VIEW[module] || (Object.hasOwn(AURA_MODULE_CAPABILITIES, module) ? module : "");
  if (!view) return false;
  const { data, error } = await admin.rpc("navigation_module_allowed_v1", { p_actor_id: actorId, p_view: view });
  if (error) throw error;
  return data === true;
}
const SOURCE_MODULE: Record<string, string> = {
  inventory: "drive", ownership: "drive", unassigned: "drive", lot: "drive", eval_work: "review",
  location_work: "tasks", requests: "request", orders: "sales-office", dock: "docks", hr: "hours",
  calendar: "department-calendar", chat: "chat", weather: "reports", production: "production-workflow",
  photos: "drive", marketing: "drive",
};
async function sourcesAllowed(admin: QueryClient, user: QueryClient, actorId: string, sources: unknown, signal?: AbortSignal) {
  const descriptors = Array.isArray(sources) ? sources.map((source) => typeof source === "string" ? { mode: source } : record(source)) : [];
  for (const descriptor of descriptors) {
    const name = String(descriptor.mode || "");
    const capability = descriptor.capabilityId ? AURA_READ_CAPABILITIES[String(descriptor.capabilityId)] : null;
    const module = capability?.module || (Object.hasOwn(AURA_MODULE_CAPABILITIES, String(descriptor.module || "")) ? String(descriptor.module) : "") || SOURCE_MODULE[name];
    if (!module || !await moduleAllowed(admin, actorId, module)) return false;
    const ids = Array.isArray(descriptor.recordIds) ? descriptor.recordIds.map(String).filter(Boolean).slice(0, 200) : [];
    if (!ids.length && descriptor.table) continue;
    if (name === "chat") {
      let query = user.from("ph_chat_participants").select("conversation_id").eq("username", "dylan_collyge").limit(500);
      if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      const memberIds = new Set(Array.isArray(data) ? data.map((row: Record<string, unknown>) => String(row.conversation_id || "")) : []);
      const conversationIds = Array.isArray(descriptor.conversationIds) ? descriptor.conversationIds.map(String) : [];
      if (!conversationIds.length || conversationIds.some((id) => !memberIds.has(id))) return false;
      continue;
    }
    if (!capability && descriptor.table && descriptor.key) {
      if (descriptor.table === "ph_location_work_assignments" && descriptor.key === "job_id") {
        const expected = new Set(ids);
        const jobIds = [...new Set(ids.map((value) => value.split("|", 2)[0]))];
        let assignmentQuery = user.from("ph_location_work_assignments").select("job_id,username").in("job_id", jobIds).limit(1000);
        if (signal && typeof assignmentQuery.abortSignal === "function") assignmentQuery = assignmentQuery.abortSignal(signal);
        const { data, error } = await assignmentQuery;
        if (error) throw error;
        const found = new Set(Array.isArray(data) ? data.map((row: Record<string, unknown>) => `${String(row.job_id || "")}|${String(row.username || "")}`) : []);
        if ([...expected].some((id) => !found.has(id))) return false;
        continue;
      }
      const safeTables: Record<string, string> = {
        ph_location_work_jobs: "id", ph_location_work_lines: "id",
      };
      const table = String(descriptor.table); const key = String(descriptor.key);
      if (safeTables[table] !== key) return false;
      if (table !== "ph_location_work_jobs" && table !== "ph_location_work_lines") return false;
      let query = table === "ph_location_work_jobs"
        ? user.from("ph_location_work_jobs").select("id").in("id", ids).limit(200)
        : user.from("ph_location_work_lines").select("id").in("id", ids).limit(200);
      if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      const found = new Set(Array.isArray(data) ? data.map((row) => String(record(row).id || "")) : []);
      if (ids.some((id) => !found.has(id))) return false;
      continue;
    }
    if (!capability) return false;
    if (capability.reader === "inventory") {
      const query = record(descriptor.query);
      const data = await rpc(admin, "aura_query_inventory_v1", { p_actor_id: actorId, p_operation: String(query.operation || "stock"),
        p_filters: jsonRecord(query.filters), p_cursor: boundedCursor(query.cursor), p_limit: 200 }, signal);
      if (data.ok !== true) return false;
      const returned = Array.isArray(data.rows) ? data.rows.map((row) => String(record(row).selectionId || record(row).uniqueId || "")) : [];
      if (ids.length && ids.some((id) => !returned.includes(id))) return false;
      continue;
    }
    if (capability.reader === "low_stock") {
      const data = await rpcValue(user, "get_eval_item_low_stock_targets_v1", { p_itemcodes: ids, p_limit: Math.min(200, Math.max(1, ids.length)) }, signal);
      const returned = Array.isArray(data) ? new Set(data.map((row) => String(record(row).itemcode_normalized || ""))) : new Set<string>();
      if (ids.some((id) => !returned.has(id))) return false;
      continue;
    }
    if (capability.reader === "operations") {
      const before = record(descriptor.query).before;
      const data = await rpcValue(user, "list_codex_ops_tasks_v1", { ...(typeof before === "string" ? { p_before: before } : {}), p_limit: 50 }, signal);
      const returned = Array.isArray(data) ? new Set(data.map((row) => String(record(row).id || ""))) : new Set<string>();
      if (ids.some((id) => !returned.has(id))) return false;
      continue;
    }
    if (capability.reader === "production_schedule") {
      const query = record(descriptor.query);
      for (const rowNumber of ids) {
        const sourceRow = Number(rowNumber);
        const data = record(await rpcValue(admin, "production_schedule_read_rows_v1", {
          p_sheet_index: Number(query.sheetIndex), ...(typeof query.snapshotId === "string" ? { p_snapshot_id: query.snapshotId } : {}),
          p_cursor: Math.max(0, sourceRow - 1), p_limit: 1, p_search: "", p_filters: jsonRecord({}),
        }, signal));
        if (!Array.isArray(data.rows) || !data.rows.some((row) => Number(record(row).sourceRow) === sourceRow)) return false;
      }
      continue;
    }
    if (capability.reader === "hl_orders") {
      const query = record(descriptor.query);
      const data = await rpc(admin, "aura_query_hl_order_v1", { p_actor_id: actorId, p_operation: String(query.operation || "orders"),
        p_filters: jsonRecord(query.filters), p_cursor: boundedCursor(query.cursor), p_limit: 200 }, signal);
      const idField = query.operation === "receipts" ? "receiptId" : query.operation === "balances" ? "poId" : "orderId";
      const returned = Array.isArray(data.rows) ? new Set(data.rows.map((row) => String(record(row)[idField] || record(row).selectionId || record(row).id || ""))) : new Set<string>();
      if (ids.some((id) => !returned.has(id))) return false;
      continue;
    }
    if (capability.reader === "bunch_notes") {
      const query = record(descriptor.query);
      const idsToCheck = ids;
      for (const recordId of idsToCheck) {
        const filters = { ...record(query.filters), recordId };
        const data = await rpc(admin, "aura_query_bunch_v1", { p_actor_id: actorId, p_operation: "get", p_filters: jsonRecord(filters), p_limit: 1 }, signal);
        if (data.ok !== true || !Array.isArray(data.rows) || !data.rows.some((row) => String(record(row).recordId || record(row).id || "") === recordId)) return false;
      }
      continue;
    }
    if (capability.reader === "seasonal_records") {
      const query = record(descriptor.query);
      const data = await rpc(admin, "aura_query_seasonal_records_v1", {
        p_actor_id: actorId, p_capability: capability.id || "", p_filters: jsonRecord(query.filters),
        p_cursor: boundedCursor(query.cursor), p_limit: 200,
      }, signal);
      if (data.ok !== true) return false;
      const returned = Array.isArray(data.rows)
        ? new Set(data.rows.map((row) => String(record(row)[capability.key] || record(row).unique_id || record(row).id || "")))
        : new Set<string>();
      if (ids.some((id) => !returned.has(id))) return false;
      continue;
    }
    if (capability.reader === "navigation") {
      for (const id of ids) if (!await moduleAllowed(admin, actorId, id)) return false;
      continue;
    }
    if (capability.reader === "settings") {
      const data = record(await rpcValue(user, "get_eval_report_settings", undefined, signal));
      if (ids.some((id) => !Object.hasOwn(data, id))) return false;
      continue;
    }
    if (capability.table && capability.key && ids.length) {
      const table = capability.table;
      if (!isPublicTableName(table)) return false;
      if (!capability.key) return false;
      let query = user.from(table).select(capability.fields).limit(200);
      query = query.filter(capability.key, "in", `(${ids.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`);
      for (const [field, value] of Object.entries(capability.fixedFilters || {})) query = query.eq(field, value);
      if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw error;
      const found = new Set(Array.isArray(data) ? data.map((row) => String(record(row)[capability.key] || "")) : []);
      if (ids.some((id) => !found.has(id))) return false;
    }
  }
  return true;
}

function searchTerm(intent: AuraIntent) {
  const value = String(intent.filters.productText || "").trim();
  if (!value || /^(?:open|active|pending|recent|latest|today|this week|this month|all)$/i.test(value)) return "";
  return value;
}
function assertDomainFilters(capability: AuraCapability, filters: Record<string, unknown>) {
  if (capability.reader === "seasonal_records") {
    const unsupported = capability.id === "av" ? ["locationCode", "lotcode", "status"]
      : capability.id === "reserves" ? ["status"] : [];
    if (unsupported.some(key => filters[key] != null && filters[key] !== "")) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  }
  const reader = capability.reader;
  const allowedByReader: Record<string, Set<string>> = {
    low_stock: new Set(["itemcode"]),
    settings: new Set(),
    operations: new Set(),
    navigation: new Set(["navigationView"]),
    production_schedule: new Set(["productText", "locationCode", "locationMode", "lotcode", "contSize", "assigneeText", "selectionId"]),
    hl_orders: new Set(["productText", "itemcode", "lotcode", "contSize", "status"]),
    bunch_notes: new Set(["recordId", "status", "locationCode", "locationMode", "productText", "dateFrom", "dateTo"]),
    seasonal_records: new Set(["productText", "itemcode", "locationCode", "locationMode", "lotcode", "status", "season", "salesYear", "seasonReference"]),
  };
  if (!reader || !allowedByReader[reader]) return;
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === false || value === "") continue;
    if ((key === "metric" && value === "ptravailable") || (key === "countMode" && value === "quantity")
      || (key === "openStockOnly" && value === false)) continue;
    if (!allowedByReader[reader].has(key)) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  }
}
type FilterPart = { field: string; operator: "eq" | "like" | "ilike" | "gte" | "lt"; value: string };
function applyFilters(capability: AuraCapability, intent: AuraIntent): FilterPart[] {
  const result: FilterPart[] = [];
  const add = (field: string, operator: FilterPart["operator"], value: unknown) => result.push({ field, operator, value: String(value) });
  const f = intent.filters;
  if (f.zone || f.bay || f.quantity != null) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  if (f.commonName || f.genus || f.openStockOnly === true || f.countMode && f.countMode !== "quantity" || f.metric && f.metric !== "ptravailable"
    || f.assigneeText || f.selectionId || f.navigationView) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  if (capability.id === "po_fall" || capability.id === "po_spring") {
    const expectedSeason = capability.id === "po_spring" ? "S1" : "F1";
    if ((f.season && f.season !== expectedSeason) || (f.salesYear != null && Number(f.salesYear) !== 27)) {
      throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    }
  } else if (f.salesYear != null) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  const fieldMap: Record<string, string[]> = {
    itemcode: ["itemcode", "item_code", "itemcode_normalized", "sku"],
    locationCode: ["locationcode", "source_locationcode", "origin_locationcode"],
    lotcode: ["lotcode", "source_lotcode", "origin_lotcode"],
    contSize: ["contsize", "source_contsize"], season: ["season"],
  };
  for (const [filter, options] of Object.entries(fieldMap)) {
    if (f[filter] == null) continue;
    if (filter === "season" && (capability.id === "po_fall" || capability.id === "po_spring")) continue;
    const field = options.find((candidate) => capability.filterFields.includes(candidate));
    if (!field) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    if (filter === "locationCode" && f.locationMode === "prefix") add(field, "like", `${escapeAuraLike(String(f[filter]))}%`);
    else if (filter === "locationCode" && f.locationMode === "contains") add(field, "ilike", `%${escapeAuraLike(String(f[filter]))}%`);
    else add(field, "eq", f[filter]);
  }
  if (f.assignee) {
    const key = ["assignedto", "assignee_username", "assigned_to_username", "requested_by_username", "created_by_username"]
      .find((candidate) => capability.filterFields.includes(candidate));
    if (!key) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    add(key, "ilike", escapeAuraLike(String(f.assignee)));
  }
  if (f.recordId) {
    const key = [capability.key, "id", "unique_id", "event_key"].find((candidate) => candidate && capability.filterFields.includes(candidate));
    if (!key) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    add(key, "eq", f.recordId);
  }
  if (f.status) {
    const key = ["status", "req_status", "order_status", "workflow_status", "issue_state", "review_status", "credit_status", "row_status", "stage"].find((candidate) => capability.filterFields.includes(candidate));
    if (!key) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    add(key, "ilike", String(f.status));
  }
  if (f.dateFrom != null || f.dateTo != null) {
    if (!capability.dateField) throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
    if (f.dateFrom != null) add(capability.dateField, "gte", f.dateFrom);
    if (f.dateTo != null) add(capability.dateField, "lt", f.dateTo);
  }
  return result;
}
async function readCapability(user: QueryClient, capability: AuraCapability, intent: AuraIntent, context: QueryContext, signal?: AbortSignal) {
  const queryText = searchTerm(intent);
  const searchFields = queryText ? capability.searchFields : [""];
  const table = capability.table;
  if (!isPublicTableName(table)) throw new Error("AURA_QUERY_CAPABILITY_UNAVAILABLE");
  const projection = capability.fields.split(",").map((field) => field.trim()).filter(Boolean);
  const tableSchema = contracts.tables[table].row;
  if (!tableSchema || typeof tableSchema !== "object" || !("object" in tableSchema)
    || projection.some((field) => !Object.hasOwn(tableSchema.object, field))) throw new Error("AURA_QUERY_CAPABILITY_UNAVAILABLE");
  const filters = applyFilters(capability, intent);
  const pagesCursor = record(record(context.nextCursor).pages);
  const pageCursor = record(pagesCursor[capability.id || ""]);
  const pages = await Promise.all(searchFields.map(async (field) => {
    let query = user.from(table).select(projection.join(","), { count: "exact" }).order(capability.key, { ascending: false }).limit(MAX_PAGE + 1);
    if (pageCursor.key != null) query = query.lt(capability.key, pageCursor.key);
    for (const [field, value] of Object.entries(capability.fixedFilters || {})) query = query.eq(field, value);
    for (const filter of filters) query = query.filter(filter.field, filter.operator, filter.value);
    if (field) query = query.ilike(field, `%${escapeAuraLike(queryText)}%`);
    if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (error) throw error;
    const selected = Array.isArray(data) ? data.map(record) : [];
    const rows = selected.map((row) => Object.fromEntries(projection.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]])));
    return { rows, count: Number.isFinite(count) ? Number(count) : null };
  }));
  const unique = new Map<string, Record<string, unknown>>();
  for (const page of pages) for (const row of page.rows) unique.set(String(row[capability.key] || JSON.stringify(row)), row);
  const compareKeys = (left: unknown, right: unknown) => {
    if (typeof left === "number" && typeof right === "number") return left === right ? 0 : left > right ? -1 : 1;
    const a = String(left ?? ""); const b = String(right ?? "");
    return a === b ? 0 : a > b ? -1 : 1;
  };
  const rows = [...unique.values()].sort((a, b) => compareKeys(a[capability.key], b[capability.key]));
  const hasMore = pages.some((page) => page.rows.length > MAX_PAGE) || rows.length > MAX_PAGE;
  const nextCursor = hasMore && rows.length ? { capabilityId: capability.id, key: rows[Math.min(MAX_PAGE, rows.length) - 1]?.[capability.key] } : null;
  return { rows: rows.slice(0, MAX_PAGE + 1), total: searchFields.length === 1 ? pages[0].count : null, hasMore, nextCursor };
}
function labelFor(row: Record<string, unknown>) {
  return [row.commonName || row.commonname || row.title || row.name || row.itemcode || row.id,
    row.contSize || row.contsize, row.locationCode || row.locationcode, row.lotCode || row.lotcode]
    .filter((part) => part != null && String(part).trim()).map(String).join(" · ") || "Record";
}
function safeRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value == null || typeof value === "boolean" || typeof value === "number") next[key] = value;
      else if (typeof value === "string") next[key] = value.slice(0, 500);
      else if (Array.isArray(value)) next[key] = value.slice(0, 25).map((item) => typeof item === "string" ? item.slice(0, 120) : item);
    }
    return next;
  });
}
async function readLocationWork(user: QueryClient, intent: AuraIntent, context: QueryContext, signal?: AbortSignal) {
  const filter = intent.filters;
  if (filter.assigneeText || filter.genus || filter.season || filter.salesYear != null || filter.openStockOnly === true || filter.zone || filter.quantity != null || filter.lotcode)
    throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  const offset = Number(context.nextCursor || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("AURA_QUERY_REQUEST_INVALID");
  let jobsQuery = user.from("ph_location_work_jobs")
    .select("id,title,status,revision,line_count,resolved_line_count,assigned_usernames,created_by_username,created_at,updated_at,completed_by_username,completed_at")
    .order("updated_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + MAX_PAGE);
  if (filter.status) jobsQuery = jobsQuery.eq("status", String(filter.status));
  else if (/\b(open|pending|in progress|active)\b/i.test(intent.question)) jobsQuery = jobsQuery.in("status", ["open", "in_progress"]);
  if (filter.recordId) jobsQuery = jobsQuery.eq("id", String(filter.recordId));
  if (filter.dateFrom) jobsQuery = jobsQuery.gte("created_at", filter.dateFrom);
  if (filter.dateTo) jobsQuery = jobsQuery.lt("created_at", filter.dateTo);
  const assignee = String(filter.assignee || "").trim();
  if (assignee) jobsQuery = jobsQuery.contains("assigned_usernames", [assignee]);
  if (signal && typeof jobsQuery.abortSignal === "function") jobsQuery = jobsQuery.abortSignal(signal);
  const { data: jobsData, error: jobsError } = await jobsQuery;
  if (jobsError) throw jobsError;
  const jobs = Array.isArray(jobsData) ? jobsData as Record<string, unknown>[] : [];
  const ids = jobs.map((job) => String(job.id || "")).filter(Boolean);
  if (!ids.length) return { rows: jobs, hasMore: jobs.length > MAX_PAGE, nextCursor: jobs.length > MAX_PAGE ? offset + MAX_PAGE : null };
  let assignmentQuery = user.from("ph_location_work_assignments").select("job_id,username,display_name").in("job_id", ids).limit(1000);
  let linesQuery = user.from("ph_location_work_lines").select("id,job_id,itemcode,commonname,contsize,source_locationcode,action_type,planned_qty,destination_locationcode,resolution_status,actual_qty,ordinal").in("job_id", ids).order("ordinal", { ascending: true }).limit(1000);
  if (signal) {
    if (typeof assignmentQuery.abortSignal === "function") assignmentQuery = assignmentQuery.abortSignal(signal);
    if (typeof linesQuery.abortSignal === "function") linesQuery = linesQuery.abortSignal(signal);
  }
  const [assignments, lines] = await Promise.all([assignmentQuery, linesQuery]);
  if (assignments.error) throw assignments.error;
  if (lines.error) throw lines.error;
  const byJob = new Map<string, { assignedUsers: Record<string, unknown>[]; lines: Record<string, unknown>[] }>();
  for (const jobId of ids) byJob.set(jobId, { assignedUsers: [], lines: [] });
  for (const row of assignments.data || []) byJob.get(String(row.job_id))?.assignedUsers.push(row);
  for (const row of lines.data || []) byJob.get(String(row.job_id))?.lines.push(row);
  const locationCode = String(filter.locationCode || "").toUpperCase();
  const product = String(filter.productText || "").toLocaleLowerCase();
  const itemcode = String(filter.itemcode || "").toLocaleUpperCase();
  const size = String(filter.contSize || "").toLocaleUpperCase();
  const joined = jobs.map((job) => ({ ...job, ...(byJob.get(String(job.id)) || { assignedUsers: [], lines: [] }) }))
    .map((job) => {
      let lines = job.lines as Record<string, unknown>[];
      if (locationCode) lines = lines.filter((line) => {
        const value = String(line.source_locationcode || "").toUpperCase();
        return filter.locationMode === "prefix" ? value.startsWith(locationCode) : value === locationCode;
      });
      if (itemcode) lines = lines.filter((line) => String(line.itemcode || "").toUpperCase() === itemcode);
      if (size) lines = lines.filter((line) => String(line.contsize || "").toUpperCase() === size);
      if (product) lines = lines.filter((line) => [line.itemcode, line.commonname, line.contsize].some((value) => String(value || "").toLocaleLowerCase().includes(product)));
      const users = job.assignedUsers as Record<string, unknown>[];
      return { ...job, lines, assignedUsers: users };
    })
    .filter((job) => (!locationCode && !itemcode && !size && !product) || (job.lines as unknown[]).length > 0);
  const hasMore = jobs.length > MAX_PAGE || (Array.isArray(lines.data) && lines.data.length >= 1000);
  return { rows: joined, hasMore, nextCursor: hasMore ? offset + MAX_PAGE : null };
}
async function readPrivateChat(user: QueryClient, intent: AuraIntent, context: QueryContext, signal?: AbortSignal) {
  const filter = intent.filters;
  if (filter.status || filter.assignee || filter.assigneeText || filter.genus || filter.itemcode || filter.contSize || filter.lotcode || filter.locationCode || filter.season || filter.salesYear != null)
    throw new Error("AURA_QUERY_FILTER_NEEDS_CLARIFICATION");
  const offset = Number(context.nextCursor || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("AURA_QUERY_REQUEST_INVALID");
  let membership = user.from("ph_chat_participants").select("conversation_id").eq("username", "dylan_collyge").limit(500);
  if (filter.recordId) membership = membership.eq("conversation_id", String(filter.recordId));
  if (signal && typeof membership.abortSignal === "function") membership = membership.abortSignal(signal);
  const { data, error } = await membership;
  if (error) throw error;
  const ids = [...new Set((Array.isArray(data) ? data : []).map((row: Record<string, unknown>) => String(row.conversation_id || "")).filter(Boolean))];
  if (!ids.length) return { rows: [], hasMore: false, nextCursor: null };
  const search = searchTerm(intent);
  let query = user.from("ph_chat_messages").select("id,conversation_id,sender_username,sender_display_name,body,message_text,created_at,message_type")
    .in("conversation_id", ids).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + MAX_PAGE);
  if (search) query = query.ilike("body", `%${escapeAuraLike(search)}%`);
  if (filter.dateFrom) query = query.gte("created_at", filter.dateFrom);
  if (filter.dateTo) query = query.lt("created_at", filter.dateTo);
  if (filter.recordId && !ids.includes(String(filter.recordId))) return { rows: [], hasMore: false, nextCursor: null };
  if (signal && typeof query.abortSignal === "function") query = query.abortSignal(signal);
  const result = await query;
  if (result.error) throw result.error;
  const rows = Array.isArray(result.data) ? result.data as Record<string, unknown>[] : [];
  const hasMore = rows.length > MAX_PAGE;
  return { rows: rows.slice(0, MAX_PAGE), hasMore, nextCursor: hasMore ? offset + MAX_PAGE : null };
}
async function runDomainRead(admin: QueryClient, user: QueryClient, actorId: string, intent: AuraIntent, context: QueryContext, signal?: AbortSignal) {
  if (!await moduleAllowed(admin, actorId, intent.module)) return { rows: [], hasMore: false, unavailable: true };
  if (intent.mode === "location_work") {
    const result = await readLocationWork(user, intent, context, signal);
    const visibleRows = safeRows(result.rows.slice(0, MAX_PAGE));
    const sources = [
      { module: "tasks", table: "ph_location_work_jobs", key: "id", recordIds: visibleRows.map((row) => String(row.id || "")).filter(Boolean) },
      { module: "tasks", table: "ph_location_work_assignments", key: "job_id", recordIds: visibleRows.flatMap((row) => (row.assignedUsers as Record<string, unknown>[] || []).map((item) => `${String(row.id || "")}|${String(item.username || "")}`).filter((item) => !item.endsWith("|"))) },
      { module: "tasks", table: "ph_location_work_lines", key: "id", recordIds: visibleRows.flatMap((row) => (row.lines as Record<string, unknown>[] || []).map((item) => String(item.id || "")).filter(Boolean)) },
    ].filter((source) => source.recordIds.length > 0);
    return { rows: visibleRows, hasMore: result.hasMore, nextCursor: result.nextCursor, unavailable: false, sources };
  }
  if (intent.mode === "chat") {
    const result = await readPrivateChat(user, intent, context, signal);
    const rows = result.rows;
    return { rows: safeRows(rows), hasMore: result.hasMore, nextCursor: result.nextCursor, unavailable: false,
      sources: rows.length ? [{ mode: "chat", module: "chat", conversationIds: [...new Set(rows.map((row) => String(row.conversation_id || "")).filter(Boolean))] }] : [] };
  }
  const capabilities = capabilityForIntent(intent);
  if (!capabilities.length) return { rows: [], hasMore: false, unavailable: true };
  const checks = await Promise.all(capabilities.map(async (capability) => {
    if (!await moduleAllowed(admin, actorId, capability.module)) return { capability, denied: true, result: { rows: [] as Record<string, unknown>[], total: null, hasMore: false, nextCursor: null } };
    try { return { capability, denied: false, result: await readCapability(user, capability, intent, context, signal) }; }
    catch (error) {
      const code = String(record(error).code || "");
      if (code === "42501" || /permission denied|not authorized/i.test(String(record(error).message || ""))) return { capability, denied: true, result: { rows: [], total: null, hasMore: false, nextCursor: null } };
      throw error;
    }
  }));
  const all = checks.flatMap((entry) => entry.result.rows);
  const keyField = capabilities[0].key;
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of all) unique.set(String(row[keyField] || JSON.stringify(row)), row);
  const rows = [...unique.values()].slice(0, MAX_PAGE);
  const sources = checks.flatMap((entry) => entry.denied ? [] : [{ capabilityId: entry.capability.id, module: entry.capability.module,
    recordIds: entry.result.rows.map((row) => String(row[entry.capability.key] || "")).filter(Boolean).slice(0, 200) }]);
  const pages = Object.fromEntries(checks.filter((entry) => entry.result.nextCursor).map((entry) => [entry.capability.id, entry.result.nextCursor]));
  const completeCount = checks.length === 1 ? checks[0].result.total : null;
  return { rows: safeRows(rows), hasMore: all.length > MAX_PAGE || checks.some((entry) => entry.result.hasMore), unavailable: !all.length && checks.every((entry) => entry.denied), sources,
    total: completeCount, nextCursor: Object.keys(pages).length ? { pages } : null };
}

async function runSpecialReader(admin: QueryClient, user: QueryClient, actorId: string, intent: AuraIntent,
  capability: AuraCapability, context: QueryContext, signal?: AbortSignal): Promise<{ reply: string; actions: QueryAction[]; context: QueryContext; sourceQuery?: Record<string, unknown>; total?: number | null; complete?: boolean; unresolvedCount?: number; season?: string; yearCoverage?: string; salesYear?: number; settingRevision?: number }> {
  const reader = capability.reader;
  if (reader === "navigation") {
    const modules = Object.entries(AURA_MODULE_CAPABILITIES);
    const entries: Array<{ view: string; info: typeof AURA_MODULE_CAPABILITIES[keyof typeof AURA_MODULE_CAPABILITIES]; allowed: boolean }> = [];
    for (let offset = 0; offset < modules.length; offset += 8) {
      const batch = await Promise.all(modules.slice(offset, offset + 8).map(async ([view, info]) => ({
        view, info, allowed: await moduleAllowed(admin, actorId, view),
      })));
      entries.push(...batch);
    }
    const rows = entries.filter((entry) => entry.allowed).map(({ view, info }) => ({ view, title: info.questions[0], available: info.available }));
    return responseForRows(intent, rows.slice(0, MAX_PAGE), rows.length > MAX_PAGE);
  }
  if (reader === "settings") {
    const data = record(await rpcValue(user, "get_eval_report_settings", undefined, signal));
    const rows = Object.entries(data).map(([key, value]) => ({ setting: key, value }));
    return responseForRows(intent, rows.slice(0, MAX_PAGE), rows.length > MAX_PAGE);
  }
  if (reader === "operations") {
    const before = context.nextCursor == null ? undefined : text(context.nextCursor, 80);
    const data = await rpcValue(user, "list_codex_ops_tasks_v1", { ...(before ? { p_before: before } : {}), p_limit: MAX_PAGE }, signal);
    const rows = Array.isArray(data) ? data.map(record) : [];
    const visible = rows.slice(0, MAX_PAGE);
    const nextCursor = rows.length >= MAX_PAGE ? visible[visible.length - 1]?.createdAt || null : null;
    const result = responseForRows(intent, visible, Boolean(nextCursor));
    return { ...result, context: { ...result.context, nextCursor }, sourceQuery: { before } };
  }
  if (reader === "low_stock") {
    const productCode = String(intent.filters.itemcode || "").trim().toUpperCase();
    const data = await rpcValue(user, "get_eval_item_low_stock_targets_v1", {
      ...(productCode ? { p_itemcodes: [productCode] } : {}),
      ...(context.nextCursor == null ? {} : { p_after_itemcode: text(context.nextCursor, 100) }), p_limit: MAX_PAGE,
    }, signal);
    const rows = Array.isArray(data) ? data.map(record) : [];
    const visible = rows.slice(0, MAX_PAGE);
    const nextCursor = rows.length >= MAX_PAGE ? visible[visible.length - 1]?.itemcode_normalized || null : null;
    const result = responseForRows(intent, visible, Boolean(nextCursor));
    return { ...result, context: { ...result.context, nextCursor }, sourceQuery: { itemcode: productCode || null } };
  }
  if (reader === "hl_orders") {
    const operation = /\b(?:receipt|receipts|received)\b/i.test(intent.question) ? "receipts"
      : /\b(?:balance|balances|remaining|open po)\b/i.test(intent.question) ? "balances" : "orders";
    const filters: Record<string, unknown> = {};
    const orderNumber = intent.question.match(/\b(?:order|po)\s*(?:number|#)?\s*([A-Z0-9][A-Z0-9-]{2,30})\b/i)?.[1];
    if (orderNumber && !/^(?:HL|ORDERS?)$/i.test(orderNumber)) filters.orderNumber = orderNumber;
    const itemcode = intent.question.match(/\bitem\s*(?:code)?\s*[:#]?\s*([A-Z0-9][A-Z0-9._-]{2,30})\b/i)?.[1];
    if (itemcode) filters.itemcode = itemcode;
    const lotcode = intent.filters.lotcode;
    const size = intent.filters.contSize;
    const productText = intent.filters.productText;
    if (lotcode) filters.lot = lotcode;
    if (size) filters.size = size;
    if (productText) filters.productText = productText;
    if (/\bpending\b/i.test(intent.question)) filters.status = "pending";
    const data = await rpc(admin, "aura_query_hl_order_v1", {
      p_actor_id: actorId, p_operation: operation, p_filters: jsonRecord(filters),
      p_cursor: boundedCursor(context.nextCursor), p_limit: MAX_PAGE,
    }, signal);
    if (data.ok === false) throw Object.assign(new Error(String(data.code || "AURA_HL_ORDER_UNAVAILABLE")), { status: 503 });
    const rows = Array.isArray(data.rows) ? data.rows.map(record) : [];
    const result = responseForRows(intent, rows, data.hasMore === true);
    return { ...result, context: { ...result.context, nextCursor: data.nextCursor || null }, sourceQuery: { operation, filters, cursor: boundedCursor(context.nextCursor) } };
  }
  if (reader === "bunch_notes") {
    const filters: Record<string, unknown> = {};
    for (const key of ["recordId", "status", "locationCode", "locationMode", "productText", "dateFrom", "dateTo"])
      if (intent.filters[key] != null) filters[key] = intent.filters[key];
    const operation = filters.recordId ? "get" : "list";
    const cursor = boundedCursor(context.nextCursor);
    const data = await rpc(admin, "aura_query_bunch_v1", { p_actor_id: actorId, p_operation: operation, p_filters: jsonRecord(filters), p_cursor: cursor, p_limit: MAX_PAGE }, signal);
    if (data.ok !== true) throw Object.assign(new Error(String(data.code || "AURA_BUNCH_READ_UNAVAILABLE")), { status: 503 });
    const rows = Array.isArray(data.rows) ? data.rows.map(record) : [];
    const response = responseForRows(intent, rows, data.hasMore === true);
    const reply = intent.operation === "count"
      ? data.complete === true && data.total != null ? `Verified ${new Intl.NumberFormat("en-US").format(Number(data.total))} Bunch Notes record${Number(data.total) === 1 ? "" : "s"}.`
        : "The Bunch Notes count is incomplete, so I can’t give a reliable total. Please refine the filters or try again later."
      : response.reply;
    return { ...response, reply, context: { ...response.context, nextCursor: data.nextCursor || null },
      sourceQuery: { operation, filters, cursor } };
  }
  if (reader === "seasonal_records") {
    const filters: Record<string, unknown> = {};
    for (const key of ["productText", "itemcode", "locationCode", "locationMode", "lotcode", "status", "season", "salesYear", "seasonReference"])
      if (intent.filters[key] != null) filters[key] = intent.filters[key];
    const cursor = boundedCursor(context.nextCursor);
    const data = await rpc(admin, "aura_query_seasonal_records_v1", {
      p_actor_id: actorId, p_capability: capability.id || "", p_filters: jsonRecord(filters), p_cursor: cursor, p_limit: MAX_PAGE,
    }, signal);
    if (data.ok !== true) throw Object.assign(new Error(String(data.code || "AURA_SEASONAL_READ_UNAVAILABLE")), { status: 503 });
    if (data.yearCoverage === "season-only" && intent.filters.salesYear != null) throw new Error("AURA_SEASON_YEAR_UNAVAILABLE");
    const rows = Array.isArray(data.rows) ? data.rows.map(record) : [];
    const unresolvedCount = Number(data.unresolvedCount || 0);
    const season = String(data.season || filters.season || "");
    const scope = season ? ` for season ${season}` : "";
    const complete = data.complete === true && data.total != null;
    let reply: string;
    if (!rows.length && unresolvedCount > 0) reply = `I found no verified ${capability.title.toLowerCase()}${scope}; ${unresolvedCount} matching source record${unresolvedCount === 1 ? " lacks" : "s lack"} season information, so I can’t confirm that there are no matches.`;
    else if (!rows.length) reply = `No matching ${capability.title.toLowerCase()}${scope} were found.`;
    else {
      const base = responseForRows(intent, rows, data.hasMore === true).reply;
      reply = `${base} Scope: season ${season}.`;
    }
    if (intent.operation === "count") {
      reply = complete ? `Verified ${new Intl.NumberFormat("en-US").format(Number(data.total))} ${capability.title.toLowerCase()}${scope}.`
        : `The ${capability.title.toLowerCase()} count${scope} is incomplete${unresolvedCount > 0 ? `; ${unresolvedCount} matching source record${unresolvedCount === 1 ? " lacks" : "s lack"} reliable season information` : ""}, so I can’t give a reliable total.`;
    }
    if (unresolvedCount > 0 && rows.length) reply += ` ${unresolvedCount} matching record${unresolvedCount === 1 ? " was" : "s were"} excluded because the season or year is unresolved.`;
    if (data.yearCoverage === "season-only") reply += " This source stores season only; sales-year coverage is unavailable.";
    const actions = rows.length ? [{ type: "records", title: capability.title, rows, columns: Object.keys(rows[0]), hasMore: data.hasMore === true }] : [];
    return { reply, actions, context: { pendingChoices: [], nextCursor: data.nextCursor || null },
      sourceQuery: { filters: { ...filters, season }, cursor }, total: complete ? Number(data.total) : null, complete,
      ...seasonalReadInfo(data), unresolvedCount, season, yearCoverage: String(data.yearCoverage || "season-only") };
  }
  if (reader === "production_schedule") return await readProductionSchedule(admin, intent, context, signal);
  return { reply: "This app area is not available to AURA yet.", actions: [], context: { pendingChoices: [], nextCursor: null } };
}

async function readProductionSchedule(admin: QueryClient, intent: AuraIntent, context: QueryContext, signal?: AbortSignal) {
  const metadata = record(await rpcValue(admin, "production_schedule_read_metadata_v1", undefined, signal));
  const sheets = Array.isArray(metadata.sheets) ? metadata.sheets.map(record) : [];
  const selectedId = String(context.selectionId || intent.filters.selectionId || "");
  let selected = sheets.find((sheet) => String(sheet.id ?? sheet.index ?? "") === selectedId);
  const queryText = String(intent.filters.productText || "").toLocaleLowerCase();
  if (!selected && queryText) {
    const matches = sheets.filter((sheet) => String(sheet.title || "").toLocaleLowerCase() === queryText);
    if (matches.length === 1) selected = matches[0];
  }
  if (!selected) {
    const choices = sheets.slice(0, 5).map((sheet) => ({ id: String(sheet.id ?? sheet.index ?? ""), label: String(sheet.title || `Sheet ${sheet.id}`), ...sheet }));
    if (!choices.length) return { reply: "There is no published production schedule to read right now.", actions: [], context: { pendingChoices: [], nextCursor: null } };
    return { reply: "Which production schedule sheet should I search? You can also name a sheet directly.", actions: [{ type: "choices", kind: "entity", items: choices, hasMore: sheets.length > choices.length }],
      context: { pendingChoices: choices, nextCursor: null } };
  }
  const filterFields = Array.isArray(selected.filterColumns) ? selected.filterColumns.map(record) : [];
  const filters: Record<string, string> = {};
  const requestedFilters: Array<[string, string, RegExp]> = [
    ["locationCode", String(intent.filters.locationCode || ""), /location|bay|block/i],
    ["lotcode", String(intent.filters.lotcode || ""), /lot/i],
    ["contSize", String(intent.filters.contSize || ""), /size|container/i],
    ["assigneeText", String(intent.filters.assigneeText || ""), /assigned|worker|employee|owner/i],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string, RegExp]>;
  for (const [name, value, headerPattern] of requestedFilters) {
    const matchingFields = filterFields.filter((field) => headerPattern.test(String(field.header || "")));
    if (matchingFields.length !== 1) return {
      reply: `I can search this sheet, but I can’t safely map the ${name} filter to one configured column. Please choose a filter in the Production Schedule screen.`,
      actions: [{ type: "navigation", view: "production" }], context: { pendingChoices: [], nextCursor: null },
    };
    filters[String(matchingFields[0].index)] = value;
  }
  const cursor = context.nextCursor == null ? 0 : Number(context.nextCursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const result = record(await rpcValue(admin, "production_schedule_read_rows_v1", {
    p_sheet_index: Number(selected.id ?? selected.index),
    ...(typeof record(metadata.snapshot).id === "string" ? { p_snapshot_id: String(record(metadata.snapshot).id) } : {}),
    p_cursor: cursor, p_limit: MAX_PAGE, p_search: queryText, p_filters: filters,
  }, signal));
  const headerValues = Array.isArray(selected.columns) ? selected.columns : [];
  const rows = Array.isArray(result.rows) ? result.rows.map((value) => {
    const row = record(value); const cells = Array.isArray(row.cells) ? row.cells : [];
    const mapped: Record<string, unknown> = { sourceRow: row.sourceRow };
    cells.forEach((cell, index) => { const label = String(headerValues[index] || `Column ${index + 1}`).slice(0, 80); mapped[label] = cell; });
    return mapped;
  }) : [];
  const response = responseForRows(intent, rows, result.hasMore === true);
  return { ...response, reply: rows.length ? `${response.reply} From “${String(selected.title || "schedule sheet") }”.` : `No matching rows are present in “${String(selected.title || "schedule sheet") }”.`,
    context: { ...response.context, pendingChoices: [], nextCursor: result.nextCursor || null },
    sourceQuery: { sheetIndex: Number(selected.id ?? selected.index), snapshotId: record(metadata.snapshot).id || null } };
}

function parseSelectedChoice(textValue: string, context: QueryContext) {
  const match = textValue.match(/^\s*(?:option\s*)?(\d{1,2})\s*$/i);
  if (!match) return { context, error: "" };
  const options = Array.isArray(context.pendingChoices) ? context.pendingChoices : [];
  const index = Number(match[1]) - 1;
  const selected = record(options[index]);
  if (index < 0 || !selected.id) return { context, error: "I don’t have a current choice with that number. Please ask again so I can refresh the options." };
  const isAssignee = String(selected.choiceKind || selected.kind || "") === "assignee";
  const nextContext: QueryContext = { ...context, selectedChoice: selected };
  if (isAssignee) {
    const username = String(selected.username || selected.assignee || selected.id || "").trim();
    if (username) nextContext.selectedAssignee = username;
    delete nextContext.selectionId;
  } else nextContext.selectionId = String(selected.id);
  return { context: nextContext, error: "" };
}
function responseForRows(intent: AuraIntent, rows: Record<string, unknown>[], hasMore: boolean): { reply: string; actions: QueryAction[]; context: QueryContext } {
  if (!rows.length) return {
    reply: "I couldn’t find matching records in the data available to your active account.", actions: [], context: { pendingChoices: [], nextCursor: null },
  };
  const items = rows.map((row) => ({ id: String(row.id || row.unique_id || row.itemcode || ""), label: labelFor(row), ...row }));
  const action: QueryAction = { type: "records", title: intent.title, rows, columns: Object.keys(rows[0]) };
  const reply = `I found ${rows.length}${hasMore ? " or more" : ""} ${intent.title.toLowerCase()} record${rows.length === 1 ? "" : "s"}.`;
  return { reply, actions: [action], context: { pendingChoices: items.slice(0, 20), nextCursor: null } };
}
function inventoryScope(filters: Record<string, unknown>, data: Record<string, unknown>) {
  const parts: string[] = [];
  const season = String(filters.season || data.season || data.currentSeason || "").trim();
  const year = Number(filters.salesYear ?? data.salesYear);
  if (season) parts.push(`for ${Number.isFinite(year) && year > 0 ? String(year).padStart(2, "0") : ""}${season}`);
  if (filters.locationCode) parts.push(`at ${String(filters.locationCode)}`);
  if (filters.contSize) parts.push(`in size ${String(filters.contSize)}`);
  if (filters.assignee || filters.assigneeText) parts.push(`assigned to ${String(filters.assignee || filters.assigneeText)}`);
  if (filters.zone) parts.push(filters.zone === "OUTSIDE" ? "outside the perennial area" : "in the perennial area");
  return parts.length ? ` ${parts.join(" ")}` : " in the current inventory";
}
function handoffAction(intent: AuraIntent): QueryAction | null {
  const textValue = intent.question.toLowerCase();
  if (intent.capability === "navigation" && intent.filters.navigationView) {
    return { type: "navigation", view: String(intent.filters.navigationView), filters: intent.filters };
  }
  const writes = /^(?:please\s+)?(?:can you\s+)?(?:create|make|prepare|draft|submit|save|approve|deny|edit|update|change|move|assign|reclass|complete|finish|send|message|delete|cancel|release|deploy|merge)\b/.test(textValue);
  if (!writes) return null;
  const capability = capabilityForIntent(intent)[0];
  const view = capability?.id === "sales_orders" || (intent.mode === "orders" && !intent.capability) ? "bloom"
    : capability?.reader === "operations" ? "managers"
    : capability?.reviewView || AURA_MODULE_CAPABILITIES[intent.module as keyof typeof AURA_MODULE_CAPABILITIES]?.reviewView
    || (intent.mode === "orders" ? "bloom"
      : intent.mode === "requests" ? "request"
      : intent.mode === "eval_work" ? "review"
      : intent.mode === "location_work" ? "tasks"
      : intent.mode === "dock" ? "docks"
      : intent.mode === "hr" ? "hours"
      : MODULE_VIEW[intent.module] || "drive");
  let filters: Record<string, unknown> = capability?.reader === "operations" ? { ...intent.filters, operations: true } : { ...intent.filters };
  if (intent.mode === "location_work") filters.workType = "location";
  if (intent.mode === "eval_work") filters.workType = "eval";
  const quotedMessage = intent.question.match(/\b(?:send|message)\b[^“"]*[“"]([^”"]+)[”"]/i)?.[1];
  return { type: "review", view, filters, ...(intent.filters.recordId ? { recordId: intent.filters.recordId } : {}),
    proposal: { summary: intent.question, text: intent.question, message: quotedMessage || intent.question } };
}

async function handleMemoryMode(mode: string, body: Record<string, unknown>, admin: QueryClient, user: QueryClient, actorId: string, signal?: AbortSignal) {
  if (!["list", "create", "read", "delete", "cancel"].includes(mode)) throw new Error("AURA_QUERY_MODE_INVALID");
  const conversationId = body.conversationId == null ? null : text(body.conversationId, 80);
  if (conversationId && !UUID.test(conversationId)) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const turnId = body.turnId == null ? null : text(body.turnId, 80);
  if (turnId && !UUID.test(turnId)) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const payload: Record<string, unknown> = {};
  if (mode === "list" || mode === "read") {
    const limit = Number(body.limit ?? MAX_PAGE);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("AURA_QUERY_REQUEST_INVALID");
    payload.limit = limit;
    payload.cursor = boundedCursor(body.cursor);
  }
  const result = await rpc(admin, "aura_query_conversation_v1", {
    p_actor_id: actorId, p_operation: mode,
    ...(conversationId ? { p_conversation_id: conversationId } : {}), ...(turnId ? { p_turn_id: turnId } : {}),
    ...(body.expectedRevision == null ? {} : { p_expected_revision: Number(body.expectedRevision) }), p_payload: jsonRecord(payload),
  }, signal);
  // Stored answers can contain rows that were readable when they were created.
  // Re-check each source before returning transcript content.
  if (mode === "read" && Array.isArray(result.turns)) {
    const turns = result.turns.map(record);
    for (let offset = 0; offset < turns.length; offset += 6) {
      const checks = await Promise.all(turns.slice(offset, offset + 6).map((turn) => sourcesAllowed(admin, user, actorId, turn.sources, signal)));
      if (checks.some((allowed) => !allowed)) throw Object.assign(new Error("AURA_FORBIDDEN"), { status: 403 });
    }
  }
  return { ok: true, ...responseFields(result) };
}

async function executeIntent(intent: AuraIntent, admin: QueryClient, user: QueryClient, actorId: string, context: QueryContext, signal?: AbortSignal) {
  const selectedCapability = capabilityForIntent(intent)[0];
  if (selectedCapability?.reader && selectedCapability.reader !== "inventory") {
    assertDomainFilters(selectedCapability, intent.filters);
    if (!await moduleAllowed(admin, actorId, selectedCapability.module)) return {
      reply: `I can’t read ${selectedCapability.title.toLowerCase()} through your active app permissions.`, actions: [], context: { pendingChoices: [], nextCursor: null },
    };
    const result = await runSpecialReader(admin, user, actorId, intent, selectedCapability, context, signal);
    const rows = result.actions.flatMap((action) => Array.isArray(record(action).rows) ? (record(action).rows as unknown[]).map(record) : []);
    const idField = selectedCapability.key || (selectedCapability.reader === "low_stock" ? "itemcode_normalized"
      : selectedCapability.reader === "operations" ? "id" : selectedCapability.reader === "production_schedule" ? "sourceRow"
      : selectedCapability.reader === "navigation" ? "view" : selectedCapability.reader === "settings" ? "setting"
      : selectedCapability.reader === "hl_orders" ? String(record(result.sourceQuery).operation || "orders") === "receipts" ? "receiptId" : String(record(result.sourceQuery).operation || "orders") === "balances" ? "poId" : "orderId"
      : selectedCapability.reader === "bunch_notes" ? "recordId" : "id");
    const recordIds = rows.map((row) => String(row[idField] || row.recordId || row.receiptId || row.poId || row.id || "")).filter(Boolean).slice(0, 200);
    const sources = [{ capabilityId: selectedCapability.id, module: selectedCapability.module, recordIds, query: record(result.sourceQuery) }];
    if (selectedCapability.reader === "seasonal_records") {
      return { ...result, sources, actions: result.actions, total: result.total, complete: result.complete,
        unresolvedCount: result.unresolvedCount, season: result.season, yearCoverage: result.yearCoverage, salesYear: result.salesYear, settingRevision: result.settingRevision,
        context: { ...result.context, lastIntent: context.lastIntent } };
    }
    return { ...result, sources };
  }
  if (["inventory", "ownership", "unassigned", "lot"].includes(intent.mode) || selectedCapability?.reader === "inventory") {
    if (!await moduleAllowed(admin, actorId, intent.module)) return {
      reply: "I can’t read inventory through your active app permissions.", actions: [], context: { pendingChoices: [], nextCursor: null },
    };
    const operation = ["inventory", "domain"].includes(intent.mode)
      ? (intent.operation === "locations" || intent.operation === "maximum" ? intent.operation : "stock") : intent.mode;
    const filters = inventoryFilters({ ...intent.filters });
    const pageCursor = intent.question.toLowerCase().includes("show more") ? boundedCursor(context.nextCursor) : null;
    const data = await rpc(admin, "aura_query_inventory_v1", {
      p_actor_id: actorId, p_operation: operation, p_filters: jsonRecord(filters), p_cursor: pageCursor, p_limit: MAX_PAGE,
    }, signal);
    if (data.ok === false) throw Object.assign(new Error(String(data.code || "AURA_QUERY_INVENTORY_UNAVAILABLE")), { status: 503 });
    const rows = Array.isArray(data.rows) ? data.rows.map(record) : [];
    const candidates = Array.isArray(data.candidateChoices) ? data.candidateChoices.map(record) : [];
    if (data.exactMatch === false && candidates.length > 0) {
      const choices = candidates.slice(0, 5).map((row) => ({ id: String(row.selectionId || row.uniqueId || row.itemcode || ""), label: labelFor(row), ...row }));
      const actions = [{ type: "choices", kind: "entity", items: choices, complete: data.complete === true, hasMore: data.hasMore === true }];
      return { ...seasonalReadInfo(data), reply: `I found ${choices.length} possible matches. Choose the exact plant, size, or location.`, actions,
        context: { ...context, pendingChoices: choices, nextCursor: data.nextCursor || null },
        sources: [{ capabilityId: "inventory", module: "drive", recordIds: choices.map((choice) => String(choice.id)), query: { operation, filters, cursor: pageCursor } }] };
    }
    if (operation === "stock") {
      const amount = data.total == null ? NaN : Number(data.total);
      const subject = String(intent.filters.commonName || intent.filters.productText || intent.filters.itemcode || intent.filters.genus || "plants");
      const metric = intent.filters.metric === "ptronhand" ? "on hand" : "available";
      const countMode = String(intent.filters.countMode || "quantity");
      const quantityLabel = countMode === "physical_rows" ? "physical inventory rows" : countMode === "unique_items" ? "unique items" : `${subject} ${metric}`;
      const scope = inventoryScope(intent.filters, data);
      const unresolved = Number(data.unresolvedCount || 0);
      let reply = unresolved > 0 && rows.length === 0
        ? `No verified inventory matches${scope}; ${unresolved} matching records have an unresolved season or sales year and were excluded.`
        : data.complete === true && Number.isFinite(amount) && amount === 0 && rows.length === 0
        ? `No matching inventory was found${scope}.`
        : data.complete === true && Number.isFinite(amount)
        ? `Verified ${new Intl.NumberFormat("en-US").format(amount)} ${quantityLabel}${scope}.`
        : `The ${quantityLabel} count is incomplete, so I can’t give a reliable total. Please refine the filters or try again later.`;
      if (unresolved > 0 && rows.length) reply += ` ${unresolved} matching records have an unresolved season or sales year and were excluded.`;
      const actions = rows.length ? [{ type: "records", title: intent.title, rows, columns: Object.keys(rows[0]) }] : [];
      return { ...seasonalReadInfo(data), reply, actions, context: { pendingChoices: [], nextCursor: data.nextCursor || null },
        sources: [{ capabilityId: "inventory", module: "drive", recordIds: rows.map((row) => String(row.selectionId || row.uniqueId || "")).filter(Boolean), query: { operation, filters, cursor: pageCursor } }] };
    }
    if (data.complete !== true && rows.length === 0) return { ...seasonalReadInfo(data), reply: Number(data.unresolvedCount) > 0
      ? `No verified inventory matches${inventoryScope(intent.filters, data)}; ${Number(data.unresolvedCount)} matching records have an unresolved season or sales year and were excluded.`
      : `I couldn’t complete the ${intent.title.toLowerCase()} lookup, so I can’t confirm whether matching inventory exists.`,
      actions: [], context: { pendingChoices: [], nextCursor: data.nextCursor || null },
      sources: [{ capabilityId: "inventory", module: "drive", recordIds: [], query: { operation, filters, cursor: pageCursor } }] };
    if (rows.length === 0) return { ...seasonalReadInfo(data), reply: Number(data.unresolvedCount) > 0
      ? `No verified inventory matches${inventoryScope(intent.filters, data)}; ${Number(data.unresolvedCount)} matching records have an unresolved season or sales year and were excluded.`
      : `No matching inventory was found${inventoryScope(intent.filters, data)}.`, actions: [],
      context: { pendingChoices: [], nextCursor: data.nextCursor || null },
      sources: [{ capabilityId: "inventory", module: "drive", recordIds: [], query: { operation, filters, cursor: pageCursor } }] };
    const response = responseForRows(intent, rows, data.hasMore === true);
    response.reply += ` Scope:${inventoryScope(intent.filters, data)}.`;
    if (Number(data.unresolvedCount) > 0) response.reply += ` ${Number(data.unresolvedCount)} matching records have an unresolved season or sales year and were excluded.`;
    return { ...seasonalReadInfo(data), ...response, context: { ...response.context, nextCursor: data.nextCursor || null },
      sources: [{ capabilityId: "inventory", module: "drive", recordIds: rows.map((row) => String(row.selectionId || row.uniqueId || "")).filter(Boolean), query: { operation, filters, cursor: pageCursor } }] };
  }
  const result = await runDomainRead(admin, user, actorId, intent, context, signal);
  if (result.unavailable) return { reply: `I can’t read ${intent.title.toLowerCase()} through your active app permissions.`, actions: [], context: { pendingChoices: [], nextCursor: null } };
  if (intent.operation === "count") {
    const total = result.total == null ? NaN : Number(result.total);
    const reply = Number.isFinite(total)
      ? `Verified ${new Intl.NumberFormat("en-US").format(total)} ${intent.title.toLowerCase()} record${total === 1 ? "" : "s"}.`
      : `The ${intent.title.toLowerCase()} count is incomplete, so I can’t give a reliable total. Please refine the filters or try again later.`;
    const actions = result.rows.length ? [{ type: "records", title: intent.title, rows: result.rows, columns: Object.keys(result.rows[0]) }] : [];
    return { reply, actions, context: { pendingChoices: [], nextCursor: result.nextCursor || null }, sources: result.sources };
  }
  return { ...responseForRows(intent, result.rows, result.hasMore), context: { ...responseForRows(intent, result.rows, result.hasMore).context, nextCursor: result.nextCursor || null }, sources: result.sources };
}

async function handleCommand(body: Record<string, unknown>, admin: QueryClient, user: QueryClient, actorId: string, signal?: AbortSignal) {
  const question = text(body.text, MAX_TEXT_CHARS);
  const turnId = text(body.turnId, 80);
  if (!UUID.test(turnId)) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const source = String(body.source || "typed");
  if (source !== "typed" && source !== "voice") throw new Error("AURA_QUERY_REQUEST_INVALID");
  const conversationId = body.conversationId == null ? null : text(body.conversationId, 80);
  if (conversationId && !UUID.test(conversationId)) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const expectedRevision = body.expectedRevision == null ? null : Number(body.expectedRevision);
  if (expectedRevision != null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const begin = await rpc(admin, "aura_query_conversation_v1", {
      p_actor_id: actorId, p_operation: "begin", ...(conversationId ? { p_conversation_id: conversationId } : {}), p_turn_id: turnId,
      ...(expectedRevision == null ? {} : { p_expected_revision: expectedRevision }), p_payload: jsonValue({ text: question, source }),
  }, signal);
  const resolvedConversationId = String(begin.conversationId || begin.conversation_id || "");
  const revision = Number(begin.revision || 0);
  if (!UUID.test(resolvedConversationId)) throw new Error("AURA_QUERY_CONVERSATION_UNAVAILABLE");
  const replayResponse = record(begin.response);
  if (begin.replayed === true && Object.keys(replayResponse).length) {
    if (!await sourcesAllowed(admin, user, actorId, begin.sources, signal)) throw Object.assign(new Error("AURA_FORBIDDEN"), { status: 403 });
    return { ...replayResponse, ok: true, requestId: turnId, conversationId: resolvedConversationId, revision };
  }
  try {
  let context = record(begin.context);
  const more = /\bshow more\b/i.test(question);
  const isSelection = /^\s*(?:option\s*)?\d{1,2}\s*$/i.test(question);
  const continuation = record(context.lastIntent);
  let intent = (isSelection || more) && typeof continuation.mode === "string"
    ? { ...continuation, question, filters: { ...record(continuation.filters) } } as AuraIntent
    : resolveAuraIntent(question, context);
  let seasonScope: SeasonScope | null = null;
  let scopeRestarted = false;
  if (!intent.clarification && !handoffAction(intent) && isSeasonalIntent(intent)
    && await moduleAllowed(admin, actorId, capabilityForIntent(intent)[0]?.module || intent.module)) {
    // Keep the relative reference in memory; SQL resolves it again in its read snapshot.
    if (!intent.filters.season && !intent.filters.seasonReference) intent.filters.seasonReference = "current";
    seasonScope = await resolveSeasonScope(admin, actorId, intent, signal);
    const previous = record(context.seasonScope);
    scopeRestarted = typeof continuation.mode === "string" && (more || isSelection) && (previous.settingRevision !== seasonScope.settingRevision
      || previous.seasonCode !== seasonScope.seasonCode || previous.salesYear !== seasonScope.salesYear);
    if (scopeRestarted) {
      context = resetContinuation(context);
      delete intent.filters.selectionId;
    }
  }
  const choice = scopeRestarted ? { context, error: "" } : parseSelectedChoice(question, context);
  if (choice.error) {
    const result = { ok: true, requestId: turnId, conversationId: resolvedConversationId, revision,
      reply: choice.error, speech: choice.error, actions: [], context, interpretation: { intent: "selection", entities: {} }, source: sourceInfo(source),
      hasMore: false, nextCursor: context.nextCursor || null };
    const completed = await rpc(admin, "aura_query_conversation_v1", {
      p_actor_id: actorId, p_operation: "complete", p_conversation_id: resolvedConversationId, p_turn_id: turnId,
      p_expected_revision: revision, p_payload: jsonValue({ response: result, context, sources: [] }),
    }, signal);
    return { ...result, revision: Number(completed.revision || revision) };
  }
  context = choice.context;
  if (more && !context.nextCursor && !scopeRestarted) {
    const reply = "There are no more results in the current page.";
    const result = { ok: true, requestId: turnId, conversationId: resolvedConversationId, revision, reply, speech: reply,
      actions: [], context, interpretation: { intent: "pagination", entities: {} }, source: sourceInfo(source), hasMore: false, nextCursor: null };
    const completed = await rpc(admin, "aura_query_conversation_v1", {
      p_actor_id: actorId, p_operation: "complete", p_conversation_id: resolvedConversationId, p_turn_id: turnId,
      p_expected_revision: revision, p_payload: jsonValue({ response: result, context, sources: [] }),
    }, signal);
    return { ...result, revision: Number(completed.revision || revision) };
  }
  if (!more || scopeRestarted) context = { ...context, nextCursor: null };
  if (isSelection && !scopeRestarted && context.selectionId) intent.filters.selectionId = context.selectionId;
  if (isSelection && !scopeRestarted && context.selectedAssignee) intent.filters.assignee = context.selectedAssignee;
  const clarification = String(record(intent).clarification || "");
  let handoff = clarification ? null : handoffAction(intent);
  let outcome: { reply: string; actions: QueryAction[]; context: QueryContext; sources?: unknown[] } & SeasonalReadInfo;
  if (clarification) outcome = { reply: clarification, actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [] };
  else if (handoff?.type === "navigation") {
    if (!await moduleAllowed(admin, actorId, intent.module)) { outcome = {
      reply: `I can’t open ${String(handoff.view)} through your active app permissions.`, actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [],
    }; handoff = null; }
    else outcome = { reply: `Opening ${String(handoff.view)}.`, actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [] };
  } else if (handoff) {
    if (!await moduleAllowed(admin, actorId, String(handoff.view))) { outcome = {
      reply: `I can’t open ${String(handoff.view)} through your active app permissions.`, actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [],
    }; handoff = null; }
    else outcome = { reply: `I prepared a draft for review in ${String(handoff.view)}.`, actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [] };
  } else {
    try {
      outcome = await executeIntent(intent, admin, user, actorId, context, signal);
      if (seasonScope && outcome.settingRevision != null && outcome.settingRevision !== seasonScope.settingRevision) {
        // A Manager save raced the initial read. Never return an old page or choice under a new scope.
        context = resetContinuation(context);
        delete intent.filters.selectionId;
        scopeRestarted = more || isSelection;
        seasonScope = await resolveSeasonScope(admin, actorId, intent, signal);
        outcome = await executeIntent(intent, admin, user, actorId, context, signal);
        if (outcome.settingRevision !== seasonScope.settingRevision) throw new Error("AURA_SEASON_SCOPE_CHANGED");
      }
    }
    catch (error) {
      if (safeErrorCode(error) !== "AURA_QUERY_FILTER_NEEDS_CLARIFICATION") throw error;
      outcome = { reply: "I can’t safely apply every part of that filter to this app area. Please open its screen or rephrase with a supported item, location, assignee, status, or date filter.",
        actions: [], context: { pendingChoices: [], nextCursor: null }, sources: [] };
    }
  }
  if (scopeRestarted) outcome.reply = "The Managers season setting changed. I restarted this query with the current scope. " + outcome.reply;
  const seasonMetadata = seasonScope ? {
    resolvedSeason: { seasonCode: outcome.season || seasonScope.seasonCode, salesYear: outcome.salesYear || seasonScope.salesYear },
    settingRevision: outcome.settingRevision ?? seasonScope.settingRevision,
    yearCoverage: outcome.yearCoverage || "inventory-cutoff", unresolvedCount: outcome.unresolvedCount || 0,
  } : {};
  const actions = [...outcome.actions, ...(handoff ? [handoff] : [])];
  const result = {
    ok: true, requestId: turnId, conversationId: resolvedConversationId, revision,
    reply: handoff?.type === "review" ? `${outcome.reply} Review and save any changes in the existing ${String(handoff.view)} screen.` : outcome.reply,
    speech: handoff?.type === "review" ? `${outcome.reply} Review and save any changes in the existing ${String(handoff.view)} screen.` : outcome.reply,
    actions, context: { ...outcome.context, ...(seasonScope ? { seasonScope } : {}), lastIntent: { mode: intent.mode, operation: intent.operation, question: intent.question,
      filters: intent.filters, capability: intent.capability, module: intent.module, title: intent.title, replyPrefix: intent.replyPrefix } },
    interpretation: { intent: intent.mode, operation: intent.operation, entities: intent.filters, ...seasonMetadata },
    source: { ...sourceInfo(source), ...seasonMetadata },
    checkedAt: { at: new Date().toISOString(), capabilities: Array.isArray(outcome.sources) ? outcome.sources.map((item) => String(record(item).capabilityId || record(item).mode || "")) : [] },
    hasMore: Boolean(outcome.context.nextCursor) || actions.some((action) => record(action).hasMore === true), nextCursor: outcome.context.nextCursor || null,
  };
  const completed = await rpc(admin, "aura_query_conversation_v1", {
    p_actor_id: actorId, p_operation: "complete", p_conversation_id: resolvedConversationId, p_turn_id: turnId,
     p_expected_revision: revision, p_payload: jsonValue({ response: result, context: result.context, sources: Array.isArray(outcome.sources) ? outcome.sources : [] }),
  }, signal);
  return { ...result, revision: Number(completed.revision || revision) };
  } catch (error) {
    // Mark a downstream read as retryable while releasing the per-conversation lease.
    // Deliberately omit the already-aborted request signal for this cleanup call.
    try {
      await rpc(admin, "aura_query_conversation_v1", {
        p_actor_id: actorId, p_operation: "fail", p_conversation_id: resolvedConversationId, p_turn_id: turnId,
        p_expected_revision: revision, p_payload: {},
      }, AbortSignal.timeout(3_000));
    } catch { /* the lease may already have expired or completed */ }
    throw error;
  }
}

export async function handleAuraQueryRequest(request: Request, deps: AuraQueryDeps = {}) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return fail("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
  const bearer = bearerFrom(request);
  if (!bearer) return fail("Sign in with Dylan’s active account.", 403, "AURA_FORBIDDEN");
  let clientsForRequest: { admin: QueryClient; user: QueryClient };
  try { clientsForRequest = clients(deps, bearer); }
  catch { return fail("AURA is temporarily unavailable.", 503, "AURA_QUERY_CONFIGURATION_UNAVAILABLE"); }
  const { admin, user } = clientsForRequest;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("AURA request timed out.", "TimeoutError")), 15_000);
  const signal = AbortSignal.any([controller.signal, request.signal]);
  let actor: AuthResult | null;
  try { actor = await Promise.race([authorize(request, admin), aborted(signal)]); }
  catch { actor = null; }
  if (!actor) {
    clearTimeout(timer);
    if (signal.aborted) return fail("AURA’s request took too long. Try again.", 504, "AURA_QUERY_TIMEOUT");
    return fail("AURA is available only to Dylan’s verified active account.", 403, "AURA_FORBIDDEN");
  }
  try {
    let body = await Promise.race([readBody(request), aborted(signal)]);
    const mode = String(body.mode || "command").toLowerCase();
    if (mode === "bind_party") return fail("Party binding now happens in the Bloom review screen. Refresh the app and continue there.", 409, "AURA_REFRESH_REQUIRED");
    if (mode === "list" || mode === "create" || mode === "read" || mode === "delete" || mode === "cancel") {
      return json(await handleMemoryMode(mode, body, admin, user, actor.actorId, signal));
    }
    if (mode !== "command") return fail("AURA request mode is invalid.", 400, "AURA_QUERY_MODE_INVALID");
    if (!body.turnId) {
      const sourceValue = String(body.source || "typed").toLowerCase();
      body = { ...body, text: body.text ?? body.question ?? body.prompt, turnId: await legacyTurnId(request),
        source: sourceValue === "voice" || sourceValue === "speech" ? "voice" : "typed", context: {} };
    }
    const turnId = String(body.turnId || "");
    const result = await handleCommand(body, admin, user, actor.actorId, signal);
    return json({ ...result, context: {} }, 200, UUID.test(turnId) ? { "X-Request-Id": turnId } : {});
  } catch (error) {
    const failure = record(error);
    if (signal.aborted) return fail("AURA’s request took too long. Try again.", 504, "AURA_QUERY_TIMEOUT");
    const sqlState = String(failure.code || "");
    const databaseMessage = String(failure.message || "");
    const code = sqlState === "40001" ? "AURA_QUERY_REVISION_CONFLICT"
      : sqlState === "42501" ? "AURA_FORBIDDEN"
      : /^AURA_[A-Z0-9_]+$/.test(databaseMessage) ? databaseMessage : safeErrorCode(error);
    if (code === "AURA_SEASON_SETTINGS_UNAVAILABLE" || code === "AURA_MANAGER_SETTINGS_REVISION_INVALID") return fail("The Managers current season setting is missing or invalid. Ask an authorized manager to save a valid season and sales year.", 503, "AURA_SEASON_SETTINGS_UNAVAILABLE");
    if (code === "AURA_SEASON_YEAR_UNAVAILABLE") return fail("This source stores season only and cannot honor an explicit sales-year filter. Ask for a season without a year.", 400, code);
    if (code === "AURA_BUNCH_CREATION_DATE_UNAVAILABLE") return fail("Bunch Notes do not have a reliable creation timestamp, so AURA cannot filter them by creation date. Ask without a date range.", 400, code);
    if (code === "AURA_SEASON_SCOPE_CHANGED") return fail("The Managers season setting changed during the query. Please ask again to restart with the current scope.", 409, code);
    const status = Number(failure.status) || (code === "AURA_FORBIDDEN" ? 403
      : /INVALID|REQUIRED|MODE/.test(code) ? 400 : /CONFLICT|REVISION|LEASE/.test(code) ? 409 : 503);
    const message = status === 400 ? "AURA could not validate that request."
      : status === 403 ? "AURA could not show this response because your active app permissions no longer allow access."
      : status === 409 ? "This AURA conversation changed. Refresh it and try again."
      : "AURA is temporarily unavailable.";
    return fail(message, status, code);
  } finally { clearTimeout(timer); }
}
