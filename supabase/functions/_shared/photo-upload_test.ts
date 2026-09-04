import {
  PHOTO_LEGACY_MAX_BYTES,
  PHOTO_V2_DISPLAY_MAX_BYTES,
  detectPhotoMimeType,
  readPositivePhotoDimension,
  sha256Hex,
  validatePhotoPart,
} from "./photo-upload.ts";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("plant photo signatures, MIME, and extension are authoritative", async () => {
  const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2])], "wrong.webp", { type: "image/jpeg" });
  const validated = await validatePhotoPart(jpeg, PHOTO_V2_DISPLAY_MAX_BYTES);
  assert(validated.mimeType === "image/jpeg");
  assert(validated.extension === "jpg");
  assert(detectPhotoMimeType(validated.bytes) === "image/jpeg");

  const webpBytes = new TextEncoder().encode("RIFF0000WEBPVP8 ");
  const webp = new File([webpBytes], "photo.webp", { type: "image/webp" });
  assert((await validatePhotoPart(webp, PHOTO_LEGACY_MAX_BYTES)).mimeType === "image/webp");
});

Deno.test("PNG content and MIME/signature mismatches are rejected", async () => {
  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], "photo.webp", { type: "image/webp" });
  await validatePhotoPart(png, PHOTO_V2_DISPLAY_MAX_BYTES).then(
    () => { throw new Error("PNG was accepted"); },
    (error) => assert(String(error.message) === "PHOTO_ENCODING_UNSUPPORTED"),
  );
  const mislabeled = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xdb])], "photo.webp", { type: "image/webp" });
  await validatePhotoPart(mislabeled, PHOTO_V2_DISPLAY_MAX_BYTES).then(
    () => { throw new Error("mislabeled JPEG was accepted"); },
    (error) => assert(String(error.message) === "PHOTO_MIME_MISMATCH"),
  );
});

Deno.test("oversized legacy photos and invalid dimensions are rejected", async () => {
  const oversized = new Uint8Array(PHOTO_LEGACY_MAX_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await validatePhotoPart(new File([oversized], "large.jpg", { type: "image/jpeg" }), PHOTO_LEGACY_MAX_BYTES).then(
    () => { throw new Error("oversized photo was accepted"); },
    (error) => assert(String(error.message) === "PHOTO_TOO_LARGE"),
  );
  const form = new FormData();
  form.set("width", "1921");
  try {
    readPositivePhotoDimension(form, "width", 1920);
    throw new Error("invalid dimension was accepted");
  } catch (error) {
    assert(String((error as Error).message) === "PHOTO_DIMENSIONS_INVALID");
  }
});

Deno.test("content hashes are stable and content-addressed", async () => {
  const bytes = new TextEncoder().encode("same optimized plant image");
  const first = await sha256Hex(bytes);
  const second = await sha256Hex(bytes);
  assert(first === second);
  assert(/^[a-f0-9]{64}$/.test(first));
});
