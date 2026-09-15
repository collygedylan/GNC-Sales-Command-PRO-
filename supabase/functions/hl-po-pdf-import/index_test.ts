import { assertEquals } from 'jsr:@std/assert@1';
import { createHlPoPdfHandler, createHlPoServiceAuthorizer } from './index.ts';
const client={rpc(){throw new Error('Invalid requests must never reach database');}} as never;
const authorize=async(request:Request)=>request.headers.get('authorization')==='Bearer isolated-service-key'?client:null;
function reportFixture(times:string[]) {
 const fontId=3+times.length*2;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${times.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${times.length} >>`];
 times.forEach((time,i)=>{
  const cells:Array<[string,number,number]>=[['PO Order Report',351,563],[`${i+1} of ${times.length}`,680,586],[time,680,575],['10C00258',617,541],['Vendor 823517:',120,524],
   ...[['Item Code',19],['Lot',77],['Size',105],['Common Name',127],['PO Ordered',220],['Genus',266],['Received',624],['Remaining',662],['Hand',589]].map(([s,x])=>[String(s),Number(x),506] as [string,number,number]),
   ['000310.030.1',19,450],['27.F1',77,450],['#3',105,450],['Sea Green Juniper',127,450],['300',249,450],['300',687,450]];
  const stream=cells.slice().reverse().map(([s,x,y])=>`BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${s}) Tj ET`).join('\n');
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
 });
 objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
 let pdf='%PDF-1.4\n';const offsets=[0];
 objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
 const xref=pdf.length;pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return btoa(pdf);
}

Deno.test('complete PDF worker accepts advancing page print times and rejects mixed reports before staging',async()=>{
 for(const [last,expected] of [['9/11/2026 4:17:26 PM',200],['9/11/2026 4:18:26 PM',422]] as const) {
  const pages:Array<Record<string,unknown>>=[];
  const handler=createHlPoPdfHandler(async()=>({rpc:async(_name,args)=>{pages.push(args);return {data:{status:'pending'},error:null};}}));
  const result=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({source_file_id:'synthetic-print-run',source_file_name:'PO.pdf',pdf_base64:reportFixture(['9/11/2026 4:17:25 PM',last])})}));
  assertEquals(result.status,expected,JSON.stringify(await result.clone().json()));
  if(expected===200){
   assertEquals(pages.map(p=>p.p_page),[1,2,null]);
   assertEquals(((pages[0].p_rows as Array<Record<string,unknown>>)[0]).report_printed_at,'2026-09-11T21:17:25.000Z');
   assertEquals(((pages[1].p_rows as Array<Record<string,unknown>>)[0]).report_printed_at,'2026-09-11T21:17:26.000Z');
  }else{assertEquals(pages.length,0);assertEquals((await result.json()).code,'HL_PO_PDF_MIXED_REPORT');}
 }
});
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
