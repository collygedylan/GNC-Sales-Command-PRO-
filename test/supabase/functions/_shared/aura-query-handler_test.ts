// @test-group: aura
import { handleAuraQueryRequest } from "./aura-query-handler.ts";
import { AURA_MODULE_CAPABILITIES } from "./aura-capabilities.ts";

const ACTOR = "00000000-0011-4000-8000-000000000001";
const CONVERSATION = "00000000-0011-4000-8000-000000000002";
const TURN = "00000000-0011-4000-8000-000000000003";
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }

function fixture(options: { username?: string; locked?: boolean; disabled?: boolean; mustChange?: boolean; authValid?: boolean; moduleAllowed?: boolean; inventoryResults?: unknown[]; seasonalResults?: unknown[]; seasonSettings?: { current?: Record<string, unknown>; next?: Record<string, unknown> } | null } = {}) {
  const tables: string[] = [];
  const rpcNames: string[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let revision = 0;
  let savedContext: Record<string, unknown> = {};
  let inventoryIndex = 0;
  let seasonalIndex = 0;
  let seasonSettings: { current?: Record<string, unknown>; next?: Record<string, unknown> } | null = options.seasonSettings === null ? null : {
    current: { seasonCode: "F1", salesYear: 27, revision: 0, ...(options.seasonSettings?.current || {}) },
    next: { seasonCode: "S1", salesYear: 27, revision: 0, ...(options.seasonSettings?.next || {}) },
  };
  let resolvedSeason = { season: "F1", salesYear: 27, settingRevision: 0 };
  const profile = {
    id: ACTOR,
    username: options.username || "dylan_collyge",
    display_name: "Dylan Collyge",
    role: "Admin",
    must_change_password: options.mustChange === true,
    disabled_at: options.disabled ? "2026-01-01T00:00:00Z" : null,
    locked_until: options.locked ? "2999-01-01T00:00:00Z" : null,
  };
  const chain = (table: string, data: unknown) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      in: () => q,
      ilike: () => q,
      like: () => q,
      lt: () => q,
      gte: () => q,
      abortSignal: () => q,
      limit: () => q,
      order: () => q,
      maybeSingle: async () => ({ data, error: null }),
      then: (yes: (value: unknown) => unknown, no: (error: unknown) => unknown) => Promise.resolve({ data, error: null }).then(yes, no),
    };
    return q;
  };
  const admin: any = {
    auth: { getUser: async () => options.authValid === false
      ? ({ data: { user: null }, error: new Error("bad token") })
      : ({ data: { user: { id: ACTOR } }, error: null }) },
    from: (table: string) => { tables.push(table); return chain(table, table === "profiles" ? profile : null); },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcNames.push(name);
      rpcCalls.push({ name, args });
      if (name === "aura_query_conversation_v1") {
        const op = String(args.p_operation || "");
        if (op === "complete") { savedContext = (args.p_payload as Record<string, unknown>)?.context as Record<string, unknown> || {}; revision += 1; }
        const data = op === "begin" ? { conversationId: CONVERSATION, revision, context: savedContext, replayed: false }
          : { conversationId: CONVERSATION, revision };
        return chain(name, data);
      }
      if (name === "aura_query_inventory_v1") {
        const filters = args.p_filters as Record<string, unknown> || {};
        const configured = options.inventoryResults?.[inventoryIndex++] as Record<string, unknown> || {};
        const value: Record<string, unknown> = { ok: true, complete: true, total: 0, rows: [], hasMore: false,
          season: String(filters.season || resolvedSeason.season), salesYear: Number(filters.salesYear ?? resolvedSeason.salesYear), settingRevision: resolvedSeason.settingRevision,
          yearCoverage: "inventory-cutoff", unresolvedCount: 0, ...configured };
        if (Object.hasOwn(configured, "currentSeason") && !Object.hasOwn(configured, "season")) delete value.season;
        return chain(name, value);
      }
      if (name === "aura_query_seasonal_records_v1") {
        const filters = args.p_filters as Record<string, unknown> || {};
        const value = { ok: true, complete: true, total: 0, rows: [], hasMore: false,
          season: String(filters.season || resolvedSeason.season), salesYear: Number(filters.salesYear ?? resolvedSeason.salesYear),
          settingRevision: resolvedSeason.settingRevision, yearCoverage: "season-only", unresolvedCount: 0,
          ...(options.seasonalResults?.[seasonalIndex++] as Record<string, unknown> || {}) };
        return chain(name, value);
      }
      if (name === "aura_resolve_season_v1") {
        const reference = String(args.p_reference || "current") === "next" ? "next" : "current";
        const value = seasonSettings?.[reference] || {};
        resolvedSeason = { season: String(value.seasonCode || ""), salesYear: Number(value.salesYear), settingRevision: Number(value.revision) };
        return chain(name, value);
      }
      const data = name === "app_account_active_v1" ? true
        : name === "navigation_module_allowed_v1" ? options.moduleAllowed === true
        : false;
      return chain(name, data);
    },
  };
  const userTables: string[] = [];
  const user: any = {
    auth: admin.auth,
    from: (table: string) => { userTables.push(table); return chain(table, []); },
    rpc: (name: string) => { rpcNames.push(`user:${name}`); return chain(name, []); },
  };
  const request = (body: unknown, token: string | null = "verified-token") => new Request("https://example.invalid/aura-query", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { admin, user, request, tables, userTables, rpcNames, rpcCalls,
    setSeasonSettings(value: { current?: Record<string, unknown>; next?: Record<string, unknown> } | null) {
      seasonSettings = value === null ? null : {
        current: { seasonCode: "F1", salesYear: 27, revision: 0, ...(value.current || {}) },
        next: { seasonCode: "S1", salesYear: 27, revision: 0, ...(value.next || {}) },
      };
    } };
}

Deno.test("handler denies missing, invalid, non-Dylan, locked, disabled, and password-change identities", async () => {
  const cases = [
    { options: {}, token: null },
    { options: { authValid: false }, token: "bad" },
    { options: { username: "dylan-collyge" }, token: "verified-token" },
    { options: { locked: true }, token: "verified-token" },
    { options: { disabled: true }, token: "verified-token" },
    { options: { mustChange: true }, token: "verified-token" },
  ];
  for (const testCase of cases) {
    const f = fixture(testCase.options);
    const response = await handleAuraQueryRequest(f.request({ mode: "list" }, testCase.token), { adminClient: f.admin, userClient: f.user });
    assert(response.status === 403, `expected forbidden for ${JSON.stringify(testCase.options)}`);
    assert(f.userTables.length === 0, "unauthorized requests must not read domain data");
  }
});

Deno.test("common-name filters reach the fixed inventory RPC and remain the response subject", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [
    { ok: true, complete: true, total: 12, rows: [{ itemcode: "00123", commonName: "Lily of the Valley" }], hasMore: false, exactMatch: true },
  ] });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: 'How many common name "Lily of the Valley" itemcode 00123?', turnId: TURN }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, "explicit common-name query must be accepted");
  const filters = f.rpcCalls.find((call) => call.name === "aura_query_inventory_v1")?.args.p_filters as Record<string, unknown>;
  assert(filters?.commonName === "Lily of the Valley", "commonName must survive the inventory filter allowlist");
  assert(filters.itemcode === "00123", "common name must not erase explicit itemcode or its leading zeros");
  assert(filters.productText === undefined, "explicit common name must not become a generic product query");
  assert(body.reply.includes("12 Lily of the Valley available"), "the response must name the verified common-name scope");
});

Deno.test("write requests only stage a review action and never call a business mutation", async () => {
  const f = fixture({ moduleAllowed: true });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "prepare an order for itemcode 123", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, `valid Dylan request should be handled: ${JSON.stringify(body)}`);
  assert(Array.isArray(body.actions), "response should expose actions");
  assert(body.actions.some((action: any) => action.type === "review"), "write intent should return a review handoff");
  assert(body.actions.some((action: any) => action.type === "review" && action.view === "bloom"), "order drafts must open the existing Bloom order review screen");
  const businessMutations = f.rpcNames.filter((name) => /^(?!aura_query_conversation_v1|navigation_module_allowed_v1|app_account_active_v1)/.test(name));
  assert(businessMutations.length === 0, `write intent invoked a non-memory business RPC: ${businessMutations.join(",")}`);
});

Deno.test("read nouns such as inventory changes and release tasks do not become write handoffs", async () => {
  for (const text of ["Show inventory change requests", "Show release tasks"]) {
    const f = fixture({ moduleAllowed: false });
    const response = await handleAuraQueryRequest(f.request({ mode: "command", text, turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
    const body = await response.json();
    assert(response.status === 200, `${text} should stay a read request`);
    assert(!body.actions.some((action: any) => action.type === "review"), `${text} must not produce a false write proposal`);
  }
});

Deno.test("denied module prevents user-scoped reads for every catalog module", async () => {
  for (const [module, entry] of Object.entries(AURA_MODULE_CAPABILITIES)) {
    const sample = entry.questions[0];
    if (!sample || !entry.capabilities.length || !entry.available) continue;
    const f = fixture({ moduleAllowed: false });
    const response = await handleAuraQueryRequest(f.request({ mode: "command", text: sample, turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
    assert(response.status === 200 || response.status === 400, `${module} should be handled deterministically`);
    const body = await response.json();
    assert(!body.actions?.some((action: any) => ['navigation', 'review'].includes(action.type)), `${module} returned an action despite module denial`);
    assert(f.userTables.length === 0, `${module} read data despite module denial`);
  }
});

Deno.test("memory read refuses stored content after its source module is revoked", async () => {
  const f = fixture({ moduleAllowed: false });
  f.admin.rpc = (name: string) => {
    f.rpcNames.push(name);
    const data = name === "app_account_active_v1" ? true
      : name === "aura_query_conversation_v1" ? { turns: [{ text: "secret", response: { reply: "secret answer" }, sources: [{ capabilityId: "request_queue", module: "request", recordIds: ["req-1"] }] }] }
      : false;
    return chainForTest(data);
  };
  const response = await handleAuraQueryRequest(f.request({ mode: "read", conversationId: CONVERSATION, limit: 20 }), { adminClient: f.admin, userClient: f.user });
  assert(response.status === 403, "revoked source permission must hide stored assistant content");
  assert(f.userTables.length === 0, "revoked transcript read must not query domain tables");
});

Deno.test("memory responses never expose stale internal parser context", async () => {
  const f = fixture({ moduleAllowed: true });
  f.admin.rpc = (name: string) => {
    f.rpcNames.push(name);
    return chainForTest(name === "app_account_active_v1" ? true : name === "aura_query_conversation_v1"
      ? { context: { pendingChoices: [{ id: "private-choice" }], nextCursor: { sensitive: true } }, turns: [] }
      : true);
  };
  const response = await handleAuraQueryRequest(f.request({ mode: "read", conversationId: CONVERSATION, limit: 20 }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, "authorized conversation history should be readable");
  assert(Object.keys(body.context).length === 0, "internal result context should not escape through history APIs");
});

Deno.test("Bunch Notes use the fixed gated read RPC with server-built filters", async () => {
  const f = fixture({ moduleAllowed: true });
  const baseRpc = f.admin.rpc;
  f.admin.rpc = (name: string, args: Record<string, unknown> = {}) => {
    if (name === "aura_query_bunch_v1") {
      f.rpcCalls.push({ name, args });
      f.rpcNames.push(name);
      return chainForTest({ ok: true, complete: true, total: 1, rows: [{ recordId: "note-1", status: "open", title: "Spring roses" }], hasMore: false, nextCursor: null });
    }
    return baseRpc(name, args);
  };
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show Bunch Notes jobs", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, `Bunch Notes read should succeed: ${JSON.stringify(body)}`);
  const call = f.rpcCalls.find((entry) => entry.name === "aura_query_bunch_v1");
  assert(call, "special reader must invoke the whitelisted SQL RPC");
  if (!call) throw new Error("missing Bunch Notes RPC call");
  assert((call.args.p_filters as Record<string, unknown>).status == null, "unrequested filters must not be inferred");
  assert(body.actions.some((action: any) => action.type === "records"), "Bunch Notes rows should use the shared records action");
});

Deno.test("Bunch Notes creation-date filters return an explicit unsupported-scope message", async () => {
  const f = fixture({ moduleAllowed: true });
  const baseRpc = f.admin.rpc;
  f.admin.rpc = (name: string, args: Record<string, unknown> = {}) => {
    if (name === "aura_query_bunch_v1") {
      f.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: { message: "AURA_BUNCH_CREATION_DATE_UNAVAILABLE", code: "22023" } });
    }
    return baseRpc(name, args);
  };
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show Bunch Notes jobs yesterday", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 400 && body.code === "AURA_BUNCH_CREATION_DATE_UNAVAILABLE", `unsupported creation dates should be client errors: ${JSON.stringify(body)}`);
  assert(/reliable creation timestamp/i.test(body.error) && /without a date range/i.test(body.error), "response should explain the missing source timestamp");
  assert((f.rpcCalls.find((entry) => entry.name === "aura_query_bunch_v1")?.args.p_filters as Record<string, unknown>).dateFrom != null,
    "relative date was passed to the SQL reader rather than silently dropped");
});

Deno.test("compatibility handler shares the deterministic primary handler", () => {
  assert(typeof handleAuraQueryRequest === "function", "the same deterministic handler serves both routes");
});

Deno.test("preflight allows the PWA idempotency key header", async () => {
  const f = fixture();
  const request = new Request("https://example.invalid/aura-query", { method: "OPTIONS", headers: { "access-control-request-headers": "authorization,content-type,idempotency-key" } });
  const response = await handleAuraQueryRequest(request, { adminClient: f.admin, userClient: f.user });
  assert(response.status === 200, "preflight should succeed");
  assert(response.headers.get("access-control-allow-headers")?.includes("idempotency-key"), "PWA idempotency-key must be permitted by CORS");
});

Deno.test("chat and HR transcript sources are hidden after module access is revoked", async () => {
  const sources = [
    { mode: "chat", module: "chat", conversationIds: ["conversation-1"] },
    { capabilityId: "hours", module: "hours", recordIds: ["record-1"] },
  ];
  for (const source of sources) {
    const f = fixture({ moduleAllowed: false });
    f.admin.rpc = (name: string) => {
      f.rpcNames.push(name);
      return chainForTest(name === "app_account_active_v1"
        ? true
        : name === "aura_query_conversation_v1"
        ? { turns: [{ text: "sensitive", response: { reply: "sensitive response" }, sources: [source] }] }
        : false);
    };
    const response = await handleAuraQueryRequest(f.request({ mode: "read", conversationId: CONVERSATION, limit: 20 }), { adminClient: f.admin, userClient: f.user });
    assert(response.status === 403, `${source.module} transcript must be denied after access revocation`);
    assert(f.userTables.length === 0, `${source.module} revoked transcript must not read domain tables`);
  }
});

Deno.test("incomplete inventory response never invents a count", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [{ ok: true, complete: false, total: null, rows: [], hasMore: false }] });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "How many roses are available?", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, "inventory query should be answered");
  assert(/count is incomplete/i.test(body.reply), "incomplete totals must be labeled as incomplete");
  assert(!/Verified\s+\d/i.test(body.reply), "the handler must not present an unproven total");
});

Deno.test("empty fuzzy candidate sets use the complete no-match answer with verified season and zone scope", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [{ ok: true, complete: true, total: 0, rows: [], hasMore: false,
    exactMatch: false, candidateChoices: [], currentSeason: "S1", salesYear: 27 }] });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "How many roses are available in perennial area?", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, "complete empty inventory query should succeed");
  assert(/No matching inventory was found/i.test(body.reply), "empty fuzzy candidates should not be presented as zero choices");
  assert(/27S1/i.test(body.reply) && /perennial area/i.test(body.reply), "reply should state the verified season and zone");
});

Deno.test("command responses redact internal parser choices, including invalid choice replies", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [{ ok: true, complete: true, total: null, rows: [], hasMore: false, exactMatch: false,
    candidateChoices: [{ selectionId: "rose-1", itemcode: "123", commonName: "Rose" }] }] });
  const first = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show roses", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const firstBody = await first.json();
  assert(Object.keys(firstBody.context).length === 0, "first command must not expose persisted entity choices");
  const second = await handleAuraQueryRequest(f.request({ mode: "command", text: "option 9", turnId: "00000000-0011-4000-8000-000000000004", source: "typed", conversationId: CONVERSATION, expectedRevision: 1 }), { adminClient: f.admin, userClient: f.user });
  const secondBody = await second.json();
  assert(second.status === 200, "invalid choice should be safely handled");
  assert(Object.keys(secondBody.context).length === 0, "invalid choice response must not replay stale result context");
});

Deno.test("show more reuses the stored cursor and conversation context", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [
    { ok: true, complete: true, total: 2, rows: [{ itemcode: "123", commonName: "Rose", selectionId: "123|rosa|#1" }], hasMore: true, nextCursor: { offset: 50 } },
    { ok: true, complete: true, total: 2, rows: [{ itemcode: "124", commonName: "Rose", selectionId: "124|rosa|#1" }], hasMore: false, nextCursor: null },
  ] });
  const first = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show roses", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const firstBody = await first.json();
  assert(firstBody.hasMore === true && firstBody.nextCursor?.offset === 50, "first page should expose continuation state");
  const second = await handleAuraQueryRequest(f.request({ mode: "command", text: "show more", turnId: "00000000-0011-4000-8000-000000000004", source: "typed", conversationId: CONVERSATION, expectedRevision: 1 }), { adminClient: f.admin, userClient: f.user });
  const secondBody = await second.json();
  assert(second.status === 200, `continuation should succeed: ${JSON.stringify(secondBody)}`);
  const inventoryCalls = f.rpcCalls.filter((call) => call.name === "aura_query_inventory_v1");
  assert(inventoryCalls.length === 2, "both pages should use the inventory reader");
  assert((inventoryCalls[1].args.p_cursor as Record<string, unknown>)?.offset === 50, "continuation must pass the remembered cursor");
  assert(secondBody.hasMore === false, "last page should clear continuation state");
});

Deno.test("purchase-order season selects the fixed matching view without an unsupported SQL column filter", async () => {
  const f = fixture({ moduleAllowed: true });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show purchase-order balances for 27S1", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, `seasonal PO query should be handled: ${JSON.stringify(body)}`);
  assert(f.userTables.includes("ph_view_po_27s1_hl"), "27S1 must select the dedicated spring purchase-order view");
});

Deno.test("database revision conflicts return a retryable conflict status", async () => {
  const f = fixture();
  f.admin.rpc = (name: string, args: Record<string, unknown> = {}) => {
    if (name !== "aura_query_conversation_v1") return chainForTest(name === "app_account_active_v1" ? true : false);
    return { then: (resolve: any, reject: any) => Promise.resolve({ data: null, error: { code: "40001", message: "revision conflict" } }).then(resolve, reject) };
  };
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show roses", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 409, "SQLSTATE 40001 should surface as HTTP 409");
  assert(body.code === "AURA_QUERY_REVISION_CONFLICT", "revision conflict should have a stable retryable code");
});

Deno.test("legacy cached requests are upgraded after auth with a server-derived turn id", async () => {
  const f = fixture({ moduleAllowed: false });
  const request = new Request("https://example.invalid/aura-query", { method: "POST",
    headers: { authorization: "Bearer verified-token", "content-type": "application/json", "idempotency-key": "legacy-retry-key" },
    body: JSON.stringify({ text: "Show roses", context: { lastIntent: { mode: "chat", question: "private" } } }),
  });
  const response = await handleAuraQueryRequest(request, { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, `legacy request should be migrated: ${JSON.stringify(body)}`);
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.requestId || "")), "legacy turn id must be server-derived UUID");
  assert(response.headers.get("x-request-id") === body.requestId, "idempotency id should be returned for safe retries");
  assert(body.interpretation.intent !== "chat", "legacy client context must not steer server routing");
});

Deno.test("legacy bind_party mutation is redirected to the reviewed Bloom flow", async () => {
  const f = fixture();
  const response = await handleAuraQueryRequest(f.request({ mode: "bind_party", party: { customerName: "Acme" } }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 409 && body.code === "AURA_REFRESH_REQUIRED", "legacy bind_party must not mutate or bind data");
  assert(f.userTables.length === 0, "legacy binding call must not access business data");
});

Deno.test("current and next season references stay semantic while SQL returns resolved metadata", async () => {
  const settings = { current: { seasonCode: "F1", salesYear: 27, revision: 4 }, next: { seasonCode: "S1", salesYear: 28, revision: 5 } };
  const currentFixture = fixture({ moduleAllowed: true, seasonSettings: settings });
  const current = await handleAuraQueryRequest(currentFixture.request({ mode: "command", text: "How many roses are available this season?", turnId: TURN, source: "typed" }), { adminClient: currentFixture.admin, userClient: currentFixture.user });
  const currentBody = await current.json();
  const currentSetting = currentFixture.rpcCalls.find((call) => call.name === "aura_resolve_season_v1");
  const currentRead = currentFixture.rpcCalls.find((call) => call.name === "aura_query_inventory_v1");
  const currentFilters = currentRead?.args.p_filters as Record<string, unknown>;
  assert(current.status === 200, "current season query should succeed");
  assert(currentSetting?.args.p_reference === "current", "current language should resolve through current settings");
  assert(currentFilters.seasonReference === "current" && currentFilters.season === undefined, "relative current scope should remain semantic at the data RPC");
  assert(currentBody.interpretation.resolvedSeason.seasonCode === "F1" && currentBody.interpretation.resolvedSeason.salesYear === 27, "response scope should use SQL season metadata");
  assert(currentBody.interpretation.settingRevision === 4, "response should include the setting revision");

  const nextFixture = fixture({ moduleAllowed: true, seasonSettings: settings });
  const next = await handleAuraQueryRequest(nextFixture.request({ mode: "command", text: "How many roses next season?", turnId: "00000000-0011-4000-8000-000000000004", source: "typed" }), { adminClient: nextFixture.admin, userClient: nextFixture.user });
  const nextBody = await next.json();
  const nextSetting = nextFixture.rpcCalls.find((call) => call.name === "aura_resolve_season_v1");
  const nextRead = nextFixture.rpcCalls.find((call) => call.name === "aura_query_inventory_v1");
  assert(next.status === 200, "next season query should succeed");
  assert(nextSetting?.args.p_reference === "next", "next-season language should reach the resolver as a relative reference");
  assert((nextRead?.args.p_filters as Record<string, unknown>).seasonReference === "next", "relative next scope should be retained at the data RPC");
  assert(nextBody.interpretation.resolvedSeason.seasonCode === "S1" && nextBody.interpretation.resolvedSeason.salesYear === 28, "next-season response should use returned metadata");
});

Deno.test("explicit season and year override the resolved current setting", async () => {
  const f = fixture({ moduleAllowed: true, seasonSettings: { current: { seasonCode: "F1", salesYear: 28, revision: 8 } } });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "How many roses for 27S1?", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  const filters = f.rpcCalls.find((call) => call.name === "aura_query_inventory_v1")?.args.p_filters as Record<string, unknown>;
  assert(response.status === 200, "explicit season-year query should succeed");
  assert(filters.season === "S1" && filters.salesYear === 27 && filters.seasonReference === undefined, "literal scope should override current settings and clear relative scope");
  assert(body.interpretation.resolvedSeason.seasonCode === "S1" && body.interpretation.resolvedSeason.salesYear === 27, "response should describe the explicit scope");
});

Deno.test("missing or invalid settings fail clearly, and denied or nonseasonal reads do not resolve settings", async () => {
  const missing = fixture({ moduleAllowed: true, seasonSettings: null });
  const response = await handleAuraQueryRequest(missing.request({ mode: "command", text: "How many roses this season?", turnId: TURN, source: "typed" }), { adminClient: missing.admin, userClient: missing.user });
  const body = await response.json();
  assert(response.status === 503 && body.code === "AURA_SEASON_SETTINGS_UNAVAILABLE", "missing settings should produce the documented 503 response");
  assert(!missing.rpcNames.includes("aura_query_inventory_v1"), "no inventory query should run without valid settings");

  const invalid = fixture({ moduleAllowed: true, seasonSettings: { current: { seasonCode: "U1", salesYear: 27, revision: 1 } } });
  const invalidResponse = await handleAuraQueryRequest(invalid.request({ mode: "command", text: "How many roses this season?", turnId: TURN, source: "typed" }), { adminClient: invalid.admin, userClient: invalid.user });
  assert(invalidResponse.status === 503, "unsupported current season settings should fail closed");

  const denied = fixture({ moduleAllowed: false });
  await handleAuraQueryRequest(denied.request({ mode: "command", text: "How many roses this season?", turnId: TURN, source: "typed" }), { adminClient: denied.admin, userClient: denied.user });
  assert(!denied.rpcNames.includes("aura_resolve_season_v1") && !denied.rpcNames.includes("aura_query_inventory_v1"), "denied inventory must not read settings or rows");

  const nonseasonal = fixture({ moduleAllowed: true });
  await handleAuraQueryRequest(nonseasonal.request({ mode: "command", text: "Show Bunch Notes jobs", turnId: TURN, source: "typed" }), { adminClient: nonseasonal.admin, userClient: nonseasonal.user });
  assert(!nonseasonal.rpcNames.includes("aura_resolve_season_v1"), "nonseasonal readers must not query Manager settings");
});

Deno.test("a changed setting resets selected inventory pagination and returns a restart notice", async () => {
  const f = fixture({ moduleAllowed: true, inventoryResults: [
    { ok: true, complete: true, total: null, rows: [], exactMatch: false, candidateChoices: [{ selectionId: "rose-choice", commonName: "Rose", itemcode: "00123" }], hasMore: true, nextCursor: { offset: 50 } },
    { ok: true, complete: true, total: 3, rows: [{ selectionId: "rose-choice", commonName: "Rose", itemcode: "00123" }], hasMore: true, nextCursor: { offset: 50 } },
    { ok: true, complete: true, total: 2, rows: [{ selectionId: "rose-new", commonName: "Rose", itemcode: "00999" }], hasMore: false, nextCursor: null },
  ] });
  const first = await handleAuraQueryRequest(f.request({ mode: "command", text: "How many roses this season?", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const firstBody = await first.json();
  const selected = await handleAuraQueryRequest(f.request({ mode: "command", text: "option 1", turnId: "00000000-0011-4000-8000-000000000004", source: "typed", conversationId: CONVERSATION, expectedRevision: firstBody.revision }), { adminClient: f.admin, userClient: f.user });
  const selectedBody = await selected.json();
  const calls = () => f.rpcCalls.filter((call) => call.name === "aura_query_inventory_v1");
  assert(selected.status === 200 && selectedBody.hasMore === true, "candidate selection should establish a continuation");
  assert((calls()[1].args.p_filters as Record<string, unknown>).selectionId === "rose-choice", "selected identity should scope the first continuation");

  f.setSeasonSettings({ current: { seasonCode: "S1", salesYear: 28, revision: 1 }, next: { seasonCode: "F1", salesYear: 29, revision: 1 } });
  const more = await handleAuraQueryRequest(f.request({ mode: "command", text: "show more", turnId: "00000000-0011-4000-8000-000000000005", source: "typed", conversationId: CONVERSATION, expectedRevision: selectedBody.revision }), { adminClient: f.admin, userClient: f.user });
  const moreBody = await more.json();
  const restarted = calls()[2];
  const restartedFilters = restarted.args.p_filters as Record<string, unknown>;
  assert(more.status === 200, `changed scope should restart: ${JSON.stringify(moreBody)}`);
  assert(restarted.args.p_cursor === null, "stale pagination cursor must be cleared");
  assert(!Object.hasOwn(restartedFilters, "selectionId"), "stale selection must be cleared");
  assert(restartedFilters.seasonReference === "current", "relative current reference should survive the follow-up");
  assert(/Managers season setting changed/i.test(moreBody.reply), "response should disclose the restart");
  const completedContext = f.rpcCalls.filter((call) => call.name === "aura_query_conversation_v1" && call.args.p_operation === "complete").at(-1)?.args.p_payload as Record<string, unknown>;
  const storedContext = completedContext.context as Record<string, unknown>;
  assert(Array.isArray(storedContext.pendingChoices) && storedContext.pendingChoices.length === 0 && storedContext.nextCursor == null, "old choices and cursor should be cleared from persisted continuation state");
  assert(moreBody.interpretation.resolvedSeason.seasonCode === "S1" && moreBody.interpretation.settingRevision === 1, "response should use the updated scope metadata");
});

Deno.test("season-only records disclose unavailable year coverage and reject explicit year filters", async () => {
  const f = fixture({ moduleAllowed: true, seasonalResults: [{ season: "S1", salesYear: 27, settingRevision: 0, yearCoverage: "season-only", unresolvedCount: 2, total: 4, rows: [{ id: "req-1", itemcode: "00123", season: "S1" }] }] });
  const response = await handleAuraQueryRequest(f.request({ mode: "command", text: "Show request history for S1", turnId: TURN, source: "typed" }), { adminClient: f.admin, userClient: f.user });
  const body = await response.json();
  assert(response.status === 200, "season-only read without a year should succeed");
  assert(/season only/i.test(body.reply) && /sales-year coverage is unavailable/i.test(body.reply), "reply should distinguish season coverage from year coverage");
  assert(/2 matching record/i.test(body.reply), "unresolved source rows should be disclosed");
  assert(body.source.yearCoverage === "season-only" && body.source.unresolvedCount === 2, "source metadata should include coverage and unresolved totals");

  const explicit = fixture({ moduleAllowed: true, seasonalResults: [{ season: "S1", salesYear: 27, settingRevision: 0, yearCoverage: "season-only", unresolvedCount: 0, total: 1, rows: [{ id: "req-1", itemcode: "00123", season: "S1" }] }] });
  const rejected = await handleAuraQueryRequest(explicit.request({ mode: "command", text: "Show request history for 27S1", turnId: TURN, source: "typed" }), { adminClient: explicit.admin, userClient: explicit.user });
  const rejectedBody = await rejected.json();
  assert(rejected.status === 400 && rejectedBody.code === "AURA_SEASON_YEAR_UNAVAILABLE", "an explicit year must be rejected when this source cannot verify it");
});

function chainForTest(data: unknown) {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }), then: (yes: any, no: any) => Promise.resolve({ data, error: null }).then(yes, no) };
  return q;
}
