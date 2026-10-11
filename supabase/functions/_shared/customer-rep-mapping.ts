export type CustomerRepMappingOperation = "list" | "options" | "detail" | "save";

export type CustomerRepMappingRequest = {
  operation: CustomerRepMappingOperation;
  payload: Record<string, unknown>;
};

const LIST_FIELDS = new Set(["action", "operation", "page", "pageSize", "filters", "sort", "direction", "q"]);
const OPTIONS_FIELDS = new Set(["action", "operation", "page", "pageSize", "q", "salesrepId", "customerId", "consigneeId"]);
const SAVE_FIELDS = new Set(["action", "operation", "id", "expectedRevision", "salesrepId", "salesrepName", "customerName", "consigneeName"]);
const FILTER_FIELDS = new Set(["salesrepid", "salesrepname", "customername", "consigneename", "status"]);
const SORT_FIELDS = new Set(["salesrepid", "salesrepname", "customername", "consigneename"]);
const STATUSES = new Set(["all", "active", "inactive", "unassigned"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every(key => allowed.has(key));
}

function boundedString(value: unknown, name: string, max: number, allowEmpty = true) {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
  }
  return value.trim();
}

export function isCustomerRepMappingEditorRole(role: unknown) {
  return ["ADMIN", "ADMINISTRATOR", "MANAGER"].includes(String(role || "").trim().toUpperCase());
}

export function validateCustomerRepMappingRequest(input: unknown): CustomerRepMappingRequest {
  const value = record(input);
  if (!value || value.action !== "customer-rep-map" || typeof value.operation !== "string") {
    throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
  }
  const operation = value.operation;
  if (operation === "list") {
    if (!onlyKeys(value, LIST_FIELDS)) throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
    const page = value.page ?? 0;
    const pageSize = value.pageSize ?? 50;
    const filters = value.filters === undefined ? {} : record(value.filters);
    const sort = value.sort ?? "customername";
    const direction = value.direction ?? "asc";
    const q = value.q === undefined ? "" : boundedString(value.q, "q", 120);
    if (!Number.isSafeInteger(page) || Number(page) < 0 || Number(page) > 1000
      || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 200
      || !filters || !onlyKeys(filters, FILTER_FIELDS)
      || !SORT_FIELDS.has(String(sort)) || !["asc", "desc"].includes(String(direction))) {
      throw new Error("CUSTOMER_REP_MAPPING_FILTER_INVALID");
    }
    const cleanFilters: Record<string, string> = {};
    for (const key of FILTER_FIELDS) {
      if (filters[key] === undefined) continue;
      const text = boundedString(filters[key], key, key === "status" ? 16 : 240);
      if (key === "status" && !STATUSES.has(text)) throw new Error("CUSTOMER_REP_MAPPING_FILTER_INVALID");
      if (text) cleanFilters[key] = text;
    }
    return { operation, payload: { page, pageSize, filters: cleanFilters, sort, direction, q } };
  }
  if (operation === "options") {
    if (!onlyKeys(value, OPTIONS_FIELDS)) throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
    const page = value.page ?? 0;
    const pageSize = value.pageSize ?? 100;
    if (!Number.isSafeInteger(page) || Number(page) < 0 || Number(page) > 1000
      || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 200) {
      throw new Error("CUSTOMER_REP_MAPPING_FILTER_INVALID");
    }
    const q = value.q === undefined ? "" : boundedString(value.q, "q", 120);
    const salesrepId = value.salesrepId === undefined ? "" : boundedString(value.salesrepId, "salesrepId", 100);
    const customerId = value.customerId === undefined ? "" : boundedString(value.customerId, "customerId", 200);
    const consigneeId = value.consigneeId === undefined ? "" : boundedString(value.consigneeId, "consigneeId", 200);
    return { operation, payload: { page, pageSize, q, salesrepId, customerId, consigneeId } };
  }
  if (operation === "detail") {
    if (!onlyKeys(value, new Set(["action", "operation", "id"]))) throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
    return { operation, payload: { id: boundedString(value.id, "id", 200, false) } };
  }
  if (operation === "save") {
    if (!onlyKeys(value, SAVE_FIELDS)) throw new Error("CUSTOMER_REP_MAPPING_PAYLOAD_INVALID");
    const expectedRevision = boundedString(value.expectedRevision, "expectedRevision", 19, false);
    if (!/^[1-9][0-9]{0,18}$/.test(expectedRevision)) throw new Error("CUSTOMER_REP_MAPPING_REVISION_INVALID");
    return {
      operation,
      payload: {
        id: boundedString(value.id, "id", 200, false), expectedRevision,
        salesrepId: boundedString(value.salesrepId, "salesrepId", 100, false),
        salesrepName: boundedString(value.salesrepName, "salesrepName", 240, false),
        customerName: boundedString(value.customerName, "customerName", 300, false),
        consigneeName: boundedString(value.consigneeName, "consigneeName", 300, false),
      },
    };
  }
  throw new Error("CUSTOMER_REP_MAPPING_OPERATION_INVALID");
}
