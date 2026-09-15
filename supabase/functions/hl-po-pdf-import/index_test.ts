import { assertEquals } from 'jsr:@std/assert@1';
import { createHlPoPdfHandler } from './index.ts';
const client={rpc(){throw new Error('Invalid requests must never reach database');}} as never;
Deno.test('PDF staging rejects browser and missing server credentials before reading request data',async()=>{
 const handler=createHlPoPdfHandler('isolated-service-key',client);
 for(const bearer of ['', 'Bearer native-session-token']) {
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:bearer},body:'not JSON'}));
  assertEquals(response.status,403);
 }
 assertEquals((await createHlPoPdfHandler('',client)(new Request('https://fixture.invalid'))).status,403);
});
Deno.test('PDF importer validates method and original PDF before any staging',async()=>{
 const handler=createHlPoPdfHandler('isolated-service-key',client);
 const headers={authorization:'Bearer isolated-service-key','content-type':'application/json'};
 assertEquals((await handler(new Request('https://fixture.invalid',{headers}))).status,405);
 const result=await handler(new Request('https://fixture.invalid',{method:'POST',headers,body:JSON.stringify({source_file_id:'synthetic-file-id',source_file_name:'PO.pdf',pdf_base64:btoa('not PDF')})}));
 assertEquals(result.status,422); assertEquals((await result.json()).code,'HL_PO_PDF_INVALID_FILE');
});
