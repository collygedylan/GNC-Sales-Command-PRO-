import type { AppSessionClaims } from "../../supabase/functions/_shared/app-auth.ts";

export type PhotoIdentity = { masterUid: string; requestId?: string; suspendTagId?: string };
type Actor = Record<string, unknown>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
export type PhotoAuthorizationDependencies = {
  resolveActor(...[]: [session: AppSessionClaims]): Promise<Actor>;
  normalizeUsername(...[]: [value: unknown]): string;
  verifyNativeSession(...[]: [actor: Actor, request: Request]): Promise<string>;
  rpc(...[]: [name: string, args: Record<string, unknown>]): PromiseLike<RpcResult>;
};

export class PhotoUploadFailure extends Error {
  readonly status:number;
  readonly code:string;
  constructor(message:string,status:number,code:string) {
    super(message);
    this.status=status;
    this.code=code;
  }
}

function capturedPhotoIdentity(form: FormData): Record<string, string> {
  const fields = ["masterUid", "itemCode", "locationCode", "lotCode", "requestId", "suspendTagId"];
  const identity = Object.fromEntries(fields.map(key => [key, String(form.get(key) || "").trim()]));
  if (fields.slice(0,4).some(key => !identity[key])) {
    throw new PhotoUploadFailure("Exact inventory row identity is required. Refresh the app and retry.",400,"PHOTO_IDENTITY_REQUIRED");
  }
  return identity;
}

export async function authorizePhotoUpload(session: AppSessionClaims, request: Request, form: FormData,
  prefix: string, deps: PhotoAuthorizationDependencies): Promise<PhotoIdentity> {
  const actor = await deps.resolveActor(session);
  const username = deps.normalizeUsername(session.username);
  if (!actor.id || deps.normalizeUsername(actor.username) !== username
    || session.authUserId && session.authUserId !== actor.id) {
    throw new PhotoUploadFailure("The active account changed. Sign in again before retrying.",403,"PHOTO_ACTOR_MISMATCH");
  }
  const identity = capturedPhotoIdentity(form);
  const legacySession=Boolean(request.headers.get("x-gnc-session")||request.headers.get("x-app-session"));
  let nativeSessionId:string|null=null;
  if (session.authUserId && !legacySession) {
    try { nativeSessionId=await deps.verifyNativeSession(actor,request); }
    catch { throw new PhotoUploadFailure("A verified session is required.",403,"PHOTO_SESSION_REQUIRED"); }
  }
  const result = await deps.rpc("authorize_photo_upload_v3074",{
    p_actor_id:String(actor.id),p_actor_username:username,p_prefix:prefix,p_identity:identity,
    p_session_id:nativeSessionId,p_app_issued_at:nativeSessionId ? null : session.iat,
  });
  if (result.error) {
    const code=String(result.error.message || "PHOTO_AUTHORIZATION_FAILED");
    const status=result.error.code === "42501" ? 403 : result.error.code === "22023" ? 409 : 503;
    throw new PhotoUploadFailure(status===503 ? "Photo authorization is temporarily unavailable. Retry without retaking it." :
      "This exact row is unavailable to your account. Refresh the row and retry.",status,code);
  }
  const data=result.data as PhotoIdentity & {ok?: boolean} | null;
  if (!data || data.ok!==true || data.masterUid!==identity.masterUid
    || identity.requestId && data.requestId!==identity.requestId
    || identity.suspendTagId && data.suspendTagId!==identity.suspendTagId) {
    throw new PhotoUploadFailure("The photo row was not confirmed. Your local photo is retained.",503,"PHOTO_AUTHORITY_UNCONFIRMED");
  }
  return data;
}
