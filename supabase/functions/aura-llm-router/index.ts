import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { isAppAccountActive, normalizeUsername, readSupabaseOrAppSessionFromRequest } from "../_shared/app-auth.ts";
import { auraInventoryV2ProfileMatches } from "../_shared/aura-auth.ts";
import { auraInventoryLotLookupRpc, auraInventoryV2Rpc } from "../_shared/aura-inventory.ts";
import { withObservedRequest } from "../_shared/observability.ts";

const MODEL = "gemini-3.8-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TOTAL_DEADLINE_MS = 15_000;
const PROVIDER_DEADLINE_MS = 4_000;
const MAX_TOOL_CALLS = 5;
const MAX_INPUT_CHARS = 2_000;
const MAX_CONTEXT_CHARS = 8_000;
const MAX_BODY_BYTES = 64_000;
const MAX_OUTPUT_TOKENS = 512;
const MAX_TOOL_ROWS = 100;
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "private, no-store",
};

const INVENTORY_TOOL_DECLARATIONS = [
  {
    name: "check_open_stock",
    description: "Check current open stock for an exact SKU or spoken plant name and optional container size. For a plant name, first require one complete exact match, then return the authoritative aggregate. Preserve ambiguity and unknown quantities.",
    parameters: { type: "OBJECT", properties: {
      sku: { type: "STRING", description: "Exact SKU or spoken plant common name, at most 160 characters." },
      contSize: { type: "STRING", description: "Optional exact container size." },
      locationCode: { type: "STRING", description: "Optional exact location." },
      metric: { type: "STRING", enum: ["ptravailable", "ptronhand"] },
    }, required: ["sku"] },
  },
  {
    name: "lookup_lot_code",
    description: "Look up current eligible inventory rows by exact lot code. This is not a quantity total; preserve incomplete results and ask for a choice when several rows match.",
    parameters: { type: "OBJECT", properties: { code: { type: "STRING" } }, required: ["code"] },
  },
  {
    name: "draft_order",
    description: "Prepare a review-only Bloom Picker draft for the already selected client. Item quantities are new additions only; server context contains the current draft and will merge additions cumulatively. Combine repeated SKU and size requests, resolve product names to one exact match, select one eligible lot in numeric priority order that can cover the full cumulative quantity, then validate the exact row. Never split one SKU and size across lots. Never submit or save an order.",
    parameters: { type: "OBJECT", properties: {
      client: { type: "STRING", enum: ["selected_client"] },
      items: { type: "ARRAY", minItems: 1, maxItems: 20, items: { type: "OBJECT", properties: {
        product: { type: "STRING", description: "Product SKU or spoken plant name." },
        contSize: { type: "STRING" }, locationCode: { type: "STRING" },
        quantity: { type: "INTEGER", minimum: 1, maximum: 999999 },
      }, required: ["product", "quantity"] } },
    }, required: ["client", "items"] },
  },
];

type Client = {
  auth: { getUser: (token: string) => Promise<any> };
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => any;
};
type Profile = Record<string, unknown>;
type PartySidecar = {
  customerIdentityId?: string;
  consigneeIdentityId?: string;
  customerName: string;
  consigneeName: string;
};
type RouterDeps = { client?: Client; fetcher?: typeof fetch; env?: (name: string) => string | undefined };
type RouterDiagnostics = {
  requestId: string; operation: string; status: number; providerRequests: number;
  reservedTokens: number; promptTokens: number; outputTokens: number;
  sqlstate: string | null; timeoutStage: string | null;
};
type ParsedRequest =
  | { mode: "bind_party"; party: PartySidecar }
  | { mode: "command"; text: string; source: string; turnId: string; context: Record<string, unknown>; partyRef: string; partySidecar: PartySidecar | null };

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, ...extraHeaders, "Content-Type": "application/json" } });
}

function fail(message: string, status: number, code: string, headers: Record<string, string> = {}) {
  return json({ ok: false, error: message, code }, status, headers);
}

function normalizeName(value: unknown) {
  return String(value || "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

function boundedText(value: unknown, max: number) {
  const text = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text || text.length > max) throw new Error("AURA_LLM_REQUEST_INVALID");
  return text;
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

export function assertInventoryOnlyText(text: string, hasParty: boolean) {
  const noProviderTerms = /\b(?:email|e-mail|text|message|chat|call|notify|scout|scouting|pest|disease|severity|damage|photo|address|phone|telephone)\b/i;
  const contactData = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/i;
  const customerTerms = /\b(?:customer|consignee|client|ship\s+to|bill\s+to)\b/i;
  const orderIntent = /\b(?:order|draft|prepare|place)\b/i;
  const privateAccountIntent = /\b(?:account|balance|invoice|invoices|billing|payment|payments|paid|owe|owes|owed|owing|credit|credit\s+limit|payment\s+terms|account\s+terms|statement|receivable|order\s+status|status\s+of\s+(?:the\s+)?order|where\s+is\s+(?:the\s+)?order|has\s+(?:it|the\s+order)\s+shipped|shipment\s+status|order\s+tracking|shipment\s+tracking|order\s+history|purchase\s+history)\b/i;
  const shipmentStatusIntent = /\b(?:track|tracking|shipped|shipment|delivered|delivery|arrived|order\s+status)\b/i.test(text)
    && /\b(?:order|shipment|tracking|delivery)\b/i.test(text);
  if (noProviderTerms.test(text) || contactData.test(text) || privateAccountIntent.test(text) || shipmentStatusIntent || (customerTerms.test(text) && !hasParty)
    || (orderIntent.test(text) && !hasParty && /\b(?:for|to)\b/i.test(text))) {
    throw Object.assign(new Error("AURA_LLM_PRIVACY_BLOCKED"), { status: 400 });
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assertKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("AURA_LLM_REQUEST_INVALID");
}

function getClient(deps: RouterDeps, signal: AbortSignal): Client {
  if (deps.client) return deps.client;
  const url = String((deps.env || Deno.env.get.bind(Deno.env))("SUPABASE_URL") || "").trim();
  const key = String((deps.env || Deno.env.get.bind(Deno.env))("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) throw new Error("AURA_LLM_CONFIGURATION_UNAVAILABLE");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init = {}) => fetch(input, { ...init,
      signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal }) },
  }) as unknown as Client;
}

function readNativeBearer(request: Request) {
  const value = String(request.headers.get("authorization") || "").trim();
  return /^Bearer\s+\S+$/i.test(value) ? value.replace(/^Bearer\s+/i, "").trim() : "";
}

function withinDeadline<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason || new DOMException("AURA deadline exceeded.", "TimeoutError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new DOMException("AURA deadline exceeded.", "TimeoutError"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function readBoundedJson(request: Request, signal: AbortSignal) {
  const maxBytes = MAX_BODY_BYTES;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("AURA_LLM_REQUEST_INVALID");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await withinDeadline(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("AURA_LLM_REQUEST_INVALID");
      }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch { /* A pending read is already governed by the request deadline. */ } }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function authorize(request: Request, client: Client, signal: AbortSignal, diagnostics: RouterDiagnostics) {
  const bearer = readNativeBearer(request);
  if (!bearer) return { error: fail("Sign in with Dylan’s active native account to use AURA.", 401, "AURA_AUTH_REQUIRED") };
  const { data: authData, error: authError } = await withinDeadline(client.auth.getUser(bearer), signal);
  const nativeUserId = String(authData?.user?.id || "");
  if (authError || !nativeUserId) return { error: fail("Sign in with Dylan’s active native account to use AURA.", 401, "AURA_AUTH_REQUIRED") };
  const session = await withinDeadline(readSupabaseOrAppSessionFromRequest(request, client as Client & { auth: { getUser: (token: string) => Promise<any> } }), signal);
  if (!session || !session.authUserId || String(session.authUserId) !== nativeUserId) {
    return { error: fail("Sign in with Dylan’s active native account to use AURA.", 401, "AURA_AUTH_REQUIRED") };
  }
  if (session.mustChangePassword || normalizeUsername(session.username) !== "dylan_collyge") {
    return { error: fail("AURA is available only to Dylan’s active account.", 403, "AURA_FORBIDDEN") };
  }
  const profileQuery = client.from("profiles")
    .select("id,username,display_name,role,disabled_at,locked_until,must_change_password")
    .eq("id", nativeUserId).abortSignal(signal).maybeSingle();
  const { data: profile, error } = await withinDeadline(profileQuery, signal) as any;
  if (error) captureSqlState(diagnostics, error);
  const lockedUntil = Date.parse(String(profile?.locked_until || ""));
  if (error || String(profile?.username || "").trim().toLowerCase() !== "dylan_collyge"
    || !auraInventoryV2ProfileMatches(session, profile)
    || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())
    || !await withinDeadline(isAppAccountActive(client, { id: nativeUserId }), signal)) {
    return { error: fail("Dylan’s active account profile could not be verified.", 403, "AURA_PROFILE_INACTIVE") };
  }
  return { session, profile: profile as Profile };
}

function getConfig(env: (name: string) => string | undefined) {
  const enabled = String(env("AURA_LLM_ENABLED") || "").trim().toLowerCase() === "true";
  const key = String(env("GEMINI_API_KEY") || "").trim();
  const rpm = Number(env("AURA_LLM_RPM"));
  const tpm = Number(env("AURA_LLM_TPM"));
  const rpd = Number(env("AURA_LLM_RPD"));
  if (!enabled || !key || !Number.isInteger(rpm) || rpm < 1 || rpm > 15 || !Number.isInteger(tpm) || tpm < 1
    || tpm > 1_000_000 || !Number.isInteger(rpd) || rpd < 1 || rpd > 100_000) return null;
  return { key, rpm: Math.min(15, rpm), tpm, rpd };
}

function estimateReservationTokens(value: unknown) {
  const serialized = JSON.stringify(value);
  // One token per UTF-8 byte is deliberately conservative, including punctuation
  // and multi-byte text. Reserve the complete output cap in the same TPM budget.
  return Math.max(1, new TextEncoder().encode(serialized).byteLength + MAX_OUTPUT_TOKENS);
}

async function reserveProviderCall(client: Client, requestId: string, round: number, inputTokens: number, config: { rpm: number; tpm: number; rpd: number }, signal: AbortSignal, diagnostics: RouterDiagnostics) {
  diagnostics.timeoutStage = "quota_reservation";
  const { data, error } = await withinDeadline(client.rpc("aura_llm_reserve_call_v1", {
    p_request_id: requestId,
    p_round: round,
    p_input_tokens: inputTokens,
    p_rpm: config.rpm,
    p_tpm: config.tpm,
    p_rpd: config.rpd,
  }).abortSignal(signal), signal) as any;
  if (error) throw safeDatabaseError("AURA_LLM_QUOTA_UNAVAILABLE", error);
  if (!data || typeof data !== "object") throw new Error("AURA_LLM_QUOTA_UNAVAILABLE");
  const result = data as Record<string, unknown>;
  if (result.allowed !== true) {
    const retryAfter = Math.max(0, Number(result.retryAfter || 0));
    if (result.duplicate === true) throw Object.assign(new Error("AURA_LLM_DUPLICATE_TURN"), { status: 409 });
    throw Object.assign(new Error("AURA_LLM_RATE_LIMITED"), { status: 429, retryAfter });
  }
  diagnostics.reservedTokens += inputTokens;
}

async function geminiCall(input: {
  requestId: string; round: number; content: unknown[]; tools?: boolean;
  client: Client; config: { key: string; rpm: number; tpm: number; rpd: number };
  fetcher: typeof fetch; deadline: AbortSignal;
  diagnostics: RouterDiagnostics;
}) {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: input.round === 1 ? SYSTEM_INSTRUCTION : FINAL_SYSTEM_INSTRUCTION }] },
    contents: input.content,
    generationConfig: { thinkingConfig: { thinkingLevel: "LOW" }, maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(input.round === 2 ? { responseMimeType: "application/json", responseSchema: {
        type: "OBJECT", properties: { factIds: { type: "ARRAY", items: { type: "STRING", enum: ["f0", "f1", "f2", "f3", "f4"] } } }, required: ["factIds"]
      } } : {}) },
    store: false,
    serviceTier: "standard",
  };
  if (input.tools) {
    body.tools = [{ functionDeclarations: INVENTORY_TOOL_DECLARATIONS }];
    body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: INVENTORY_TOOL_DECLARATIONS.map(tool => tool.name) } };
  }
  await reserveProviderCall(input.client, input.requestId, input.round, estimateReservationTokens(body), input.config, input.deadline, input.diagnostics);
  const localDeadline = AbortSignal.timeout(PROVIDER_DEADLINE_MS);
  const signal = AbortSignal.any([input.deadline, localDeadline]);
  input.diagnostics.timeoutStage = input.round === 1 ? "provider_request" : "provider_phrasing";
  input.diagnostics.providerRequests += 1;
  const response = await withinDeadline(input.fetcher(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": input.config.key },
    body: JSON.stringify(body), signal, redirect: "error",
  }), signal);
  if (!response.ok) {
    if (response.status === 429) {
      const headerSeconds = Number(response.headers.get("retry-after"));
      const retryAfter = Number.isFinite(headerSeconds) && headerSeconds > 0 ? Math.min(3600, Math.ceil(headerSeconds)) : 60;
      throw Object.assign(new Error("AURA_LLM_PROVIDER_UNAVAILABLE"), { status: 429, retryAfter });
    }
    throw Object.assign(new Error("AURA_LLM_PROVIDER_UNAVAILABLE"), { status: 503 });
  }
  const payload = await withinDeadline(response.json(), signal);
  const usage = objectValue(payload?.usageMetadata);
  const promptTokens = Number(usage.promptTokenCount);
  const outputTokens = Number(usage.candidatesTokenCount);
  if (Number.isSafeInteger(promptTokens) && promptTokens >= 0 && promptTokens <= 1_000_000) input.diagnostics.promptTokens += promptTokens;
  if (Number.isSafeInteger(outputTokens) && outputTokens >= 0 && outputTokens <= 1_000_000) input.diagnostics.outputTokens += outputTokens;
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  if (!candidate?.content || !Array.isArray(candidate.content.parts)) throw new Error("AURA_LLM_PROVIDER_RESPONSE_INVALID");
  input.diagnostics.timeoutStage = null;
  return candidate;
}

const SYSTEM_INSTRUCTION = `You are AURA, an inventory assistant. Interpret only the current inventory/product request. Use only the declared tools for current inventory facts. Do not estimate or invent quantities, SKU identities, lot identities, season, or stock status. Preserve incomplete data and ambiguity. For order preparation, draft_order item quantities are new additions only; do not repeat current draft quantities supplied in inventoryContext.draftLines. Call draft_order only when the selected-client alias is available; it creates a review-only draft and never submits an order. Never request or expose customer names, consignee names, chat messages, scout details, credentials, or prior conversation. Return no executable action instructions.`;
const FINAL_SYSTEM_INSTRUCTION = `Return only JSON matching {"factIds":["f0"]}. Select only supplied fact IDs that are relevant to the current inventory question. Do not produce prose, claims, quantities, identities, or instructions. The server will render fixed text from verified facts.`;

function sanitizeInventoryContext(value: unknown) {
  const context = objectValue(value);
  assertKeys(context, ["lines", "draftLines", "selectedRows", "sku", "size", "locationCode", "season", "metric"]);
  // Context arrays can contain untrusted or customer-derived UI state. They
  // are deliberately validated but never forwarded to the model.
  for (const key of ["lines", "draftLines", "selectedRows"]) if (context[key] != null) {
    if (!Array.isArray(context[key]) || (context[key] as unknown[]).length > 50) throw new Error("AURA_LLM_REQUEST_INVALID");
    context[key] = (context[key] as unknown[]).map(value => {
      const line = objectValue(value);
      assertKeys(line, ["unique_id", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "quantity"]);
      const quantity = line.quantity == null ? null : Number(line.quantity);
      if (quantity != null && (!Number.isFinite(quantity) || quantity < 0)) throw new Error("AURA_LLM_REQUEST_INVALID");
      return {
        itemcode: String(line.itemcode || "").slice(0, 100), commonname: String(line.commonname || "").slice(0, 160),
        contsize: String(line.contsize || "").slice(0, 48), locationcode: String(line.locationcode || "").slice(0, 64),
        lotcode: String(line.lotcode || "").slice(0, 64), quantity,
      };
    });
  }
  for (const [key, max] of [["sku", 100], ["size", 48], ["locationCode", 64], ["season", 2], ["metric", 16]] as const) {
    if (context[key] != null) context[key] = boundedText(context[key], max);
  }
  return context;
}

export function parseAuraLlmRequest(body: Record<string, unknown>): ParsedRequest {
  const mode = String(body.mode || "command");
  if (mode === "bind_party") {
    assertKeys(body, ["mode", "party"]);
    const party = objectValue(body.party);
    assertKeys(party, ["customerIdentityId", "consigneeIdentityId", "customerName", "consigneeName"]);
    const customerName = boundedText(party.customerName, 160);
    const consigneeName = boundedText(party.consigneeName || customerName, 160);
    const customerIdentityId = String(party.customerIdentityId || "").trim();
    const consigneeIdentityId = String(party.consigneeIdentityId || "").trim();
    if (customerIdentityId.length > 120 || consigneeIdentityId.length > 120
      || customerIdentityId.toLowerCase() === "multiple" || consigneeIdentityId.toLowerCase() === "multiple") {
      throw new Error("AURA_PARTY_AMBIGUOUS");
    }
    return { mode, party: { customerName, consigneeName, customerIdentityId, consigneeIdentityId } satisfies PartySidecar };
  }
  if (mode !== "command") throw new Error("AURA_LLM_REQUEST_INVALID");
  assertKeys(body, ["mode", "text", "source", "turnId", "context", "partyRef", "partySidecar"]);
  const text = boundedText(body.text, MAX_INPUT_CHARS);
  const source = String(body.source || "typed");
  if (!["typed", "voice"].includes(source)) throw new Error("AURA_LLM_REQUEST_INVALID");
  const turnId = boundedText(body.turnId, 96);
  if (!isUuid(turnId)) throw new Error("AURA_LLM_REQUEST_INVALID");
  const context = sanitizeInventoryContext(body.context);
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) throw new Error("AURA_LLM_REQUEST_INVALID");
  const partyRef = String(body.partyRef || "").trim();
  const partySidecar = body.partySidecar == null ? null : (parseAuraLlmRequest({ mode: "bind_party", party: body.partySidecar }) as Extract<ParsedRequest, { mode: "bind_party" }>).party;
  if (partyRef.length > 160 || (!!partyRef !== !!partySidecar)) throw new Error("AURA_LLM_REQUEST_INVALID");
  return { mode, text, source, turnId, context, partyRef, partySidecar };
}

function escapeIlike(value: string) { return value.replace(/[\\%_*]/g, ch => `\\${ch}`); }

async function readPartyRows(client: Client, table: "ph_customer_consignee_sales_reps" | "ph_reserves", party: PartySidecar, signal: AbortSignal) {
  const mapTable = table === "ph_customer_consignee_sales_reps";
  const fields = mapTable
    ? "unique_id,customeridentityid,customername,consigneeid,consigneename,salesrepname"
    : "unique_id,customeridentityid,customername,consigneeidentityid,consigneename,salesrepname";
  let query = client.from(table).select(fields).limit(101);
  if (party.customerIdentityId && party.consigneeIdentityId) {
    query = query.eq("customeridentityid", party.customerIdentityId)
      .eq(mapTable ? "consigneeid" : "consigneeidentityid", party.consigneeIdentityId);
  } else {
    query = query.ilike("customername", escapeIlike(party.customerName))
      .ilike("consigneename", escapeIlike(party.consigneeName));
  }
  const { data, error } = await withinDeadline(query.abortSignal(signal), signal) as any;
  if (error) throw safeDatabaseError("AURA_PARTY_LOOKUP_UNAVAILABLE", error);
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}

function inventoryRpc(client: Client, input: Parameters<typeof auraInventoryV2Rpc>[1], signal: AbortSignal) {
  return withinDeadline(auraInventoryV2Rpc(client, input, signal), signal) as Promise<any>;
}

function lotLookupRpc(client: Client, code: string, signal: AbortSignal) {
  return withinDeadline(auraInventoryLotLookupRpc(client, code, MAX_TOOL_ROWS, signal), signal) as Promise<any>;
}

async function validateParty(client: Client, party: PartySidecar, signal: AbortSignal) {
  const [mapRows, reserveRows] = await Promise.all([
    readPartyRows(client, "ph_customer_consignee_sales_reps", party, signal),
    readPartyRows(client, "ph_reserves", party, signal),
  ]);
  const rows = [...mapRows, ...reserveRows].filter(row => normalizeName(row.customername || row.customerName) === normalizeName(party.customerName)
    && normalizeName(row.consigneename || row.consigneeName || row.customername) === normalizeName(party.consigneeName));
  if (mapRows.length > 100 || reserveRows.length > 100) throw Object.assign(new Error("AURA_PARTY_AMBIGUOUS"), { status: 409 });
  if (mapRows.length >= 100 || reserveRows.length >= 100) throw Object.assign(new Error("AURA_PARTY_AMBIGUOUS"), { status: 409 });
  if (!rows.length) throw Object.assign(new Error("AURA_PARTY_NOT_FOUND"), { status: 409 });
  const customerIds = new Set(rows.map(row => String(row.customeridentityid || "").trim()).filter(Boolean));
  const consigneeIds = new Set(rows.map(row => String(row.consigneeid || row.consigneeidentityid || "").trim()).filter(Boolean));
  if ((party.customerIdentityId && !customerIds.has(party.customerIdentityId))
    || (party.consigneeIdentityId && !consigneeIds.has(party.consigneeIdentityId))
    || customerIds.size > 1 || consigneeIds.size > 1) {
    throw Object.assign(new Error("AURA_PARTY_AMBIGUOUS"), { status: 409 });
  }
  return { customerIdentityId: party.customerIdentityId || [...customerIds][0] || "", consigneeIdentityId: party.consigneeIdentityId || [...consigneeIds][0] || "" };
}

async function signPartyRef(actorId: string, party: PartySidecar, expiresAt: number, secret: string) {
  const material = ["aura-party-ref-v1", actorId, expiresAt, normalizeName(party.customerName), normalizeName(party.consigneeName), party.customerIdentityId || "", party.consigneeIdentityId || ""].join("\n");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(material));
  const digest = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${expiresAt}.${digest}`;
}

async function bindParty(client: Client, actorId: string, party: PartySidecar, secret: string, signal: AbortSignal) {
  await validateParty(client, party, signal);
  const expiresAt = Date.now() + 5 * 60_000;
  if (!secret) throw new Error("AURA_LLM_CONFIGURATION_UNAVAILABLE");
  const partyRef = await signPartyRef(actorId, party, expiresAt, secret);
  return { ok: true, partyRef, expiresAt };
}

async function verifyPartyRef(client: Client, actorId: string, partyRef: string, party: PartySidecar, secret: string, signal: AbortSignal) {
  const [expiresText, digest] = partyRef.split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || !digest || digest.length > 100) throw Object.assign(new Error("AURA_PARTY_REF_EXPIRED"), { status: 409 });
  const expected = await signPartyRef(actorId, party, expiresAt, secret);
  if (expected !== partyRef) throw Object.assign(new Error("AURA_PARTY_REF_INVALID"), { status: 409 });
  await validateParty(client, party, signal);
}

function numericValue(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function strictArgs(value: unknown, allowed: string[], required: string[] = []) {
  const args = objectValue(value);
  assertKeys(args, allowed);
  if (required.some(key => args[key] == null || args[key] === "")) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
  return args;
}

function validMetric(value: unknown) {
  const metric = String(value || "ptravailable").toLowerCase();
  if (!new Set(["ptravailable", "ptronhand"]).has(metric)) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
  return metric;
}

function toolPayload(result: unknown, operation: string): Record<string, unknown> {
  const data = objectValue(result);
  if (data.ok !== true) throw new Error("AURA_INVENTORY_UNAVAILABLE");
  return { operation, ...data };
}

async function executeTool(client: Client, name: string, rawArgs: unknown, signal: AbortSignal, actorId: string, partyContext: { ref: string; sidecar: PartySidecar } | null, partySecret: string, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name === "check_open_stock") {
    const args = strictArgs(rawArgs, ["sku", "contSize", "locationCode", "metric"], ["sku"]);
    const query = boundedText(args.sku, 160);
    const contSize = args.contSize == null ? "" : boundedText(args.contSize, 48);
    const locationCode = args.locationCode == null ? "" : boundedText(args.locationCode, 64);
    let sku = query;
    let size = contSize;
    if (!/^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(query)) {
      const match = await inventoryRpc(client, { operation: "match", commonName: query, contSize: size, locationCode,
        metric: validMetric(args.metric), openStockOnly: true }, signal);
      if (match.error) throw safeDatabaseError("AURA_INVENTORY_UNAVAILABLE", match.error);
      const matchData = objectValue(match.data);
      const rows = Array.isArray(matchData.rows) ? matchData.rows : [];
      if (matchData.ok !== true) throw new Error("AURA_INVENTORY_UNAVAILABLE");
      if (matchData.exactMatch !== true || matchData.complete !== true || rows.length !== 1) {
        return { operation: "match", ...matchData };
      }
      const exact = objectValue(rows[0]);
      sku = boundedText(exact.itemcode, 100);
      size ||= boundedText(exact.contsize, 48);
    }
    const { data, error } = await inventoryRpc(client, { operation: "count", itemcode: sku,
      contSize: size, locationCode, metric: validMetric(args.metric), openStockOnly: true, limit: MAX_TOOL_ROWS }, signal);
    if (error) throw safeDatabaseError("AURA_INVENTORY_UNAVAILABLE", error);
    return toolPayload(data, "open_stock");
  }
  if (name === "lookup_lot_code") {
    const args = strictArgs(rawArgs, ["code"], ["code"]);
    const code = boundedText(args.code, 64);
    const { data, error } = await lotLookupRpc(client, code, signal);
    if (error) throw safeDatabaseError("AURA_LOT_LOOKUP_UNAVAILABLE", error);
    return toolPayload(data, "lot_lookup");
  }
  if (name === "draft_order") {
    const args = strictArgs(rawArgs, ["client", "items"], ["client", "items"]);
    if (args.client !== "selected_client" || !partyContext) throw Object.assign(new Error("AURA_SELECTED_CLIENT_REQUIRED"), { status: 409 });
    await verifyPartyRef(client, actorId, partyContext.ref, partyContext.sidecar, partySecret, signal);
    if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 20) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
    const requested: { itemcode: string; commonname: string; contSize: string; locationCode: string; quantity: number }[] = [];
    const draftLines = Array.isArray(context.draftLines) ? context.draftLines as Record<string, unknown>[] : [];
    if (draftLines.length > 50) throw new Error("AURA_LLM_REQUEST_INVALID");
    for (const line of draftLines) {
      const itemcode = boundedText(line.itemcode, 100);
      const contSize = boundedText(line.contsize, 48);
      const locationCode = line.locationcode ? boundedText(line.locationcode, 64) : "";
      const quantity = Number(line.quantity);
      if (!/^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(itemcode)
        || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) throw new Error("AURA_LLM_REQUEST_INVALID");
      const prior = requested.find(entry => entry.itemcode.toUpperCase() === itemcode.toUpperCase()
        && entry.contSize.toUpperCase() === contSize.toUpperCase());
      if (prior) {
        if (prior.locationCode && locationCode && prior.locationCode.toUpperCase() !== locationCode.toUpperCase()) {
          return { operation: "draft_validation", valid: false, complete: false, failures: [{ error: "duplicate_sku_size_location_conflict" }] };
        }
        prior.locationCode ||= locationCode;
        prior.quantity += quantity;
        if (prior.quantity > 999999) throw new Error("AURA_LLM_REQUEST_INVALID");
      } else requested.push({ itemcode, commonname: boundedText(line.commonname || itemcode, 160), contSize, locationCode, quantity });
    }
    for (const value of args.items) {
      const item = strictArgs(value, ["product", "contSize", "locationCode", "quantity"], ["product", "quantity"]);
      const product = boundedText(item.product, 160);
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
      const contSize = item.contSize == null ? "" : boundedText(item.contSize, 48);
      const locationCode = item.locationCode == null ? "" : boundedText(item.locationCode, 64);
      let itemcode = product;
      let commonname = product;
      let resolvedSize = contSize;
      const isSku = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(product);
      if (!isSku) {
        const match = await inventoryRpc(client, { operation: "match", commonName: product, contSize, locationCode,
          metric: "ptravailable", openStockOnly: true }, signal);
        if (match.error) throw safeDatabaseError("AURA_INVENTORY_UNAVAILABLE", match.error);
        const matchData = objectValue(match.data);
        const choices = Array.isArray(matchData.rows) ? matchData.rows.slice(0, 5) : [];
        if (matchData.ok !== true) throw new Error("AURA_INVENTORY_UNAVAILABLE");
        if (matchData.complete !== true || matchData.exactMatch !== true || choices.length !== 1) {
          return { operation: "draft_validation", valid: false, complete: matchData.complete === true,
            choiceKind: "inventory", choices };
        }
        const exact = objectValue(choices[0]);
        itemcode = boundedText(exact.itemcode, 100);
        commonname = boundedText(exact.commonname, 160);
        resolvedSize = resolvedSize || boundedText(exact.contsize, 48);
      } else if (!resolvedSize) {
        const currentSizes = [...new Set(requested.filter(entry => entry.itemcode.toUpperCase() === itemcode.toUpperCase())
          .map(entry => entry.contSize))];
        if (currentSizes.length === 1) resolvedSize = currentSizes[0];
        else {
          const countResult = await inventoryRpc(client, { operation: "count", itemcode,
            locationCode, metric: "ptravailable", openStockOnly: true, limit: MAX_TOOL_ROWS }, signal);
          if (countResult.error) throw safeDatabaseError("AURA_INVENTORY_UNAVAILABLE", countResult.error);
          const countData = objectValue(countResult.data);
          if (countData.ok !== true) throw new Error("AURA_INVENTORY_UNAVAILABLE");
          const rows = Array.isArray(countData.rows) ? countData.rows as Record<string, unknown>[] : [];
          const sizes = [...new Set(rows.map(row => String(row.contsize || "").trim()).filter(Boolean))];
          if (sizes.length !== 1 || countData.hasMore === true || countData.complete !== true) {
            const unique = new Map<string, Record<string, unknown>>();
            for (const row of rows) {
              const key = [row.itemcode, row.commonname, row.contsize].map(value => String(value || "").trim()).join("\u0000");
              unique.set(key, { itemcode: row.itemcode, commonname: row.commonname, contsize: row.contsize });
            }
            return { operation: "draft_validation", valid: false, complete: countData.complete === true,
              choiceKind: "inventory", choices: [...unique.values()].slice(0, 5) };
          }
          resolvedSize = sizes[0];
          commonname = String(rows.find(row => String(row.contsize || "").trim() === resolvedSize)?.commonname || itemcode);
        }
      }
      const prior = requested.find(entry => entry.itemcode.toUpperCase() === itemcode.toUpperCase()
        && entry.contSize.toUpperCase() === resolvedSize.toUpperCase());
      if (prior) {
        if (prior.locationCode && locationCode && prior.locationCode.toUpperCase() !== locationCode.toUpperCase()) return { operation: "draft_validation", valid: false,
          complete: false, choiceKind: "inventory", failures: [{ error: "duplicate_sku_size_location_conflict" }] };
        prior.locationCode ||= locationCode;
        prior.quantity += quantity;
        if (prior.quantity > 999999) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
      } else requested.push({ itemcode, commonname, contSize: resolvedSize, locationCode, quantity });
    }
    const lines: Record<string, unknown>[] = [];
    for (const item of requested) {
      const lotResult = await inventoryRpc(client, { operation: "lots", itemcode: item.itemcode,
        contSize: item.contSize, locationCode: item.locationCode, metric: "ptravailable", openStockOnly: true,
        quantity: item.quantity, limit: 100 }, signal);
      if (lotResult.error) throw safeDatabaseError("AURA_LOT_LOOKUP_UNAVAILABLE", lotResult.error);
      const lotData = objectValue(lotResult.data);
      if (lotData.ok !== true) throw new Error("AURA_LOT_LOOKUP_UNAVAILABLE");
      if (lotData.complete !== true) return { operation: "draft_validation", valid: false, complete: false, failures: [{ error: "inventory_incomplete" }] };
      const eligibleLots = Array.isArray(lotData.rows) ? lotData.rows as Record<string, unknown>[] : [];
      if (!eligibleLots.length) {
        const countResult = await inventoryRpc(client, { operation: "count", itemcode: item.itemcode,
          contSize: item.contSize, locationCode: item.locationCode, metric: "ptravailable", openStockOnly: true, limit: 100 }, signal);
        if (countResult.error) throw safeDatabaseError("AURA_INVENTORY_UNAVAILABLE", countResult.error);
        const countData = objectValue(countResult.data);
        if (countData.ok !== true) throw new Error("AURA_INVENTORY_UNAVAILABLE");
        const choiceResult = await inventoryRpc(client, { operation: "lots", itemcode: item.itemcode,
          contSize: item.contSize, locationCode: item.locationCode, metric: "ptravailable", openStockOnly: true,
          quantity: 1, limit: 100 }, signal);
        const choiceData = objectValue(choiceResult.data);
        if (choiceResult.error) throw safeDatabaseError("AURA_LOT_LOOKUP_UNAVAILABLE", choiceResult.error);
        if (choiceData.ok !== true) throw new Error("AURA_LOT_LOOKUP_UNAVAILABLE");
        return { operation: "draft_validation", valid: false, complete: countData.complete === true && choiceData.complete === true,
          requestedQuantity: item.quantity, availableAcrossLots: countData.total, choiceKind: "lot",
          choices: Array.isArray(choiceData.rows) ? choiceData.rows.slice(0, 5) : [], failures: [{ error: "no_single_lot_covers_quantity" }] };
      }
      const lot = eligibleLots[0]; // RPC order is numeric priority ascending, NULLS LAST.
      lines.push({ unique_id: lot.unique_id, itemcode: lot.itemcode, commonname: lot.commonname || item.commonname,
        contsize: lot.contsize, locationcode: lot.locationcode, lotcode: lot.lotcode, quantity: item.quantity });
    }
    const { data, error } = await inventoryRpc(client, { operation: "validate_draft", lines, limit: 50 }, signal);
    if (error) throw safeDatabaseError("AURA_DRAFT_VALIDATION_UNAVAILABLE", error);
    const validation = toolPayload(data, "draft_validation");
    if (validation.valid !== true || validation.complete !== true || !Array.isArray(validation.rows) || validation.rows.length !== lines.length) {
      return { operation: "draft_validation", valid: false, complete: validation.complete === true, failures: validation.failures || [] };
    }
    return { operation: "draft_validation", valid: true, complete: true, rows: validation.rows };
  }
  throw new Error("AURA_LLM_TOOL_NOT_ALLOWED");
}

export function actionsFrom(results: Record<string, unknown>[]) {
  const actions: Record<string, unknown>[] = [];
  for (const result of results) {
    if (result.operation === "match") {
      const rows = Array.isArray(result.rows) ? result.rows.slice(0, 5).map(value => {
        const row = objectValue(value);
        return { itemcode: row.itemcode, commonname: row.commonname, contsize: row.contsize };
      }) : [];
      actions.push({ type: "choices", kind: "inventory", items: rows,
        complete: result.complete === true, hasMore: result.hasMore === true || result.additionalMatches === true });
    } else if (result.operation === "lot_lookup") {
      const data = { ...result };
      delete data.operation;
      if (Array.isArray(data.rows)) data.rows = data.rows.slice(0, MAX_TOOL_ROWS);
      actions.push({ type: "inventory_result", operation: "lot_lookup", data });
    } else if (result.operation === "open_stock") {
      const data = { ...result };
      delete data.operation;
      actions.push({ type: "inventory_result", operation: "open_stock", data });
    } else if (result.operation === "draft_validation") {
      if (result.valid === true && result.complete === true) actions.push({ type: "draft_update", lines: result.rows });
      else if (Array.isArray(result.choices) && result.choices.length) actions.push({ type: "choices",
        kind: result.choiceKind === "lot" ? "lot" : "inventory", items: result.choiceKind === "lot" ? result.choices.slice(0, 5) : result.choices.slice(0, 5).map(value => {
          const row = objectValue(value);
          return { itemcode: row.itemcode, commonname: row.commonname, contsize: row.contsize };
        }),
        complete: result.complete === true, hasMore: false });
    }
  }
  return actions;
}

function normalizeToolCall(part: Record<string, unknown>) {
  const call = objectValue(part.functionCall);
  const name = String(call.name || "");
  if (!INVENTORY_TOOL_DECLARATIONS.some(tool => tool.name === name)) throw new Error("AURA_LLM_TOOL_NOT_ALLOWED");
  if (!call.args || typeof call.args !== "object" || Array.isArray(call.args)) throw new Error("AURA_LLM_TOOL_ARGUMENTS_INVALID");
  return { name, args: call.args };
}

function deterministicReply(results: Record<string, unknown>[]) {
  const messages = results.map(result => {
    if (result.operation === "open_stock") {
      if (result.complete !== true || result.total == null) return "The open-stock quantity is incomplete, so I can’t give a reliable total.";
      const total = numericValue(result.total);
      if (total == null) return "The open-stock quantity is unknown.";
      const rows = Array.isArray(result.rows) ? result.rows as Record<string, unknown>[] : [];
      const labels = [...new Set(rows.map(row => [String(row.commonname || "").trim(), String(row.contsize || "").trim()].filter(Boolean).join(" ")).filter(Boolean))];
      const subject = labels.length === 1 ? `${labels[0]}: ` : "";
      return `Verified ${subject}${new Intl.NumberFormat("en-US").format(total)} ${result.metric === "ptronhand" ? "on hand" : "available"} in eligible open stock.`;
    }
    if (result.operation === "match") {
      const count = Array.isArray(result.rows) ? result.rows.length : 0;
      return count ? `I found ${count} inventory matches. Choose the exact plant and size before checking stock.` : "I couldn’t identify a complete inventory match. Try a more specific plant name or size.";
    }
    if (result.operation === "lot_lookup") {
      const count = Array.isArray(result.rows) ? result.rows.length : 0;
      return result.complete === true ? `I found ${count}${result.hasMore ? " shown" : ""} eligible rows for that exact lot code.` : `I found ${count} possible lot rows, but the inventory data is incomplete.`;
    }
    if (result.operation === "draft_validation") {
      if (result.valid === true && result.complete === true) {
        const lines = Array.isArray(result.rows) ? result.rows as Record<string, unknown>[] : [];
        const products = [...new Set(lines.map(row => [String(row.commonname || "").trim(), String(row.contsize || "").trim()].filter(Boolean).join(" ")).filter(Boolean))];
        return `The draft is ready for review${products.length ? ` for ${products.join(", ")}` : ""} with ${lines.length} validated lot line(s). Nothing was submitted.`;
      }
      if (result.availableAcrossLots != null) return `No single eligible lot covers ${result.requestedQuantity}. The verified aggregate across lots is ${new Intl.NumberFormat("en-US").format(Number(result.availableAcrossLots))}; choose a lot or quantity to continue.`;
      if (Array.isArray(result.choices) && result.choices.length) return "I found inventory choices. Select an exact SKU, size, or lot before I prepare the draft.";
      return "I couldn’t validate every requested item, so I left the draft unchanged. Review the availability and try again.";
    }
    return "I couldn’t complete one of the inventory lookups, so I’m leaving that quantity unknown.";
  });
  return messages.join(" ").slice(0, 1200) || "I couldn’t safely identify an inventory lookup. Try asking about a plant, SKU, size, stock quantity, or lot code.";
}

export function modelFactSelection(candidate: Record<string, unknown>, count: number) {
  const parts = objectValue(candidate.content).parts;
  if (!Array.isArray(parts)) return [];
  const text = parts.map(part => String(objectValue(part).text || "")).join("").trim();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.factIds) || parsed.factIds.length > count) return [];
    const seen = new Set<number>();
    for (const value of parsed.factIds) {
      const match = /^f([0-4])$/.exec(String(value));
      if (!match || Number(match[1]) >= count) return [];
      seen.add(Number(match[1]));
    }
    return [...seen].sort((a, b) => a - b);
  } catch { return []; }
}

export function hasMultipleDraftCalls(calls: Array<{ name: string }>) {
  return calls.filter(call => call.name === "draft_order").length > 1;
}

function captureSqlState(diagnostics: RouterDiagnostics, error: unknown) {
  const value = objectValue(error);
  const candidate = String(value.code || "").toUpperCase();
  if (/^[0-9A-Z]{5}$/.test(candidate)) diagnostics.sqlstate = candidate;
}

function safeDatabaseError(message: string, cause: unknown) {
  const code = String(objectValue(cause).code || "").toUpperCase();
  const error = new Error(message) as Error & { code?: string };
  if (/^[0-9A-Z]{5}$/.test(code)) error.code = code;
  return error;
}

async function handleCommand(command: Extract<ParsedRequest, { mode: "command" }>, client: Client, actorId: string, config: NonNullable<ReturnType<typeof getConfig>>, fetcher: typeof fetch, deadline: AbortSignal, requestId: string, partySecret: string, diagnostics: RouterDiagnostics) {
  const safeText = command.partySidecar
    ? command.text.replace(new RegExp(command.partySidecar.customerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "selected client")
      .replace(new RegExp(command.partySidecar.consigneeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "selected client")
    : command.text;
  const userPayload = { source: command.source, question: safeText, inventoryContext: {
    sku: command.context.sku, size: command.context.size, locationCode: command.context.locationCode,
    season: command.context.season, metric: command.context.metric,
    selectedRows: command.context.selectedRows, draftLines: command.context.draftLines,
  }, selectedClientAvailable: !!command.partyRef };
  const first = await geminiCall({ requestId, round: 1, content: [{ role: "user", parts: [{ text: JSON.stringify(userPayload) }] }], tools: true, client, config, fetcher, deadline, diagnostics });
  const parts = first.content.parts as Record<string, unknown>[];
  const calls = parts.filter(part => !!part.functionCall).map(normalizeToolCall);
  if (!calls.length) {
    const reply = "I couldn’t safely identify an inventory lookup. Try asking about a plant, SKU, size, stock quantity, or lot code.";
    return { ok: true, requestId, reply, speech: reply, actions: [], context: { verified: true } };
  }
  if (calls.length > MAX_TOOL_CALLS) throw new Error("AURA_LLM_TOOL_LIMIT");
  const partyContext = command.partyRef && command.partySidecar ? { ref: command.partyRef, sidecar: command.partySidecar } : null;
  const rejectDraftCalls = hasMultipleDraftCalls(calls);
  diagnostics.timeoutStage = "inventory_lookup";
  const settled = await Promise.allSettled(calls.map(call => rejectDraftCalls && call.name === "draft_order"
    ? Promise.resolve({ operation: "unavailable", complete: false })
    : executeTool(client, call.name, call.args, deadline, actorId, partyContext, partySecret, command.context)));
  const results: Record<string, unknown>[] = settled.map(entry => {
    if (entry.status === "fulfilled") return entry.value;
    captureSqlState(diagnostics, entry.reason);
    return { operation: "unavailable", complete: false };
  });
  diagnostics.timeoutStage = null;
  let selectedResults = results;
  try {
    const facts = results.map((result, index) => ({ factId: `f${index}`, summary: deterministicReply([result]) }));
    const final = await geminiCall({ requestId, round: 2,
      content: [{ role: "user", parts: [{ text: JSON.stringify({ instruction: "Select only the fact IDs needed to answer the inventory question. Return JSON with a factIds array and no other fields.", facts }) }] }],
      tools: false, client, config, fetcher, deadline, diagnostics });
    const selected = modelFactSelection(final, results.length);
    if (selected.length) {
      const selectedSet = new Set([...selected, ...results.flatMap((result, index) =>
        result.operation === "unavailable" || result.complete !== true || result.valid === false ? [index] : [])]);
      selectedResults = [...selectedSet].sort((a, b) => a - b).map(index => results[index]);
    }
  } catch (error) {
    if (deadline.aborted) throw error;
    /* Quota/provider failure on phrasing uses grounded local templates. */
  }
  const reply = deterministicReply(selectedResults);
  return { ok: true, requestId, reply, speech: reply, actions: actionsFrom(results), context: { verified: true } };
}

export async function handleAuraLlmRequest(request: Request, deps: RouterDeps = {}) {
  const diagnostics: RouterDiagnostics = {
    requestId: isUuid(request.headers.get("x-request-id")) ? String(request.headers.get("x-request-id")) : crypto.randomUUID(),
    operation: request.method === "OPTIONS" ? "preflight" : "request", status: 500, providerRequests: 0,
    reservedTokens: 0, promptTokens: 0, outputTokens: 0, sqlstate: null, timeoutStage: "request_body",
  };
  const startedAt = performance.now();
  try {
    const response = await handleAuraLlmRequestInternal(request, deps, diagnostics);
    diagnostics.status = response.status;
    return response;
  } catch (error) {
    captureSqlState(diagnostics, error);
    diagnostics.status = 500;
    return fail("AURA’s inventory assistant is temporarily unavailable.", diagnostics.status, "AURA_LLM_UNAVAILABLE");
  } finally {
    const log = {
      event: "aura_llm_request", request_id: diagnostics.requestId, operation: diagnostics.operation,
      duration_ms: Math.max(0, Math.round(performance.now() - startedAt)), status: diagnostics.status,
      sqlstate: diagnostics.sqlstate, timeout_stage: diagnostics.status === 504 ? diagnostics.timeoutStage : null,
      provider_requests: diagnostics.providerRequests, reserved_input_tokens: diagnostics.reservedTokens,
      prompt_tokens: diagnostics.promptTokens, output_tokens: diagnostics.outputTokens,
    };
    (diagnostics.status >= 500 ? console.error : console.info)(JSON.stringify(log));
  }
}

async function handleAuraLlmRequestInternal(request: Request, deps: RouterDeps, diagnostics: RouterDiagnostics) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return fail("Method not allowed.", 405, "METHOD_NOT_ALLOWED");
  const deadlineController = new AbortController();
  const timer = setTimeout(() => deadlineController.abort(new DOMException("AURA LLM deadline exceeded.", "TimeoutError")), TOTAL_DEADLINE_MS);
  const deadline = AbortSignal.any([deadlineController.signal, request.signal]);
  try {
    const payload = await withinDeadline(readBoundedJson(request, deadline), deadline);
    const parsed = parseAuraLlmRequest(objectValue(payload));
    diagnostics.operation = parsed.mode;
    const headerRequestId = String(request.headers.get("x-request-id") || "").trim();
    const requestId = parsed.mode === "command" ? parsed.turnId : (isUuid(headerRequestId) ? headerRequestId : crypto.randomUUID());
    diagnostics.requestId = requestId;
    if (parsed.mode === "command" && (!isUuid(headerRequestId) || headerRequestId.toLowerCase() !== parsed.turnId.toLowerCase())) {
      return fail("AURA request identifier must match this turn.", 400, "AURA_LLM_REQUEST_INVALID");
    }
    const client = getClient(deps, deadline);
    diagnostics.timeoutStage = "authentication";
    const auth = await authorize(request, client, deadline, diagnostics);
    if ("error" in auth) return auth.error || fail("AURA authentication failed.", 401, "AURA_AUTH_REQUIRED");
    diagnostics.timeoutStage = null;
    const config = getConfig(deps.env || Deno.env.get.bind(Deno.env));
    if (!config) return fail("AURA’s inventory assistant is not configured for the free tier.", 503, "AURA_LLM_CONFIGURATION_UNAVAILABLE");
    if (parsed.mode === "bind_party") {
      const party = parsed.party as PartySidecar;
      const secret = String((deps.env || Deno.env.get.bind(Deno.env))("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
      diagnostics.timeoutStage = "party_validation";
      const bound = await bindParty(client, String(auth.session.authUserId), party, secret, deadline);
      diagnostics.timeoutStage = null;
      return json(bound);
    }
    assertInventoryOnlyText(parsed.text, !!parsed.partyRef);
    const secret = String((deps.env || Deno.env.get.bind(Deno.env))("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const result = await handleCommand(parsed as Extract<ParsedRequest, { mode: "command" }>, client, String(auth.session.authUserId), config, deps.fetcher || fetch, deadline, requestId, secret, diagnostics);
    return json(result);
  } catch (error) {
    captureSqlState(diagnostics, error);
    const failure = error as { message?: string; status?: number; retryAfter?: number; name?: string };
    const message = String(failure.message || "AURA_LLM_REQUEST_FAILED");
    if (failure.status === 409 || /AMBIGUOUS|NOT_FOUND|EXPIRED|REQUIRED/.test(message)) {
      return fail("AURA needs a current, unambiguous selection. Review the choices and try again.", 409, message);
    }
    if (failure.status === 429 || message === "AURA_LLM_RATE_LIMITED") {
      const retryAfter = Math.max(0, Number(failure.retryAfter || 0));
      return fail("AURA is temporarily at its free-tier request limit. Try again after the indicated wait.", 429, "AURA_LLM_RATE_LIMITED", retryAfter ? { "Retry-After": String(retryAfter) } : {});
    }
    if (/^AURA_(LLM|PARTY|INVENTORY|DRAFT|LOT)_/.test(message)) {
      const status = failure.status || (/INVALID|LIMIT|PRIVACY_BLOCKED/.test(message) ? 400 : /TIMEOUT/.test(message) ? 504 : 503);
      return fail(status === 409 ? "AURA needs a current, unambiguous selection. Review the choices and try again." : status === 400 ? "AURA could not validate that inventory request." : status === 504 ? "AURA’s inventory request took too long. Try again." : "AURA’s inventory assistant is temporarily unavailable.", status, message);
    }
    if (deadline.aborted || failure.name === "TimeoutError" || failure.name === "AbortError") {
      diagnostics.timeoutStage ||= "request_deadline";
      return fail("AURA’s inventory request exceeded the 15-second deadline.", 504, "AURA_LLM_DEADLINE_EXCEEDED");
    }
    return fail("AURA’s inventory assistant is temporarily unavailable.", 503, "AURA_LLM_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.main) serve(request => withObservedRequest("aura-llm-router", request, async () =>
  await handleAuraLlmRequest(request) || fail("AURA request failed.", 500, "AURA_LLM_UNAVAILABLE"), { action: "aura_llm" }));
