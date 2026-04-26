import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getRoleAccessState, normalizeUsername, readAppSessionFromRequest } from "../_shared/app-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gnc-session, x-app-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = String(Deno.env.get("SUPABASE_URL") || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const OPENAI_API_KEY = String(Deno.env.get("OPENAI_API_KEY") || "").trim();
const OPENAI_MODEL = String(Deno.env.get("LEAF_ASSISTANT_MODEL") || "gpt-4.1-mini").trim();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Intent = {
  question: string;
  normalizedQuestion: string;
  dataset: "master" | "reserves" | "request" | "sales-office";
  itemPhrase: string;
  tokens: string[];
  size: string;
  priority: string;
  lot: string;
  wantsLocation: boolean;
  wantsQuantity: boolean;
  wantsPriorityRows: boolean;
};

type MatchRow = {
  dataset: string;
  uniqueId: string;
  commonName: string;
  itemCode: string;
  contSize: string;
  location: string;
  lot: string;
  priority: string;
  qty: number;
  rawQty: string;
  photoLink: string;
  score: number;
};

const DATASET_QUERY_CONFIG: Record<string, {
  select: string;
  searchFields: string[];
  photoFields: string[];
}> = {
  v2_master_inventory: {
    select: "unique_id,commonname,itemcode,contsize,priority,ptravailable,locationcode,lotcode,loc_match_qty,photo_link",
    searchFields: ["commonname", "itemcode"],
    photoFields: ["photo_link", "PHOTO_LINK"],
  },
  v2_reserves: {
    select: "unique_id,commonname,itemcode,contsize,lotcode,priority,ptravailable,locationcode,customername,consigneename,salesrepname,quantityordered,photo_link",
    searchFields: ["commonname", "itemcode", "customername", "consigneename", "salesrepname"],
    photoFields: ["photo_link", "PHOTO_LINK"],
  },
  v2_active_request: {
    select: "unique_id,commonname,itemcode,contsize,lotcode,priority,ptravailable,locationcode,requested_by,request_folder,req_photo_link",
    searchFields: ["commonname", "itemcode", "requested_by", "request_folder"],
    photoFields: ["req_photo_link", "REQ_PHOTO_LINK", "photo_link", "PHOTO_LINK"],
  },
  v2_sales_office: {
    select: "unique_id,commonname,itemcode,contsize,lotcode,priority,ptravailable,locationcode,order_customer,order_folder,photo_link",
    searchFields: ["commonname", "itemcode", "order_customer", "order_folder"],
    photoFields: ["photo_link", "PHOTO_LINK"],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

function ensureServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getFirstRowValue(row: Record<string, unknown>, keys: string[] = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (value === undefined || value === null) continue;
    const text = compactText(String(value));
    if (text) return text;
  }
  return "";
}

function escapeLike(value = "") {
  return String(value || "").replace(/[%*,()]/g, "").trim();
}

function asNumber(value: unknown) {
  const cleaned = String(value ?? "").replace(/[^0-9.-]+/g, "").trim();
  if (!cleaned) return Number.NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatQty(value: number) {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value % 1) < 0.001) return String(Math.round(value));
  return value.toFixed(2);
}

function buildUserMatchKeys(session: { username?: string; displayName?: string }) {
  const rawValues = [session.username, session.displayName]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const keys = new Set<string>();
  rawValues.forEach((value) => {
    const normalized = normalizeText(value);
    if (normalized) keys.add(normalized);
    const compact = normalized.replace(/\s+/g, "");
    if (compact) keys.add(compact);
    const pieces = normalized.split(" ").filter(Boolean);
    if (pieces.length > 1) {
      keys.add(pieces.join(" "));
      keys.add(pieces.join(", "));
      keys.add(`${pieces[pieces.length - 1]} ${pieces[0]}`.trim());
      keys.add(`${pieces[pieces.length - 1]}, ${pieces[0]}`.trim());
    }
    const usernameKey = normalizeUsername(value);
    if (usernameKey) keys.add(usernameKey.replace(/_/g, " "));
  });
  return Array.from(keys).filter(Boolean);
}

function matchesScopedUser(fieldValue: unknown, userKeys: string[]) {
  if (!userKeys.length) return false;
  const normalizedField = normalizeText(String(fieldValue || ""));
  if (!normalizedField) return false;
  return userKeys.some((key) => normalizedField.includes(key));
}

function buildIntent(question: string): Intent {
  const normalizedQuestion = normalizeText(question);
  const sizeMatch = normalizedQuestion.match(/\b\d+\s*(?:dp|g|gal|bb|b b|qt|pot|cf|ltr|l)\b/i);
  const priorityMatch = normalizedQuestion.match(/\bpriority\s*([0-9]+)\b/i);
  const lotMatch = normalizedQuestion.match(/\blot\s+([a-z0-9.\-]+)\b/i);
  let dataset: Intent["dataset"] = "master";
  if (/\breserve|customer|consignee|sales rep\b/.test(normalizedQuestion)) dataset = "reserves";
  else if (/\brequest|req\b/.test(normalizedQuestion)) dataset = "request";
  else if (/\bsales office|order\b/.test(normalizedQuestion)) dataset = "sales-office";

  const filler = /\b(hey leaf|leaf|where is|where are|how many|how much|do we have|show me|find|on|in|for|there|the|a|an|please|priority\s*[0-9]+|lot\s+[a-z0-9.\-]+|\d+\s*(?:dp|g|gal|bb|b b|qt|pot|cf|ltr|l)|reserve|reserves|request|requests|sales office|order|orders|qty|quantity|there)\b/gi;
  const stripped = compactText(question.replace(filler, " "));
  const tokens = normalizeText(stripped)
    .split(" ")
    .filter((token) => token.length > 1 && !new Set(["is", "are", "of", "to", "and"]).has(token))
    .slice(0, 6);

  return {
    question: compactText(question),
    normalizedQuestion,
    dataset,
    itemPhrase: compactText(stripped),
    tokens,
    size: compactText(sizeMatch?.[0] || "").toUpperCase().replace(/\s+/g, ""),
    priority: compactText(priorityMatch?.[1] || ""),
    lot: compactText(lotMatch?.[1] || "").toUpperCase(),
    wantsLocation: /\bwhere|location|loc\b/.test(normalizedQuestion),
    wantsQuantity: /\bhow many|qty|quantity|available|have\b/.test(normalizedQuestion),
    wantsPriorityRows: /\bpriority\b/.test(normalizedQuestion),
  };
}

async function maybePhraseAnswer(answer: string, matches: MatchRow[], sourceLabel: string, question: string) {
  if (!OPENAI_API_KEY || !answer) return answer;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "text",
                text: "You are Leaf, a grounded Greenleaf inventory assistant. Rephrase the provided answer briefly and operationally. Do not invent rows, quantities, or locations. Keep it under 80 words.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  question,
                  draftAnswer: answer,
                  sourceLabel,
                  matches: matches.slice(0, 6),
                }),
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return answer;
    const payload = await response.json();
    const outputText = Array.isArray(payload?.output)
      ? payload.output.flatMap((entry: any) => Array.isArray(entry?.content) ? entry.content : []).find((entry: any) => entry?.type === "output_text")?.text
      : "";
    return compactText(outputText || answer);
  } catch (_error) {
    return answer;
  }
}

async function fetchRows(table: string, intent: Intent) {
  const config = DATASET_QUERY_CONFIG[table];
  if (!config) throw new Error(`Unsupported assistant dataset: ${table}`);
  let query = supabase
    .from(table)
    .select(config.select)
    .limit(table === "v2_master_inventory" || table === "v2_reserves" ? 500 : 400);
  const firstToken = escapeLike(intent.tokens[0] || intent.itemPhrase || "");
  if (firstToken) {
    query = query.or(config.searchFields.map((field) => `${field}.ilike.*${firstToken}*`).join(","));
  }
  if (intent.size) query = query.ilike("contsize", `%${intent.size}%`);
  if (intent.priority) query = query.eq("priority", intent.priority);
  if (intent.lot) query = query.ilike("lotcode", `%${intent.lot}%`);
  const { data, error } = await query;
  if (error) throw new Error(`${table} query failed: ${String(error.message || error || "").trim()}`);
  return Array.isArray(data) ? data : [];
}

function scoreAndNormalizeRows(rows: Record<string, unknown>[], intent: Intent, datasetLabel: string) {
  const tokens = intent.tokens.map((token) => normalizeText(token)).filter(Boolean);
  return rows.map((row) => {
    const datasetConfig = DATASET_QUERY_CONFIG[String(row.__leaf_table || "")] || null;
    const commonName = compactText(String(row.commonname || row.COMMONNAME || ""));
    const itemCode = compactText(String(row.itemcode || row.ITEMCODE || ""));
    const contSize = compactText(String(row.contsize || row.CONTSIZE || "")).toUpperCase().replace(/\s+/g, "");
    const location = compactText(String(row.locationcode || row.LOCATIONCODE || ""));
    const lot = compactText(String(row.lotcode || row.LOTCODE || "")).toUpperCase();
    const priority = compactText(String(row.priority || row.PRIORITY || ""));
    const optionalSearchFields = datasetConfig
      ? datasetConfig.searchFields.map((field) => row[field] ?? row[field.toUpperCase()])
      : [];
    const haystack = normalizeText([commonName, itemCode, ...optionalSearchFields].filter(Boolean).join(" "));
    let score = 0;
    if (!tokens.length && intent.itemPhrase) {
      if (haystack.includes(normalizeText(intent.itemPhrase))) score += 18;
    }
    tokens.forEach((token) => {
      if (haystack.includes(token)) score += 8;
    });
    if (tokens.length && tokens.every((token) => haystack.includes(token))) score += 16;
    if (intent.size && contSize === intent.size) score += 10;
    if (intent.priority && priority === intent.priority) score += 10;
    if (intent.lot && lot.includes(intent.lot)) score += 8;
    if (!commonName && !itemCode) score -= 4;
    const qtySource = row.quantityordered ?? row.ptravailable ?? row.PTRAVAILABLE ?? row.order_qty ?? row.order_reserve;
    const qtyNumber = asNumber(qtySource);
    return {
      dataset: datasetLabel,
      uniqueId: compactText(String(row.unique_id || row.UNIQUE_ID || "")),
      commonName: commonName || itemCode || "Unknown item",
      itemCode,
      contSize,
      location,
      lot,
      priority,
      qty: Number.isFinite(qtyNumber) ? qtyNumber : 0,
      rawQty: compactText(String(qtySource ?? "")),
      photoLink: getFirstRowValue(row, datasetConfig?.photoFields || ["photo_link", "PHOTO_LINK"]),
      score,
    } as MatchRow;
  }).filter((row) => row.score > 0);
}

function buildAnswer(intent: Intent, matches: MatchRow[], datasetLabel: string) {
  if (!matches.length) {
    const askText = intent.itemPhrase || intent.question;
    return {
      answer: `I could not find a matching ${datasetLabel.toLowerCase()} result for "${askText}".`,
      matches: [],
      needsClarification: false,
      clarificationPrompt: "",
      sourceLabel: `Source: ${datasetLabel}`,
    };
  }

  const sizeSet = new Set(matches.map((match) => match.contSize).filter(Boolean));
  if (!intent.size && sizeSet.size > 1 && matches.length > 1) {
    return {
      answer: `I found ${matches.length} possible ${datasetLabel.toLowerCase()} matches for ${matches[0].commonName}, but there are multiple sizes.`,
      matches: matches.slice(0, 6),
      needsClarification: true,
      clarificationPrompt: `Which size do you want for ${matches[0].commonName}? I found ${Array.from(sizeSet).slice(0, 6).join(", ")}.`,
      sourceLabel: `Source: ${datasetLabel}`,
    };
  }

  const totalQty = matches.reduce((sum, match) => sum + (Number.isFinite(match.qty) ? match.qty : 0), 0);
  const topLocations = matches
    .map((match) => {
      const parts = [];
      if (match.location) parts.push(match.location);
      if (Number.isFinite(match.qty)) parts.push(formatQty(match.qty));
      return parts.join(" ");
    })
    .filter(Boolean)
    .slice(0, 4);

  const topic = [matches[0].commonName, matches[0].contSize].filter(Boolean).join(" ").trim();
  let defaultAnswer = `I found ${matches.length} ${datasetLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"}.`;
  if (intent.wantsLocation && intent.wantsQuantity) {
    defaultAnswer = `I found ${matches.length} ${datasetLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} at ${topLocations.join(", ") || "the matched locations"}, with ${formatQty(totalQty)} total available.`;
  } else if (intent.wantsLocation) {
    defaultAnswer = `I found ${matches.length} ${datasetLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} at ${topLocations.join(", ") || "the matched locations"}.`;
  } else if (intent.wantsQuantity) {
    defaultAnswer = `I found ${matches.length} ${datasetLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} with ${formatQty(totalQty)} total available.`;
  }

  return {
    answer: defaultAnswer,
    matches: matches.slice(0, 8),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: `Source: ${datasetLabel}`,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed.", 405);

  try {
    ensureServerConfig();
    const session = await readAppSessionFromRequest(req);
    if (!session) return errorResponse("Unauthorized", 401);
    const access = getRoleAccessState(session.role);
    if (!(access.isAdmin || access.isRep || access.isQcSupervisor || access.isQc)) {
      return errorResponse("Unauthorized", 403);
    }

    const payload = await req.json().catch(() => ({}));
    const question = compactText(String(payload?.question || ""));
    if (!question) return errorResponse("Question is required.", 400);

    const intent = buildIntent(question);
    const tableMap = {
      master: { table: "v2_master_inventory", label: "Drive inventory" },
      reserves: { table: "v2_reserves", label: "Reserves" },
      request: { table: "v2_active_request", label: "Requests" },
      "sales-office": { table: "v2_sales_office", label: "Sales Office" },
    } as const;
    const datasetConfig = tableMap[intent.dataset] || tableMap.master;

    if (intent.dataset === "request" && !(access.isAdmin || access.isRep)) {
      return errorResponse("You do not have access to request answers.", 403);
    }
    if (intent.dataset === "sales-office" && !(access.isAdmin || access.isRep)) {
      return errorResponse("You do not have access to sales office answers.", 403);
    }
    if (intent.dataset === "reserves" && !(access.isAdmin || access.isRep)) {
      return errorResponse("You do not have access to reserve answers.", 403);
    }
    if (intent.dataset === "master" && !(access.isAdmin || access.isRep || access.isQcSupervisor)) {
      return errorResponse("You do not have access to inventory answers.", 403);
    }

    let rows = (await fetchRows(datasetConfig.table, intent)).map((row) => ({ ...row, __leaf_table: datasetConfig.table }));
    if (access.isRep && datasetConfig.table === "v2_reserves") {
      const userKeys = buildUserMatchKeys(session);
      rows = rows.filter((row) => matchesScopedUser(row.salesrepname || row.SALESREPNAME, userKeys));
    }
    if (access.isRep && datasetConfig.table === "v2_active_request") {
      const userKeys = buildUserMatchKeys(session);
      rows = rows.filter((row) => matchesScopedUser(row.requested_by || row.REQUESTED_BY, userKeys));
    }

    const matches = scoreAndNormalizeRows(rows, intent, datasetConfig.label)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.qty - a.qty;
      });

    const answerPayload = buildAnswer(intent, matches, datasetConfig.label);
    answerPayload.answer = await maybePhraseAnswer(answerPayload.answer, answerPayload.matches as MatchRow[], answerPayload.sourceLabel, question);

    return jsonResponse(answerPayload, 200);
  } catch (error) {
    console.error("inventory-assistant failed", {
      error: String(error && (error as Error).message || error || "").trim(),
    });
    return errorResponse("Leaf could not answer that question right now.", 500, {
      details: String(error && (error as Error).message || error || "").trim(),
    });
  }
});
