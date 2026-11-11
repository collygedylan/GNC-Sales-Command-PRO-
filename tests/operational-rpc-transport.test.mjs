import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {dispatchRpcWithRecovery, retryOperationalRpc} from '../src/services/rpc-recovery-domain.js';
import {databaseBridge} from './helpers/database-bridge.mjs';
import {createServer} from 'node:http';

const root = new URL('../', import.meta.url);
const files = ['operational-rpc-retry','rpc-recovery-domain','app-api-transport'];
const source = files.map(name => readFileSync(new URL('src/services/' + name + '.js', root), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');

function neverResolves() {
    return new Promise(() => {});
}

function stalledJsonClone() {
    return {arrayBuffer:neverResolves};
}

function streamingResponse(request, response) {
    const json = request.url.startsWith('/json/');
    response.writeHead(200, {'content-type':json ? 'application/json' : 'application/octet-stream', 'x-transport-fixture':'native'});
    response.write(json ? '{"ok":' : 'first-');
    if (request.url.endsWith('/happy')) setTimeout(response.end.bind(response, 'second'), 5);
}

async function withStreamingServer(run) {
    const server = createServer(streamingResponse);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        return await run('http://127.0.0.1:' + server.address().port);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

function streamingFixture(origin, resource, nativeDeadline) {
    const fixture = transportFixture({nativeDeadline});
    fixture.context.fetch = async (_url, init) => {
        const response = await fetch(origin + resource, init);
        fixture.calls.push({init, response});
        return response;
    };
    return fixture;
}

async function verifyInterruptedStorage(origin, nativeDeadline, cancel = false, resource = '/stream/stall') {
    const fixture = streamingFixture(origin, resource, nativeDeadline);
    const controller = new AbortController();
    const response = await fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/storage/v1/object/public/fixture',
        {signal:controller.signal, headers:{Authorization:'Bearer exact'}}, 100, 'Storage stream');
    assert.equal(response, fixture.calls[0].response);
    assert.equal(response.headers.get('x-transport-fixture'), 'native');
    assert.equal(response.url, origin + resource);
    assert.equal(response.bodyUsed, false);
    if (cancel) controller.abort();
    await assert.rejects(response.arrayBuffer(), /abort|interrupted/i);
    assert.equal(fixture.calls[0].init.signal.aborted, true);
    assert.deepEqual(fixture.timers, nativeDeadline ? [] : [100]);
}

function transportFixture({cellular = false, timerScale = 1, nativeDeadline = false} = {}) {
    const calls = [], timers = [];
    let traces = 0, upgrades = 0;
    const context = vm.createContext({Response, Headers, Request, AbortController, AbortSignal:nativeDeadline ? AbortSignal : undefined, TextEncoder, URL, Map, Set,
        setTimeout:(callback, delay) => { timers.push(delay); return setTimeout(callback, delay * timerScale); }, clearTimeout,
        window:{GncLoginTrace:{fetch:async () => { traces++; return Response.json({trace:true}); }},
            forceAgDataVersionUpgrade:() => upgrades++},
        document:{body:{dataset:{currentView:'managers'}}, hidden:false},
        navigator:cellular ? {connection:{type:'cellular'}} : {},
        SUPABASE_URL:'https://kzrnyjsosryejjejliii.supabase.co',
        APP_API_FUNCTION_URL:'https://kzrnyjsosryejjejliii.supabase.co/functions/v1/app-api',
        SUPABASE_KEY:'anon', SUPABASE_WRITE_TIMEOUT_MS:1000, APP_VERSION:'fixture', APP_SHELL_VERSION:'fixture',
        nativeAuthRecoveryEpoch:1, currentUser:'dylan_collyge', PRELOGIN_BACKGROUND_ACTIONS:new Set(),
        isAllowedAppHostname:() => true, isLoginScreenVisible:() => false, getCurrentAppSessionToken:() => 'stale-legacy',
        getNativeAuthRequestHeaders:async refresh => ({Authorization:refresh ? 'Bearer renewed' : 'Bearer native'}),
        fetchSupabaseRestViaAppApiIfNeeded:async () => null,
        staleSupabaseReadScopeError:() => Object.assign(new Error('Scope changed'), {code:'REQUEST_SCOPE_CHANGED'}),
        canRunManualInventoryImport:() => true,
        fetch:async (input, init) => { calls.push({input, init}); return Response.json({ok:true, data:[]}); }
    });
    context.getSupabaseReadIdentityScope = () => context.currentUser;
    vm.runInContext(source, context);
    context.waitForOperationalRetry = async () => {};
    return {context, calls, timers, get traces() { return traces; }, get upgrades() { return upgrades; }};
}

test('all signed Supabase paths fetch directly without cache or referrer; unrelated traces remain', async () => {
    const fixture = transportFixture({nativeDeadline:true});
    for (const path of ['/rest/v1/app_dataset_revisions','/rest/v1/rpc/get_my_dataset_revisions_v1',
        '/storage/v1/object/public/evidence/image.jpg','/auth/v1/user','/functions/v1/app-api']) {
        await fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + path,
            {headers:{Authorization:'Bearer native'}, cache:'force-cache'}, 1000);
    }
    assert.equal(fixture.traces, 0);
    assert.equal(fixture.calls.length, 5);
    for (const {init} of fixture.calls) {
        assert.equal(init.cache, 'no-store');
        assert.equal(init.referrerPolicy, 'no-referrer');
        assert.equal(init.headers.Authorization, 'Bearer native');
    }
    await fixture.context.fetchWithTimeout('https://unrelated.fixture/trace', {}, 1000);
    assert.equal(fixture.traces, 1);
});

test('SDK Request input retains authorization/body and existing session configuration', async () => {
    const fixture = transportFixture();
    const sdk = {createClient:(_url, _key, config) => config};
    const config = fixture.context.createSupabaseTransportClient(sdk, fixture.context.SUPABASE_URL, 'anon');
    const request = new Request(fixture.context.SUPABASE_URL + '/rest/v1/rpc/get_fixture', {
        method:'POST', headers:{Authorization:'Bearer exact'}, body:'{"exact":true}'
    });
    await config.global.fetch(request);
    const effective = new Request(fixture.calls[0].input, fixture.calls[0].init);
    assert.equal(effective.headers.get('Authorization'), 'Bearer exact');
    assert.equal(await effective.text(), '{"exact":true}');
    assert.equal(effective.method, 'POST');
    assert.equal(config.auth.storageKey, 'gnc_supabase_auth_v1');
    assert.equal(config.auth.persistSession, true);
    assert.equal(config.auth.autoRefreshToken, false);
    assert.equal(config.auth.detectSessionInUrl, false);
    assert.equal(config.auth.experimental.passkey, true);
    assert.equal(config.realtime.params.eventsPerSecond, 8);
});

test('Storage response streams remain native and are not eagerly copied', async () => {
    const fixture = transportFixture({nativeDeadline:true});
    const response = new Response(new ReadableStream({start(controller) { controller.enqueue(new Uint8Array([1])); }}));
    response.clone = () => assert.fail('Storage must not be copied');
    fixture.context.fetch = async () => response;
    const result = await fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/storage/v1/object/public/image', {}, 1000);
    assert.equal(result, response);
    assert.equal(result.bodyUsed, false);
    await result.body.cancel();
});

test('the shared direct policy also reaches retained detached transport options', async () => {
    const fixture = transportFixture();
    await fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/rest/v1/rpc/reclass_transport_v1',
        {method:'POST', body:'{}', headers:{Authorization:'Bearer exact'}, detachedReclass:true}, 1000);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].init.cache, 'no-store');
    assert.equal(fixture.calls[0].init.referrerPolicy, 'no-referrer');
    assert.equal(fixture.calls[0].init.headers.Authorization, 'Bearer exact');
});

test('native Storage deadlines remain active after real HTTP headers', async () => {
    await withStreamingServer(origin => verifyInterruptedStorage(origin, true));
});

test('mobile fallback Storage deadlines remain active after real HTTP headers', async () => {
    await withStreamingServer(origin => verifyInterruptedStorage(origin, false));
});

test('explicit Storage cancellation remains active after real HTTP headers', async () => {
    await withStreamingServer(origin => verifyInterruptedStorage(origin, false, true));
});

test('arbitrary JSON Storage downloads stream without eager copying', async () => {
    await withStreamingServer(origin => verifyInterruptedStorage(origin, true, false, '/json/stall'));
});

test('happy Storage streaming preserves native response metadata and exact bytes', async () => {
    await withStreamingServer(async origin => {
        const fixture = streamingFixture(origin, '/stream/happy', true);
        const response = await fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/storage/v1/object/public/fixture', {}, 1000);
        assert.equal(response, fixture.calls[0].response);
        assert.equal(response.url, origin + '/stream/happy');
        assert.equal(response.headers.get('x-transport-fixture'), 'native');
        assert.equal(response.bodyUsed, false);
        assert.equal(await response.text(), 'first-second');
        assert.deepEqual(fixture.timers, []);
    });
});

test('Storage JSON acknowledgments and SDK Edge JSON remain within the request deadline', async () => {
    await withStreamingServer(async origin => {
        const fixture = streamingFixture(origin, '/json/stall', false);
        await assert.rejects(fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/storage/v1/object/fixture',
            {method:'POST', body:'synthetic', headers:{Authorization:'Bearer exact'}}, 100), error => error.code === 'TRANSPORT_TIMEOUT');
        fixture.context.SUPABASE_WRITE_TIMEOUT_MS = 100;
        const client = fixture.context.createSupabaseTransportClient({createClient:(_url, _key, config) => config}, 'fixture', 'fixture');
        await assert.rejects(client.global.fetch(fixture.context.APP_API_FUNCTION_URL,
            {method:'POST', body:'{"action":"synthetic_read"}', headers:{Authorization:'Bearer exact'}}), error => error.code === 'TRANSPORT_TIMEOUT');
        assert.ok(fixture.calls.every(call => call.init.signal.aborted));
        assert.deepEqual(fixture.timers, [100,100]);
    });
});

test('explicit cancellation aborts the actual network signal through headers and body reads', async () => {
    for (const body of [false, true]) {
        const fixture = transportFixture();
        let networkSignal;
        fixture.context.fetch = async (_url, init) => {
            networkSignal = init.signal;
            return body ? {ok:true, status:200, headers:new Headers(), text:neverResolves} : neverResolves();
        };
        const controller = new AbortController();
        const pending = fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL,
            {action:'watchdog_list_events'}, {signal:controller.signal, timeoutMs:1000});
        await new Promise(resolve => setTimeout(resolve, 0));
        controller.abort();
        await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
        assert.equal(networkSignal.aborted, true);
    }
});

test('PostgREST JSON body deadlines cover SDK response consumption', async () => {
    const fixture = transportFixture();
    let signal;
    fixture.context.fetch = async (_url, init) => {
        signal = init.signal;
        return {headers:new Headers({'content-type':'application/json'}), clone:stalledJsonClone};
    };
    await assert.rejects(fixture.context.fetchWithTimeout(fixture.context.SUPABASE_URL + '/rest/v1/app_dataset_revisions', {}, 10),
        error => error.code === 'TRANSPORT_TIMEOUT');
    assert.equal(signal.aborted, true);
});

test('the real checked PostgREST bridge retains direct options for initial table and RPC reads', async () => {
    const fixture = transportFixture();
    const bridge = databaseBridge((...args) => fixture.context.fetchWithTimeout(...args));
    fixture.context.fetch = async (input, init) => {
        fixture.calls.push({input, init});
        return String(input).includes('/rpc/') ? Response.json({ok:true, sources:[]}) : Response.json([]);
    };
    const init = {method:'GET', headers:{Authorization:'Bearer exact'}};
    await bridge.fetchTable(fixture.context.SUPABASE_URL, 'app_dataset_revisions', 'select=*', init, 1000, 'Revisions');
    await bridge.fetchRpc(fixture.context.SUPABASE_URL, 'get_my_dataset_revisions_v1',
        {...init, method:'POST', body:JSON.stringify({p_dataset_keys:['master']})}, 1000, 'Revision RPC');
    for (const {init:sent} of fixture.calls) {
        assert.equal(sent.cache, 'no-store');
        assert.equal(sent.referrerPolicy, 'no-referrer');
        assert.equal(sent.headers.Authorization, 'Bearer exact');
    }
    assert.equal(fixture.traces, 0);
});

test('initial master CSV pages have the same bounded body deadline without buffering Storage', async () => {
    const fixture = transportFixture();
    const bridge = databaseBridge((...args) => fixture.context.fetchWithTimeout(...args), () => []);
    let signal;
    fixture.context.fetch = async (_url, init) => {
        signal = init.signal;
        return {headers:new Headers({'content-type':'text/csv'}), clone:stalledJsonClone};
    };
    await assert.rejects(bridge.fetchTable(fixture.context.SUPABASE_URL, 'ph_master_inventory', 'select=itemcode&limit=500',
        {method:'GET', headers:{Authorization:'Bearer exact', accept:'text/csv'}}, 10, 'Master CSV'),
    error => error.code === 'TRANSPORT_TIMEOUT');
    assert.equal(signal.aborted, true);
});

test('mobile auth/request deadlines retain 15 seconds and late canceled bodies cannot upgrade', async () => {
    const fixture = transportFixture({cellular:true, timerScale:0.001});
    let complete, signal;
    fixture.context.fetch = async (_url, init) => {
        signal = init.signal;
        return {ok:true, status:200, headers:new Headers({'x-agdata-latest-version':'99.0.0'}),
            text:() => new Promise(resolve => { complete = resolve; })};
    };
    await assert.rejects(fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL,
        {action:'watchdog_list_events'}, {timeoutMs:5000}), error => error.code === 'TRANSPORT_TIMEOUT');
    assert.deepEqual(fixture.timers, [15000,15000]);
    assert.equal(signal.aborted, true);
    complete('{"ok":true}');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.upgrades, 0);
});

test('stalled native-auth preparation is bounded and never dispatches late or downgrades identity', async () => {
    const fixture = transportFixture({timerScale:0.001});
    let complete;
    fixture.context.getNativeAuthRequestHeaders = () => new Promise(resolve => { complete = resolve; });
    await assert.rejects(fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL,
        {action:'watchdog_list_events'}, {timeoutMs:5000}), error => error.code === 'TRANSPORT_TIMEOUT');
    assert.equal(fixture.calls.length, 0);
    complete({Authorization:'Bearer native'});
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.calls.length, 0);
});

test('explicit cancellation also bounds native-auth preparation', async () => {
    const fixture = transportFixture();
    fixture.context.getNativeAuthRequestHeaders = () => new Promise(() => {});
    const controller = new AbortController();
    const pending = fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL,
        {action:'watchdog_list_events'}, {signal:controller.signal});
    controller.abort();
    await assert.rejects(pending, error => error.code === 'REQUEST_ABORTED');
    assert.equal(fixture.calls.length, 0);
});

test('Watchdog list and writes never replay; eligible read recovery stays bounded', async () => {
    for (const [command, expected] of [[{action:'watchdog_list_events'},1],
        [{action:'request_work', operation:'save'},1], [{action:'dataset_read'},4]]) {
        const fixture = transportFixture();
        let calls = 0;
        fixture.context.fetch = async () => { calls++; return Response.json({code:'XX000'}, {status:500}); };
        await assert.rejects(fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL, command));
        assert.equal(calls, expected);
    }
});

test('RPC recovery rejects a successful response from a changed account', async () => {
    let current = true;
    await assert.rejects(retryOperationalRpc(async () => { current = false; return Response.json({ok:true}); },
        {safe:true, current:() => current, wait:async () => {}}), error => error.code === 'REQUEST_SCOPE_CHANGED');
});

test('a caller cannot change a retryable read into a write between attempts', async () => {
    const fixture = transportFixture();
    const command = {action:'dataset_read', dataset:'request_queue'};
    const actions = [];
    fixture.context.fetch = async (_url, init) => {
        actions.push(JSON.parse(init.body).action);
        command.action = 'request_work';
        command.operation = 'save';
        return actions.length === 1 ? Response.json({code:'XX000'}, {status:500}) : Response.json({ok:true});
    };
    await fixture.context.postAppFunctionJson(fixture.context.APP_API_FUNCTION_URL, command);
    assert.deepEqual(actions, ['dataset_read','dataset_read']);
});

test('idempotent write retries have one owner and no outer retry amplification', async () => {
    let calls = 0;
    const options = {bridge:{fetchRpc:async () => { calls++; return new Response('', {status:503}); }},
        rpcName:'save_drive_evidence_v3', body:{p_idempotency_key:'exact'}, baseUrl:'fixture',
        request:{}, requestOptions:{}, timeoutMs:1000, inScope:() => true};
    assert.equal((await dispatchRpcWithRecovery(options)).status, 503);
    assert.equal(calls, 2);
    calls = 0;
    options.body = {};
    assert.equal((await dispatchRpcWithRecovery(options)).status, 503);
    assert.equal(calls, 1, 'Missing durable identity cannot replay');
});

test('RPC authorization errors and explicit aborts are never replayed', async () => {
    for (const code of ['REQUEST_ABORTED','FORBIDDEN']) {
        let calls = 0;
        await assert.rejects(retryOperationalRpc(async () => { calls++; throw Object.assign(new Error(code), {code}); },
            {safe:true, current:() => true, wait:async () => assert.fail('No retry wait')}));
        assert.equal(calls, 1);
    }
});
