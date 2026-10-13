// @test-group: eval
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/report-pages-live.js', import.meta.url), 'utf8');
function setup(read) {
    const context = { AbortController }; vm.createContext(context); vm.runInContext(source, context);
    let scope = 'account-a', permission = 'p1', cleared = 0;
    const calls = [], metadata = [], mounts = [];
    const session = { read, refresh:read, clear:() => { cleared += 1; }, invalidate() {} };
    const controller = context.GncReportPagesLive.createController({
        scope:() => scope, permission:() => permission, allowed:() => true,
        loadModule:async () => ({ createReportSession:() => session,
            mountReportRows:(_host,config) => { const mount={config,destroyed:false,update(next){this.config=next;},destroy(){this.destroyed=true;},refresh(){}}; mounts.push(mount);return mount; } }),
        transport:async () => ({ surfaces:['eval2'] }), onMetadata:(surface,state) => metadata.push([surface,state.revision]),
        onState:(surface,state) => calls.push([surface,state.error])
    });
    return { controller, calls, metadata, mounts, scope:(value) => { scope = value; }, permission:(value) => { permission = value; }, cleared:() => cleared };
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
