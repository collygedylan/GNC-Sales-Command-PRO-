import { auraObject, type AuraActor, type AuraTool, type SocFilters, type SocToolName } from "./aura-gemini.ts";
import type { AuraVoiceStore } from "./aura-voice-handler.ts";
import { signedAuraQuantity, type AuraAppContext } from "./aura-voice-scope.ts";

type ObjectValue = Record<string, unknown>;
type SocTool = Extract<AuraTool, { name: SocToolName }>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
export function socStamp(data: ObjectValue) {
  return { season: data.season, settingRevision: data.settingRevision, datasetRevision: data.datasetRevision, mappingRevision: data.mappingRevision };
}
export async function socFingerprint(data: ObjectValue): Promise<string> {
  const facts = JSON.stringify({ rows: data.rows, total: data.total, complete: data.complete, metric: data.metric,
    choices: data.candidateChoices, unresolvedCount: data.unresolvedCount, hasMore: data.hasMore });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(facts))))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function socData(value: unknown): ObjectValue {
  const data = auraObject(value);
  if (data.ok === false) throw new Error(String(data.code || "AURA_SOC_UNAVAILABLE"));
  if (data.ok !== true || !Array.isArray(data.rows) || data.rows.length > 50 || typeof data.complete !== "boolean"
    || !data.rows.every(row => row && typeof row === "object" && !Array.isArray(row))
    || !["remaining_quantity", "ordered_quantity"].includes(String(data.metric)) || data.yearFilterApplied !== false
    || !/^(F1|S1|U[123]|X|Y|Z)$/.test(String(data.season))) throw new Error("AURA_RESULT_INVALID");
  if (data.complete) signedAuraQuantity(data.total);
  return data;
}
export async function socOutcome(tool: SocTool, context: ObjectValue, actor: AuraActor, store: AuraVoiceStore,
  signal: AbortSignal, active: AuraAppContext, requestedVariants: SocFilters["requestedVariants"], more: boolean, selection?: ObjectValue) {
  if (!(tool.name === "soc_reserves" ? actor.socReserves : actor.socOpenOrders)) throw new Error("AURA_TOOL_FORBIDDEN");
  const { name, ...fields } = tool;
  let filters: SocFilters = { ...fields, season: fields.season || active.season, requestedVariants, expectedSettingRevision: active.settingRevision };
  if (more || selection) {
    const previous = object(context.socFilters);
    for (const key of ["customerId", "consigneeId"] as const) {
      const value = selection?.[key] ?? previous[key];
      if (typeof value === "string" && value.length && value.length <= 500) filters[key] = value;
    }
  }
  let cursor = more ? context.cursor ?? null : null;
  let data = socData(await store.soc(name, filters, cursor, signal));
  let restarted = false;
  if ((more || selection) && JSON.stringify(socStamp(data)) !== JSON.stringify(context.socStamp)) {
    filters = { ...fields, season: fields.season || active.season, requestedVariants, expectedSettingRevision: active.settingRevision };
    cursor = null; restarted = true;
    data = socData(await store.soc(name, filters, cursor, signal));
  }
  const choices = Array.isArray(data.candidateChoices) ? data.candidateChoices.slice(0, 5).map(auraObject) : [];
  const rows = data.rows as unknown[];
  const metric = name === "soc_reserves" ? "remaining_quantity" : "ordered_quantity";
  if (data.metric !== metric) throw new Error("AURA_RESULT_INVALID");
  const metadata = { metric, resolvedSeason: { seasonCode: data.season }, settingRevision: data.settingRevision,
    datasetRevision: data.datasetRevision, mappingRevision: data.mappingRevision, yearCoverage: "unavailable", yearFilterApplied: false,
    complete: data.complete, unresolvedCount: data.unresolvedCount ?? 0 };
  const actions: ObjectValue[] = [];
  let reply: string;
  if (choices.length) {
    reply = `Choose the exact ${data.choiceKind === "consignee" ? "consignee" : "customer"} for this SOC lookup.`;
    if (data.candidateChoicesTruncated === true) reply += " More than five identities match; narrow the name if yours is not listed.";
    actions.push({ type: "choices", kind: "entity", items: choices.map((choice, index) => ({ ...choice, id: String(index + 1) })) });
  } else if (!data.complete) reply = "I can’t find a verified total while the SOC feed or its quantities are incomplete.";
  else if (!rows.length) reply = "I can’t find matching customer inventory in the current SOC feed.";
  else {
    const row = auraObject(rows[0]);
    const total = new Intl.NumberFormat("en-US").format(signedAuraQuantity(data.total));
    const names = [row.customerName, row.commonname, row.contsize];
    if (names.some(value => typeof value !== "string" || !value.trim())) throw new Error("AURA_RESULT_INVALID");
    reply = `${row.customerName}${tool.consigneename && typeof row.consigneeName === "string" ? ` / ${row.consigneeName}` : ""}: ${total} ${name === "soc_reserves" ? "remaining on reserve (ordered minus shipped)" : "ordered on open orders"} for ${row.commonname} ${row.contsize}, season ${data.season}.`;
    if (rows.length) actions.push({ type: "records", title: name === "soc_reserves" ? "SOC Reserves" : "SOC Open Orders", rows, columns: Object.keys(auraObject(rows[0])) });
  }
  reply += " Sales-year filtering does not apply to this SOC feed.";
  if (restarted) reply = "The source or season changed. I restarted the lookup. " + reply;
  return { reply, actions, metadata, hasMore: data.hasMore === true && !choices.length,
    context: { version: 1, tool, socFilters: filters, socStamp: socStamp(data), requestedVariants,
      cursor: choices.length ? null : data.nextCursor ?? null, choices },
    sources: [{ kind: "soc", tool: name, filters, cursor, stamp: socStamp(data), fingerprint: await socFingerprint(data), metric, policy: {
      id: actor.id, username: actor.username, role: actor.role, inventory: actor.inventory, history: actor.history, drafts: actor.drafts,
      socReserves: actor.socReserves === true, socOpenOrders: actor.socOpenOrders === true } }] };
}
