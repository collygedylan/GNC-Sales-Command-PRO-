import assert from "node:assert/strict";
import {handleScopedPhotoUpload} from "../src/services/photo-upload-handler.ts";
import {photoFixture,photoForm,photoRequest} from "./helpers/photo-upload-edge-fixture.ts";

for(const prefix of ["ssn-","lsn-","na-","flyer-","req-"]){
  Deno.test("table-approved REP upload uses exact SQL authority for "+prefix,async()=>{
    const {state,deps}=photoFixture(),form=photoForm(prefix);
    const response=await handleScopedPhotoUpload(state.session,photoRequest(form),deps);
    const data=await response.json();
    assert.equal(response.status,200);assert.equal(data.contractVersion,"plant-photo-v2");
    assert.equal(data.masterUid,"master-a");assert.equal(data.width,1920);assert.equal(data.height,1152);
    assert.equal(state.calls[0].name,"authorize_photo_upload_v3074");assert.equal(state.nativeProofs,1);
    assert.equal(state.writes.length,3);assert.ok(state.writes.every(row=>!row.path.includes("/render/image/")));
    if(prefix==="req-")assert.equal((state.calls[0].args.p_identity as Record<string,unknown>).requestId,"request-a");
  });
}
Deno.test("listed and ordinary accounts with explicit denial cannot write a single object",async()=>{
  for(const username of ["mitch_kaiser","ordinary_actor"]){
    const {state,deps}=photoFixture(username,"ADMIN");state.rpcError={code:"42501",message:"PHOTO_FORBIDDEN"};
    const response=await handleScopedPhotoUpload(state.session,photoRequest(photoForm("lsn-")),deps);
    assert.equal(response.status,403);assert.equal(state.writes.length,0);
  }
});
Deno.test("wrong source witness, wrong actor and missing identity cannot upload",async()=>{
  const {state,deps}=photoFixture();state.returnedIdentity={ok:true,masterUid:"master-a",requestId:"foreign"};
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(photoForm()),deps)).status,503);
  assert.equal(state.writes.length,0);
  state.actor.username="foreign";
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(photoForm()),deps)).status,403);
  state.actor.username=state.session.username;const form=photoForm();form.delete("masterUid");
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(form),deps)).status,400);
});
Deno.test("verified legacy app sessions retain identity binding without becoming native proofs",async()=>{
  const {state,deps}=photoFixture(),form=photoForm("req-",false);
  const response=await handleScopedPhotoUpload(state.session,photoRequest(form,{"x-gnc-session":"verified-app-session"}),deps);
  assert.equal(response.status,200);assert.equal(state.nativeProofs,0);
  assert.equal(state.calls[0].args.p_session_id,null);assert.equal(state.calls[0].args.p_app_issued_at,state.session.iat);
  assert.equal((await response.json()).contractVersion,"plant-photo-legacy-compatible");
  const native=photoFixture();
  await handleScopedPhotoUpload(native.state.session,photoRequest(photoForm(),{"x-gnc-session":""}),native.deps);
  assert.equal(native.state.nativeProofs,1,"empty headers cannot bypass native session validation");
});
Deno.test("captured Suspend tag ID reaches the exact authorization witness",async()=>{
  const {state,deps}=photoFixture(),form=photoForm();form.delete("requestId");form.set("suspendTagId","physical-tag");
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(form),deps)).status,200);
  assert.equal((state.calls[0].args.p_identity as Record<string,unknown>).suspendTagId,"physical-tag");
});
Deno.test("queued Request upload binds the validated binary path and native session",async()=>{
  const {state,deps}=photoFixture(),form=photoForm("req-");
  form.set("queuedPhotoId","capture_1");
  form.set("queuedObjectPath","v2/foreign.jpg");
  const response=await handleScopedPhotoUpload(state.session,photoRequest(form),deps);
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(state.calls[0].name,"authorize_request_photo_intent_v3079");
  assert.equal(state.calls[0].args.p_photo_id,"capture_1");
  assert.equal(state.calls[0].args.p_object_path,data.filePath);
  assert.equal(state.nativeProofs,1);
  state.rpcError={code:"42501",message:"REQUEST_PHOTO_INTENT_FORBIDDEN"};
  state.writes.length=0;
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(form),deps)).status,403);
  assert.equal(state.writes.length,0);
});
Deno.test("Eval private paths and assignment proof stay owned by the existing Eval hooks",async()=>{
  const {state,deps}=photoFixture(),response=await handleScopedPhotoUpload(state.session,photoRequest(photoForm("eval-")),deps);
  assert.equal(response.status,200);assert.equal(state.calls.length,0);
  assert.ok(state.writes.every(row=>row.path.startsWith("eval/work-1/origin-1/")));
  if(state.evalRow)state.evalRow.status="complete";
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(photoForm("eval-")),deps)).status,403);
});
Deno.test("Docks keeps its existing role boundary and never enters the scoped SQL photo path",async()=>{
  const rep=photoFixture();
  assert.equal((await handleScopedPhotoUpload(rep.state.session,photoRequest(photoForm("dock-")),rep.deps)).status,403);
  const admin=photoFixture("ordinary_admin","ADMIN");
  assert.equal((await handleScopedPhotoUpload(admin.state.session,photoRequest(photoForm("dock-")),admin.deps)).status,200);
  assert.equal(admin.state.calls.length,0);assert.ok(admin.state.writes.every(row=>row.bucket==="dock_photos"));
});
Deno.test("encoding, thumbnail and dimension errors fail before Storage",async()=>{
  for(const failure of ["missing-thumb","dimensions","mime"]){
    const {state,deps}=photoFixture(),form=photoForm();
    if(failure==="missing-thumb")form.delete("thumbnail144");
    if(failure==="dimensions")form.set("displayWidth","1921");
    if(failure==="mime")form.set("file",new File([new Uint8Array([255,216,255])],"x.png",{type:"image/png"}));
    assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(form),deps)).status,400);
    assert.equal(state.writes.length,0);
  }
});
Deno.test("default flyer syntax stays fenced and unknown-prefix fallback cannot upload",async()=>{
  const {state,deps}=photoFixture();
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(photoForm("default")),deps)).status,200);
  assert.ok(state.writes.every(row=>row.bucket==="flyer_photos"));
  const before=state.writes.length;
  assert.equal((await handleScopedPhotoUpload(state.session,photoRequest(photoForm("unknown-prefix")),deps)).status,400);
  assert.equal(state.writes.length,before);
});
