import { assertEquals } from "jsr:@std/assert@1";
import type { AppSessionClaims } from "../_shared/app-auth.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { handleManagerReportReadAction } = await import("./index.ts");

const session: AppSessionClaims = {
  ver: 2, authUserId: "00000000-0000-4000-8000-000000000091", username: "stale_username",
  displayName: "Stale Session Name", role: "ADMIN", mustChangePassword: false, iat: 1, exp: 9999999999,
};
const activeProfile = {
  id: session.authUserId, username: "dylan_collyge", display_name: "Dylan Collyge",
  role: "ADMIN", disabled_at: null, locked_until: null, must_change_password: false,
};
type Call = { path: string; query: URLSearchParams; body: unknown; headers: Headers };

async function mockDatabase<T>(options: {
  profile?: unknown;
  accountActive?: boolean;
  rpcData?: unknown;
  rpcError?: { message: string; code?: string; status?: number };
}, action: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "http://127.0.0.1:54321") throw new Error("Unexpected external request");
    const body = request.method === "POST" ? await request.json() : null;
    calls.push({ path: url.pathname, query: url.searchParams, body, headers: request.headers });
    const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), {
      status, headers: { "content-type": "application/json" },
    }));
    if (url.pathname === "/rest/v1/profiles") return json(options.profile === undefined ? activeProfile : options.profile);
    if (url.pathname === "/rest/v1/rpc/app_account_active_v1") return json(options.accountActive !== false);
    if (url.pathname === "/rest/v1/app_dataset_revisions") return json({ revision: 9, state: "ready" });
    if (url.pathname === "/rest/v1/ph_master_inventory") return Promise.resolve(new Response(JSON.stringify([{
      unique_id: "ncr-row-1", itemcode: "001973.030.1", locationcode: "I.12.000",
      app_tab_assignment: "ncr_outbox_new_crop", priority: 2,
      ncr_approval_message: '[[GNC_NCR_ITEM_INQUIRY:{"activeRows":[{}]}]]',
    }]), {
      status: 200, headers: { "content-type": "application/json", "content-range": "0-0/3" },
    }));
    if (url.pathname === "/rest/v1/rpc/inventory_location_on_hand_read_v1") {
      const args = body as { p_pairs?: Array<{ itemcode: string; locationcode: string }>; p_expected_revision?: string };
      const pairs = Array.isArray(args.p_pairs) ? args.p_pairs : [];
      return json({ inventoryRevision: "12", rows: pairs.map(pair => ({
        itemcode: pair.itemcode, locationcode: pair.locationcode, loc_on_hand: 2000, loc_on_hand_revision: "12",
      })) });
    }
    if (url.pathname === "/rest/v1/rpc/manager_report_read_v2") {
      if (options.rpcError) return json({ message: options.rpcError.message, code: options.rpcError.code || "40001" }, options.rpcError.status || 409);
      return json(options.rpcData ?? { ok: true, version: "manager-report-read-v2", surfaces: ["eval1", "eval2", "ncr"] });
    }
    if (url.pathname === "/rest/v1/rpc/manager_ncr_outbox_metadata_v1") {
      return json({ total: 3, activeLineCount: 7, sourceRevision: "9" });
    }
    throw new Error("Unexpected database route: " + url.pathname);
  };
  try { return await action(calls); }
  finally { globalThis.fetch = originalFetch; }
}

Deno.test("manager report capabilities fall back safely when the new RPC is absent", async () => {
  await mockDatabase({ rpcError: { message: "Could not find the function manager_report_read_v2", status: 404 } }, async calls => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: { operation: "capabilities" } });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, data: {
      version: "manager-report-read-v2", surfaces: [], approvalTabs: [], operations: [],
    } });
    assertEquals(calls.filter(call => call.path.endsWith("manager_report_read_v2")).length, 1);
  });
});

Deno.test("manager report capabilities intersect backend surfaces with active actor access", async () => {
  await mockDatabase({ rpcData: { ok: true, surfaces: ["eval1", "eval2", "ncr", "assigned-items", "season-priority"] } }, async calls => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: { operation: "capabilities" } });
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.data.surfaces, ["eval1", "eval2", "ncr", "assigned-items", "season-priority"]);
    assertEquals(body.data.operations, ["groups", "rows", "metadata", "detail"]);
    const rpc = calls.find(call => call.path.endsWith("manager_report_read_v2"));
    assertEquals(rpc?.body, { p_payload: { actorUsername: "dylan_collyge", operation: "capabilities" } });
  });
});

Deno.test("manager report reads clamp pages, project safe report ids and use active profile identity", async () => {
  await mockDatabase({ rpcData: { ok: true, rows: [], total: 0, hasMore: false, sourceRevision: "rev-9", metadata: {} } }, async calls => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: {
      surface: "eval2", operation: "rows", limit: 500, offset: 12,
      sourceRevision: "rev-9", filters: { reportIds: ["u1", "ignored", 5] },
    } });
    assertEquals(response.status, 200);
    const rpc = calls.find(call => call.path.endsWith("manager_report_read_v2"));
    assertEquals(rpc?.body, { p_payload: {
      actorUsername: "dylan_collyge", surface: "eval2", operation: "rows",
      filters: { reportIds: ["u1", "ignored"] }, offset: 12, limit: 100, sourceRevision: "rev-9",
    } });
  });
});

Deno.test("manager report revision conflicts are explicit and distinguishable", async () => {
  await mockDatabase({ rpcError: { message: "manager_report_source_revision_changed" } }, async () => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: {
      surface: "eval2", operation: "groups", filters: {}, sourceRevision: "old",
    } });
    assertEquals(response.status, 409);
    assertEquals((await response.json()).code, "MANAGER_REPORT_SOURCE_REVISION_CHANGED");
  });
});

Deno.test("NCR approval outbox uses an authorized exact-assignment bounded page and package projection", async () => {
  await mockDatabase({ profile: { ...activeProfile, role: "FOREMAN" } }, async calls => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: {
      surface: "approval", operation: "rows", limit: 500, offset: 0,
      filters: { approvalTab: "ncr-approvals", queue: "outbox" },
    } });
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.data.total, 3);
    assertEquals(body.data.hasMore, true);
    assertEquals(body.data.metadata.activeLineCount, 7);
    assertEquals(body.data.metadata.assignments, ["ncr_outbox_new_crop"]);
    assertEquals(body.data.inventoryRevision, "12");
    assertEquals(body.data.rows[0].loc_on_hand, 2000);
    assertEquals(body.data.rows[0].loc_on_hand_revision, "12");
    const inventory = calls.find(call => call.path === "/rest/v1/ph_master_inventory");
    assertEquals(inventory?.query.get("app_tab_assignment"), "in.(ncr_outbox_new_crop)");
    assertEquals(inventory?.query.getAll("ncr_approval_message"), ["like.%[[GNC_NCR_ITEM_INQUIRY:%", "like.%\"activeRows\":[{%"]);
    assertEquals(inventory?.query.get("offset"), "0");
    assertEquals(inventory?.query.get("limit"), "100");
    assertEquals(inventory?.query.get("select")?.includes("ncr_approval_message"), true);
    assertEquals(inventory?.query.get("priority"), "not.is.null");
    const locationReads = calls.filter(call => call.path.endsWith("inventory_location_on_hand_read_v1"));
    assertEquals(locationReads.length, 2, "outbox pagination captures then fences the inventory aggregate revision");
    assertEquals((locationReads[0].body as Record<string, unknown>).p_pairs, []);
    assertEquals((locationReads[1].body as Record<string, unknown>).p_pairs, [{ itemcode: "001973.030.1", locationcode: "I.12.000" }]);
    assertEquals((locationReads[1].body as Record<string, unknown>).p_expected_revision, "12");
    assertEquals(calls.filter(call => call.path.endsWith("manager_ncr_outbox_metadata_v1")).length, 2);
  });
});

Deno.test("manager report action requires an authenticated, active profile before backend reads", async () => {
  await mockDatabase({}, async calls => {
    assertEquals((await handleManagerReportReadAction(null, { action: "report_read_v2", query: { operation: "capabilities" } })).status, 401);
    assertEquals((await handleManagerReportReadAction({ ...session, mustChangePassword: true }, { action: "report_read_v2", query: { operation: "capabilities" } })).status, 403);
    assertEquals(calls.some(call => call.path.endsWith("manager_report_read_v2")), false);
  });
  await mockDatabase({ accountActive: false }, async calls => {
    const response = await handleManagerReportReadAction(session, { action: "report_read_v2", query: {
      surface: "eval2", operation: "groups",
    } });
    assertEquals(response.status, 403);
    assertEquals((await response.json()).code, "PROFILE_NOT_ACTIVE");
    assertEquals(calls.some(call => call.path.endsWith("manager_report_read_v2")), false);
  });
});
