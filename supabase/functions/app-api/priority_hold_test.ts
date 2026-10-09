import { assertEquals } from "jsr:@std/assert@1";
import type { AppSessionClaims } from "../_shared/app-auth.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
const { handleDriveReclassAction } = await import("./index.ts");
const policy = "reclass-action-workflow-v6-smart-shield-20261009";
const session: AppSessionClaims = {
  ver: 2, authUserId: "00000000-0000-4000-8000-000000000001",
  username: "stale_username", displayName: "Stored actor", role: "ADMIN",
  mustChangePassword: false, iat: 1, exp: 9999999999,
};
const activeProfile = {
  id: session.authUserId, username: "dylan_collyge", display_name: "Dylan Collyge",
  role: "ADMIN", disabled_at: null, locked_until: null, must_change_password: false,
};
const payload = () => ({
  action: "drive_reclass_inquiry", operation: "create", workflowPolicyVersion: policy,
  idempotencyToken: "priority-hold-edge-fixture-00001",
  source: { unique_id: "synthetic-row", source_table: "ph_master_inventory", itemcode: "00001", locationcode: "C.06.001", lotcode: "fixture" },
  transaction: { requestActions: ["priority_change"], holdStopProposals: [], scope: {} },
  rowOverlays: [{ unique_id: "synthetic-row", resolution: "done",
    expected: { itemcode: "00001", locationcode: "C.06.001", lotcode: "fixture", ptronhand: "20", desigitem: "", priority: "2", holdstopcode: null, holdstopreason: null },
    proposals: [{ action: "priority_change", priority: "1" }],
  }],
});

const confirmedEvidence = () => ({
  unique_id: "synthetic-row", itemcode: "00001", locationcode: "C.06.001", lotcode: "fixture",
  last_updated: "2026-10-09T12:00:00Z", photo_link: null, photo_name: null, match: null,
  spec: null, caliper: null, initial_ptr: null, loc_match_qty: null, ptravailable: "20",
  av_note: null, pic_note: null, sales_note: null, date_completed: null, app_tab_assignment: null,
  av_rule_av_note_updated_at: null, av_rule_bundle_updated_at: null, av_rule_caliper_updated_at: null,
  av_rule_holdstop_snapshot: null, av_rule_last_clear_reason: null, av_rule_last_cleared_at: null,
  av_rule_match_updated_at: null, av_rule_photo_updated_at: null, av_rule_priority_snapshot: "1",
  av_rule_spec_updated_at: null,
});

type Call = { path: string; query: URLSearchParams; body: unknown };
async function mockDatabase<T>(options: {
  profile?: unknown; accountActive?: boolean; result?: unknown; error?: string;
}, action: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "http://127.0.0.1:54321") throw new Error("Unexpected external request");
    calls.push({ path: url.pathname, query: url.searchParams,
      body: request.method === "POST" ? await request.json() : null });
    const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
      status, headers: { "content-type": "application/json" },
    }));
    if (url.pathname === "/rest/v1/profiles") return json(options.profile === undefined ? activeProfile : options.profile);
    if (url.pathname === "/rest/v1/rpc/app_account_active_v1") return json(options.accountActive !== false);
    if (url.pathname === "/rest/v1/rpc/enqueue_drive_reclass_inquiry_v6"
      || url.pathname === "/rest/v1/rpc/submit_manager_season_priority_v2") {
      return options.error
        ? json({ message: options.error, code: "40001", details: null, hint: null }, 409)
        : json(options.result ?? { ok: true, status: "queued", liveEdits: [], inventoryRevision: "1" });
    }
    throw new Error(`Unexpected database route: ${url.pathname}`);
  };
  try { return await action(calls); }
  finally { globalThis.fetch = originalFetch; }
}

Deno.test("priority/hold submission requires authenticated, active, unlocked identity before writes", async () => {
  await mockDatabase({}, async calls => {
    assertEquals((await handleDriveReclassAction(null, payload())).status, 401);
    assertEquals((await handleDriveReclassAction({ ...session, mustChangePassword: true }, payload())).status, 403);
    assertEquals(calls.length, 0);
  });
  for (const profile of [null, { ...activeProfile, disabled_at: "2026-01-01T00:00:00Z" },
    { ...activeProfile, locked_until: "2999-01-01T00:00:00Z" }, { ...activeProfile, must_change_password: true }]) {
    await mockDatabase({ profile }, async calls => {
      assertEquals((await handleDriveReclassAction(session, payload())).status, 403);
      assertEquals(calls.some(call => call.path.includes("enqueue_")), false);
    });
  }
  await mockDatabase({ accountActive: false }, async calls => {
    assertEquals((await handleDriveReclassAction(session, payload())).status, 403);
    assertEquals(calls.some(call => call.path.includes("enqueue_")), false);
  });
});

Deno.test("V6 routes once through the atomic RPC with the stored actor and no caller-controlled fanout authority", async () => {
  const result = { ok: true, status: "queued", jobId: "synthetic-job", inventoryRevision: "9007199254740993",
    liveEdits: [{ unique_id: "synthetic-row", priority: "1", holdstopcode: null, holdstopreason: null,
      av_rule_last_clear_reason: null, av_rule_last_cleared_at: null,
      last_updated: "2026-10-09T12:00:00Z", evidence: confirmedEvidence() }] };
  await mockDatabase({ result }, async calls => {
    const response = await handleDriveReclassAction(session, {
      ...payload(), actorUsername: "forged_actor", fanout: true, currentSeason: "S1", salesYear: 99,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), result);
    assertEquals(response.headers.get("cache-control"), "private, no-store");
    const writes = calls.filter(call => call.path.includes("enqueue_"));
    assertEquals(writes.length, 1);
    assertEquals(writes[0].body, { p_payload: {
      workflowPolicyVersion: policy, idempotencyToken: payload().idempotencyToken,
      source: payload().source, transaction: payload().transaction,
      rowOverlays: payload().rowOverlays, clientVersion: "", actorUsername: activeProfile.username,
    } });
    assertEquals(calls[0].query.get("id"), `eq.${session.authUserId}`);
    assertEquals(calls.some(call => call.path === "/rest/v1/ph_master_inventory"), false);
  });
});

Deno.test("atomic submission conflicts never become a successful live edit response", async () => {
  await mockDatabase({ error: "DRIVE_RECLASS_SOURCE_ROW_CHANGED" }, async calls => {
    const response = await handleDriveReclassAction(session, payload());
    assertEquals(response.status, 409);
    const body = await response.json();
    assertEquals(body.code, "DRIVE_RECLASS_SOURCE_CHANGED");
    assertEquals(Object.hasOwn(body, "liveEdits"), false);
    assertEquals(calls.filter(call => call.path.includes("enqueue_")).length, 1);
  });
});

Deno.test("V6 validation, stale edits, and refreshing inventory remain distinguishable", async () => {
  for (const [error, status] of [
    ["DRIVE_RECLASS_V6_MOVE_UP_HOLD_CONFLICT", 400],
    ["RECLASS_V6_LIVE_EDIT_CONFLICT", 409],
    ["RECLASS_V6_LIVE_EDIT_ROW_MISSING", 409],
    ["RECLASS_V6_INVENTORY_REFRESH_REQUIRED", 503],
  ] as const) {
    await mockDatabase({ error }, async calls => {
      const response = await handleDriveReclassAction(session, payload());
      assertEquals(response.status, status, error);
      const body = await response.json();
      assertEquals(Object.hasOwn(body, "liveEdits"), false);
      assertEquals(calls.filter(call => call.path.includes("enqueue_")).length, 1);
    });
  }
});

Deno.test("Managers priority submission uses the same atomic live edit contract and stored profile ID", async () => {
  const result = { ok: true, lifecycleStatus: "queued", inventoryRevision: "81", liveEdits: [
    { unique_id: "synthetic-row", priority: "1", holdstopcode: "H", holdstopreason: "Review",
      av_rule_last_clear_reason: "season-priority", av_rule_last_cleared_at: "2026-10-09T12:00:00Z",
      last_updated: "2026-10-09T12:00:00Z", evidence: { ...confirmedEvidence(),
        av_rule_last_clear_reason: "season-priority", av_rule_last_cleared_at: "2026-10-09T12:00:00Z" } },
  ] };
  await mockDatabase({ result }, async calls => {
    const response = await handleDriveReclassAction(session, {
      operation: "season_priority_submit", sourceUid: "synthetic-row", expectedPriority: 2,
      scopeFingerprint: "a".repeat(64), idempotencyToken: "manager-priority-edge-fixture-0001",
      actorId: "forged-id", season: "S1", salesYear: 99,
    });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), result);
    const writes = calls.filter(call => call.path.includes("submit_manager_"));
    assertEquals(writes.length, 1);
    assertEquals(writes[0].body, {
      p_actor_id: activeProfile.id, p_source_unique_id: "synthetic-row", p_expected_priority: 2,
      p_scope_fingerprint: "a".repeat(64), p_idempotency_token: "manager-priority-edge-fixture-0001",
    });
  });
});
