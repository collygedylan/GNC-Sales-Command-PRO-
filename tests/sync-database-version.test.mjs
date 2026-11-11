import assert from 'node:assert/strict';
import test from 'node:test';
import {syncDatabaseVersion} from '../scripts/sync-database-version.mjs';

test('pure REST version synchronization preserves settings and verifies the conditional write',async()=>{
  let value={app_version:'3.0.68',release:'AgData v3.0.68',preserved:'evidence'};
  const calls=[];
  const fetcher=async(url,init)=>{
    calls.push({url,method:init.method});
    if (init.method==='PATCH') {
      assert.ok(url.includes('value->>app_version=eq.3.0.68'));
      value=JSON.parse(init.body).value;
    }
    return Response.json([{value}]);
  };
  const input={version:'3.0.72',key:'fixture',url:'https://kzrnyjsosryejjejliii.supabase.co',fetcher};
  assert.deepEqual(await syncDatabaseVersion(input),{version:'3.0.72',verified:true});
  assert.equal(value.preserved,'evidence');
  await syncDatabaseVersion(input);
  assert.equal(calls.filter(call=>call.method==='PATCH').length,1);
  await assert.rejects(syncDatabaseVersion({...input,version:'3.0.67'}),/NEWER/);
  await assert.rejects(syncDatabaseVersion({...input,url:'https://example.com'}),/ORIGIN_INVALID/);
});

test('version sync rejects HTTP failures, missing settings and concurrent writers',async()=>{
  const input={version:'3.0.72',key:'fixture',url:'https://kzrnyjsosryejjejliii.supabase.co'};
  await assert.rejects(syncDatabaseVersion({...input,fetcher:async()=>new Response('',{status:403})}),/HTTP_403/);
  await assert.rejects(syncDatabaseVersion({...input,fetcher:async()=>Response.json([])}),/MISSING/);
  await assert.rejects(syncDatabaseVersion({...input,fetcher:async(url,init)=>{
    assert.ok(url.startsWith(input.url));
    return Response.json(init.method==='PATCH'?[]:[{value:{app_version:'3.0.68'}}]);
  }}),/CONCURRENT_CHANGE/);
});
