export const PHOTO_V2_DISPLAY_MAX_BYTES = 1_310_720;
export const PHOTO_V2_THUMB_144_MAX_BYTES = 81_920;
export const PHOTO_V2_THUMB_320_MAX_BYTES = 163_840;
export const PHOTO_LEGACY_MAX_BYTES = 2_097_152;

export type ValidatedPhotoPart = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/webp";
  extension: "jpg" | "webp";
};

export function detectPhotoMimeType(bytes: Uint8Array): ValidatedPhotoPart["mimeType"] | "" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}

export async function validatePhotoPart(file: File, maxBytes: number): Promise<ValidatedPhotoPart> {
  if (file.size <= 0 || file.size > maxBytes) throw new Error("PHOTO_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectPhotoMimeType(bytes);
  if (!mimeType) throw new Error("PHOTO_ENCODING_UNSUPPORTED");
  const declaredType = String(file.type || "").trim().toLowerCase().replace("image/jpg", "image/jpeg");
  if (declaredType && declaredType !== mimeType) throw new Error("PHOTO_MIME_MISMATCH");
  return { bytes, mimeType, extension: mimeType === "image/webp" ? "webp" : "jpg" };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes.buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function readPositivePhotoDimension(form: FormData, key: string, max: number): number {
  const value = Number(form.get(key) || 0);
  if (!Number.isFinite(value) || value < 1 || value > max) throw new Error("PHOTO_DIMENSIONS_INVALID");
  return Math.round(value);
}
