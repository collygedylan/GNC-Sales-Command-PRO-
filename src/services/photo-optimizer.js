const PHOTO_MAX_WIDTH = 1920;
const PHOTO_JPEG_QUALITY = 0.90;
const PHOTO_DISPLAY_MAX_BYTES = 1_310_720;
const PHOTO_THUMB_144_MAX_BYTES = 80 * 1024;
const PHOTO_THUMB_320_MAX_BYTES = 160 * 1024;
const PHOTO_OPTIMIZER_WORKER_URL = './assets/image-optimize-worker-v2026090401.js?v=3.0.87';
let photoOptimizerWorker = null;
let photoOptimizerRequestId = 0;
const photoOptimizerPending = new Map();

export function getPhotoOptimizerWorker() {
    if (photoOptimizerWorker || typeof Worker !== 'function' || typeof OffscreenCanvas === 'undefined') return photoOptimizerWorker;
    try {
        photoOptimizerWorker = new Worker(PHOTO_OPTIMIZER_WORKER_URL);
        photoOptimizerWorker.onmessage = (event) => {
            const payload = event && event.data ? event.data : {};
            const pending = photoOptimizerPending.get(Number(payload.id));
            if (!pending) return;
            photoOptimizerPending.delete(Number(payload.id));
            clearTimeout(pending.timeoutId);
            if (payload.ok) pending.resolve(payload);
            else pending.reject(new Error(String(payload.error || 'Image optimization failed.')));
        };
        photoOptimizerWorker.onerror = () => {
            photoOptimizerPending.forEach((pending) => {
                clearTimeout(pending.timeoutId);
                pending.reject(new Error('Image optimization worker failed.'));
            });
            photoOptimizerPending.clear();
            photoOptimizerWorker.terminate();
            photoOptimizerWorker = null;
        };
    } catch {
        photoOptimizerWorker = null;
    }
    return photoOptimizerWorker;
}

export async function getPhotoBlobEncoding(blob = null) {
    if (!(blob instanceof Blob)) return '';
    return detectImageEncoding(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
}

export function getPhotoFitDimensions(width = 0, height = 0, maxEdge = PHOTO_MAX_WIDTH) {
    const sourceWidth = Math.max(1, Number(width) || 1);
    const sourceHeight = Math.max(1, Number(height) || 1);
    const edge = Math.max(sourceWidth, sourceHeight);
    const scale = edge > maxEdge ? maxEdge / edge : 1;
    return {
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale))
    };
}

export function canvasToPhotoBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function encodeMainThreadPhotoBlob(source, target, type, maxBytes) {
    let width = target.width;
    let height = target.height;
    const qualities = type === 'image/webp' ? [0.82, 0.74, 0.66, 0.56] : [PHOTO_JPEG_QUALITY];
    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Image canvas unavailable.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(source, 0, 0, width, height);
        const lastBlob = await encodePhotoCanvasAttempts(canvas,type,qualities,maxBytes);
        canvas.width = 1;
        canvas.height = 1;
        if (lastBlob.size<=maxBytes) return {blob:lastBlob,width,height};
        const shrink = Math.max(0.62, Math.min(0.88, Math.sqrt(maxBytes / lastBlob.size) * 0.94));
        width = Math.max(1, Math.round(width * shrink));
        height = Math.max(1, Math.round(height * shrink));
    }
    throw new Error('PHOTO_COMPRESSION_LIMIT');
}

export async function loadMainThreadPhotoSource(blob) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
            return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
        } catch { globalThis.reportHandledRuntimeIssue?.("loadMainThreadPhotoSource", 'HANDLED_OPERATION_FAILURE'); }
    }
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    try {
        await new Promise((resolve, reject) => {
            image.onload = resolve;
            image.onerror = () => reject(new Error('Could not decode the selected image.'));
            image.src = objectUrl;
        });
        return {
            source: image,
            width: Number(image.naturalWidth || image.width || 0),
            height: Number(image.naturalHeight || image.height || 0),
            cleanup: () => { image.src = ''; URL.revokeObjectURL(objectUrl); }
        };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

export async function optimizePhotoBlobOnMainThread(blob) {
    const loaded = await loadMainThreadPhotoSource(blob);
    try {
        const encodeSet = async (type) => ({
            display: await encodeMainThreadPhotoBlob(loaded.source, getPhotoFitDimensions(loaded.width, loaded.height, PHOTO_MAX_WIDTH), type, PHOTO_DISPLAY_MAX_BYTES),
            thumbnail144: await encodeMainThreadPhotoBlob(loaded.source, getPhotoFitDimensions(loaded.width, loaded.height, 144), type, PHOTO_THUMB_144_MAX_BYTES),
            thumbnail320: await encodeMainThreadPhotoBlob(loaded.source, getPhotoFitDimensions(loaded.width, loaded.height, 320), type, PHOTO_THUMB_320_MAX_BYTES)
        });
        const contentType = 'image/jpeg';
        const encoded = await encodeSet(contentType);
        const digest = await crypto.subtle.digest('SHA-256', await encoded.display.blob.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
        return {
            blob: encoded.display.blob,
            thumbnail144Blob: encoded.thumbnail144.blob,
            thumbnail320Blob: encoded.thumbnail320.blob,
            contentType,
            extension: contentType === 'image/webp' ? 'webp' : 'jpg',
            hash,
            width: encoded.display.width,
            height: encoded.display.height,
            thumbnail144Width: encoded.thumbnail144.width,
            thumbnail144Height: encoded.thumbnail144.height,
            thumbnail320Width: encoded.thumbnail320.width,
            thumbnail320Height: encoded.thumbnail320.height
        };
    } finally {
        loaded.cleanup();
    }
}

export function normalizeOptimizedPhotoResult(result = {}) {
    const contentType = String(result.type || result.contentType || (result.blob && result.blob.type) || '').toLowerCase();
    const extension = contentType === 'image/webp' ? 'webp' : 'jpg';
    return {
        blob: result.blob,
        thumbnail144Blob: result.thumbnail144Blob,
        thumbnail320Blob: result.thumbnail320Blob,
        fileName: `${String(result.hash || '').slice(0, 64)}.${extension}`,
        contentType,
        extension,
        hash: String(result.hash || ''),
        width: Number(result.width || 0),
        height: Number(result.height || 0),
        thumbnail144Width: Number(result.thumbnail144Width || 0),
        thumbnail144Height: Number(result.thumbnail144Height || 0),
        thumbnail320Width: Number(result.thumbnail320Width || 0),
        thumbnail320Height: Number(result.thumbnail320Height || 0)
    };
}

export async function optimizePhotoBlobForUpload(blob, fileName = 'photo.jpg', options = {}) {
    if (!(blob instanceof Blob) || !String(blob.type || '').toLowerCase().startsWith('image/')) {
        throw new Error('Select a supported plant photo.');
    }
    const worker = getPhotoOptimizerWorker();
    const id = ++photoOptimizerRequestId;
    if (worker) try {
        const result = await requestPhotoOptimizerWorker(worker,id,blob,fileName,options);
        const normalized = normalizeOptimizedPhotoResult(result);
        if (normalized.blob && normalized.blob.size <= PHOTO_DISPLAY_MAX_BYTES
            && (options.mainOnly === true || (normalized.thumbnail144Blob && normalized.thumbnail320Blob
            && normalized.thumbnail144Blob.size <= PHOTO_THUMB_144_MAX_BYTES
            && normalized.thumbnail320Blob.size <= PHOTO_THUMB_320_MAX_BYTES))) return normalized;
        throw new Error('PHOTO_OPTIMIZER_CONTRACT_INVALID');
    } catch {
        globalThis.reportHandledRuntimeIssue?.('photo_optimizer','WORKER_FALLBACK');
    }
    try {
        return normalizeOptimizedPhotoResult(await optimizePhotoBlobOnMainThread(blob));
    } catch {
        throw new Error('Could not safely compress this photo. Try taking it again.');
    }
}




async function encodePhotoCanvasAttempts(canvas,type,qualities,maxBytes) {
    let blob;
    for (const quality of qualities) {
        blob = await canvasToPhotoBlob(canvas,type,quality);
        if (!(blob instanceof Blob) || !blob.size || await getPhotoBlobEncoding(blob)!==type) {
            throw new Error('IMAGE_ENCODER_UNAVAILABLE');
        }
        if (blob.size<=maxBytes) break;
    }
    return blob;
}

function requestPhotoOptimizerWorker(worker,id,blob,fileName,options) {
    return new Promise((resolve,reject)=>{
        const timeoutId=setTimeout(()=>{
            photoOptimizerPending.delete(id);
            reject(new Error('Image optimization timed out.'));
        },30000);
        photoOptimizerPending.set(id,{resolve,reject,timeoutId});
        worker.postMessage({id,blob,fileName,mainOnly:options.mainOnly===true});
    });
}
