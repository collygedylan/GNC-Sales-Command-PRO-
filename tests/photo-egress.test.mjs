import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const worker = read('../assets/image-optimize-worker-v2026090401.js');
const edge = read('../supabase/functions/app-api/index.ts');
const healthMigration = read('../supabase/migrations/20260904070154_photo_delivery_health_v1.sql');
const bucketMigration = read('../supabase/migrations/20260904070155_photo_bucket_guard_v1.sql');
const probe = read('../scripts/probe-production-auth-health.mjs');
const serviceWorker = read('../sw.js');

test('legacy cards use only bounded canonical Supabase transforms', () => {
  const helpers = html.slice(html.indexOf('function getSupabaseStaticV2ThumbnailUrl'), html.indexOf('function getPhotoUrlList'));
  const thumbnailBuilder = helpers.slice(
    helpers.indexOf('function buildSupabaseStorageThumbnailUrl'),
    helpers.indexOf('function getSupabaseStorageOriginalUrl'),
  );
  assert.match(helpers, /\/storage\/v1\/render\/image\/public\//);
  assert.match(helpers, /searchParams\.set\('quality', '62'\)/);
  assert.match(helpers, /searchParams\.set\('resize', 'contain'\)/);
  assert.match(helpers, /requestedWidth\) <= 144 \? 144 : \(Number\(requestedWidth\) <= 320 \? 320 : 640\)/);
  assert.match(helpers, /_thumbs\/v2\/\$\{match\[2\]\}-w\$\{staticWidth\}/);
  assert.doesNotMatch(thumbnailBuilder, /pathname = objectPrefix \+ publicPath/);
  assert.match(html, /const previewUrl = getDirectImageUrl\(cleanUrl, 'card-feature'\) \|\| shareUrl/);
  assert.match(html, /href: shareUrl/);
});

test('thumbnail failures never fetch the original automatically', () => {
  const deferred = html.slice(html.indexOf('function getDeferredCardPhotoFallbackSrc'), html.indexOf('function trimDeferredCardPhotoHydrationState'));
  assert.match(deferred, /function getDeferredCardPhotoFallbackSrc[\s\S]*return '';/);
  assert.doesNotMatch(deferred, /getSupabaseStorageOriginalUrl\(cleanSrc\)/);
  assert.doesNotMatch(deferred, /drive\.google\.com\/uc\?export=view/);
  assert.match(deferred, /app-photo-thumbnail-failed/);
  assert.match(deferred, /const maxCount = Number\(options\.maxCount \|\| \(touch \? 12 : 24\)\)/);
  assert.doesNotMatch(deferred, /slides\[currentIndex \+ 1\]/);
  assert.match(html, /DEFERRED_CARD_PHOTO_ROOT_MARGIN_MOBILE = '160px 0px 320px 0px'/);
  assert.match(html, /DEFERRED_CARD_PHOTO_ROOT_MARGIN_DESKTOP = '320px 0px 480px 0px'/);
});

test('iPhone-safe optimization always produces a verified bounded three-image set', () => {
  assert.match(html, /optimizePhotoBlobOnMainThread/);
  assert.match(html, /WEBP_ENCODER_UNAVAILABLE[\s\S]*contentType = 'image\/jpeg'/);
  assert.match(html, /Could not safely compress this photo/);
  assert.doesNotMatch(html, /preserving the original upload/);
  assert.match(worker, /imageOrientation: 'from-image'/);
  assert.match(worker, /DISPLAY_MAX_BYTES = 1_310_720/);
  assert.match(worker, /THUMBNAIL_LIMITS = Object\.freeze\(\{ 144: 81_920, 320: 163_840 \}\)/);
  assert.match(worker, /blobHasEncoding/);
  assert.match(worker, /thumbnail144Blob/);
  assert.match(worker, /thumbnail320Blob/);
});

test('protected upload API is content-addressed, idempotent, and legacy-bounded', () => {
  assert.match(edge, /uploadContract === "plant-photo-v2"/);
  assert.match(edge, /validatePhotoPart\(file, PHOTO_V2_DISPLAY_MAX_BYTES\)/);
  assert.match(edge, /validatePhotoPart\(thumbnail144, PHOTO_V2_THUMB_144_MAX_BYTES\)/);
  assert.match(edge, /validatePhotoPart\(thumbnail320, PHOTO_V2_THUMB_320_MAX_BYTES\)/);
  assert.match(edge, /const hash = await sha256Hex\(displayPart\.bytes\)/);
  assert.match(edge, /`v2\/\$\{hash\}\.\$\{displayPart\.extension\}`/);
  assert.match(edge, /`_thumbs\/v2\/\$\{hash\}-w144/);
  assert.match(edge, /already exists\|duplicate/);
  assert.match(edge, /PHOTO_TOO_LARGE_REFRESH_REQUIRED/);
  assert.doesNotMatch(edge, /uploadResult\.error\.message \|\| "Photo upload failed/);
  assert.match(html, /HIGH_VOLUME_PLANT_PHOTO_BUCKETS[\s\S]*Secure plant-photo upload is required/);
});

test('service-only health and post-shell bucket guards are explicit', () => {
  assert.match(healthMigration, /^begin;[\s\S]*commit;\s*$/);
  assert.match(healthMigration, /create or replace function public\.get_photo_delivery_health_v1\(\)/);
  assert.match(healthMigration, /private\.is_service_role_request\(\)/);
  assert.match(healthMigration, /revoke all on function public\.get_photo_delivery_health_v1\(\) from public, anon, authenticated/);
  assert.match(healthMigration, /grant execute on function public\.get_photo_delivery_health_v1\(\) to service_role/);
  const healthPayload = healthMigration.slice(
    healthMigration.indexOf('return jsonb_build_object'),
    healthMigration.indexOf('end\n$function$'),
  );
  assert.doesNotMatch(healthPayload, /'photo_url'|'filename'|'username'|'unique_id'/i);
  assert.match(bucketMigration, /file_size_limit = 2097152/);
  assert.match(bucketMigration, /allowed_mime_types = array\['image\/jpeg', 'image\/webp'\]/);
  assert.match(bucketMigration, /guarded_count <> 4/);
  assert.match(probe, /get_photo_delivery_health_v1/);
  assert.match(probe, /production_photo_delivery_contract_unhealthy/);
});

test('photo release uses one synchronized shell and optimizer asset', () => {
  assert.match(html, /window\.__APP_SHELL_VERSION__ = 'V2026\.09\.04\.04'/);
  assert.match(serviceWorker, /APP_SHELL_BUILD = 'V2026\.09\.04\.04'/);
  assert.match(serviceWorker, /image-optimize-worker-v2026090401\.js/);
  assert.doesNotMatch(serviceWorker, /image-optimize-worker-v2026081709\.js/);
});
