const DATASET_READ_FILTER_OPERATORS = new Set(["eq", "neq", "in", "ilike", "is", "gte", "lte", "gt", "lt", "not.is", "not.ilike"]);

function datasetReadScalar(value: unknown) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 500 && ![...value].some((character) => character.charCodeAt(0) < 32)) return value;
  throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
}

export function datasetReadFilterParts(source: { filterFields: ReadonlySet<string> }, filters: unknown[],
  normalizeDisplayValue: Function) {
  return filters.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DATASET_READ_FILTER_INVALID");
    const filter = raw as Record<string, unknown>;
    if (Object.keys(filter).some((key) => !["field", "op", "value"].includes(key))) throw new Error("DATASET_READ_FILTER_INVALID");
    const field = String(filter.field || ""), op = String(filter.op || "");
    if (!source.filterFields.has(field) || !DATASET_READ_FILTER_OPERATORS.has(op) || !Object.prototype.hasOwnProperty.call(filter, "value")) throw new Error("DATASET_READ_FILTER_INVALID");
    let value: unknown = filter.value;
    if (op === "in") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
      value = value.map(datasetReadScalar);
    } else {
      value = datasetReadScalar(value);
      if ((op === "ilike" || op === "not.ilike") && typeof value !== "string") throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
      if ((op === "is" || op === "not.is") && value !== null && typeof value !== "boolean") throw new Error("DATASET_READ_FILTER_VALUE_INVALID");
    }
    return { field, op, value: normalizeDisplayValue(field, value) };
  });
}

export function datasetReadOrLiteral(value: unknown) {
  if (value === null) return "null";
  const text = String(value);
  return /[,()."\\]/.test(text) ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"` : text;
}

export function datasetReadOrCondition(filter: { field: string; op: string; value: unknown }) {
  const value = Array.isArray(filter.value)
    ? `(${filter.value.map(datasetReadOrLiteral).join(",")})`
    : datasetReadOrLiteral(filter.value);
  return `${filter.field}.${filter.op}.${value}`;
}

function reserveRepSearchPatterns(names: unknown[]) {
  const patterns = new Set<string>();
  for (const value of names) {
    const parts = String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (parts.length < 2) continue;
    patterns.add(`${parts[0]}*${parts.at(-1)}`);
    patterns.add(`${parts.at(-1)}*${parts[0]}`);
  }
  return patterns;
}

export function validateDatasetReadParams(payload: Record<string, unknown>, maxPage = 500) {
  if (Object.keys(payload).some((key) => !["action", "dataset", "params", "requestDeliveryStatus"].includes(key))) throw new Error("DATASET_READ_PAYLOAD_INVALID");
  const params = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
    ? payload.params as Record<string, unknown> : {};
  if (payload.params !== undefined && (!payload.params || typeof payload.params !== "object" || Array.isArray(payload.params))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  if (Object.keys(params).some((key) => !["limit", "offset", "select", "projection", "filters", "anyOf", "order", "ifRevision"].includes(key))) throw new Error("DATASET_READ_PARAMETERS_INVALID");
  const requestedLimitValue = Number(params.limit ?? 250), offsetValue = Number(params.offset ?? 0);
  const requestedLimit = Number.isInteger(requestedLimitValue) && requestedLimitValue > 0 ? requestedLimitValue : 250;
  const offset = Number.isInteger(offsetValue) && offsetValue >= 0 && offsetValue <= 2_000_000 ? offsetValue : 0;
  const limit = Math.min(maxPage, requestedLimit);
  // A legacy select may narrow the fixed projection, never inject SQL fields.
  const requestedSelection = params.select == null ? "*" : String(params.select).trim() || "*";
  const selection = ["*", "unique_id"].includes(requestedSelection) ? requestedSelection : "*";
  const projection = String(params.projection || (selection === "unique_id" ? "ids" : "default"));
  if (!["default", "signature", "ids"].includes(projection)) throw new Error("DATASET_READ_PROJECTION_INVALID");
  const rawFilters = params.filters ?? [];
  const rawAnyOf = params.anyOf ?? [];
  const rawOrder = params.order ?? [];
  if (!Array.isArray(rawFilters) || rawFilters.length > 30 || !Array.isArray(rawAnyOf) || rawAnyOf.length > 30 || !Array.isArray(rawOrder) || rawOrder.length > 4) throw new Error("DATASET_READ_FILTER_INVALID");
  const ifRevision = params.ifRevision === undefined ? '' : String(params.ifRevision);
  if (ifRevision && !/^\d+$/.test(ifRevision)) throw new Error("DATASET_READ_REVISION_INVALID");
  return { limit, offset, projection, ifRevision, filters: rawFilters as unknown[], anyOf: rawAnyOf as unknown[], order: rawOrder as unknown[] };
}

export function applyReserveRepQuery(query: URLSearchParams, actor: Record<string, unknown>, anyOf: ReturnType<typeof datasetReadFilterParts>) {
  const patterns = reserveRepSearchPatterns([actor.username, actor.display_name]);
  if (!patterns.size) return false;
  const repScope = [...patterns].map((pattern) => `salesrepname.ilike.${datasetReadOrLiteral(pattern)}`).join(",");
  const anyOfScope = anyOf.length ? `or(${anyOf.map(datasetReadOrCondition).join(",")})` : "";
  query.set("or", anyOfScope ? `(and(or(${repScope}),${anyOfScope}))` : `(${repScope})`);
  return true;
}

export function isRequestRemovalTimestamp(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days
    && Number(parts[4]) < 24 && Number(parts[5]) < 60 && Number(parts[6]) < 60
    && (!parts[7] || (Number(parts[8]) < 16 && Number(parts[9]) < 60));
}
