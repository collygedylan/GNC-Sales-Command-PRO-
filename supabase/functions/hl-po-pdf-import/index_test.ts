import { assertEquals } from 'jsr:@std/assert@1';
import { createHlPoPdfHandler, createHlPoServiceAuthorizer } from './index.ts';
const client={rpc(){throw new Error('Invalid requests must never reach database');}} as never;
const authorize=async(request:Request)=>request.headers.get('authorization')==='Bearer isolated-service-key'?client:null;
Deno.test('PDF staging rejects browser and missing server credentials before reading request data',async()=>{
 const handler=createHlPoPdfHandler(authorize);
 for(const bearer of ['', 'Bearer native-session-token']) {
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:bearer},body:'not JSON'}));
  assertEquals(response.status,403);
 }
 assertEquals((await createHlPoPdfHandler(async()=>null)(new Request('https://fixture.invalid'))).status,403);
});
Deno.test('PDF importer validates method and original PDF before any staging',async()=>{
 const handler=createHlPoPdfHandler(authorize);
 const headers={authorization:'Bearer isolated-service-key','content-type':'application/json'};
 assertEquals((await handler(new Request('https://fixture.invalid',{headers}))).status,405);
 const result=await handler(new Request('https://fixture.invalid',{method:'POST',headers,body:JSON.stringify({source_file_id:'synthetic-file-id',source_file_name:'PO.pdf',pdf_base64:btoa('not PDF')})}));
 assertEquals(result.status,422); assertEquals((await result.json()).code,'HL_PO_PDF_INVALID_FILE');
});

Deno.test('service authentication uses caller credentials and protected PostgREST grants for legacy and secret keys',async()=>{
 const credentials:Array<Record<string,string>>=[{authorization:'Bearer existing-legacy-key',apikey:'existing-legacy-key'},{apikey:'sb_secret_existing'}];
 for(const headers of credentials) {
  const calls:Array<{url:string,headers:Headers}>=[];
  const check=createHlPoServiceAuthorizer('https://fixture.invalid',(async(url,init)=>{
   calls.push({url:String(url),headers:new Headers(init?.headers)});
   return Response.json(String(url).endsWith('/hl_po_import_capabilities')?{version:2,pdf:true}:{status:'staging'});
  }) as typeof fetch);
  const verified=await check(new Request('https://fixture.invalid',{headers}));
  assertEquals(!!verified,true);
  await verified!.rpc('hl_po_pdf_stage',{p_page:1});
  assertEquals(calls.map(c=>c.url),['https://fixture.invalid/rest/v1/rpc/hl_po_import_capabilities','https://fixture.invalid/rest/v1/rpc/hl_po_pdf_stage']);
  for(const call of calls){
   assertEquals(call.headers.get('apikey'),headers.apikey);
   assertEquals(call.headers.get('authorization'),headers.authorization || null);
  }
 }
});

Deno.test('forged service claims, ordinary users, revoked keys and missing credentials cannot parse or stage',async()=>{
 const forged='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({role:'service_role',iss:'supabase'}))+'.forged';
 let calls=0;
 const check=createHlPoServiceAuthorizer('https://fixture.invalid',(async()=>{calls++;return Response.json({message:'permission denied'},{status:403});}) as typeof fetch);
 const handler=createHlPoPdfHandler(check);
 for(const token of [forged,'native-user-token','revoked-service-key']) {
  assertEquals((await handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:`Bearer ${token}`},body:'not JSON'}))).status,403);
 }
 assertEquals(calls,3);
 for(const headers of [{apikey:'sb_publishable_client'},{apikey:'anonymous-key',authorization:'Bearer native-user-token'},{apikey:'sb_secret_existing',authorization:'Bearer native-user-token'}]) {
  assertEquals((await handler(new Request('https://fixture.invalid',{method:'POST',headers:new Headers(Object.entries(headers)),body:'not JSON'}))).status,403);
 }
 assertEquals(calls,6);
 assertEquals((await handler(new Request('https://fixture.invalid',{method:'POST',body:'not JSON'}))).status,403);
 assertEquals(calls,6);
});

Deno.test('authentication outages remain unavailable and never authorize with the worker credential',async()=>{
 for(const reply of [()=>Promise.reject(new Error('offline')),()=>Promise.resolve(Response.json({message:'unavailable'},{status:503})),()=>Promise.resolve(Response.json({version:1}))]) {
  const check=createHlPoServiceAuthorizer('https://fixture.invalid',reply as typeof fetch);
  const result=await createHlPoPdfHandler(check)(new Request('https://fixture.invalid',{method:'POST',headers:{apikey:'existing-key'},body:'not JSON'}));
  assertEquals(result.status,503);assertEquals((await result.json()).code,'HL_PO_PDF_AUTH_UNAVAILABLE');
 }
});
