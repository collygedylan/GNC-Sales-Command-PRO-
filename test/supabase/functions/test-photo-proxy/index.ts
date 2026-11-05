const SOURCE='kzrnyjsosryejjejliii.supabase.co';
const TARGET='https://apztnscvagayslumnalr.supabase.co';
const BUCKET='farm-operations-staging';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const LIMIT=8*1024*1024;
let active=0;
Deno.serve(async request=>{
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
 let source:URL;
 try{source=new URL(new URL(request.url).searchParams.get('source')||'');}catch{return new Response('Invalid image',{status:400});}
 if(source.protocol!=='https:'||source.hostname!==SOURCE||!source.pathname.startsWith('/storage/v1/object/public/')||source.username||source.password||source.port)return new Response('Source denied',{status:403});
 source.search='';source.hash='';
 const object=source.pathname.slice('/storage/v1/object/public/'.length);
 if(!object||object.includes('..'))return new Response('Invalid image path',{status:400});
 const publicUrl=TARGET+'/storage/v1/object/public/'+BUCKET+'/'+object;
 const exists=await fetch(publicUrl,{method:'HEAD',signal:AbortSignal.timeout(5000)});
 if(exists.ok)return Response.redirect(publicUrl,302);
 if(active>=4)return new Response('Image is warming',{status:503,headers:{'Retry-After':'1'}});
 active++;
 try{
  const response=await fetch(source,{signal:AbortSignal.timeout(15000)});
  const mime=response.headers.get('content-type')?.split(';')[0]||'';
  if(!response.ok||!['image/jpeg','image/png','image/webp','image/gif'].includes(mime))return new Response('Image unavailable',{status:404});
  if(Number(response.headers.get('content-length'))>LIMIT)return new Response('Image too large',{status:413});
  const reader=response.body?.getReader();if(!reader)return new Response('Image unavailable',{status:404});
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>LIMIT){await reader.cancel();return new Response('Image too large',{status:413});}chunks.push(part.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const uploaded=await fetch(TARGET+'/storage/v1/object/'+BUCKET+'/'+object,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':mime,'Cache-Control':'max-age=31536000','x-upsert':'true'},body:bytes});
  if(!uploaded.ok)return new Response('Image staging unavailable',{status:503});
  return Response.redirect(publicUrl,302);
 }catch{return new Response('Image retry available',{status:503});}finally{active--;}
});
