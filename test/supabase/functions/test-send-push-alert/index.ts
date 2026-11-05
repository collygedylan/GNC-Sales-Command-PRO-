import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
const url='https://apztnscvagayslumnalr.supabase.co';
const client=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'Access-Control-Allow-Origin':'https://agmetricapp.com','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Content-Type':'application/json'};
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{headers});
 const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data,error}=await client.auth.getUser(token);
 if(error||data.user?.app_metadata?.environment!=='agdata-test')return Response.json({ok:false,code:'AUTH_REQUIRED'},{status:401,headers});
 return Response.json({ok:true,environment:'agdata-test',status:'TEST_PUSH_SUPPRESSED',delivered:0,message:'Test events remain in the app; copied production device subscriptions are never used.'},{headers});
});
