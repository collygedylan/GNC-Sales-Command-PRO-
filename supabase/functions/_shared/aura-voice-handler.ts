import { AURA_PROVIDER_TIMEOUT_MS, auraObject, routeAuraWithGemini, validateAuraHistory, validateAuraTool, validateInventoryFilters, validateSocFilters, type SocFilters, type SocToolName, type AuraActor, type AuraTool, type InventoryFilters, type InventoryOperation } from "./aura-gemini.ts";
import { resolveAuraIntent } from "./aura-query.ts";

import { parseAuraAppContext, requestedAuraVariants, spokenAuraSeason, signedAuraQuantity } from "./aura-voice-scope.ts";
import { socData, socOutcome, socStamp, socFingerprint } from "./aura-voice-soc.ts";
import { auraVoice, extractAuraEntity, auraInventorySummary, type AuraGlossaryEntry, type AuraVoice } from "./aura-domain.ts";
import { synthesizeAuraSpeech } from "./aura-speech.ts";

type ObjectValue = Record<string, unknown>;
export type AuraMemoryArgs = { operation: string; conversationId?: string; turnId?: string; expectedRevision?: number; payload?: ObjectValue };
export type AuraHistoryQuery = { operation: "customers" | "consignees" | "requests" | "reps" | "summary"; customerKey?: string; consigneeKey?: string; page?: number; pageSize?: number };
export interface AuraVoiceStore {
  domain(signal: AbortSignal): Promise<{ glossary: AuraGlossaryEntry[]; revision: string }>;
  voicePreference(voice: AuraVoice | undefined, signal: AbortSignal): Promise<AuraVoice>;
  appContext(signal: AbortSignal): Promise<unknown>;
  soc(kind: SocToolName, filters: SocFilters, cursor: unknown, signal: AbortSignal): Promise<unknown>;
  authorize(signal: AbortSignal): Promise<AuraActor | null>;
  memory(actorId: string, args: AuraMemoryArgs, signal: AbortSignal): Promise<unknown>;
  inventory(operation: string, filters: InventoryFilters, cursor: unknown, signal: AbortSignal): Promise<unknown>;
  history(query: AuraHistoryQuery, signal: AbortSignal): Promise<unknown>;
  reserve(inputBytes: number, signal: AbortSignal): Promise<void>;
}
export type AuraVoiceDeps = {
  createStore: (bearer: string) => AuraVoiceStore;
  apiKey: () => string;
  fetcher?: typeof fetch;
};
type Outcome = { reply: string; actions: ObjectValue[]; context: ObjectValue; sources: ObjectValue[]; hasMore?: boolean; metadata?: ObjectValue };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFUSAL = "I can help with live nursery inventory, stock, locations, lots, customer reserves, open orders, request drafts, and your authorized Historical Requests. Please ask about those records.";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-gnc-session, x-app-session, x-request-id", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "private, no-store" };
const optionalObject = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
const array = (value: unknown): ObjectValue[] => Array.isArray(value) ? value.map(auraObject) : [];
const format = (value: number) => new Intl.NumberFormat("en-US").format(value);
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("AURA_RESULT_INVALID"); return value; }
function identifier(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new Error("AURA_QUERY_REQUEST_INVALID"); return value; }
function boundedString(value: unknown, max = 2000): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("AURA_QUERY_REQUEST_INVALID"); return value.trim(); }
function result(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } }); }
function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function policy(actor: AuraActor) { return { version: 2, auraEnabled: true, id: actor.id, username: actor.username, role: actor.role, inventory: actor.inventory, history: actor.history, drafts: actor.drafts, socReserves: actor.socReserves === true, socOpenOrders: actor.socOpenOrders === true }; }
async function withinSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  let onAbort: () => void = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true });
  })]); } finally { signal.removeEventListener("abort", onAbort); }
}
async function requestBody(request: Request, signal: AbortSignal): Promise<ObjectValue> {
  if (Number(request.headers.get("content-length")) > 16000 || !request.body) throw new Error("AURA_QUERY_REQUEST_INVALID");
  const reader = request.body.getReader(), decoder = new TextDecoder(); let raw = "", bytes = 0;
  try { for (;;) { const chunk = await withinSignal(reader.read(), signal); if (chunk.done) break; bytes += chunk.value.byteLength;
    if (bytes > 16000) throw new Error("AURA_QUERY_REQUEST_INVALID"); raw += decoder.decode(chunk.value, { stream: true }); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  try { return auraObject(JSON.parse(raw + decoder.decode())); } catch { throw new Error("AURA_QUERY_REQUEST_INVALID"); }
}
function memoryArgs(body: ObjectValue, operation: string): AuraMemoryArgs {
  const args: AuraMemoryArgs = { operation };
  if (body.conversationId != null) args.conversationId = identifier(body.conversationId);
  if (body.turnId != null) args.turnId = identifier(body.turnId);
  if (body.expectedRevision != null) {
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new Error("AURA_QUERY_REQUEST_INVALID");
    args.expectedRevision = Number(body.expectedRevision);
  }
  return args;
}
function inventoryStamp(data: ObjectValue) {
  return { settingRevision: data.settingRevision, season: data.season, salesYear: data.salesYear, datasetRevision: data.datasetRevision };
}
type DraftConfirmationTuple = {
  version: 1;
  inventoryId: string; selectionId: string; itemcode: string; contSize: string; locationCode: string; lotCode: string;
  quantity: number; customerName: string; consigneeName: string; inventoryStamp: ObjectValue;
};
function explicitDraftConfirmation(text: string) {
  const normalized = text.trim().replace(/[.!?]+$/g, "").replace(/\s+/g, " ").toLowerCase();
  return ["yes", "yes please", "confirm", "confirmed", "i confirm", "correct", "that's correct", "that is correct", "looks good", "prepare the draft", "prepare draft"].includes(normalized);
}
function draftConfirmationTuple(value: unknown): DraftConfirmationTuple | null {
  const raw = optionalObject(value), stamp = optionalObject(raw.inventoryStamp);
  const requiredStrings = ["inventoryId", "selectionId", "itemcode", "customerName", "consigneeName"];
  const optionalDimensions = ["contSize", "locationCode", "lotCode"];
  if (raw.version !== 1 || requiredStrings.some(key => typeof raw[key] !== "string" || !(raw[key] as string).trim())
    || optionalDimensions.some(key => typeof raw[key] !== "string")
    || typeof raw.quantity !== "number" || !Number.isSafeInteger(raw.quantity) || raw.quantity < 1
    || typeof stamp.settingRevision !== "number" || !Number.isSafeInteger(stamp.settingRevision) || typeof stamp.season !== "string"
    || typeof stamp.salesYear !== "number" || !Number.isSafeInteger(stamp.salesYear)
    || (typeof stamp.datasetRevision !== "string" && typeof stamp.datasetRevision !== "number")
    || typeof stamp.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(stamp.fingerprint)) return null;
  return { version: 1, inventoryStamp: stamp, quantity: raw.quantity,
    inventoryId: String(raw.inventoryId), selectionId: String(raw.selectionId), itemcode: String(raw.itemcode),
    contSize: String(raw.contSize), locationCode: String(raw.locationCode), lotCode: String(raw.lotCode),
    customerName: String(raw.customerName).trim(), consigneeName: String(raw.consigneeName).trim() };
}
function sameDraftConfirmation(left: DraftConfirmationTuple | null, right: DraftConfirmationTuple | null) {
  if (!left || !right) return false;
  return left.inventoryId === right.inventoryId && left.selectionId === right.selectionId && left.itemcode === right.itemcode
    && left.contSize === right.contSize && left.locationCode === right.locationCode && left.lotCode === right.lotCode
    && left.quantity === right.quantity && left.customerName === right.customerName && left.consigneeName === right.consigneeName
    && same(left.inventoryStamp, right.inventoryStamp);
}
function makeDraftConfirmationTuple(row: ObjectValue, tool: Extract<AuraTool, { name: "draft_request" }>, data: ObjectValue, fingerprint: string): DraftConfirmationTuple | null {
  const rowString = (value: unknown, optional = false): string | null => {
    if (value === null || value === undefined) return optional ? "" : null;
    return typeof value === "string" ? value.trim() : null;
  };
  const inventoryId = rowString(row.uniqueId ?? row.unique_id);
  const selectionId = rowString(row.selectionId);
  const itemcode = rowString(row.itemcode);
  const contSize = rowString(row.contSize ?? row.contsize, true);
  const locationCode = rowString(row.locationCode ?? row.locationcode, true);
  const lotCode = rowString(row.lotCode ?? row.lotcode, true);
  const customerName = String(tool.customerName || "").trim();
  const consigneeName = String(tool.consigneeName || "").trim();
  if (!inventoryId || !selectionId || !itemcode || contSize === null || locationCode === null || lotCode === null || !customerName || !consigneeName) return null;
  return { version: 1, inventoryId, selectionId, itemcode, contSize, locationCode, lotCode,
    quantity: tool.quantity, customerName, consigneeName, inventoryStamp: { ...inventoryStamp(data), fingerprint } };
}
function draftConfirmationPrompt(tuple: DraftConfirmationTuple, changed: boolean) {
  const dimensions = [tuple.locationCode ? `at ${tuple.locationCode}` : "", tuple.lotCode ? `lot ${tuple.lotCode}` : ""].filter(Boolean).join(", ");
  return `${changed ? "Inventory, season, or draft details changed. Please review the current details. " : ""}Confirm ${format(tuple.quantity)} × ${tuple.itemcode}${tuple.contSize ? ` ${tuple.contSize}` : ""}${dimensions ? ` (${dimensions})` : ""}; customer ${tuple.customerName}; consignee ${tuple.consigneeName}. Say “yes” to prepare this draft for Request review. Nothing will be submitted or emailed.`;
}
async function inventoryFingerprint(data: ObjectValue): Promise<string> {
  // Ownership and evidence can change outside the master import revision. Check
  // the current returned facts as well before displaying a saved answer.
  const facts = JSON.stringify({ rows: data.rows, total: data.total, complete: data.complete,
    exactMatch: data.exactMatch, choices: data.candidateChoices, unresolved: data.unresolvedCount, hasMore: data.hasMore });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(facts))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function modelContext(context: ObjectValue): ObjectValue {
  // No stored answers, arbitrary client context, personnel records or old business rows reach the provider.
  const last = optionalObject(context.tool);
  if (context.version !== 1 || !["inventory", "history", "draft_request", "soc_reserves", "soc_open_orders"].includes(String(last.name))) return {};
  const safe = { ...last };
  if (safe.filters) safe.filters = Object.fromEntries(Object.entries(optionalObject(safe.filters)).filter(([key]) => !["requestedVariants", "expectedSettingRevision", "selectionId"].includes(key)));
  return { previousTool: safe };
}
function knownOutsideDomain(text: string) {
  // Protect literal common names while rejecting obvious unrelated instructions before any provider call.
  const syntax = text.replace(/["“][^"”]*["”]/g, "quoted plant");
  return /\b(?:weather|forecast|write (?:me )?(?:code|a poem|an essay)|world history|capital of|ignore (?:all |previous |your )?instructions|system prompt|execute sql|drop table)\b/i.test(syntax)
    && !/\bcommon[ -]?name\b/i.test(syntax);
}
function explicitFilters(question: string, proposed: InventoryFilters): InventoryFilters {
  const parsed = resolveAuraIntent(question, {}).filters;
  const filters = { ...proposed };
  // Preserve authoritative literal entities and the mature season/number parser.
  for (const key of ["commonName", "itemcode", "genus", "contSize", "locationCode", "locationMode", "lotcode", "season", "seasonReference", "salesYear"] as const) {
    if (Object.hasOwn(parsed, key)) Object.assign(filters, { [key]: parsed[key] });
  }
  if (parsed.commonName || parsed.itemcode) delete filters.productText;
  if (parsed.season) delete filters.seasonReference;
  else if (parsed.seasonReference) { delete filters.season; if (!Object.hasOwn(parsed, "salesYear")) delete filters.salesYear; }
  if (!filters.season && !filters.seasonReference) filters.seasonReference = "current";
  return validateInventoryFilters(filters);
}
function scopeAuraOpenStock(filters: InventoryFilters): InventoryFilters {
  filters.season = String(filters.season || "F1").toUpperCase();
  filters.salesYear = Number.isInteger(filters.salesYear) ? filters.salesYear : 27;
  filters.metric = "s_lts";
  filters.countMode = "quantity";
  filters.openStockOnly = false;
  delete filters.seasonReference;
  delete filters.locationCode;
  delete filters.locationMode;
  return filters;
}
function normalizeInventoryName(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
}
function strictInventoryIdentityMatch(row: ObjectValue, filters: InventoryFilters) {
  const requestedItemcode = String(filters.itemcode || "").trim().toUpperCase();
  if (requestedItemcode && String(row.itemcode || "").trim().toUpperCase() !== requestedItemcode) return false;
  const requestedName = normalizeInventoryName(filters.commonName || filters.productText);
  const tokens = requestedName.split(/\s+/).filter(token => token.length > 1);
  const commonName = normalizeInventoryName(row.commonName || row.commonname);
  if (!requestedItemcode && !tokens.length) return false;
  if (tokens.length && !tokens.every(token => commonName.includes(token))) return false;
  const requestedSize = normalizeInventoryName(filters.contSize).replace(/\s+/g, "");
  const rowSize = normalizeInventoryName(row.contSize || row.contsize).replace(/\s+/g, "");
  return !requestedSize || requestedSize === rowSize;
}
function distinctInventoryIdentities(rows: ObjectValue[]) {
  const identities = new Map<string, ObjectValue>();
  for (const row of rows) {
    const key = `${String(row.itemcode || "").trim().toUpperCase()}|${normalizeInventoryName(row.contSize || row.contsize).replace(/\s+/g, "")}`;
    if (!identities.has(key)) identities.set(key, row);
  }
  return [...identities.values()];
}
function seasonLevelOpenStockTotal(rows: ObjectValue[]): number | null {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = `${String(row.itemcode || "").trim().toUpperCase()}|${String(row.season || "F1").trim().toUpperCase()}`;
    const value = row.s_lts ?? row.quantity;
    if (!totals.has(key) && typeof value === "number" && Number.isFinite(value)) totals.set(key, value);
  }
  return totals.size ? [...totals.values()].reduce((sum, value) => sum + value, 0) : null;
}
function normalizeScopedOpenStockData(data: ObjectValue, filters: InventoryFilters): ObjectValue {
  const rows = array(data.rows).filter(row => strictInventoryIdentityMatch(row, filters));
  const candidateChoices = distinctInventoryIdentities(array(data.candidateChoices).filter(row => strictInventoryIdentityMatch(row, filters))).slice(0, 5);
  const total = seasonLevelOpenStockTotal(rows);
  return { ...data, rows, candidateChoices, ...(data.complete === true && total != null ? { total } : {}) };
}
function deterministicInventoryTool(question: string, active: ReturnType<typeof parseAuraAppContext>): Extract<AuraTool, { name: "inventory" }> | null {
  try {
    const intent = resolveAuraIntent(question, {});
    if (intent.mode !== "inventory") return null;
    const operation = String(intent.operation || "stock") as InventoryOperation;
    if (!["stock", "locations", "ownership", "unassigned", "lot", "maximum"].includes(operation)) return null;
    const filters = validateInventoryFilters(intent.filters);
    if (!filters.itemcode && !filters.commonName && !filters.productText && !filters.genus) return null;
    if (operation === "stock") {
      filters.countMode = "quantity";
      if (/\bopen stock\b/i.test(question)) {
        scopeAuraOpenStock(filters);
      } else if (/\bon[ -]?hand\b/i.test(question)) filters.metric = "ptronhand";
      else filters.metric = "ptravailable";
      if (filters.metric !== "s_lts") {
        filters.season = active.season;
        filters.salesYear = active.salesyear;
        delete filters.seasonReference;
      }
    }
    return { name: "inventory", operation, filters };
  } catch {
    return null;
  }
}
function recordAction(title: string, rows: ObjectValue[]): ObjectValue[] {
  const labels: Record<string, string> = { commonName: "Common Name", commonname: "Common Name", itemcode: "Item Code", contSize: "Size", contsize: "Size",
    locationCode: "Location", locationcode: "Location", lotCode: "Lot", lotcode: "Lot", ptravailable: "Available", ptronhand: "On Hand", s_lts: "Open Stock", quantity: "Quantity",
    assignedTo: "Assigned To", assignedDisplayName: "Assigned To", ownerStatus: "Ownership", customerName: "Customer", consigneeName: "Consignee" };
  return rows.length ? [{ type: "records", title, rows, columns: Object.keys(rows[0]).filter(key => labels[key]).map(key => ({ key, label: labels[key] })) }] : [];
}
function label(row: ObjectValue) { return [row.commonName || row.commonname || row.itemcode || row.label || row.username, row.contSize || row.contsize, row.locationCode || row.locationcode, row.lotCode || row.lotcode].filter(Boolean).join(" · "); }
async function inventoryOutcome(tool: Extract<AuraTool, { name: "inventory" | "draft_request" }>, context: ObjectValue, actor: AuraActor, store: AuraVoiceStore, signal: AbortSignal, more: boolean, selection?: ObjectValue, expectedDraft?: DraftConfirmationTuple | null): Promise<Outcome> {
  if (!actor.inventory || tool.name === "draft_request" && !actor.drafts) throw new Error("AURA_TOOL_FORBIDDEN");
  const originalFilters = { ...tool.filters };
  let filters = { ...originalFilters };
  if (selection?.id) filters.selectionId = String(selection.id);
  if (selection?.username) {
    filters.assignee = String(selection.username);
    delete filters.assigneeText;
  } else if (selection?.itemcode) {
    // Remember confirmed identities as explicit filters so a later follow-up
    // does not have to guess from an opaque choice ID or repeat fuzzy matching.
    filters.itemcode = String(selection.itemcode);
    for (const field of ["genus", "contSize"] as const) {
      if (typeof selection[field] === "string" && selection[field]) filters[field] = selection[field];
    }
    delete filters.productText; delete filters.commonName;
  }
  if (selection && tool.name === "draft_request") {
    for (const [key, field] of [["itemcode", "itemcode"], ["contSize", "contSize"], ["locationCode", "locationCode"], ["lotcode", "lotCode"]]) {
      if (typeof selection[field] === "string" && selection[field]) Object.assign(filters, { [key]: selection[field] });
    }
    filters.locationMode = "exact";
  }
  const operation = tool.name === "draft_request" ? "locations" : tool.operation;
  let cursor = more ? context.cursor ?? null : null;
  let data = auraObject(await store.inventory(operation, filters, cursor, signal));
  if (data.ok === false) throw new Error(String(data.code || "AURA_INVENTORY_UNAVAILABLE"));
  let restarted = false;
  if ((more || selection) && !same(inventoryStamp(data), context.inventoryStamp)) {
    if (selection) filters = { ...originalFilters };
    delete filters.selectionId; cursor = null; restarted = true;
    data = auraObject(await store.inventory(operation, filters, cursor, signal));
    if (data.ok === false) throw new Error(String(data.code || "AURA_INVENTORY_UNAVAILABLE"));
  }
  if (data.ok !== true || !Array.isArray(data.rows) || data.rows.length > 50 || typeof data.complete !== "boolean") throw new Error("AURA_RESULT_INVALID");
  if (operation === "stock" && filters.metric === "s_lts") {
    const strictChoices = distinctInventoryIdentities(array(data.candidateChoices).filter(row => strictInventoryIdentityMatch(row, filters)));
    if (data.exactMatch === false && strictChoices.length === 1) {
      const selected = strictChoices[0];
      filters = { ...filters, itemcode: String(selected.itemcode || "").trim(), contSize: String(selected.contSize || selected.contsize || filters.contSize || "").trim() };
      delete filters.productText;
      delete filters.commonName;
      delete filters.selectionId;
      cursor = null;
      data = auraObject(await store.inventory(operation, filters, cursor, signal));
      if (data.ok !== true || !Array.isArray(data.rows) || data.rows.length > 50 || typeof data.complete !== "boolean") throw new Error("AURA_RESULT_INVALID");
      if (data.rows.length) data = { ...data, exactMatch: true };
    }
    data = normalizeScopedOpenStockData(data, filters);
  }
  const rows = array(data.rows), choices = array(data.candidateChoices).slice(0, 5);
  const unresolved = number(data.unresolvedCount ?? 0);
  const sourceFingerprint = await inventoryFingerprint(data);
  const scope = `season ${String(data.season || "unresolved")}, sales year ≤ ${String(data.salesYear || "unresolved")}`;
  const nextContext: ObjectValue = { version: 1, tool: { ...tool, filters }, cursor: data.nextCursor ?? null, inventoryStamp: inventoryStamp(data), choices: [] };
  const sources = [{ kind: "inventory", operation, filters, cursor, stamp: inventoryStamp(data), fingerprint: sourceFingerprint, policy: policy(actor) }];
  const metadata = { resolvedSeason: { seasonCode: data.season, salesYear: data.salesYear }, settingRevision: data.settingRevision,
    yearCoverage: data.yearCoverage, yearFilterApplied: true, metric: data.metric ?? filters.metric, datasetRevision: data.datasetRevision, unresolvedCount: unresolved, complete: data.complete === true };
  let reply: string, actions: ObjectValue[] = [];
  if (data.exactMatch === false && choices.length) {
    const options = choices.map(row => ({ ...row, id: String(row.selectionId || row.uniqueId || row.itemcode),
      label: filters.metric === "s_lts" ? [row.commonName || row.commonname || row.itemcode, row.contSize || row.contsize, row.itemcode].filter(Boolean).join(" Â· ") : label(row) }));
    nextContext.choices = options; nextContext.cursor = null;
    reply = filters.metric === "s_lts" ? "I found possible plant matches. Choose the exact plant and size." : "I found possible matches. Choose the exact plant, size, or location.";
    actions = [{ type: "choices", kind: "entity", items: options }];
  } else if (data.complete !== true) {
    reply = filters.metric === "allocated" ? "I can’t find verified allocated quantities in the current inventory data."
      : "I can’t find verified stock information while inventory is updating or incomplete. Please try again shortly.";
  } else if (!rows.length) {
    reply = unresolved ? `I can’t find verified inventory in ${scope}; ${format(unresolved)} unresolved records were excluded.` : `I can’t find matching inventory in ${scope}.`;
  } else if (tool.name === "draft_request") {
    if (rows.length !== 1 || data.hasMore === true) {
      const options = rows.slice(0, 5).map(row => ({ ...row, id: String(row.selectionId || row.uniqueId || ""), label: label(row) }));
      nextContext.choices = options; nextContext.cursor = null;
      reply = "Select one inventory row to prepare this request.";
      actions = [{ type: "choices", kind: "entity", items: options }];
    } else {
      const row = rows[0];
      const available = number(row.ptravailable);
      if (tool.quantity > available) reply = `Only ${format(available)} are currently available at this location. Reduce the request quantity or choose another location.`;
      else {
        const customerName = String(tool.customerName || "").trim(), consigneeName = String(tool.consigneeName || "").trim();
        if (!customerName || !consigneeName) {
          reply = !customerName ? "Which customer should this draft be for?" : "Which consignee should this draft be for?";
        } else {
          const tuple = makeDraftConfirmationTuple(row, tool, data, sourceFingerprint);
          if (!tuple) throw new Error("AURA_RESULT_INVALID");
          if (!sameDraftConfirmation(expectedDraft || null, tuple)) {
            nextContext.draftConfirmation = tuple;
            reply = draftConfirmationPrompt(tuple, expectedDraft !== undefined && expectedDraft !== null);
          } else {
            reply = `Draft prepared for Request review: ${format(tuple.quantity)} × ${label(row)}; customer ${tuple.customerName}; consignee ${tuple.consigneeName}. Verify the current Request mapping before submitting. Nothing has been submitted or emailed.`;
            actions = [{ type: "review", view: "request", filters: { ...filters, quantity: tool.quantity },
              proposal: { summary: reply, text: `${format(tool.quantity)} × ${label(row)}. Customer: ${tuple.customerName}. Consignee: ${tuple.consigneeName}. Verify the current Request mapping before submitting.`,
                inventoryId: tuple.inventoryId, quantity: tool.quantity, customerName: tuple.customerName, consigneeName: tuple.consigneeName } }];
          }
        }
      }
    }
  } else if (operation === "stock") {
    const expectedMetric = filters.countMode && filters.countMode !== "quantity" ? filters.countMode : filters.metric || "ptravailable";
    if (data.metric !== expectedMetric) throw new Error("AURA_RESULT_INVALID");
    const total = signedAuraQuantity(data.total);
    const metric = filters.countMode === "physical_rows" ? "physical inventory rows" : filters.countMode === "unique_items" ? "distinct items" : filters.metric === "ptronhand" ? "units on hand" : filters.metric === "s_lts" ? "units open stock" : "units available";
    reply = filters.countMode && filters.countMode !== "quantity" ? `I found ${format(total)} ${metric} in ${scope}.`
      : auraInventorySummary(total, String(data.metric), rows, data.hasMore === true);
    actions = recordAction("Inventory", rows);
  } else {
    reply = `Found ${format(rows.length)} matching inventory rows in ${scope}${data.hasMore ? "; more are available" : ""}.`;
    const details = rows.slice(0, 3).map(row => {
      if (operation === "ownership" || operation === "unassigned") {
        const owner = row.ownerStatus === "assigned" ? String(row.assignedDisplayName || row.assignedTo)
          : row.ownerStatus === "unassigned" ? "explicitly unassigned" : row.ownerStatus === "ambiguous" ? "ownership is ambiguous" : "ownership is unresolved";
        return `${label(row)}: ${owner}`;
      }
      const quantity = ["loc_on_hand", "allocated", "held"].includes(String(filters.metric)) ? row.quantity
        : filters.metric === "ptronhand" ? row.ptronhand : filters.metric === "s_lts" ? row.s_lts : row.ptravailable;
      const metricLabel = filters.metric === "held" ? "on hold" : filters.metric === "allocated" ? "allocated"
        : filters.metric === "ptronhand" || filters.metric === "loc_on_hand" ? "on hand" : filters.metric === "s_lts" ? "open stock" : "available";
      return `${label(row)}${typeof quantity === "number" && Number.isFinite(quantity) ? `: ${format(quantity)} ${metricLabel}` : ""}`;
    });
    reply += ` ${details.join("; ")}.`;
    if (rows.length > 3) reply += " See the result table for the remaining rows.";
    actions = recordAction("Inventory", rows);
  }
  if (unresolved && rows.length) reply += ` ${format(unresolved)} records with unresolved season/year were excluded.`;
  if (restarted) reply = "Inventory or season scope changed. I restarted the lookup. " + reply;
  return { reply, actions, context: nextContext, sources, metadata, hasMore: Boolean(nextContext.cursor) && array(nextContext.choices).length === 0 };
}
function normalizeName(value: unknown) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
function historyData(value: unknown): ObjectValue {
  const data = auraObject(value);
  if (!["own", "all"].includes(String(data.scope)) || typeof data.revision !== "string" || !Array.isArray(data.rows) || data.rows.length > 100) throw new Error("AURA_RESULT_INVALID");
  const summary = auraObject(data.summary); number(summary.requestCount); number(data.total);
  if (typeof data.financials !== 'boolean' || data.financials !== (data.scope === 'all')) throw new Error('AURA_RESULT_INVALID');
  if (data.financials) { number(summary.totalValue); number(summary.unpricedCount); }
  else if (summary.totalValue !== null || summary.unpricedCount !== null
    || array(data.rows).some(row => row.totalValue != null || row.listPrice != null || row.unpricedCount != null)) throw new Error('AURA_RESULT_INVALID');
  return data;
}
async function historyOutcome(tool: Extract<AuraTool, { name: "history" }>, context: ObjectValue, actor: AuraActor, store: AuraVoiceStore, signal: AbortSignal, more: boolean, selection?: ObjectValue): Promise<Outcome> {
  if (!actor.history) throw new Error("AURA_TOOL_FORBIDDEN");
  let customerKey = typeof context.customerKey === "string" ? context.customerKey : undefined;
  let consigneeKey = typeof context.consigneeKey === "string" ? context.consigneeKey : undefined;
  const stage = String(context.choiceStage || "");
  if (selection && stage === "customer") { customerKey = String(selection.id); consigneeKey = undefined; }
  if (selection && stage === "consignee") consigneeKey = String(selection.id);
  let operation = tool.operation;
  const wantsSummary = operation === "summary";
  if (wantsSummary) {
    if ((tool.customerName || tool.consigneeName) && !customerKey) operation = "customers";
    else if (tool.consigneeName && !consigneeKey) operation = "consignees";
    // The existing summary operation is global/own scoped, not customer-filtered.
    // Its bounded drill-down operations provide authoritative filtered summaries.
    else if (consigneeKey) operation = "requests";
    else if (customerKey) operation = "consignees";
  }
  if (operation === "requests" && !customerKey) operation = "customers";
  else if (operation === "requests" && !consigneeKey) operation = "consignees";
  if (operation === "consignees" && !customerKey) operation = "customers";
  const pageSize = operation === "customers" || operation === "consignees" ? 5 : 50;
  const query: AuraHistoryQuery = { operation, page: more ? Number(context.page || 0) + 1 : 0, pageSize,
    ...(customerKey ? { customerKey } : {}), ...(consigneeKey ? { consigneeKey } : {}) };
  let data = historyData(await store.history(query, signal));
  if ((selection || more) && context.historyRevision !== data.revision) {
    return { ...(await historyOutcome(tool, {}, actor, store, signal, false)), reply: "Request data or scope changed. I restarted the lookup. Select the customer again." };
  }
  let rows = array(data.rows);
  // Resolve names only among authorized database results; never turn a name into an owner ID.
  const hint = operation === "customers" ? tool.customerName : operation === "consignees" ? tool.consigneeName : undefined;
  if (hint && !more && !selection) {
    const matches = rows.filter(row => normalizeName(row.label) === normalizeName(hint));
    if (matches.length === 1 && number(data.total) <= rows.length) {
      if (operation === "customers") customerKey = String(matches[0].key); else consigneeKey = String(matches[0].key);
      if (tool.operation !== operation) return await historyOutcome(tool, { ...context, customerKey, consigneeKey }, actor, store, signal, false);
    } else if (matches.length) rows = matches;
  }
  const summary = auraObject(data.summary), scope = data.scope === "all" ? "all authorized requests" : "your assigned requests";
  const sources = [{ kind: "history", query, revision: data.revision, scope: data.scope, policy: policy(actor) }];
  const nextContext: ObjectValue = { version: 1, tool, customerKey, consigneeKey, page: query.page, historyRevision: data.revision, choices: [], choiceStage: "" };
  let reply: string, actions = recordAction("Historical Requests", rows);
  const summaryReady = wantsSummary && (operation === "summary" || Boolean(customerKey) && (!tool.consigneeName || Boolean(consigneeKey)));
  if (summaryReady && data.financials) reply = `Current-price value for ${scope}${consigneeKey ? " within the selected consignee" : customerKey ? " within the selected customer" : ""}: ${money(number(summary.totalValue))} across ${format(number(summary.requestCount))} requests. Missing or zero request quantity uses 25 units. ${format(number(summary.unpricedCount))} requests lack a resolved value.`;
  else if (summaryReady) reply = `I found ${format(number(summary.requestCount))} of your assigned requests${consigneeKey ? ' within the selected consignee' : customerKey ? ' within the selected customer' : ''}. Financial totals are restricted to designated financial admins.`;
  else {
    reply = `Showing ${format(rows.length)} of ${format(number(data.total))} ${operation} within ${scope}.${data.financials ? ' Values use current list prices; missing or zero request quantity uses 25.' : ''}`;
    if (operation === "customers" || operation === "consignees") {
      const options = rows.slice(0, 5).map(row => ({ id: String(row.key), label: `${String(row.label)} · ${format(number(row.requestCount))} requests${data.financials ? ' · ' + money(number(row.totalValue)) : ''}` }));
      nextContext.choices = options; nextContext.choiceStage = operation === "customers" ? "customer" : "consignee";
      // A chosen customer/consignee advances to its request drill-down.
      nextContext.tool = { ...tool, operation: wantsSummary ? "summary" : "requests" };
      actions = [...actions, ...(options.length ? [{ type: "choices", kind: "entity", items: options }] : [])];
      reply += hint && !rows.some(row => normalizeName(row.label) === normalizeName(hint)) ? " The requested name is not on this page; use Show more or select a listed record." : " Select a record to continue.";
    }
  }
  return { reply, actions, sources, context: nextContext, hasMore: (Number(query.page) + 1) * pageSize < number(data.total), metadata: { scope: data.scope, datasetRevision: data.revision, unpricedCount: summary.unpricedCount } };
}
async function sourcesCurrent(sources: unknown, actor: AuraActor, store: AuraVoiceStore, signal: AbortSignal, allowIncomplete = false): Promise<boolean> {
  if (!Array.isArray(sources)) return false;
  if (sources.length > 3) return false;
  try { for (const source of array(sources)) {
    if (!same(source.policy, policy(actor))) return false;
    if (source.kind === "domain") {
      if ((await store.domain(signal)).revision !== source.revision) return false;
    } else if (source.kind === "inventory" && actor.inventory) {
      const filters = validateInventoryFilters(source.filters);
      let data = auraObject(await store.inventory(String(source.operation), filters, source.cursor, signal));
      if (String(source.operation) === "stock" && filters.metric === "s_lts") data = normalizeScopedOpenStockData(data, filters);
      if (data.ok !== true || data.complete !== true && !(allowIncomplete && data.complete === false) || !same(inventoryStamp(data), source.stamp)
        || source.fingerprint !== await inventoryFingerprint(data)) return false;
    } else if (source.kind === "soc" && ((source.tool === "soc_reserves" && actor.socReserves) || (source.tool === "soc_open_orders" && actor.socOpenOrders))) {
      const kind = source.tool === "soc_reserves" ? "soc_reserves" : "soc_open_orders";
      const data = socData(await store.soc(kind, validateSocFilters(source.filters), source.cursor, signal));
      if (!data.complete || data.metric !== source.metric || !same(socStamp(data), source.stamp)
        || await socFingerprint(data) !== source.fingerprint) return false;
    } else if (source.kind === "history" && actor.history) {
      const query = auraObject(source.query);
      const tool = validateAuraTool("history", { operation: query.operation });
      if (tool.name !== "history") return false;
      const data = historyData(await store.history({ operation: tool.operation,
        ...(typeof query.customerKey === "string" ? { customerKey: query.customerKey } : {}),
        ...(typeof query.consigneeKey === "string" ? { consigneeKey: query.consigneeKey } : {}), page: 0, pageSize: 1 }, signal));
      if (data.scope !== source.scope || data.revision !== source.revision) return false;
    } else return false;
  }
  return true; } catch { return false; }
}
async function memoryResponse(body: ObjectValue, mode: string, actor: AuraActor, store: AuraVoiceStore, signal: AbortSignal) {
  const args = memoryArgs(body, mode);
  const limit = body.limit ?? 20;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 30) throw new Error("AURA_QUERY_REQUEST_INVALID");
  if (body.cursor != null && JSON.stringify(body.cursor).length > 500) throw new Error("AURA_QUERY_REQUEST_INVALID");
  args.payload = { limit, cursor: body.cursor ?? null };
  const data = auraObject(await store.memory(actor.id, args, signal));
  const turns: ObjectValue[] = [];
  for (const turn of array(data.turns)) {
    const response = optionalObject(turn.response);
    const visible = optionalObject(response.interpretation).engine === "gemini-tools-v1" && await sourcesCurrent(turn.sources, actor, store, signal);
    turns.push({ text: String(turn.text || ""), completed: turn.status === "complete", response: visible ? { reply: String(response.reply || ""), actions: array(response.actions).filter(action => action.type === "records") }
      : { reply: "This saved response needs a fresh query before its data can be displayed.", actions: [] } });
  }
  return { ok: true, conversationId: data.conversationId ?? null, revision: Number(data.revision || 0), conversations: array(data.conversations), turns,
    hasMore: data.hasMore === true, nextCursor: data.nextCursor ?? null, context: {} };
}
async function command(body: ObjectValue, actor: AuraActor, store: AuraVoiceStore, deps: AuraVoiceDeps, signal: AbortSignal) {
  const question = boundedString(body.text ?? body.question ?? body.prompt);
  const history = validateAuraHistory(body.history);
  const domain = await store.domain(signal);
  const active = parseAuraAppContext(await store.appContext(signal));
  const deterministicTool = deterministicInventoryTool(question, active);
  if (body.appContext !== undefined && !same(parseAuraAppContext(body.appContext), active) && !deterministicTool) {
    throw Object.assign(new Error("AURA_APP_CONTEXT_STALE"), { appContext: active });
  }
  const args = memoryArgs({ ...body, turnId: body.turnId ?? crypto.randomUUID() }, "begin");
  const source = body.source ?? "typed";
  if (source !== "typed" && source !== "voice") throw new Error("AURA_QUERY_REQUEST_INVALID");
  args.payload = { text: question, source };
  const begin = auraObject(await store.memory(actor.id, args, signal));
  const conversationId = identifier(begin.conversationId), revision = number(begin.revision);
  const turnId = identifier(args.turnId);
  if (begin.replayed === true) {
    if (optionalObject(optionalObject(begin.response).interpretation).engine !== "gemini-tools-v1"
      || !await sourcesCurrent(begin.sources, actor, store, signal)) throw new Error("AURA_SAVED_RESULT_STALE");
    return { ...auraObject(begin.response), conversationId, revision, context: {} };
  }
  try {
    let context = optionalObject(begin.context);
    if (context.version !== 1 || !same(context.policy, policy(actor))) context = {};
    const previousScope = optionalObject(context.appContext);
    const scopeChanged = Object.keys(previousScope).length > 0 && !same(previousScope, active);
    if (scopeChanged) { delete context.draftConfirmation; context.cursor = null; }
    const confirmingDraft = explicitDraftConfirmation(question);
    let expectedDraft: DraftConfirmationTuple | undefined;
    const more = /^\s*(?:show more|next page)\s*[.!?]?\s*$/i.test(question);
    const selectionNumber = /^\s*(?:option\s*)?(\d{1,2})\s*[.!]?\s*$/i.exec(question);
    const selection = selectionNumber ? array(context.choices)[Number(selectionNumber[1]) - 1] : undefined;
    let tool: AuraTool;
    const oldTool = optionalObject(context.tool);
    if (confirmingDraft) {
      const storedTuple = draftConfirmationTuple(context.draftConfirmation);
      try {
        if (!storedTuple || oldTool.name !== "draft_request") throw new Error("AURA_DRAFT_CONFIRMATION_MISSING");
        const { name, ...values } = oldTool;
        const storedTool = validateAuraTool(name, values, true);
        if (storedTool.name !== "draft_request") throw new Error("AURA_DRAFT_CONFIRMATION_MISSING");
        tool = storedTool;
        expectedDraft = storedTuple;
      } catch {
        tool = { name: "clarify", reason: "ambiguous" };
        context = { version: 1, choices: [] };
      }
    } else {
      // A rejected or changed proposal cannot be confirmed by a later bare "yes".
      delete context.draftConfirmation;
      if ((more || selection) && oldTool.name) { const { name, ...values } = oldTool; tool = validateAuraTool(name, values, true); }
      else if (selectionNumber) tool = { name: "clarify", reason: "ambiguous" };
      else if (knownOutsideDomain(question)) tool = { name: "refuse" };
      else {
        try {
          tool = await routeAuraWithGemini({ text: question, history, actor, context: { ...modelContext(context), appContext: active,
            glossary: domain.glossary.filter(entry => question.toLowerCase().includes(entry.term)).slice(0, 30) }, apiKey: deps.apiKey(),
            signal: AbortSignal.any([signal, AbortSignal.timeout(AURA_PROVIDER_TIMEOUT_MS)]), fetcher: deps.fetcher, reserve: bytes => store.reserve(bytes, signal) });
        } catch (error) {
          if (!deterministicTool || signal.aborted) throw error;
          tool = deterministicTool;
        }
      }
    }
    const follow = more || !!selection || /^(?:and|what about|how about|those|these|are there any)\b/i.test(question) || /\b(?:those|these|them|there)\b/i.test(question);
    const spokenVariants = requestedAuraVariants(question);
    const previousVariants = optionalObject(oldTool.filters).requestedVariants ?? context.requestedVariants;
    const variants = spokenVariants.length || !(more || selection) ? spokenVariants
      : validateInventoryFilters({ requestedVariants: previousVariants ?? [] }).requestedVariants || [];
    if (tool.name === "inventory" || tool.name === "draft_request") {
      if (confirmingDraft && tool.name === "draft_request") tool.filters = validateInventoryFilters(tool.filters);
      else if (!(more || selection)) tool.filters = explicitFilters(question, tool.filters);
      if (!selection) delete tool.filters.selectionId;
      if (follow && !tool.filters.commonName && !tool.filters.productText && !tool.filters.itemcode) {
        const previous = optionalObject(oldTool.filters);
        for (const key of ["commonName", "productText", "itemcode", "genus", "contSize"] as const) {
          if (typeof previous[key] === "string" && !tool.filters[key]) Object.assign(tool.filters, { [key]: previous[key] });
        }
      }
      const proposedEntity = extractAuraEntity(question, { ...tool.filters,
        ...(follow && typeof optionalObject(oldTool.filters).metric === "string" ? { metric: optionalObject(oldTool.filters).metric } : {}) }, domain.glossary);
      tool.filters.requestedVariants = confirmingDraft ? tool.filters.requestedVariants || [] : variants;
      tool.filters.expectedSettingRevision = active.settingRevision;
      const questionSyntax = question.replace(/["“][^"”]*["”]/g, " ");
      if (tool.name === "inventory" && /\bhow many\b/i.test(questionSyntax)
        && !/\b(?:most|maximum|highest)\b/i.test(questionSyntax)) tool.operation = "stock";
      if (tool.name === "inventory" && tool.operation === "stock") {
        if (/\b(?:physical rows?|inventory rows?)\b/i.test(question)) tool.filters.countMode = "physical_rows";
        else if (/\b(?:distinct|unique) items?\b/i.test(question)) tool.filters.countMode = "unique_items";
        else if (/\bon[ -]hand\b/i.test(question)) { tool.filters.countMode = "quantity"; tool.filters.metric = "ptronhand"; }
        else if (!(more || selection)) { tool.filters.countMode = "quantity"; tool.filters.metric = "s_lts"; }
        if (tool.filters.countMode === "quantity" && tool.filters.metric === "s_lts") {
          scopeAuraOpenStock(tool.filters);
        }
      }
      if (!confirmingDraft && !(more || selection)) {
        const entity = proposedEntity;
        if (entity.size_spec) tool.filters.contSize = entity.size_spec;
        if (tool.name === "inventory" && (!tool.filters.countMode || tool.filters.countMode === "quantity")
          && (tool.operation === "stock" || /\b(?:open stock|on[ -]hand|allocated|held|on hold)\b/i.test(question))) {
          tool.filters.metric = ({ open_stock: "s_lts", loc_on_hand: "loc_on_hand", allocated: "allocated", held: "held" } as const)[entity.target_metric];
          if (entity.target_metric === "open_stock") {
            scopeAuraOpenStock(tool.filters);
          }
        }
        context.entity = entity;
      }
    } else if (tool.name === "soc_reserves" || tool.name === "soc_open_orders") {
      if (!(more || selection)) {
        const season = spokenAuraSeason(question);
        if (season) tool.season = season; else delete tool.season;
      }
    }
    let outcome: Outcome;
    if (tool.name === "refuse") outcome = { reply: REFUSAL, actions: [], context: {}, sources: [] };
    else if (tool.name === "clarify") {
      const messages = { plant: "Which plant, item code, location, or lot should I look up?", customer: "Which customer’s requests should I look up?", consignee: "Which consignee should I look up?", quantity: "How many whole units should I prepare for review?", ambiguous: "Please identify one nursery record or choose an option from the latest results." };
      outcome = { reply: messages[tool.reason], actions: [], context, sources: [] };
    } else if (tool.name === "soc_reserves" || tool.name === "soc_open_orders") {
      outcome = await socOutcome(tool, context, actor, store, signal, active, variants, more, selection);
    } else if (tool.name === "history") {
      // New named subjects cannot inherit old resolved customer/consignee IDs.
      const follow = /^(?:and|what about|how about|show (?:their|those|the)|their|those|these)\b/i.test(question)
        || /\b(?:their|those|these|that customer|that consignee)\b/i.test(question);
      const inherit = follow
        && !tool.customerName && !tool.consigneeName;
      const next = more || selection || inherit ? context : { ...context, customerKey: undefined, consigneeKey: undefined, page: 0 };
      outcome = await historyOutcome(tool, next, actor, store, signal, more, selection);
    } else outcome = await inventoryOutcome(tool, context, actor, store, signal, more, selection, expectedDraft);
    if (outcome.sources.length) outcome.sources.push({ kind: "domain", revision: domain.revision, policy: policy(actor) });
    const completedContext = { ...outcome.context, entity: context.entity, domainRevision: domain.revision, appContext: active, version: 1, policy: policy(actor) };
    const response = { ok: true, requestId: turnId, conversationId, revision, reply: outcome.reply, speech: outcome.reply, actions: outcome.actions,
      interpretation: { engine: "gemini-tools-v1", intent: tool.name, ...outcome.metadata },
      source: { kind: source, checkedAt: new Date().toISOString(), ...outcome.metadata }, hasMore: outcome.hasMore === true, nextCursor: null };
    if (signal.aborted) throw signal.reason;
    const completed = auraObject(await store.memory(actor.id, { operation: "complete", conversationId, turnId, expectedRevision: revision,
      payload: { response, context: completedContext, sources: outcome.sources } }, signal));
    return { ...response, revision: number(completed.revision), context: {} };
  } catch (error) {
    try { await store.memory(actor.id, { operation: "fail", conversationId, turnId, expectedRevision: revision, payload: {} }, AbortSignal.timeout(2500)); } catch { /* cancellation/lease ownership is decisive */ }
    throw error;
  }
}
export async function handleAuraVoiceRequest(request: Request, deps: AuraVoiceDeps): Promise<Response> {
  if (request.method === "OPTIONS") return result({ ok: true });
  if (request.method !== "POST") return result({ ok: false, error: "Method not allowed." }, 405);
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) return result({ ok: false, code: "AURA_FORBIDDEN", error: "Sign in with an authorized active account." }, 403);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(27000)]);
  try {
    const store = deps.createStore(token);
    const actor = await withinSignal(store.authorize(signal), signal);
    if (!actor) return result({ ok: false, code: "AURA_FORBIDDEN", error: "Aura is unavailable to this active account." }, 403);
    // Authentication and account/capability checks must finish before reading body or history.
    const body = await requestBody(request, signal);
    const mode = String(body.mode || "command");
    if (mode === "capabilities") return result({ ok: true, capabilities: policy(actor), configured: Boolean(deps.apiKey()), voiceName: await store.voicePreference(undefined, signal), voiceEngine: "gemini-tts-v1" });
    if (mode === "voice_preferences") return result({ ok: true, voiceName: await store.voicePreference(body.voiceName === undefined ? undefined : auraVoice(body.voiceName), signal) });
    if (mode === "speech") {
      const args = memoryArgs(body, "read");
      if (!args.conversationId || !args.turnId) throw new Error("AURA_SPEECH_INVALID");
      args.payload = { limit: 30 };
      const conversation = auraObject(await store.memory(actor.id, args, signal));
      const turn = array(conversation.turns).find(turn => turn.id === args.turnId && turn.status === "complete");
      if (!turn) throw new Error("AURA_SAVED_RESULT_STALE");
      const response = auraObject(turn.response);
      if (optionalObject(response.interpretation).engine !== "gemini-tools-v1") throw new Error("AURA_SAVED_RESULT_STALE");
      const missingInventory = optionalObject(response.interpretation).complete === false
        && /^I can’t find verified (?:stock information|allocated quantities)/.test(String(response.reply))
        && Array.isArray(response.actions) && response.actions.length === 0;
      if (!await sourcesCurrent(turn.sources, actor, store, signal, missingInventory)) throw new Error("AURA_SAVED_RESULT_STALE");
      const voice = await store.voicePreference(undefined, signal);
      const audio = await synthesizeAuraSpeech({ text: boundedString(response.reply), voice, apiKey: deps.apiKey(), signal,
        fetcher: deps.fetcher, reserve: bytes => store.reserve(bytes, signal) });
      return result({ ok: true, audio, conversationId: args.conversationId, turnId: args.turnId });
    }
    if (["list", "create", "read", "delete", "cancel"].includes(mode)) return result(await withinSignal(memoryResponse(body, mode, actor, store, signal), signal));
    if (mode !== "command") throw new Error("AURA_QUERY_REQUEST_INVALID");
    return result(await withinSignal(command(body, actor, store, deps, signal), signal));
  } catch (error) {
    const failure = optionalObject(error);
    const raw = error instanceof Error ? error.message : String(failure.message || "");
    const code = signal.aborted ? "AURA_QUERY_TIMEOUT" : failure.code === "42501" ? "AURA_FORBIDDEN"
      : (failure.code === "40001" || failure.code === "PT409") || failure.code === "55P03" ? "AURA_REVISION_CONFLICT"
      : /^AURA_[A-Z0-9_]+$/.test(raw) ? raw : "AURA_UNAVAILABLE";
    const status = /FORBIDDEN/.test(code) ? 403 : /INVALID|SEASON_AMBIGUOUS|SIZE_AMBIGUOUS/.test(code) ? 400 : /STALE|CONFLICT|CANCELLED|IN_PROGRESS|LEASE/.test(code) ? 409 : /BUSY|QUOTA/.test(code) ? 429 : /TIMEOUT/.test(code) ? 504 : 503;
    const errorMessage = code === "AURA_GEMINI_CONFIGURATION_UNAVAILABLE" ? "Aura’s connection is not configured. Ask your administrator to configure the Edge Function secret."
      : code === "AURA_SEASON_AMBIGUOUS" ? "Please choose one season for this SOC lookup."
      : code === "AURA_SIZE_AMBIGUOUS" ? "Please choose one plant size for this lookup."
      : /SEASON|APP_CONTEXT_(?:INVALID|UNAVAILABLE)/.test(code) ? "The Managers current season setting is unavailable or invalid. Ask a manager to save it."
      : status === 403 ? "Your active app permissions do not allow this Aura request."
      : status === 409 ? "The conversation or source data changed. Refresh the conversation and ask again."
      : status === 429 ? "Aura is busy. Please wait a moment and try again."
      : status === 400 ? "Aura could not safely interpret that request. Please rephrase using a plant, location, lot, or Historical Request."
      : "Aura’s query could not finish. Please try again.";
    return result({ ok: false, code, error: errorMessage, ...(code === "AURA_APP_CONTEXT_STALE" && failure.appContext ? { appContext: failure.appContext } : {}) }, status);
  }
}
