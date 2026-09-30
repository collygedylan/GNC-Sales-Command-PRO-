/* Client-side photo optimizer. No network access and no persistent data. */
self.onmessage = async (event) => {
  const id = event.data && event.data.id;
  const input = event.data && event.data.blob;
  try {
    if (!(input instanceof Blob)) throw new Error('Missing image blob.');
    let bitmap;
    try {
      bitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
    } catch (_error) {
      bitmap = await createImageBitmap(input);
    }
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > 1920 ? 1920 / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Image canvas unavailable.');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let output = null;
    let outputType = 'image/webp';
    for (const quality of [0.82, 0.74, 0.66]) {
      output = await canvas.convertToBlob({ type: 'image/webp', quality });
      if (output.size <= 600 * 1024 || quality === 0.66) break;
    }
    if (!output || !output.size) {
      outputType = 'image/jpeg';
      output = await canvas.convertToBlob({ type: outputType, quality: 0.82 });
    }
    const digest = await crypto.subtle.digest('SHA-256', await output.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    self.postMessage({ id, ok: true, blob: output, type: outputType, extension: outputType === 'image/webp' ? 'webp' : 'jpg', hash, width, height });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error && error.message || error || 'Image optimization failed.') });
  }
};
