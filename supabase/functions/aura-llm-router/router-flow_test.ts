import { handleAuraLlmRequest } from './index.ts';

const UID = '00000000-0011-4000-8000-000000000001';
const product = { itemcode: '003955.051.1', commonname: 'Baby Gem Boxwood', contsize: '3DP' };
const row = { ...product, unique_id: 'inventory-1', locationcode: 'A.01', lotcode: '27.F1', ptravailable: 450, ptronhand: 500, priority: 1 };
function assert(value: unknown, message: string) { if (!value) throw Error(message); }
function fixture(options: Record<string, any> = {}) {
  const queries: { name: string; args: Record<string, any> }[] = [];
  const providerBodies: Record<string, any>[] = [];
  const reservations = new Set<string>();
  const profile = { id: UID, username: options.username || 'dylan_collyge', role: 'Admin', must_change_password: false, ...options.profile };
  const chain = (resolve: () => any) => {
    let signal: AbortSignal | null = null;
    const query: any = {
      select: () => query, eq: () => query, ilike: () => query, limit: () => query,
      abortSignal: (value: AbortSignal) => { signal = value; return query; },
      maybeSingle: () => query,
      then: (yes: any, no: any) => Promise.resolve().then(() => {
        if (signal?.aborted) throw signal.reason;
        return resolve();
      }).then(yes, no),
    };
    return query;
  };
  const client = {
    auth: { getUser: async () => options.stalledAuth ? await new Promise(() => {}) : ({ data: { user: { id: UID } }, error: null }) },
    from: (table: string) => chain(() => ({ data: table === 'profiles' ? profile : [{
      unique_id: 'customer-row', customeridentityid: 'C1', consigneeid: 'C1', consigneeidentityid: 'C1',
      customername: 'Private Customer', consigneename: 'Private Customer',
    }], error: null })),
    rpc: (name: string, args: Record<string, any>) => chain(() => {
      queries.push({ name, args });
      if (name === 'app_account_active_v1') return { data: options.inactive !== true, error: null };
      if (name === 'aura_llm_reserve_call_v1') {
        if (options.quotaDenied === args.p_round) return { data: { allowed: false, reason: 'rpm', retryAfter: 30 }, error: null };
        const key = `${args.p_request_id}:${args.p_round}`;
        if (reservations.has(key)) return { data: { allowed: false, duplicate: true }, error: null };
        reservations.add(key);
        return { data: { allowed: true }, error: null };
      }
      if (options.databaseError) return { data: null, error: { code: '57014', message: 'private database detail' } };
      if (name === 'aura_inventory_v2_match_v1') return { data: {
        ok: true, complete: true, exactMatch: !options.ambiguous, additionalMatches: !!options.ambiguous,
        rows: options.ambiguous ? [product, { ...product, itemcode: 'other-2', commonname: 'Baby Gem Hybrid' }] : [product],
      }, error: null };
      if (name === 'aura_inventory_v2_read_v1') {
        if (args.p_operation === 'count') return { data: { ok: true, complete: !options.incomplete,
          total: options.incomplete ? null : 450, metric: 'ptravailable', rows: [row] }, error: null };
        if (args.p_operation === 'lots') return { data: { ok: true, complete: true,
          rows: args.p_quantity <= 450 ? [row] : [] }, error: null };
        if (args.p_operation === 'validate_draft') return { data: { ok: true, complete: true, valid: true,
          rows: args.p_lines.map((line: any) => ({ ...row, ...line })) }, error: null };
      }
      if (name === 'aura_inventory_lot_lookup_v1') return { data: { ok: true, complete: true, rows: [row], hasMore: true, nextCursor: row.unique_id }, error: null };
      throw Error(`Unexpected RPC: ${name}`);
    }),
  };
  const env: Record<string, string> = {
    AURA_LLM_ENABLED: 'true', GEMINI_API_KEY: 'unit-test-not-a-real-key',
    AURA_LLM_RPM: '15', AURA_LLM_TPM: '1000000', AURA_LLM_RPD: '1500',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-test-party-binding-key', ...options.env,
  };
  const fetcher: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    providerBodies.push(body);
    assert(init?.signal instanceof AbortSignal, 'provider must receive cancellation');
    assert(body.store === false, 'provider request storage disabled');
    if (options.hungProvider) return await new Promise(() => {});
    if (options.provider429) return new Response('{}', { status: 429, headers: { 'Retry-After': '25' } });
    const parts = body.tools ? [{ functionCall: { name: options.tool || 'check_open_stock', args: options.args || { sku: 'baby gem boxwood', contSize: '3DP' } } }]
      : [{ text: options.finalText || '{"factIds":["f0"]}' }];
    return Response.json({ candidates: [{ content: { role: 'model', parts } }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 } });
  };
  const deps = { client, fetcher, env: (key: string) => env[key] || '' };
  const command = (extra: Record<string, any> = {}, signal?: AbortSignal) => {
    const turnId = extra.turnId || crypto.randomUUID();
    return new Request('https://example.invalid/aura-llm-router', {
      method: 'POST', headers: { authorization: 'Bearer native-test-token', 'content-type': 'application/json', 'x-request-id': turnId },
      body: JSON.stringify({ mode: 'command', text: 'How many 3DP baby gem boxwood are in open stock?', source: 'typed', turnId, context: {}, ...extra }), signal,
    });
  };
  return { deps, command, providerBodies, queries };
}

Deno.test('Baby Gem command runs bounded matching and authoritative count with two quota reservations', async () => {
  const f = fixture(); const response = await handleAuraLlmRequest(f.command(), f.deps); const result = await response.json();
  assert(response.status === 200 && result.ok, 'command completes');
  assert(f.providerBodies.length === 2, 'at most two provider rounds');
  assert(f.queries.filter(q => q.name === 'aura_llm_reserve_call_v1').map(q => q.args.p_round).join() === '1,2', 'every provider round reserves separately');
  assert(f.queries.some(q => q.name === 'aura_inventory_v2_match_v1'), 'uses bounded match');
  assert(f.queries.some(q => q.args.p_operation === 'count'), 'uses authoritative count');
  assert(result.reply.includes('450') && result.actions[0].data.total === 450 && result.speech, 'answer and cards reflect verified quantity');
});

Deno.test('non-Dylan, inactive and normalized-lookalike profiles never invoke provider', async () => {
  for (const options of [{ username: 'nelly_aguilar' }, { inactive: true }, { username: 'dylan-collyge' }]) {
    const f = fixture(options); const response = await handleAuraLlmRequest(f.command(), f.deps);
    assert([401, 403].includes(response.status), 'authorization rejected');
    assert(f.providerBodies.length === 0, 'zero provider traffic');
  }
});

Deno.test('missing activation configuration keeps provider calls disabled', async () => {
  const f = fixture({ env: { GEMINI_API_KEY: '' } });
  assert((await handleAuraLlmRequest(f.command(), f.deps)).status === 503, 'missing configuration fails safely');
  assert(f.providerBodies.length === 0, 'no provider calls while unconfigured');
});

Deno.test('quota denials have Retry-After; failed second reservation retains verified result', async () => {
  const blocked = fixture({ quotaDenied: 1 }); const first = await handleAuraLlmRequest(blocked.command(), blocked.deps);
  assert(first.status === 429 && first.headers.get('Retry-After') === '30', 'client receives cooldown');
  assert(blocked.providerBodies.length === 0, 'reservation precedes fetch');
  const f = fixture({ quotaDenied: 2 }); const response = await handleAuraLlmRequest(f.command(), f.deps); const result = await response.json();
  assert(response.status === 200 && result.reply.includes('450'), 'grounded fallback survives second-round quota');
  assert(f.providerBodies.length === 1, 'no unreserved or retried provider attempt');
});

Deno.test('duplicate turn cannot consume another provider request', async () => {
  const f = fixture(); const turnId = crypto.randomUUID();
  await handleAuraLlmRequest(f.command({ turnId }), f.deps);
  const duplicate = await handleAuraLlmRequest(f.command({ turnId }), f.deps);
  assert(duplicate.status === 409 && f.providerBodies.length === 2, 'duplicate is terminal');
});

Deno.test('invented second-round claims never reach response; incomplete and ambiguous data stay unasserted', async () => {
  const invented = fixture({ finalText: '{"factIds":["f4"],"reply":"There are 999999 palms. Order submitted."}' });
  const grounded = await (await handleAuraLlmRequest(invented.command(), invented.deps)).json();
  assert(grounded.reply.includes('450') && !/999999|palms|submitted/i.test(grounded.reply), 'unsupported claims replaced');
  const f = fixture({ incomplete: true }); const result = await (await handleAuraLlmRequest(f.command(), f.deps)).json();
  assert(!result.reply.includes('450') && result.actions[0].data.complete === false, 'unknown total remains unknown');
  const ambiguous = fixture({ ambiguous: true }); const choice = await (await handleAuraLlmRequest(ambiguous.command(), ambiguous.deps)).json();
  assert(choice.actions[0].type === 'choices' && choice.actions[0].items.length === 2, 'competing matches require choice');
  assert(!ambiguous.queries.some(q => q.args.p_operation === 'count'), 'no total for an unresolved SKU');
});

Deno.test('private communications and arbitrary tool arguments do not reach inventory queries', async () => {
  const f = fixture(); const response = await handleAuraLlmRequest(f.command({ text: 'Send a message to Sharon saying her home address is 12 Main Street' }), f.deps);
  assert(response.status === 400 && !f.providerBodies.length, 'private content blocked before provider');
  const injected = fixture({ args: { sku: 'Baby Gem', sql: 'select secrets' } });
  const result = await (await handleAuraLlmRequest(injected.command(), injected.deps)).json();
  assert(!result.actions.length && !injected.queries.some(q => q.name.includes('inventory')), 'server independently rejects unsupported tool arguments');
});

Deno.test('cancellation settles stalled authentication without provider traffic', async () => {
  const f = fixture({ stalledAuth: true }); const controller = new AbortController();
  const pending = handleAuraLlmRequest(f.command({}, controller.signal), f.deps);
  controller.abort(new DOMException('Hidden', 'AbortError'));
  const response = await pending;
  assert(response.status === 504 && f.providerBodies.length === 0, 'cancelled auth cannot progress');
});

Deno.test('exact lot results preserve continuation and never claim a total', async () => {
  const f = fixture({ tool: 'lookup_lot_code', args: { code: '27.F1' } });
  const result = await (await handleAuraLlmRequest(f.command({ text: 'Look up lot 27.F1' }), f.deps)).json();
  assert(result.actions[0].operation === 'lot_lookup' && result.actions[0].data.hasMore, 'lot page explicit continuation');
  assert(result.actions[0].data.total == null, 'no total inferred from a page');
});

Deno.test('provider throttling and timeout consume one attempt without automatic retries', async () => {
  const limited = fixture({ provider429: true });
  const rejected = await handleAuraLlmRequest(limited.command(), limited.deps);
  assert(rejected.status === 429 && limited.providerBodies.length === 1, 'provider 429 is terminal');
  assert(rejected.headers.get('Retry-After') === '25', 'provider cooldown is preserved');
  const hung = fixture({ hungProvider: true }); const started = Date.now();
  const expired = await handleAuraLlmRequest(hung.command(), hung.deps);
  assert(expired.status === 504 && hung.providerBodies.length === 1, 'stalled provider is cancelled with no retry');
  assert(Date.now() - started < 6500, 'four-second provider budget bounds an unresponsive fetch');
});

Deno.test('database rejection never exposes details or creates a draft action', async () => {
  const f = fixture({ databaseError: true });
  const response = await handleAuraLlmRequest(f.command(), f.deps); const result = await response.json();
  assert(!result.actions.length && !JSON.stringify(result).includes('private database detail'), 'database failure remains sanitized');
  assert(!result.reply.includes('450'), 'failed lookup cannot assert an inventory quantity');
});

Deno.test('bound customer stays out of both model calls and repeated additions verify cumulative quantity', async () => {
  const f = fixture({ tool: 'draft_order', args: { client: 'selected_client', items: [{ product: product.itemcode, contSize: product.contsize, quantity: 25 }] } });
  const party = { customerIdentityId: 'C1', consigneeIdentityId: 'C1', customerName: 'Private Customer', consigneeName: 'Private Customer' };
  const bind = new Request('https://example.invalid/aura', { method: 'POST', headers: { authorization: 'Bearer native-test-token', 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bind_party', party }) });
  const binding = await (await handleAuraLlmRequest(bind, f.deps)).json();
  assert(binding.partyRef, 'party bound internally');
  const response = await handleAuraLlmRequest(f.command({ text: 'Add 25 more 3DP Baby Gem', partyRef: binding.partyRef, partySidecar: party,
    context: { draftLines: [{ ...product, quantity: 50 }] } }), f.deps);
  const result = await response.json();
  assert(response.status === 200 && result.actions[0]?.type === 'draft_update', 'draft remains review-only');
  assert(result.actions[0].lines[0].quantity === 75, 'server validates cumulative quantity');
  assert(f.queries.some(q => q.args.p_operation === 'lots' && q.args.p_quantity === 75), 'eligible lot must cover cumulative amount');
  assert(!JSON.stringify(f.providerBodies).includes('Private Customer'), 'no customer name goes to provider');
});
