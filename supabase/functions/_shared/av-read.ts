const RESERVE_FULL_SELECT_FIELDS = [
  "unique_id", "concat", "last_updated", "assigned_to", "assignedto", "spec", "caliper",
  "pic_note", "sales_note", "av_note", "photo_link", "photo_name", "dock_spec", "dock_caliper",
  "dock_note", "dock_photo_link", "dock_photo_name", "date_completed", "flyer_cat", "flyer_title", "flyer_inst",
  "flyer_assigned", "flyer_notes", "flyer_photo_link", "flyer_photo_name", "flyer_completed", "initial_ptr", "loc_match_qty",
  "end_cap_folder", "end_cap_qty", "end_cap_level", "match", "item", "size", "container",
  "location", "lot", "warehouseid", "warehousename", "isreserve", "salesrepid", "salesrepname",
  "nationalaccountidgroup", "national_account_idgroup", "idgroup", "customeridentityid", "customername", "consigneeidentityid", "consigneename",
  "consigneecity", "consigneestate", "consigneezip", "tripnumber", "stopnumber", "zonecode", "tagcode",
  "transactionnumber", "purchaseordernumber", "extunitprice", "ordertotal", "requestdate", "stagename", "step",
  "customersku", "formattedupc", "printedcontainercode", "lotcode", "locationcode", "descriptorcode", "itemcode",
  "plantgroupcode", "sortname", "variety", "containersort", "qualitycode", "commonname", "quantityordered",
  "quantityshipped", "listprice", "unitprice", "handlingchargeperitem", "taggingchargeperitem", "combinedprice", "freightrateperitem",
  "landedretailprice", "holdstopcode", "holdstopreason", "salesnote", "fnsalesnote", "picknote", "planstart",
  "generalloadinstr", "invoicedate", "consigneeaddress_1", "consigneeaddress_2", "altshipcomment", "shiptotelephone_1", "okloadinstructions",
  "txloadinstructions", "ncloadinstructions", "hlloadinstructions", "dock", "equiv_unit", "equiv_uom", "wingdingunits",
  "dropweight", "internalinvnote", "hardinesszone", "brand", "tagdeptnote", "ext_unit", "merch_shipped",
  "ext_unit_merch_shipped", "ext_eunit_shipped", "avg_price_eunit_shipped", "requestdateweek", "carrier", "suspend", "suspend_to",
  "qa_code", "grower", "nationalaccount", "sortnamevariety", "landed", "retailprice", "dock_num",
  "priority", "ptronhand", "ptrreviewed", "ptravailable", "season_supply", "s_lts", "itemspec",
  "season", "mcstatus", "hz", "intercopo", "insurancegroup", "si_lts", "a_lts",
  "ai_lts", "si_available", "holdstopenddate", "salesnote_1", "contsize", "source", "desigitem",
  "desigcust", "desigloc", "filename",
].join(",");

// Service-role reads for AV dependencies whose browser SELECT grants are revoked.
// Only these datasets and simple same-table filters can cross this boundary.
const SOURCES: Record<string, { table: string; permission: string; key: string; fields: string }> = {
  reserves: { table: "ph_reserves", permission: "ph_reserves", key: "unique_id", fields: RESERVE_FULL_SELECT_FIELDS },
  notes: { table: "ph_av_notes", permission: "ph_av_notes", key: "unique_id", fields: "unique_id,commonname,salesnote" },
  hot_prices: { table: "ph_view_av_hot_price_keys", permission: "ph_cav_import", key: "itemcode_key", fields: "itemcode_key,cav_itemcode,hot_price,cav_filename,cav_last_updated" },
  settings: { table: "ph_app_settings", permission: "ph_app_settings", key: "key", fields: "key,value,updated_by,updated_at" },
};
const FILTER_FIELDS = new Set(["unique_id", "itemcode", "itemcode_key", "lotcode", "season", "salesrepname", "customername", "consigneename", "key", "holdstopreason"]);
const invalid = () => Object.assign(new Error("AV_READ_QUERY_INVALID"), { status: 400 });

function splitConditions(input: string) {
  const terms: string[] = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && input[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (c === "(") depth++;
      if (c === ")" && --depth < 0) throw invalid();
      if (c === "," && depth === 0) { terms.push(input.slice(start, i)); start = i + 1; }
    }
  }
  if (quoted || depth) throw invalid();
  terms.push(input.slice(start));
  return terms;
}

function validateLogic(input: string, depth = 0): string {
  if (depth > 4 || !input || input.length > 12000 || /[\x00-\x1f]/.test(input)) throw invalid();
  for (const term of splitConditions(input)) {
    const group = term.match(/^(and|or)\((.*)\)$/);
    if (group) { validateLogic(group[2], depth + 1); continue; }
    const condition = term.match(/^([a-z_]+)\.(eq|ilike|is|in|not\.is)\.(.+)$/);
    if (!condition || !FILTER_FIELDS.has(condition[1])) throw invalid();
  }
  return input;
}

export async function readAvPage({ supabase, actor, payload, canRead, restrictRep }: {
  supabase: any; actor: Record<string, unknown>; payload: Record<string, unknown>;
  canRead: (table: string) => boolean; restrictRep: boolean;
}) {
  if (Object.keys(payload).some(key => !["action", "dataset", "query"].includes(key))) throw invalid();
  const dataset = String(payload.dataset || "");
  if (!Object.hasOwn(SOURCES, dataset)) throw invalid();
  const source = SOURCES[dataset];
  if (!canRead(source.permission)) throw Object.assign(new Error("AV_READ_FORBIDDEN"), { status: 403 });
  const raw = String(payload.query || "");
  if (raw.length > 16000) throw invalid();
  const params = new URLSearchParams(raw);
  const last = (key: string, fallback: string) => params.getAll(key).at(-1) ?? fallback;
  const limit = Number(last("limit", "500")), offset = Number(last("offset", "0"));
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0 || offset > 2_000_000) throw invalid();
  const pageSize = Math.min(500, limit);
  const requestedFields = params.get("select") || source.fields;
  if (requestedFields !== "*" && !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(requestedFields)) throw invalid();
  const fields = requestedFields === "*" ? source.fields : requestedFields;
  if (source.fields !== "*" && fields.split(",").some(field => !source.fields.split(",").includes(field))) throw invalid();
  let query = supabase.from(source.table).select(fields, { count: "exact" });
  const logic: string[] = [];
  for (const [key, value] of params) {
    if (["select", "limit", "offset", "order"].includes(key)) continue;
    if (key === "or" || key === "and") {
      if (!value.startsWith("(") || !value.endsWith(")")) throw invalid();
      const expression = validateLogic(value.slice(1, -1));
      logic.push(`${key}(${expression})`);
    } else {
      const match = value.match(/^(eq|ilike|is|in|not\.is)\.(.+)$/);
      if (!FILTER_FIELDS.has(key) || !match || /[\x00-\x1f]/.test(value)) throw invalid();
      query = query.filter(key, match[1], match[2]);
    }
  }
  // A client filter may narrow this scope, but can never replace it.
  if (restrictRep && dataset === "reserves") {
    const names = new Set<string>();
    for (const value of [actor.username, actor.display_name]) {
      const parts = String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (parts.length < 2) continue;
      const first = parts[0], last = parts.at(-1);
      names.add(`${first}*${last}`);
      names.add(`${last}*${first}`);
    }
    if (!names.size) throw Object.assign(new Error("AV_READ_REP_IDENTITY_REQUIRED"), { status: 403 });
    logic.push(`or(${[...names].map(name => `salesrepname.ilike.${name}`).join(",")})`);
  }
  if (logic.length) query = query.or(logic.length === 1 && logic[0].startsWith("or(")
    ? logic[0].slice(3, -1) : `and(${logic.join(",")})`);
  // AV needs the public season setting, never arbitrary operational settings.
  if (payload.dataset === "settings") query = query.eq("key", "current_season_salesyear");
  const order = params.get("order");
  if (order) {
    for (const part of order.split(",")) {
      const match = part.match(/^([a-z_][a-z0-9_]*)(?:\.(asc|desc))?(?:\.(nullsfirst|nullslast))?$/);
      if (!match || (source.fields !== "*" && !source.fields.split(",").includes(match[1]))) throw invalid();
      query = query.order(match[1], { ascending: match[2] !== "desc", nullsFirst: match[3] === "nullsfirst" });
    }
  }
  query = query.order(source.key, { ascending: true }).range(offset, offset + pageSize - 1);
  const { data, error, count, status: responseStatus } = await query;
  if (error) {
    const code = String(error.code || error.sqlState || error.sqlstate || "").trim().toUpperCase();
    const reportedStatus = Number(error.status || responseStatus) || 0;
    const status = code === "42501" ? 403 : code === "40001" || code === "PT409" ? 409
      : [401, 403].includes(reportedStatus) ? reportedStatus
      : reportedStatus >= 400 && reportedStatus < 600 ? reportedStatus : 503;
    throw Object.assign(new Error(code === "42501" ? "AV_READ_FORBIDDEN" : "AV_READ_UNAVAILABLE"), {
      status,
      code: code || (status === 503 ? "AV_READ_UNAVAILABLE" : ""),
    });
  }
  if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) throw Object.assign(new Error("AV_READ_INVALID_PAGE"), { status: 503 });
  return { rows: data, total: count, offset, limit: pageSize, hasMore: offset + data.length < count };
}
