import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isCustomerRepMappingEditorRole, validateCustomerRepMappingRequest } from "./customer-rep-mapping.ts";

Deno.test("customer rep map list accepts only bounded filters and known sort fields", () => {
  assertEquals(validateCustomerRepMappingRequest({
    action: "customer-rep-map", operation: "list", page: 0, pageSize: 50,
    filters: { salesrepid: "42", status: "active" }, sort: "customername", direction: "asc",
  }), {
    operation: "list",
    payload: { page: 0, pageSize: 50, filters: { salesrepid: "42", status: "active" }, sort: "customername", direction: "asc", q: "" },
  });
  for (const invalid of [
    { action: "customer-rep-map", operation: "list", page: -1 },
    { action: "customer-rep-map", operation: "list", pageSize: 201 },
    { action: "customer-rep-map", operation: "list", sort: "raw_data" },
    { action: "customer-rep-map", operation: "list", filters: { raw_data: "secret" } },
    { action: "customer-rep-map", operation: "list", filters: { status: "deleted" } },
    { action: "customer-rep-map", operation: "list", unknown: true },
  ]) assertThrows(() => validateCustomerRepMappingRequest(invalid));
});

Deno.test("customer rep map detail and save reject raw data, identity edits, and stale revision formats", () => {
  assertEquals(validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "detail", id: "cust_rep_1" }), {
    operation: "detail", payload: { id: "cust_rep_1" },
  });
  assertEquals(validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "save", id: "cust_rep_1",
    expectedRevision: "12", salesrepId: "42", salesrepName: "Rep Name", customerName: "Customer", consigneeName: "Consignee" }), {
    operation: "save", payload: { id: "cust_rep_1", expectedRevision: "12", salesrepId: "42", salesrepName: "Rep Name", customerName: "Customer", consigneeName: "Consignee" },
  });
  assertThrows(() => validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "detail", id: "x", rawData: {} }));
  assertThrows(() => validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "save", id: "x",
    expectedRevision: "1", salesrepId: "42", salesrepName: "R", customerName: "C", consigneeName: "K", rawData: {} }));
  assertThrows(() => validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "save", id: "x",
    expectedRevision: "01", salesrepId: "42", salesrepName: "R", customerName: "C", consigneeName: "K" }));
});

Deno.test("customer rep map Request options are bounded and carry no management fields", () => {
  assertEquals(validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "options", page: 2, pageSize: 100, q: "maple", salesrepId: "R1", customerId: "C1", consigneeId: "D1" }), {
    operation: "options", payload: { page: 2, pageSize: 100, q: "maple", salesrepId: "R1", customerId: "C1", consigneeId: "D1" },
  });
  assertEquals(validateCustomerRepMappingRequest({ action: "customer-rep-map", operation: "options" }), {
    operation: "options", payload: { page: 0, pageSize: 100, q: "", salesrepId: "", customerId: "", consigneeId: "" },
  });
  for (const invalid of [
    { action: "customer-rep-map", operation: "options", pageSize: 201 },
    { action: "customer-rep-map", operation: "options", q: "x".repeat(121) },
    { action: "customer-rep-map", operation: "options", rawData: true },
  ]) assertThrows(() => validateCustomerRepMappingRequest(invalid));
});

Deno.test("only current Admin and Manager roles may edit customer rep mappings", () => {
  for (const role of ["Admin", "Administrator", "Manager"]) assertEquals(isCustomerRepMappingEditorRole(role), true);
  for (const role of ["Rep", "CSR", "QC", "Sales Marketing", "", null]) assertEquals(isCustomerRepMappingEditorRole(role), false);
});
