/* Plant-photo optimizer. Produces one bounded display image and two static thumbnails. */
const DISPLAY_MAX_EDGE = 1920;
const DISPLAY_MAX_BYTES = 1_310_720;
const THUMBNAIL_LIMITS = Object.freeze({ 144: 81_920, 320: 163_840 });

function detectImageEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
}

async function blobHasEncoding(blob, expectedType) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return detectImageEncoding(bytes) === expectedType;
}

function fitDimensions(width, height, maxEdge) {
  const edge = Math.max(width, height);
  const scale = edge > maxEdge ? maxEdge / edge : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function encodeBounded(bitmap, target, type, maxBytes) {
  let width = target.width;
  let height = target.height;
  const qualities = type === 'image/webp' ? [0.82, 0.74, 0.66, 0.56] : [0.84, 0.76, 0.68, 0.58, 0.48];
  for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Image canvas unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    let lastBlob = null;
    for (const quality of qualities) {
      const encoded = await canvas.convertToBlob({ type, quality });
      if (!(encoded instanceof Blob) || !encoded.size || !(await blobHasEncoding(encoded, type))) {
        throw new Error(type === 'image/webp' ? 'WEBP_ENCODER_UNAVAILABLE' : 'IMAGE_ENCODER_UNAVAILABLE');
      }
      lastBlob = encoded;
      if (encoded.size <= maxBytes) return { blob: encoded, width, height };
    }
    if (!lastBlob) throw new Error('Image encoding failed.');
    const shrink = Math.max(0.62, Math.min(0.88, Math.sqrt(maxBytes / lastBlob.size) * 0.94));
    width = Math.max(1, Math.round(width * shrink));
    height = Math.max(1, Math.round(height * shrink));
  }
  throw new Error('PHOTO_COMPRESSION_LIMIT');
}

async function encodePhotoSet(bitmap, type) {
  const displayTarget = fitDimensions(bitmap.width, bitmap.height, DISPLAY_MAX_EDGE);
  const display = await encodeBounded(bitmap, displayTarget, type, DISPLAY_MAX_BYTES);
  const thumbnail144 = await encodeBounded(bitmap, fitDimensions(bitmap.width, bitmap.height, 144), type, THUMBNAIL_LIMITS[144]);
  const thumbnail320 = await encodeBounded(bitmap, fitDimensions(bitmap.width, bitmap.height, 320), type, THUMBNAIL_LIMITS[320]);
  return { display, thumbnail144, thumbnail320 };
}

self.onmessage = async (event) => {
  const id = event.data && event.data.id;
  const input = event.data && event.data.blob;
  let bitmap = null;
  try {
    if (!(input instanceof Blob)) throw new Error('Missing image blob.');
    try {
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
    } catch (_error) {
      bitmap = await createImageBitmap(input);
    }
    let type = 'image/webp';
    let encoded;
    try {
      encoded = await encodePhotoSet(bitmap, type);
    } catch (error) {
      if (!/WEBP_ENCODER_UNAVAILABLE/i.test(String(error && error.message || error))) throw error;
      type = 'image/jpeg';
      encoded = await encodePhotoSet(bitmap, type);
    }
    const digest = await crypto.subtle.digest('SHA-256', await encoded.display.blob.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    self.postMessage({
      id,
      ok: true,
      blob: encoded.display.blob,
      thumbnail144Blob: encoded.thumbnail144.blob,
      thumbnail320Blob: encoded.thumbnail320.blob,
      type,
      extension: type === 'image/webp' ? 'webp' : 'jpg',
      hash,
      width: encoded.display.width,
      height: encoded.display.height,
      thumbnail144Width: encoded.thumbnail144.width,
      thumbnail144Height: encoded.thumbnail144.height,
      thumbnail320Width: encoded.thumbnail320.width,
      thumbnail320Height: encoded.thumbnail320.height,
    });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error || 'Image optimization failed.') });
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
};
