const calls:{url:string;method:string;body:unknown}[]=[];
const id='12345678-1234-1234-1234-123456789abc';
let filename='erp-drops/drive/inventory.csv';
globalThis.fetch=async(input:RequestInfo|URL,init:RequestInit={})=>{
 const url=String(input),method=String(init.method||'GET');
 if(!url.startsWith('https://apztnscvagayslumnalr.supabase.co/'))throw Error('Unexpected external request');
 calls.push({url,method,body:init.body?JSON.parse(String(init.body)):null});
 if(url.includes('/object/list/'))return Response.json([{id,name:'inventory.csv',metadata:{size:15,mimetype:'text/csv',eTag:'abc'},updated_at:'2026-11-05T00:00:00Z'}]);
 if(url.includes('/rpc/test_sync_file_metadata'))return Response.json({id,name:filename,metadata:{size:15,mimetype:'text/csv'}});
 if(url.includes('/object/authenticated/'))return new Response('itemcode,qty\nA,1');
 if(url.endsWith('/object/move')){filename='erp-drops/drive/Processed/inventory.csv';return Response.json({ok:true});}
 throw Error('Unexpected test route');
};
const {testDriveFetch,testSyncEnv}=await import('../supabase/functions/_shared/test-drive-adapter.ts');
const assert=(v:unknown)=>{if(!v)throw Error('Assertion failed');};
Deno.test('five-stage folders use only isolated Storage and preserve file identity through Processed',async()=>{
 assert(Object.keys(JSON.parse(testSyncEnv('ERP_SYNC_DROP_FOLDERS_JSON'))).join(',')==='drive,cav,reserves,soc');
 const listed=await testDriveFetch("https://www.googleapis.com/drive/v3/files?q="+encodeURIComponent("'test-drive' in parents"));
 const result=await listed.json();assert(result.files[0].id==='test-file:'+id);assert(result.files[1].id==='test-drive-processed');
 const downloaded=await testDriveFetch('https://www.googleapis.com/drive/v3/files/test-file:'+id+'?alt=media');assert((await downloaded.text()).includes('A,1'));
 const moved=await testDriveFetch('https://www.googleapis.com/drive/v3/files/test-file:'+id+'?addParents=test-drive-processed&removeParents=test-drive',{method:'PATCH'});
 assert((await moved.json()).parents[0]==='test-drive-processed');assert(calls.some(c=>c.url.endsWith('/object/move')));
});
Deno.test('production folders, arbitrary destinations and deletes are blocked',async()=>{
 for(const [url,init] of [["https://www.googleapis.com/drive/v3/files?q="+encodeURIComponent("'live-folder' in parents"),{}],['https://www.googleapis.com/drive/v3/files/test-file:'+id+'?addParents=test-cav-processed',{method:'PATCH'}]] as [string,RequestInit][]){let blocked=false;try{await testDriveFetch(url,init);}catch{blocked=true;}assert(blocked);}
 const denied=await testDriveFetch('https://www.googleapis.com/drive/v3/files/test-file:'+id,{method:'DELETE'});assert(denied.status===405);
});
