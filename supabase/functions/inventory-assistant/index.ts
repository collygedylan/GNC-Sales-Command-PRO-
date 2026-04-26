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

type DatasetKey =
  | "master"
  | "reserves"
  | "requests"
  | "sales-office"
  | "docks"
  | "dock-team"
  | "future";

type IntentMode =
  | "lookup"
  | "list"
  | "dock-lookup"
  | "dock-hold-list"
  | "reserve-owners"
  | "request-draft"
  | "future-crop";

type Intent = {
  question: string;
  normalizedQuestion: string;
  itemPhrase: string;
  questionTokens: string[];
  itemTokens: string[];
  size: string;
  priority: string;
  lot: string;
  salesRep: string;
  customer: string;
  consignee: string;
  wantsLocation: boolean;
  wantsQuantity: boolean;
  wantsPriorityRows: boolean;
  wantsHoldRows: boolean;
  markerToken: string;
  domains: DatasetKey[];
  mode: IntentMode;
};

type MatchRow = {
  dataset: string;
  uniqueId: string;
  masterId: string;
  commonName: string;
  itemCode: string;
  contSize: string;
  location: string;
  lot: string;
  priority: string;
  qty: number;
  rawQty: string;
  sLts: number;
  hold: string;
  customer: string;
  consignee: string;
  salesRep: string;
  requestFolder: string;
  dockNum: string;
  stopNumber: string;
  tripNumber: string;
  note: string;
  datasetKey: DatasetKey;
  score: number;
};

type LeafAction = {
  type: "request-draft";
  itemLabel: string;
  salesRep: string;
  requestedBy: string;
  customer: string;
  customerName: string;
  customerDisplay: string;
  consignee: string;
  consigneeName: string;
  summary: string;
  recommendedSource: Record<string, unknown>;
  fallbackSources: Record<string, unknown>[];
};

type LeafResponse = {
  answer: string;
  matches: Record<string, unknown>[];
  needsClarification: boolean;
  clarificationPrompt: string;
  sourceLabel: string;
  action?: LeafAction | null;
};

const TABLE_LABELS: Record<DatasetKey, string> = {
  master: "Drive inventory",
  reserves: "Reserves",
  requests: "Requests",
  "sales-office": "Sales Office",
  docks: "Docks",
  "dock-team": "Dock Status",
  future: "Future Crop",
};

const TABLE_NAMES: Record<DatasetKey, string> = {
  master: "v2_master_inventory",
  reserves: "v2_reserves",
  requests: "v2_active_request",
  "sales-office": "v2_sales_office",
  docks: "v2_soc_master",
  "dock-team": "v2_dock_team_status",
  future: "v2_master_inventory",
};

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

const STOP_WORDS = new Set([
  "a", "about", "all", "an", "and", "any", "app", "are", "ask", "at", "customer", "customers",
  "dock", "docks", "find", "for", "future", "give", "has", "have", "hey", "hold", "holds", "how",
  "i", "if", "in", "inventory", "is", "it", "item", "items", "leaf", "list", "look", "me", "module",
  "modules", "on", "one", "please", "positive", "priority", "rep", "reserve", "reserves", "sales",
  "show", "source", "sources", "stock", "tell", "that", "the", "their", "there", "these", "this",
  "to", "use", "what", "where", "which", "who", "with"
]);

const FUTURE_LOT_SUFFIXES = ["F1", "U1", "U2", "U3"];
const SPOKEN_ALIAS_MAP: Record<string, string[]> = {
  incredible: ["incrediball"],
  incredable: ["incrediball"],
  hydrangea: ["hydrangea"],
  hydragea: ["hydrangea"],
  hydrengea: ["hydrangea"],
  bugloss: ["bugloss"],
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

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeQuestionText(value = "") {
  let text = compactText(String(value || "").toLowerCase());
  Object.entries(NUMBER_WORDS).forEach(([word, digit]) => {
    text = text.replace(new RegExp(`\\bpriority\\s+${word}\\b`, "g"), `priority ${digit}`);
    text = text.replace(new RegExp(`\\b${word}\\s+dp\\b`, "g"), `${digit}dp`);
  });
  text = text
    .replace(/\b3\s*d\s*p\b/g, "3dp")
    .replace(/\bthree\s+d\s+p\b/g, "3dp")
    .replace(/\b2\s*d\s*p\b/g, "2dp")
    .replace(/\btwo\s+d\s+p\b/g, "2dp")
    .replace(/\bsales\s+rep\b/g, "salesrep")
    .replace(/\bnew\s+crop\b/g, "newcrop")
    .replace(/\bfuture\s+crop(?:s)?\b/g, "futurecrop")
    .replace(/\s+/g, " ");
  return text.trim();
}

function normalizeText(value = "") {
  return normalizeQuestionText(String(value || ""))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function getRowValue(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (!key) continue;
    const value = row?.[key];
    if (value === undefined || value === null) continue;
    const text = compactText(String(value));
    if (text) return text;
  }
  return "";
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

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = compactText(String(value ?? ""));
    if (text) return text;
  }
  return "";
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

function extractFieldPhrase(question: string, markers: string[]) {
  const normalized = normalizeQuestionText(question);
  for (const marker of markers) {
    const idx = normalized.indexOf(marker);
    if (idx === -1) continue;
    const slice = normalized.slice(idx + marker.length).trim();
    if (!slice) continue;
    const value = slice
      .split(/\b(?:customer|consignee|salesrep|rep|item|with|that|using|use|and|if)\b/i)[0]
      .trim();
    if (value) return compactText(value);
  }
  return "";
}

function extractSize(normalizedQuestion: string) {
  const sizeMatch = normalizedQuestion.match(/\b\d+(?:dp|g|gal|bb|qt|pot|cf|ltr|l)\b/i);
  return compactText(sizeMatch?.[0] || "").toUpperCase();
}

function extractPriority(normalizedQuestion: string) {
  const priorityMatch = normalizedQuestion.match(/\bpriority\s*([0-9]+)\b/i);
  return compactText(priorityMatch?.[1] || "");
}

function extractLot(normalizedQuestion: string) {
  const lotMatch = normalizedQuestion.match(/\blot\s+([a-z0-9.\-]+)\b/i);
  return compactText(lotMatch?.[1] || "").toUpperCase();
}

function buildQuestionTokens(normalizedQuestion: string) {
  return tokenize(normalizedQuestion).filter((token) => token.length > 1);
}

function expandAliasTokens(tokens: string[] = []) {
  const expanded = new Set<string>();
  (tokens || []).forEach((token) => {
    const safeToken = String(token || "").trim().toLowerCase();
    if (!safeToken) return;
    expanded.add(safeToken);
    const aliases = SPOKEN_ALIAS_MAP[safeToken] || [];
    aliases.forEach((alias) => {
      const safeAlias = String(alias || "").trim().toLowerCase();
      if (safeAlias) expanded.add(safeAlias);
    });
  });
  return Array.from(expanded);
}

function buildIntent(question: string): Intent {
  const safeQuestion = compactText(question);
  const normalizedQuestion = normalizeQuestionText(safeQuestion);
  const wantsLocation = /\bwhere\b|\blocation\b|\bwhich dock\b|\bwhat dock\b/.test(normalizedQuestion);
  const wantsQuantity = /\bhow many\b|\bqty\b|\bquantity\b|\bavailable\b|\bhow much\b/.test(normalizedQuestion);
  const wantsHoldRows = /\bhold\b|\bon hold\b|\bholdstop\b/.test(normalizedQuestion);
  const wantsPriorityRows = /\bpriority\b/.test(normalizedQuestion);
  const size = extractSize(normalizedQuestion);
  const priority = extractPriority(normalizedQuestion);
  const lot = extractLot(normalizedQuestion);
  const salesRep = extractFieldPhrase(normalizedQuestion, ["salesrep ", "rep "]);
  const customer = extractFieldPhrase(normalizedQuestion, ["customer ", "for customer ", "customername "]);
  const consignee = extractFieldPhrase(normalizedQuestion, ["consignee ", "consigneename "]);
  const markerToken = compactText((normalizedQuestion.match(/\b(?:dock|docks)\s+(?:has|have|with)\s+([a-z0-9_-]+)/i)?.[1] || "").toUpperCase());
  const questionTokens = buildQuestionTokens(normalizedQuestion);
  const itemTokens = questionTokens.filter((token) =>
    token.length > 1
    && !STOP_WORDS.has(token)
    && token !== size.toLowerCase()
    && token !== priority
    && token !== lot.toLowerCase()
    && token !== markerToken.toLowerCase()
  );
  const expandedItemTokens = expandAliasTokens(itemTokens);
  const itemPhrase = compactText(expandedItemTokens.join(" "));
  const domains = new Set<DatasetKey>();
  let mode: IntentMode = "lookup";

  if (/\bmake\b.*\brequest\b|\bcreate\b.*\brequest\b|\bdraft\b.*\brequest\b/.test(normalizedQuestion)) {
    mode = "request-draft";
    domains.add("requests");
    domains.add("future");
  } else if (/\bwho\b.*\breserve/.test(normalizedQuestion) || /\bwho has\b.*\bon\b.*\breserve/.test(normalizedQuestion)) {
    mode = "reserve-owners";
    domains.add("reserves");
  } else if (/\bdock\b.*\bhold\b|\bhold\b.*\bdock\b/.test(normalizedQuestion)) {
    mode = "dock-hold-list";
    domains.add("docks");
  } else if (/\bwhat dock\b|\bwhich dock\b|\bdock has\b|\bdocks have\b/.test(normalizedQuestion)) {
    mode = "dock-lookup";
    domains.add("docks");
    domains.add("dock-team");
  } else if (/\bfuturecrop\b|\bnewcrop\b|\bncr\b/.test(normalizedQuestion)) {
    mode = "future-crop";
    domains.add("future");
  } else if (/\blist\b|\bshow\b|\bgive me\b/.test(normalizedQuestion)) {
    mode = "list";
  }

  if (/\breserve\b|\bsalesrep\b|\bcustomer\b|\bconsignee\b/.test(normalizedQuestion)) domains.add("reserves");
  if (/\brequest\b|\brequested\b|\breq\b/.test(normalizedQuestion)) domains.add("requests");
  if (/\bsales office\b|\border\b/.test(normalizedQuestion)) domains.add("sales-office");
  if (/\bdock\b|\bdocks\b|\bmta\b/.test(normalizedQuestion)) domains.add("docks");
  if (!domains.size) domains.add("master");
  if (!domains.has("master") && (mode === "lookup" || mode === "list")) domains.add("master");

  return {
    question: safeQuestion,
    normalizedQuestion,
    itemPhrase,
    questionTokens,
    itemTokens: expandedItemTokens,
    size,
    priority,
    lot,
    salesRep,
    customer,
    consignee,
    wantsLocation,
    wantsQuantity,
    wantsPriorityRows,
    wantsHoldRows,
    markerToken,
    domains: Array.from(domains),
    mode,
  };
}

function levenshteinDistance(a: string, b: string) {
  const first = String(a || "");
  const second = String(b || "");
  if (!first) return second.length;
  if (!second) return first.length;
  const matrix = Array.from({ length: first.length + 1 }, () => new Array<number>(second.length + 1).fill(0));
  for (let i = 0; i <= first.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= second.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= first.length; i += 1) {
    for (let j = 1; j <= second.length; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[first.length][second.length];
}

function isCloseTokenMatch(token: string, candidate: string) {
  if (!token || !candidate) return false;
  if (candidate.includes(token) || token.includes(candidate)) return true;
  if (token.length >= 5 && candidate.length >= 5 && token.slice(0, 4) === candidate.slice(0, 4)) return true;
  return levenshteinDistance(token, candidate) <= 2;
}

function mapTableToDataset(tableName: string): DatasetKey {
  const entry = Object.entries(TABLE_NAMES).find(([, table]) => table === tableName);
  return (entry?.[0] || "master") as DatasetKey;
}

async function fetchRows(tableName: string, intent: Intent) {
  let query = supabase.from(tableName).select("*").limit(tableName === "v2_master_inventory" ? 650 : 500);
  const searchTokens = expandAliasTokens((intent.itemTokens || []).slice(0, 3)).filter(Boolean);
  if (searchTokens.length && tableName !== "v2_dock_team_status") {
    const fieldOptions: Record<string, string[]> = {
      v2_master_inventory: ["commonname", "itemcode", "locationcode"],
      v2_reserves: ["commonname", "itemcode", "customername", "consigneename", "salesrepname"],
      v2_active_request: ["commonname", "itemcode", "requested_by", "req_customer", "request_folder"],
      v2_sales_office: ["commonname", "itemcode", "order_customer", "order_folder"],
      v2_soc_master: ["commonname", "itemcode", "locationcode", "dock_note", "dock_num", "customername", "salesrepname"],
    };
    const orFields = fieldOptions[tableName] || [];
    const clauses: string[] = [];
    searchTokens.forEach((rawToken) => {
      const token = String(rawToken || "").replace(/[^a-z0-9_-]+/gi, "").trim();
      if (!token) return;
      orFields.forEach((field) => clauses.push(`${field}.ilike.*${token}*`));
    });
    if (clauses.length) {
      query = query.or(clauses.join(","));
    }
  }
  if (intent.size && tableName !== "v2_dock_team_status") query = query.ilike("contsize", `%${intent.size}%`);
  if (intent.priority && tableName !== "v2_dock_team_status") query = query.eq("priority", intent.priority);
  if (intent.lot && tableName !== "v2_dock_team_status") query = query.ilike("lotcode", `%${intent.lot}%`);
  const { data, error } = await query;
  if (error) throw new Error(`${tableName} query failed: ${String(error.message || error || "").trim()}`);
  return Array.isArray(data) ? data : [];
}

function normalizeMatchRow(row: Record<string, unknown>, datasetKey: DatasetKey): MatchRow {
  const qtySource = firstNonEmpty(
    row.quantityordered, row.QUANTITYORDERED,
    row.req_qty, row.REQ_QTY,
    row.ptravailable, row.PTRAVAILABLE,
    row.s_lts, row.S_LTS,
  );
  const qtyValue = asNumber(qtySource);
  return {
    dataset: TABLE_LABELS[datasetKey] || datasetKey,
    datasetKey,
    uniqueId: firstNonEmpty(row.unique_id, row.UNIQUE_ID),
    masterId: firstNonEmpty(row.master_id, row.MASTER_ID, row.unique_id, row.UNIQUE_ID),
    commonName: firstNonEmpty(row.commonname, row.COMMONNAME),
    itemCode: firstNonEmpty(row.itemcode, row.ITEMCODE),
    contSize: firstNonEmpty(row.contsize, row.CONTSIZE).toUpperCase(),
    location: firstNonEmpty(row.locationcode, row.LOCATIONCODE),
    lot: firstNonEmpty(row.lotcode, row.LOTCODE).toUpperCase(),
    priority: firstNonEmpty(row.priority, row.PRIORITY),
    qty: Number.isFinite(qtyValue) ? qtyValue : 0,
    rawQty: qtySource,
    sLts: asNumber(firstNonEmpty(row.s_lts, row.S_LTS)),
    hold: firstNonEmpty(row.holdstopcode, row.HOLDSTOPCODE, row.holdstopreason, row.HOLDSTOPREASON),
    customer: firstNonEmpty(row.customername, row.CUSTOMERNAME, row.req_customer, row.REQ_CUSTOMER, row.order_customer, row.ORDER_CUSTOMER),
    consignee: firstNonEmpty(row.consigneename, row.CONSIGNEENAME),
    salesRep: firstNonEmpty(row.salesrepname, row.SALESREPNAME, row.requested_by, row.REQUESTED_BY),
    requestFolder: firstNonEmpty(row.request_folder, row.REQUEST_FOLDER, row.order_folder, row.ORDER_FOLDER),
    dockNum: firstNonEmpty(row.dock_num, row.DOCK_NUM, row.dock, row.DOCK),
    stopNumber: firstNonEmpty(row.stopnumber, row.STOPNUMBER),
    tripNumber: firstNonEmpty(row.tripnumber, row.TRIPNUMBER),
    note: firstNonEmpty(
      row.dock_note, row.DOCK_NOTE,
      row.dock_issue_note, row.DOCK_ISSUE_NOTE,
      row.sales_note, row.SALES_NOTE,
      row.av_note, row.AV_NOTE,
      row.mistake, row.MISTAKE,
      row.status, row.STATUS,
    ),
    score: 0,
  };
}

function scoreMatchRow(match: MatchRow, intent: Intent, rawRow: Record<string, unknown>) {
  const rowTokens = tokenize([
    match.commonName,
    match.itemCode,
    match.contSize,
    match.location,
    match.lot,
    match.customer,
    match.consignee,
    match.salesRep,
    match.requestFolder,
    match.dockNum,
    match.stopNumber,
    match.tripNumber,
    match.note,
    firstNonEmpty(rawRow.status, rawRow.STATUS, rawRow.mistake, rawRow.MISTAKE, rawRow.checker, rawRow.CHECKER, rawRow.inspector, rawRow.INSPECTOR)
  ].join(" "));
  const haystack = rowTokens.join(" ");
  let score = 0;
  intent.itemTokens.forEach((token) => {
    if (rowTokens.some((candidate) => isCloseTokenMatch(token, candidate))) score += 8;
  });
  if (intent.itemPhrase && normalizeText([match.commonName, match.itemCode].join(" ")).includes(normalizeText(intent.itemPhrase))) score += 14;
  if (intent.itemTokens.length && intent.itemTokens.every((token) => rowTokens.some((candidate) => isCloseTokenMatch(token, candidate)))) score += 18;
  if (intent.size && match.contSize === intent.size) score += 10;
  if (intent.priority && match.priority === intent.priority) score += 10;
  if (intent.lot && match.lot.includes(intent.lot)) score += 8;
  if (intent.salesRep && normalizeText(match.salesRep).includes(normalizeText(intent.salesRep))) score += 10;
  if (intent.customer && normalizeText(`${match.customer} ${match.consignee}`).includes(normalizeText(intent.customer))) score += 10;
  if (intent.markerToken) {
    const marker = intent.markerToken.toLowerCase();
    if (haystack.includes(marker)) score += 20;
  }
  if (intent.wantsHoldRows && match.hold) score += 6;
  if (intent.mode === "dock-lookup" && match.dockNum) score += 5;
  if (intent.itemTokens.length === 1 && intent.itemTokens[0] && !rowTokens.some((candidate) => candidate === intent.itemTokens[0])) score -= 4;
  if (!match.commonName && !match.itemCode && !match.dockNum) score -= 6;
  return score;
}

function isStrongMatch(match: MatchRow, intent: Intent) {
  const itemTokenCount = (intent.itemTokens || []).length;
  if (!itemTokenCount) return match.score >= 10;
  if (itemTokenCount >= 3) return match.score >= 24;
  if (itemTokenCount === 2) return match.score >= 16;
  return match.score >= 12;
}

function scoreRows(rows: Record<string, unknown>[], datasetKey: DatasetKey, intent: Intent) {
  return rows.map((row) => {
    const normalized = normalizeMatchRow(row, datasetKey);
    normalized.score = scoreMatchRow(normalized, intent, row);
    return normalized;
  }).filter((row) => row.score > 0);
}

function dedupeMatches(matches: MatchRow[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = [match.datasetKey, match.uniqueId || match.masterId || match.itemCode, match.location, match.lot, match.dockNum].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortMatches(matches: MatchRow[]) {
  return dedupeMatches(matches).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sLts !== a.sLts) return (Number.isFinite(b.sLts) ? b.sLts : 0) - (Number.isFinite(a.sLts) ? a.sLts : 0);
    return b.qty - a.qty;
  });
}

function toResponseMatch(match: MatchRow) {
  return {
    dataset: match.dataset,
    uniqueId: match.uniqueId,
    masterId: match.masterId,
    commonName: match.commonName,
    itemCode: match.itemCode,
    contSize: match.contSize,
    location: match.location,
    lot: match.lot,
    priority: match.priority,
    qty: match.rawQty || formatQty(match.qty),
    salesRep: match.salesRep,
    customer: firstNonEmpty(match.customer, match.consignee),
    hold: match.hold,
    dockNum: match.dockNum,
    requestFolder: match.requestFolder,
    stopNumber: match.stopNumber,
    tripNumber: match.tripNumber,
  };
}

async function maybePhraseAnswer(answer: string, matches: Record<string, unknown>[], sourceLabel: string, question: string) {
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
                text: "You are Leaf, a grounded Greenleaf app assistant. Rephrase the provided answer briefly and operationally. Do not invent rows, quantities, locations, or customers. Keep it under 90 words.",
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
      ? payload.output
        .flatMap((entry: Record<string, unknown>) => Array.isArray(entry?.content) ? entry.content as Record<string, unknown>[] : [])
        .find((entry: Record<string, unknown>) => entry?.type === "output_text")?.text
      : "";
    return compactText(String(outputText || answer));
  } catch {
    return answer;
  }
}

function buildClarificationResponse(answer: string, prompt: string, matches: MatchRow[], sourceLabel: string): LeafResponse {
  return {
    answer,
    matches: matches.slice(0, 8).map(toResponseMatch),
    needsClarification: true,
    clarificationPrompt: prompt,
    sourceLabel,
    action: null,
  };
}

function buildNoMatchResponse(intent: Intent, sourceLabel: string): LeafResponse {
  const askText = intent.itemPhrase || intent.question;
  return {
    answer: `I could not find a matching ${sourceLabel.toLowerCase()} result for "${askText}".`,
    matches: [],
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: `Source: ${sourceLabel}`,
    action: null,
  };
}

function buildInventoryResponse(intent: Intent, matches: MatchRow[], sourceLabel: string): LeafResponse {
  if (!matches.length) return buildNoMatchResponse(intent, sourceLabel);
  const strongest = matches[0];
  if (!isStrongMatch(strongest, intent)) {
    const heardItem = intent.itemPhrase || intent.question;
    const candidateLabel = [strongest.commonName, strongest.contSize].filter(Boolean).join(" ").trim() || strongest.itemCode || "that item";
    return buildClarificationResponse(
      `I think I heard "${heardItem}", but my closest ${sourceLabel.toLowerCase()} match is ${candidateLabel}.`,
      `Did you mean ${candidateLabel}? You can also say the full item name and size again.`,
      matches,
      `Source: ${sourceLabel}`,
    );
  }
  const sizeSet = new Set(matches.map((match) => match.contSize).filter(Boolean));
  if (!intent.size && sizeSet.size > 1 && matches.length > 1 && intent.mode === "lookup") {
    return buildClarificationResponse(
      `I found ${matches.length} possible ${sourceLabel.toLowerCase()} matches for ${matches[0].commonName}, but there are multiple sizes.`,
      `Which size do you want for ${matches[0].commonName}? I found ${Array.from(sizeSet).slice(0, 6).join(", ")}.`,
      matches,
      `Source: ${sourceLabel}`,
    );
  }
  const totalQty = matches.reduce((sum, match) => sum + (Number.isFinite(match.qty) ? match.qty : 0), 0);
  const topic = [matches[0].commonName, matches[0].contSize].filter(Boolean).join(" ").trim();
  const topLocations = matches
    .map((match) => {
      const parts = [];
      if (match.location) parts.push(match.location);
      if (Number.isFinite(match.qty)) parts.push(formatQty(match.qty));
      return parts.join(" ");
    })
    .filter(Boolean)
    .slice(0, 4);
  let answer = `I found ${matches.length} ${sourceLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"}.`;
  if (intent.wantsLocation && intent.wantsQuantity) {
    answer = `I found ${matches.length} ${sourceLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} at ${topLocations.join(", ") || "the matched locations"}, with ${formatQty(totalQty)} total available.`;
  } else if (intent.wantsLocation) {
    answer = `I found ${matches.length} ${sourceLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} at ${topLocations.join(", ") || "the matched locations"}.`;
  } else if (intent.wantsQuantity) {
    answer = `I found ${matches.length} ${sourceLabel.toLowerCase()} row${matches.length === 1 ? "" : "s"} for ${topic || "that item"} with ${formatQty(totalQty)} total available.`;
  }
  return {
    answer,
    matches: matches.slice(0, 8).map(toResponseMatch),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: `Source: ${sourceLabel}`,
    action: null,
  };
}

function buildReserveOwnerResponse(intent: Intent, matches: MatchRow[]): LeafResponse {
  if (!matches.length) return buildNoMatchResponse(intent, TABLE_LABELS.reserves);
  if (!isStrongMatch(matches[0], intent)) {
    const candidateLabel = [matches[0].commonName, matches[0].contSize].filter(Boolean).join(" ").trim() || matches[0].itemCode || "that reserve item";
    return buildClarificationResponse(
      `I found reserve results, but I am not fully sure the item phrase matches.`,
      `Did you mean ${candidateLabel}? If not, say the full item name and size again.`,
      matches,
      "Source: Reserves",
    );
  }
  const grouped = new Map<string, { customer: string; salesRep: string; qty: number; rows: MatchRow[] }>();
  matches.forEach((match) => {
    const customerLabel = firstNonEmpty(match.customer, match.consignee, "Unknown Customer");
    const repLabel = firstNonEmpty(match.salesRep, "Unknown Rep");
    const key = `${customerLabel}|${repLabel}`;
    const current = grouped.get(key) || { customer: customerLabel, salesRep: repLabel, qty: 0, rows: [] };
    current.qty += Number.isFinite(match.qty) ? match.qty : 0;
    current.rows.push(match);
    grouped.set(key, current);
  });
  const groups = Array.from(grouped.values()).sort((a, b) => b.qty - a.qty);
  const top = groups.slice(0, 4).map((group) => `${group.customer} with ${group.salesRep} (${formatQty(group.qty)})`);
  return {
    answer: `I found ${matches.length} reserve row${matches.length === 1 ? "" : "s"} for ${matches[0].commonName || "that item"}. ${top.length ? `Reserved by ${top.join("; ")}.` : ""}`.trim(),
    matches: groups.slice(0, 8).map((group) => ({
      dataset: TABLE_LABELS.reserves,
      commonName: matches[0].commonName,
      contSize: matches[0].contSize,
      customer: group.customer,
      salesRep: group.salesRep,
      qty: formatQty(group.qty),
      location: group.rows[0]?.location || "",
      lot: group.rows[0]?.lot || "",
    })),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: "Source: Reserves",
    action: null,
  };
}

function buildDockLookupResponse(intent: Intent, matches: MatchRow[]): LeafResponse {
  if (!matches.length) return buildNoMatchResponse(intent, TABLE_LABELS.docks);
  const grouped = new Map<string, MatchRow[]>();
  matches.forEach((match) => {
    const key = firstNonEmpty(match.dockNum, match.location, "Unknown Dock");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(match);
  });
  const groups = Array.from(grouped.entries()).sort((a, b) => b[1][0].score - a[1][0].score);
  const dockLabels = groups.slice(0, 5).map(([dock, rows]) => `${dock}${rows[0]?.note ? ` (${rows[0].note})` : ""}`);
  return {
    answer: `I found ${groups.length} dock${groups.length === 1 ? "" : "s"} that match ${intent.markerToken || intent.itemPhrase || "that dock question"}: ${dockLabels.join(", ")}.`,
    matches: groups.slice(0, 8).map(([dock, rows]) => ({
      dataset: TABLE_LABELS.docks,
      dockNum: dock,
      commonName: rows[0]?.commonName || "",
      itemCode: rows[0]?.itemCode || "",
      customer: rows[0]?.customer || "",
      salesRep: rows[0]?.salesRep || "",
      hold: rows[0]?.hold || "",
      location: rows[0]?.location || "",
      qty: rows.length,
    })),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: "Source: Docks",
    action: null,
  };
}

function buildDockHoldResponse(matches: MatchRow[]): LeafResponse {
  if (!matches.length) return buildNoMatchResponse({ question: "dock hold", itemPhrase: "dock hold", normalizedQuestion: "", questionTokens: [], itemTokens: [], size: "", priority: "", lot: "", salesRep: "", customer: "", consignee: "", wantsLocation: false, wantsQuantity: false, wantsPriorityRows: false, wantsHoldRows: true, markerToken: "", domains: ["docks"], mode: "dock-hold-list" }, TABLE_LABELS.docks);
  const top = matches.slice(0, 6).map((match) => `${match.commonName || match.itemCode} in dock ${firstNonEmpty(match.dockNum, match.location, "Unknown")} (${match.hold || "Hold"})`);
  return {
    answer: `I found ${matches.length} dock row${matches.length === 1 ? "" : "s"} on hold. ${top.length ? top.join("; ") + "." : ""}`.trim(),
    matches: matches.slice(0, 8).map(toResponseMatch),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: "Source: Docks",
    action: null,
  };
}

function isFutureCropLot(match: MatchRow) {
  return FUTURE_LOT_SUFFIXES.some((suffix) => match.lot.endsWith(suffix));
}

function buildRequestDraftResponse(intent: Intent, matches: MatchRow[], session: { displayName?: string }): LeafResponse {
  if (!intent.salesRep || !intent.customer) {
    return buildClarificationResponse(
      "I can draft that request, but I still need the sales rep and customer.",
      "Tell me the sales rep and customer, like: Make a request for Chance for customer Acme on Incrediball Hydrangea 3DP.",
      matches,
      "Source: Drive inventory",
    );
  }
  if (!matches.length) return buildNoMatchResponse(intent, TABLE_LABELS.master);
  if (!isStrongMatch(matches[0], intent)) {
    const candidateLabel = [matches[0].commonName, matches[0].contSize].filter(Boolean).join(" ").trim() || matches[0].itemCode || "that item";
    return buildClarificationResponse(
      `I can draft that request, but I want to confirm the item first.`,
      `Did you mean ${candidateLabel}? Say the item name and size again if not.`,
      matches,
      "Source: Drive inventory",
    );
  }
  const positiveRows = matches.filter((match) => Number.isFinite(match.sLts) && match.sLts > 0);
  const futureRows = matches.filter((match) => isFutureCropLot(match) || (Number.isFinite(match.sLts) && match.sLts > 0));
  const recommended = (positiveRows.length ? positiveRows : futureRows).slice().sort((a, b) => {
    if ((Number.isFinite(b.sLts) ? b.sLts : 0) !== (Number.isFinite(a.sLts) ? a.sLts : 0)) return (Number.isFinite(b.sLts) ? b.sLts : 0) - (Number.isFinite(a.sLts) ? a.sLts : 0);
    return b.score - a.score;
  })[0];
  if (!recommended) {
    return {
      answer: `I found ${matches.length} item match${matches.length === 1 ? "" : "es"} for ${matches[0].commonName || "that item"}, but none had positive S_LTS or a safe future-crop fallback.`,
      matches: matches.slice(0, 8).map(toResponseMatch),
      needsClarification: false,
      clarificationPrompt: "",
      sourceLabel: "Source: Drive inventory",
      action: null,
    };
  }
  const fallbackSources = futureRows
    .filter((row) => row.uniqueId !== recommended.uniqueId)
    .slice(0, 4)
    .map((row) => ({
      uniqueId: row.uniqueId,
      masterId: row.masterId,
      itemCode: row.itemCode,
      contSize: row.contSize,
      location: row.location,
      lot: row.lot,
      qty: formatQty(Number.isFinite(row.sLts) ? row.sLts : row.qty),
    }));
  const customerDisplay = firstNonEmpty(intent.customer, intent.consignee ? `${intent.customer} | ${intent.consignee}` : "");
  const summary = Number.isFinite(recommended.sLts) && recommended.sLts > 0
    ? `Best live source is ${firstNonEmpty(recommended.location, "no location")} lot ${firstNonEmpty(recommended.lot, "-")} with S_LTS ${formatQty(recommended.sLts)}.`
    : `No positive S_LTS row was found, so Leaf picked the best future crop source at ${firstNonEmpty(recommended.location, "no location")} lot ${firstNonEmpty(recommended.lot, "-")}.`;
  const action: LeafAction = {
    type: "request-draft",
    itemLabel: [recommended.commonName || recommended.itemCode, recommended.contSize].filter(Boolean).join(" ").trim(),
    salesRep: intent.salesRep,
    requestedBy: intent.salesRep,
    customer: intent.customer,
    customerName: intent.customer,
    customerDisplay,
    consignee: intent.consignee,
    consigneeName: intent.consignee,
    summary,
    recommendedSource: {
      uniqueId: recommended.uniqueId,
      masterId: recommended.masterId,
      itemCode: recommended.itemCode,
      contSize: recommended.contSize,
      location: recommended.location,
      lot: recommended.lot,
      qty: formatQty(Number.isFinite(recommended.sLts) && recommended.sLts > 0 ? recommended.sLts : recommended.qty),
    },
    fallbackSources,
  };
  return {
    answer: `I drafted a request for ${action.itemLabel || "that item"} for ${intent.salesRep} and ${customerDisplay || "that customer"}. ${summary}`,
    matches: matches.slice(0, 6).map(toResponseMatch),
    needsClarification: false,
    clarificationPrompt: "",
    sourceLabel: "Source: Drive inventory",
    action,
  };
}

async function queryDataset(datasetKey: DatasetKey, intent: Intent) {
  const rows = await fetchRows(TABLE_NAMES[datasetKey], intent);
  return sortMatches(scoreRows(rows, datasetKey, intent));
}

async function handleIntent(intent: Intent, session: { username?: string; displayName?: string; role?: string }) {
  const access = getRoleAccessState(session.role);
  const userKeys = buildUserMatchKeys(session);

  const scopeRepRows = (matches: MatchRow[]) => access.isRep ? matches.filter((row) => matchesScopedUser(row.salesRep, userKeys)) : matches;
  const scopeRequestRows = (matches: MatchRow[]) => access.isRep ? matches.filter((row) => matchesScopedUser(row.salesRep, userKeys)) : matches;
  const scopeDockRows = (matches: MatchRow[]) => access.isRep ? matches.filter((row) => !row.salesRep || matchesScopedUser(row.salesRep, userKeys)) : matches;

  if (intent.mode === "request-draft") {
    if (!(access.isAdmin || access.isRep)) return errorResponse("You do not have access to request drafting.", 403);
    const matches = await queryDataset("master", intent);
    return buildRequestDraftResponse(intent, matches, session);
  }

  if (intent.mode === "reserve-owners") {
    if (!(access.isAdmin || access.isRep)) return errorResponse("You do not have access to reserve answers.", 403);
    const matches = scopeRepRows(await queryDataset("reserves", intent));
    return buildReserveOwnerResponse(intent, matches);
  }

  if (intent.mode === "dock-hold-list") {
    if (!(access.isAdmin || access.isRep || access.isQcSupervisor || access.isQc)) return errorResponse("You do not have access to dock answers.", 403);
    const matches = scopeDockRows(await queryDataset("docks", intent)).filter((row) => !!row.hold);
    return buildDockHoldResponse(matches);
  }

  if (intent.mode === "dock-lookup") {
    if (!(access.isAdmin || access.isRep || access.isQcSupervisor || access.isQc)) return errorResponse("You do not have access to dock answers.", 403);
    const dockMatches = scopeDockRows(await queryDataset("docks", intent));
    const teamMatches = access.isRep ? [] : await queryDataset("dock-team", intent);
    return buildDockLookupResponse(intent, sortMatches([...dockMatches, ...teamMatches]));
  }

  if (intent.mode === "future-crop") {
    const matches = (await queryDataset("future", intent)).filter((match) => isFutureCropLot(match) || (Number.isFinite(match.sLts) && match.sLts > 0));
    return buildInventoryResponse(intent, matches, TABLE_LABELS.future);
  }

  if (intent.domains.includes("reserves")) {
    if (!(access.isAdmin || access.isRep)) return errorResponse("You do not have access to reserve answers.", 403);
    const matches = scopeRepRows(await queryDataset("reserves", intent));
    if (matches.length) return buildInventoryResponse(intent, matches, TABLE_LABELS.reserves);
  }

  if (intent.domains.includes("requests")) {
    if (access.isAdmin || access.isRep) {
      const matches = scopeRequestRows(await queryDataset("requests", intent));
      if (matches.length) return buildInventoryResponse(intent, matches, TABLE_LABELS.requests);
    }
  }

  if (intent.domains.includes("sales-office")) {
    if (access.isAdmin || access.isRep) {
      const matches = await queryDataset("sales-office", intent);
      if (matches.length) return buildInventoryResponse(intent, matches, TABLE_LABELS["sales-office"]);
    }
  }

  if (intent.domains.includes("docks")) {
    if (access.isAdmin || access.isRep || access.isQcSupervisor || access.isQc) {
      const matches = scopeDockRows(await queryDataset("docks", intent));
      if (matches.length) return buildInventoryResponse(intent, matches, TABLE_LABELS.docks);
    }
  }

  if (!(access.isAdmin || access.isRep || access.isQcSupervisor || access.isQc)) {
    return errorResponse("You do not have access to inventory answers.", 403);
  }
  const matches = await queryDataset("master", intent);
  return buildInventoryResponse(intent, matches, TABLE_LABELS.master);
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
    const responsePayload = await handleIntent(intent, session);
    if (responsePayload instanceof Response) return responsePayload;
    const phrased = await maybePhraseAnswer(responsePayload.answer, responsePayload.matches, responsePayload.sourceLabel, question);
    return jsonResponse({ ...responsePayload, answer: phrased }, 200);
  } catch (error) {
    const details = String(error && (error as Error).message || error || "").trim();
    console.error("inventory-assistant failed", { error: details });
    return errorResponse("Leaf could not answer that question right now.", 500, { details });
  }
});
