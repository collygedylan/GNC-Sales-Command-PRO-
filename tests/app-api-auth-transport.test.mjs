import { transportFixture } from '../src/core/app-api-auth-fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const command={action:'erp_sync',operation:'start',commandId:'same-command'};
test('ERP uses native identity without sending a stale legacy actor',async()=>{
  for(const legacy of ['', 'different-actor-token']) {
    const fixture=transportFixture({legacy});
    assert.equal((await fixture.context.postAppFunctionJson('/api',command)).ok,true);
    assert.equal(fixture.calls[0].headers.Authorization,'Bearer native-a');
    assert.equal(fixture.calls[0].headers['x-gnc-session'],undefined);
  }
});
test('ERP retains signed legacy fallback when native identity is unavailable',async()=>{
  const fixture=transportFixture({native:'',legacy:'signed-legacy'});
  assert.equal((await fixture.context.postAppFunctionJson('/api',command)).ok,true);
  assert.equal(fixture.calls[0].headers['x-gnc-session'],'signed-legacy');
  const absent=transportFixture({native:'',legacy:''});
  await assert.rejects(absent.context.postAppFunctionJson('/api',command),error=>error.code==='NATIVE_SESSION_RECOVERY_REQUIRED');
  assert.equal(absent.calls.length,0);
});
test('ERP retries one renewed native session without replaying a legacy header',async()=>{
  const fixture=transportFixture({legacy:'stale-legacy',responses:[401,200]});
  assert.equal((await fixture.context.postAppFunctionJson('/api',command)).ok,true);
  assert.equal(fixture.refreshed,1);assert.equal(fixture.calls.length,2);
  assert.deepEqual(fixture.calls.map(call=>call.headers.Authorization),['Bearer native-a','Bearer native-renewed']);
  assert.ok(fixture.calls.every(call=>call.headers['x-gnc-session']===undefined));
  assert.deepEqual(fixture.calls.map(call=>call.body),[command,command]);
});
test('ERP fails on a revoked native session without falling back to another actor',async()=>{
  const fixture=transportFixture({legacy:'different-actor-token',responses:[401,401]});
  await assert.rejects(fixture.context.postAppFunctionJson('/api',command),error=>error.status===401);
  assert.equal(fixture.calls.length,2);assert.equal(fixture.refreshed,1);
  assert.ok(fixture.calls.every(call=>call.headers['x-gnc-session']===undefined));
});

test('ERP refuses dispatch when the account changes during native authentication',async()=>{
  const fixture=transportFixture();let finish;
  fixture.context.getNativeAuthRequestHeaders=()=>new Promise(resolve=>{finish=resolve;});
  const pending=fixture.context.postAppFunctionJson('/api',command);
  fixture.context.currentUser='different-actor';finish({Authorization:'Bearer native-a'});
  await assert.rejects(pending,error=>error.code==='REQUEST_SCOPE_CHANGED');
  assert.equal(fixture.calls.length,0);
});
