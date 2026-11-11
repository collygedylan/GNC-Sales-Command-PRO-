import type { AppSessionClaims } from "../../supabase/functions/_shared/app-auth.ts";
import { authorizePhotoUpload, type PhotoAuthorizationDependencies } from "../../src/services/photo-upload-authorization.ts";
import type { PhotoUploadDependencies } from "../../src/services/photo-upload-handler.ts";

export function photoFixture(username="ordinary_actor",role="REP") {
  const session:AppSessionClaims={ver:2,authUserId:"00000000-0000-0000-0000-000000000003",
    username,displayName:username,role,mustChangePassword:false,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
  const state={
    session,actor:{id:session.authUserId,username},nativeProofs:0,
    calls:[] as {name:string;args:Record<string,unknown>}[],writes:[] as {bucket:string;path:string}[],
    rpcError:null as {code:string;message:string}|null,returnedIdentity:null as Record<string,unknown>|null,
    evalRow:{assignedto:username,status:"open",contract_version:"eval-work-v2-multi-origin",
      origins:[{origin_unique_id:"origin-1"}]} as Record<string,unknown>|null,
  };
  const auth:PhotoAuthorizationDependencies={
    resolveActor:async active=>active.username===session.username ? state.actor : {},
    normalizeUsername:value=>String(value||"").trim().toLowerCase(),
    verifyNativeSession:async (actor,request)=>{
      if(actor.id!==session.authUserId || !(request instanceof Request)) throw Error("wrong proof");
      state.nativeProofs++;return "11111111-1111-1111-1111-111111111111";
    },
    rpc:async (name,args)=>{
      state.calls.push({name,args});
      return {data:state.returnedIdentity||{ok:true,...args.p_identity as Record<string,unknown>},error:state.rpcError};
    },
  };
  const deps:PhotoUploadDependencies={
    buckets:{"ssn-":"season_sales_notes_photos","lsn-":"location_sales_notes_photos","req-":"request_photos",
      "eval-":"request_photos","credit-":"credit_photos","dock-":"dock_photos","flyer-":"flyer_photos",default:"flyer_photos"},
    json:data=>Response.json(data),error:(message,status,extra)=>Response.json({ok:false,error:message,...extra},{status}),
    isRepLike:value=>["REP","CSR"].includes(value),normalizeUsername:auth.normalizeUsername,
    loadEvalAssignment:async (active,id)=>active.username===session.username && id==="work-1" ? state.evalRow : null,
    isEvalAssigned:(row,actor)=>row.assignedto===actor,
    authorize:(active,request,form,prefix)=>authorizePhotoUpload(active,request,form,prefix,auth),
    upload:async (bucket,path,part)=>{if(!part.bytes.length)throw Error("no bytes");state.writes.push({bucket,path});},
    publicUrl:(bucket,path)=>"https://photos.invalid/storage/v1/object/public/"+bucket+"/"+path,
    sanitizeFileName:value=>value.replace(/\.[^.]+$/,"").replace(/[^a-z0-9_-]/gi,""),
    sanitizeStorageFileName:value=>value.replace(/[^a-z0-9._-]/gi,""),
  };
  return {state,deps};
}

export function photoForm(prefix="req-",optimized=true) {
  const form=new FormData(),file=new File([new Uint8Array([255,216,255,1])],"photo.jpg",{type:"image/jpeg"});
  form.set("prefix",prefix);form.set("file",file);form.set("fileName","photo.jpg");
  for(const [key,value] of Object.entries({masterUid:"master-a",itemCode:"ITEM",locationCode:"A.01",lotCode:"26.F1"})) form.set(key,value);
  if(prefix==="req-")form.set("requestId","request-a");
  if(prefix==="eval-"){form.set("workId","work-1");form.set("originUid","origin-1");}
  if(optimized){
    form.set("uploadContract","plant-photo-v2");form.set("thumbnail144",file);form.set("thumbnail320",file);
    for(const [key,value] of Object.entries({displayWidth:1920,displayHeight:1152,thumbnail144Width:144,
      thumbnail144Height:86,thumbnail320Width:320,thumbnail320Height:192}))form.set(key,String(value));
  }
  return form;
}

export function photoRequest(form:FormData,headers:Record<string,string>={}) {
  return new Request("https://local.invalid/photo",{method:"POST",body:form,headers});
}
