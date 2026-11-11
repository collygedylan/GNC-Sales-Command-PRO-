import type { AppSessionClaims } from "../../supabase/functions/_shared/app-auth.ts";
import { PHOTO_LEGACY_MAX_BYTES, PHOTO_V2_DISPLAY_MAX_BYTES, PHOTO_V2_THUMB_144_MAX_BYTES,
  PHOTO_V2_THUMB_320_MAX_BYTES, readPositivePhotoDimension, sha256Hex, validatePhotoPart,
  type ValidatedPhotoPart } from "../../supabase/functions/_shared/photo-upload.ts";
import { PhotoUploadFailure, type PhotoIdentity } from "./photo-upload-authorization.ts";

type Row = Record<string,unknown>;
type EvalContext = { workId:string; originUid:string; multiOrigin:boolean };
type UploadContext = { prefix:string; identity:PhotoIdentity|null; eval:EvalContext|null; bucket:string };
export type PhotoUploadDependencies = {
  buckets:Record<string,string>;
  json(...[]: [data:unknown]): Response;
  error(...[]: [message:string,status:number,extra?:Record<string,unknown>]): Response;
  isRepLike(...[]: [role:string]): boolean;
  normalizeUsername(...[]: [value:unknown]): string;
  loadEvalAssignment(...[]: [session:AppSessionClaims,id:string]): Promise<Row|null>;
  isEvalAssigned(...[]: [row:Row,actor:string]): boolean;
  authorize(...[]: [session:AppSessionClaims,request:Request,form:FormData,prefix:string]): Promise<PhotoIdentity>;
  upload(...[]: [bucket:string,path:string,part:ValidatedPhotoPart]): Promise<void>;
  publicUrl(...[]: [bucket:string,path:string]): string;
  sanitizeFileName(...[]: [name:string]): string;
  sanitizeStorageFileName(...[]: [name:string]): string;
};
const protectedPrefixes=new Set(["ssn-","lsn-","na-","flyer-","req-"]);
const repPrefixes=new Set(["req-","credit-","eval-"]);

async function authorizeEvalPhoto(session:AppSessionClaims,form:FormData,deps:PhotoUploadDependencies):Promise<EvalContext> {
  const workId=String(form.get("workId")||"").trim(),originUid=String(form.get("originUid")||"").trim();
  if (!/^[A-Za-z0-9._-]+$/.test(originUid)) throw new PhotoUploadFailure("Invalid Eval origin.",400,"eval_work_photo_origin_invalid");
  const row=await deps.loadEvalAssignment(session,workId);
  const multiOrigin=row?.contract_version==="eval-work-v2-multi-origin";
  const originAllowed=multiOrigin ? Array.isArray(row?.origins)
    && row.origins.some(origin=>String((origin as Row).origin_unique_id||"")===originUid) : row?.origin_unique_id===originUid;
  if (!row || !deps.isEvalAssigned(row,deps.normalizeUsername(session.username||session.displayName))
    || !["open","in_progress"].includes(String(row.status||"")) || !originAllowed) {
    throw new PhotoUploadFailure("Eval photo upload is not authorized for this assignment and row.",403,"eval_work_photo_forbidden");
  }
  return {workId,originUid,multiOrigin};
}

function photoBase(context:UploadContext):string {
  if (!context.eval) return "";
  const {workId,originUid,multiOrigin}=context.eval;
  return multiOrigin ? `eval/${workId}/${originUid}/` : `eval/${workId}/`;
}

async function uploadLegacyPhoto(file:File,form:FormData,context:UploadContext,deps:PhotoUploadDependencies) {
  try {
    const legacy=await validatePhotoPart(file,PHOTO_LEGACY_MAX_BYTES);
    const requested=deps.sanitizeStorageFileName(String(form.get("fileName")||file.name||""));
    const original=deps.sanitizeFileName(String(form.get("fileName")||file.name||"photo"));
    const base=requested ? requested.replace(/\.[^.]+$/,"") : `${original}-${Date.now()}`;
    const fileName=`${base}.${legacy.extension}`;
    const folder=context.eval ? photoBase(context) : context.identity
      ? `drive/${deps.sanitizeStorageFileName(context.identity.masterUid)}/` : new Date().toISOString().split("T")[0]+"/";
    const filePath=folder+fileName;
    await deps.upload(context.bucket,filePath,legacy);
    return deps.json({ok:true,contractVersion:"plant-photo-legacy-compatible",publicUrl:deps.publicUrl(context.bucket,filePath),
      bucketName:context.bucket,filePath,mimeType:legacy.mimeType,byteCount:legacy.bytes.byteLength,
      masterUid:context.identity?.masterUid});
  } catch(error) {
    const code=String(error instanceof Error ? error.message : error);
    if (["PHOTO_TOO_LARGE","PHOTO_ENCODING_UNSUPPORTED","PHOTO_MIME_MISMATCH"].includes(code)) {
      return deps.error("This app version cannot safely upload that photo. Refresh the app and retry.",409,{code:"PHOTO_TOO_LARGE_REFRESH_REQUIRED"});
    }
    return deps.error("Photo upload is temporarily unavailable. Retry without retaking the photo.",503,{code:"PHOTO_UPLOAD_RETRY"});
  }
}

function photoDimensions(form:FormData) {
  return {width:readPositivePhotoDimension(form,"displayWidth",1920),height:readPositivePhotoDimension(form,"displayHeight",1920),
    thumbnail144Width:readPositivePhotoDimension(form,"thumbnail144Width",144),thumbnail144Height:readPositivePhotoDimension(form,"thumbnail144Height",144),
    thumbnail320Width:readPositivePhotoDimension(form,"thumbnail320Width",320),thumbnail320Height:readPositivePhotoDimension(form,"thumbnail320Height",320)};
}

function optimizedPhotoFailure(error:unknown,deps:PhotoUploadDependencies) {
  const code=String(error instanceof Error ? error.message : error);
  if (code==="PHOTO_TOO_LARGE") return deps.error("The compressed photo is still too large. Retake it or retry after refresh.",413,{code});
  if (code==="PHOTO_MIME_MISMATCH") return deps.error("The photo encoding did not match its MIME type.",400,{code});
  if (code==="PHOTO_ENCODING_UNSUPPORTED") return deps.error("Only JPEG or WebP plant photos can be uploaded.",415,{code});
  if (code==="PHOTO_DIMENSIONS_INVALID") return deps.error("The optimized photo dimensions are invalid. Refresh and retry.",400,{code});
  return deps.error("Photo upload is temporarily unavailable. Retry without retaking the photo.",503,{code:"PHOTO_UPLOAD_RETRY"});
}

async function uploadOptimizedPhoto(file:File,form:FormData,context:UploadContext,deps:PhotoUploadDependencies) {
  const thumbnail144=form.get("thumbnail144"),thumbnail320=form.get("thumbnail320");
  if (!(thumbnail144 instanceof File) || !(thumbnail320 instanceof File)) {
    return deps.error("The optimized thumbnail set is incomplete. Refresh the app and retry.",400,{code:"PHOTO_THUMBNAILS_REQUIRED"});
  }
  try {
    const [display,small,medium]=await Promise.all([validatePhotoPart(file,PHOTO_V2_DISPLAY_MAX_BYTES),
      validatePhotoPart(thumbnail144,PHOTO_V2_THUMB_144_MAX_BYTES),validatePhotoPart(thumbnail320,PHOTO_V2_THUMB_320_MAX_BYTES)]);
    if (display.mimeType!==small.mimeType || display.mimeType!==medium.mimeType) {
      return deps.error("The optimized photo encodings do not match. Refresh the app and retry.",400,{code:"PHOTO_MIME_MISMATCH"});
    }
    const dimensions=photoDimensions(form),hash=await sha256Hex(display.bytes),base=photoBase(context);
    const filePath=`${base}v2/${hash}.${display.extension}`;
    const smallPath=`${base}_thumbs/v2/${hash}-w144.${display.extension}`;
    const mediumPath=`${base}_thumbs/v2/${hash}-w320.${display.extension}`;
    await Promise.all([deps.upload(context.bucket,smallPath,small),deps.upload(context.bucket,mediumPath,medium)]);
    await deps.upload(context.bucket,filePath,display);
    const publicUrl=deps.publicUrl(context.bucket,filePath),thumbnail144Url=deps.publicUrl(context.bucket,smallPath);
    const thumbnail320Url=deps.publicUrl(context.bucket,mediumPath);
    return deps.json({ok:true,contractVersion:"plant-photo-v2",publicUrl,bucketName:context.bucket,filePath,
      thumbnailUrls:{"144":thumbnail144Url,"320":thumbnail320Url},thumbnail144Url,thumbnail320Url,...dimensions,
      mimeType:display.mimeType,byteCount:display.bytes.byteLength,thumbnail144ByteCount:small.bytes.byteLength,
      thumbnail320ByteCount:medium.bytes.byteLength,sha256:hash,masterUid:context.identity?.masterUid});
  } catch(error) { return optimizedPhotoFailure(error,deps); }
}

export async function handleScopedPhotoUpload(session:AppSessionClaims|null,request:Request,deps:PhotoUploadDependencies):Promise<Response> {
  if (!session) return deps.error("Unauthorized",401);
  if (session.mustChangePassword) return deps.error("Password change required.",403,{code:"PASSWORD_CHANGE_REQUIRED"});
  try {
    const form=await request.formData(),rawPrefix=String(form.get("prefix")||"default").trim();
    const prefix=rawPrefix==="default" ? "flyer-" : rawPrefix;
    if (!protectedPrefixes.has(prefix) && !Object.hasOwn(deps.buckets,prefix)) return deps.error("Invalid photo prefix.",400,{code:"PHOTO_PREFIX_INVALID"});
    if (!protectedPrefixes.has(prefix) && deps.isRepLike(session.role) && !repPrefixes.has(prefix)) {
      return deps.error("REP users can only upload request or credit photos.",403);
    }
    const file=form.get("file");
    if (!(file instanceof File)) return deps.error("No photo file was provided.",400);
    const identity=protectedPrefixes.has(prefix) ? await deps.authorize(session,request,form,prefix) : null;
    const evalContext=prefix==="eval-" ? await authorizeEvalPhoto(session,form,deps) : null;
    const context={prefix,identity,eval:evalContext,bucket:deps.buckets[prefix]||deps.buckets.default};
    return String(form.get("uploadContract")||"").trim().toLowerCase()==="plant-photo-v2"
      ? await uploadOptimizedPhoto(file,form,context,deps) : await uploadLegacyPhoto(file,form,context,deps);
  } catch(error) {
    if (error instanceof PhotoUploadFailure) return deps.error(error.message,error.status,{code:error.code});
    return deps.error("Photo authorization is temporarily unavailable. Retry without retaking the photo.",503,{code:"PHOTO_UPLOAD_RETRY"});
  }
}
