// @test-group: eval
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/report-pages-live.js', import.meta.url), 'utf8');
function setup(read) {
    const context = { AbortController }; vm.createContext(context); vm.runInContext(source, context);
    let scope = 'account-a', permission = 'p1', cleared = 0;
    const calls = [], metadata = [], mounts = [], externalStates = [];
    const session = { read, refresh:read, clear:() => { cleared += 1; }, invalidate() {}, invalidateInventory() { this.invalidations = (this.invalidations || 0) + 1; } };
    const controller = context.GncReportPagesLive.createController({
        scope:() => scope, permission:() => permission, allowed:() => true,
        loadModule:async () => ({ createReportSession:() => session,
            mountReportRows:(_host,config) => { const mount={destroyed:false,update(next){this.config=next;this.callback=next.onState;},destroy(){this.destroyed=true;},refresh(){this.callback?.({refreshing:true});}}; mount.config=config; mount.callback=config.onState; mounts.push(mount);return mount; } }),
        transport:async () => ({ surfaces:['eval2'] }), onMetadata:(surface,state) => metadata.push([surface,state.revision]),
        onState:(surface,state) => calls.push([surface,state.error])
    });
    return { controller, calls, metadata, mounts, externalStates, session, scope:(value) => { scope = value; }, permission:(value) => { permission = value; }, cleared:() => cleared };
}
const query = { surface:'eval2', operation:'rows', filters:{}, offset:0, limit:100 };
const page = (rows,total,hasMore = false,revision = 'r1') => ({ rows,total,hasMore,sourceRevision:revision,metadata:{ counts:{ u1:total } } });

test('report cache is cleared when the authenticated identity or permission changes', async () => {
    const fixture = setup(async () => page([{ unique_id:'a' }],1));
    await fixture.controller.load(query);
    assert.equal(fixture.controller.state('eval2').rows.length,1);
    fixture.permission('p2');
    assert.equal(fixture.controller.state('eval2').rows.length,0);
    assert.equal(fixture.cleared(),1);
    await fixture.controller.load(query);
    fixture.scope('account-b');
    assert.equal(fixture.controller.state('eval2').revision,'');
    assert.equal(fixture.cleared(),2);
});

test('a response from the previous account cannot hydrate the next account', async () => {
    let finish;
    const fixture = setup(() => new Promise(resolve => { finish = resolve; }));
    const loading = fixture.controller.load(query);
    await new Promise(resolve => setImmediate(resolve));
    fixture.scope('account-b'); fixture.controller.state('eval2');
    finish(page([{ unique_id:'private' }],1)); await loading;
    assert.equal(fixture.controller.state('eval2').rows.length,0);
});

test('complete export reads every bounded page and rejects overlapping or changed revisions', async () => {
    const requests = [];
    const fixture = setup(async request => {
        requests.push(request);
        return request.offset === 0 ? page([{ unique_id:'a' }],2,true) : page([{ unique_id:'b' }],2);
    });
    const result = await fixture.controller.readComplete(query);
    assert.equal(result.rows.length,2);
    assert.deepEqual(requests.map(request => request.limit),[100,100]);
    assert.equal(requests[1].sourceRevision,'r1');
    const overlapping = setup(async () => page([{ unique_id:'a' }],2,true));
    await assert.rejects(overlapping.controller.readComplete(query),/overlapped/);
    const changing = setup(async request => request.offset === 0 ? page([{ unique_id:'a' }],2,true) : page([{ unique_id:'b' }],2,false,'r2'));
    await assert.rejects(changing.controller.readComplete(query),/source changed/);
});

test('failed refresh retains the last display page and records an action-blocking error', async () => {
    let fail = false;
    const fixture = setup(async () => { if (fail) throw new Error('offline'); return page([{ unique_id:'a' }],1); });
    await fixture.controller.load(query); fail = true; await fixture.controller.load(query);
    assert.equal(fixture.controller.state('eval2').rows.length,1);
    assert.equal(fixture.controller.state('eval2').error,'offline');
});

test('navigation destroys view mounts while retaining the authenticated session cache', async () => {
    const fixture=setup(async () => page([{unique_id:'a'}],1));
    await fixture.controller.load(query);
    const session=fixture.controller.getSession();
    await fixture.controller.mount({isConnected:true},query,{});
    fixture.controller.suspendMounts();
    assert.equal(fixture.mounts[0].destroyed,true);
    assert.equal(fixture.cleared(),0);
    assert.equal(fixture.controller.getSession(),session);
    assert.equal(fixture.controller.state('eval2').rows.length,1);
});

test('live metadata keeps a coherent display cohort until the refreshed page arrives', async () => {
    const fixture=setup(async () => page([{unique_id:'a'}],1));
    await fixture.controller.mount({isConnected:true},query,{});
    const notify=fixture.mounts[0].config.onState;
    notify({page:page([{unique_id:'a'}],1),rows:[{unique_id:'a'}]});
    fixture.controller.state('eval2').completeItems.set('ABC','r1');
    fixture.controller.acceptMetadata('eval2',page([],0,false,'r2'));
    assert.equal(fixture.controller.state('eval2').revision,'r1');
    assert.equal(fixture.controller.state('eval2').expectedRevision,'r2');
    assert.equal(fixture.controller.state('eval2').completeItems.size,0);
    notify({page:page([{unique_id:'old'}],1),rows:[{unique_id:'old'}]});
    assert.equal(fixture.controller.state('eval2').rows[0].unique_id,'a');
    notify({page:page([{unique_id:'new'}],1,false,'r2'),rows:[{unique_id:'new'}]});
    assert.equal(fixture.controller.state('eval2').revision,'r2');
    assert.equal(fixture.controller.state('eval2').expectedRevision,'');
});

test('missing capabilities never trigger a page read or publish blank metadata', async () => {
    let reads = 0;
    // A legacy server signals unsupported paged reports during initialization.
    const ctx = { AbortController }; vm.createContext(ctx); vm.runInContext(source, ctx);
    const metadata = [], states = [];
    const controller = ctx.GncReportPagesLive.createController({
        scope:() => 'account', permission:() => 'p1', allowed:() => true,
        loadModule:async () => ({ createReportSession:() => ({ read:async () => { reads += 1; return page([], 0); }, refresh:async () => page([], 0), clear() {} }), mountReportRows() {} }),
        transport:async () => { throw Object.assign(new Error('unsupported'), { status:404 }); },
        onMetadata:(_surface, state) => metadata.push(state.revision), onState:(_surface, state) => states.push(state.error)
    });
    await controller.load(query);
    await controller.readPage(query).catch(() => null);
    assert.equal(reads, 0);
    assert.deepEqual(metadata, []);
    assert.deepEqual(states, ['', '']);
    assert.equal(controller.enabled('eval2'), false);
});

test('metadata read failure reports an error without publishing an index', async () => {
    const metadata = [], states = [];
    const ctx = { AbortController }; vm.createContext(ctx); vm.runInContext(source, ctx);
    const controller = ctx.GncReportPagesLive.createController({
        scope:() => 'account', permission:() => 'p1', allowed:() => true,
        loadModule:async () => ({ createReportSession:() => ({ read:async () => { throw new Error('metadata offline'); }, refresh:async () => {}, clear() {} }), mountReportRows() {} }),
        transport:async query => query ? {} : { surfaces:['eval2'] },
        onMetadata:(_surface, state) => metadata.push(state.revision), onState:(_surface, state) => states.push(state.error)
    });
    await controller.load(query);
    assert.deepEqual(metadata, []);
    assert.deepEqual(states, ['', 'metadata offline']);
    assert.equal(controller.state('eval2').revision, '');
});

test('metadata arriving during group mount hydrates counts without replacing mounted rows', async () => {
    let finishMetadata;
    const fixture = setup(async request => request.operation === 'metadata'
        ? new Promise(resolve => { finishMetadata = resolve; })
        : page([{ unique_id:'list-row' }], 1, false, 'r1'));
    const groupsQuery = { ...query, operation:'groups' };
    const state = fixture.controller.state('eval2');
    const metadataLoad = fixture.controller.load({ ...groupsQuery, operation:'metadata' });
    await new Promise(resolve => setImmediate(resolve));
    await fixture.controller.load(groupsQuery);
    const mountedRows = state.rows;
    assert.equal(mountedRows[0].unique_id, 'list-row');
    finishMetadata(page([], 7, false, 'r1'));
    await metadataLoad;
    assert.equal(state.metadata.counts.u1, 7);
    assert.equal(state.page.metadata.counts.u1, 1);
    assert.equal(state.rows, mountedRows);
    assert.equal(state.rows[0].unique_id, 'list-row');
});

test('metadata refresh leaves the mounted group query able to adopt its new revision', async () => {
    const fixture = setup(async () => page([], 2, false, 'r2'));
    const groupsQuery = { ...query, operation:'groups' };
    await fixture.controller.mount({isConnected:true}, groupsQuery, {});
    const notify = fixture.mounts[0].config.onState;
    notify({page:page([{unique_id:'old'}], 1), rows:[{unique_id:'old'}]});
    await fixture.controller.load({...groupsQuery, operation:'metadata'}, true);
    const state = fixture.controller.state('eval2');
    assert.equal(state.queryKey, JSON.stringify(groupsQuery));
    assert.equal(state.expectedRevision, 'r2');
    notify({page:page([{unique_id:'new'}], 2, false, 'r2'), rows:[{unique_id:'new'}]});
    assert.equal(state.revision, 'r2');
    assert.equal(state.expectedRevision, '');
    assert.equal(state.rows[0].unique_id, 'new');
    assert.equal(state.metadata.counts.u1, 2);
});

test('inventory invalidation rejects prior mounted callbacks and accepts refreshed data', async () => {
    let finish, calls=0;
    const fixture=setup(() => { calls+=1; return calls===1 ? Promise.resolve(page([{unique_id:'old'}],1,false,'r1')) : new Promise(resolve => { finish=resolve; }); });
    const host={isConnected:true};
    const external=[];
    await fixture.controller.mount(host,query,{ onState: value => external.push(value) });
    const oldNotify=fixture.mounts[0].callback;
    oldNotify({page:page([{unique_id:'old'}],1),rows:[{unique_id:'old'}]});
    fixture.controller.invalidateInventory();
    assert.equal(fixture.session.invalidations,1);
    assert.notEqual(fixture.mounts[0].callback,oldNotify);
    oldNotify({page:page([{unique_id:'stale'}],1),rows:[{unique_id:'stale'}]});
    assert.equal(fixture.controller.state('eval2').rows.length,0);
    assert.equal(external.length,2);
    const freshNotify=fixture.mounts[0].callback;
    freshNotify({page:page([{unique_id:'fresh'}],1,false,'r2'),rows:[{unique_id:'fresh'}]});
    assert.equal(fixture.controller.state('eval2').rows[0].unique_id,'fresh');
    assert.equal(external.length,3);
});

test('reopening a hidden report after inventory invalidation fetches current data', async () => {
    let revision='r1';
    const fixture=setup(async () => page([{unique_id:revision}],1,false,revision));
    const host={isConnected:true};
    await fixture.controller.mount(host,query,{});
    fixture.controller.suspendMounts();
    revision='r2';
    fixture.controller.invalidateInventory();
    await fixture.controller.mount(host,query,{});
    assert.equal(fixture.mounts.length,2);
    assert.equal(fixture.controller.state('eval2').page,null);
    await fixture.controller.load(query);
    assert.equal(fixture.controller.state('eval2').rows[0].unique_id,'r2');
});

test('mounting an existing host replaces its caller config for future invalidation refreshes', async () => {
    const fixture=setup(async () => page([{unique_id:'row'}],1));
    const host={isConnected:true}, first=[], second=[];
    await fixture.controller.mount(host,query,{onState:value=>first.push(value)});
    const firstCallback=fixture.mounts[0].callback;
    await fixture.controller.mount(host,query,{onState:value=>second.push(value)});
    fixture.controller.invalidateInventory();
    firstCallback({page:page([{unique_id:'stale'}],1),rows:[{unique_id:'stale'}]});
    fixture.mounts[0].callback({page:page([{unique_id:'fresh'}],1,false,'r2'),rows:[{unique_id:'fresh'}]});
    assert.equal(first.length,0);
    assert.equal(second.length,2);
});
