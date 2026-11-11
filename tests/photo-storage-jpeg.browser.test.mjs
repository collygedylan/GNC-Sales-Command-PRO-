import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from 'playwright';

const origin = 'https://camera.fixture.test';
const workerPath = '/assets/image-optimize-worker-v2026090401.js';
const transportPath = '/src/services/app-api-transport.js';
const scriptPaths = new Set([workerPath, transportPath, '/src/services/rpc-recovery-domain.js',
    '/src/services/operational-rpc-retry.js']);

async function cameraJpeg(worker) {
    const canvas = document.createElement('canvas');
    canvas.width = 2500;
    canvas.height = 1500;
    const paint = canvas.getContext('2d');
    paint.fillStyle = '#236b41';
    paint.fillRect(0, 0, canvas.width, canvas.height);
    const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return new Promise((resolve, reject) => {
        worker.onmessage = ({data}) => data.ok ? resolve(data) : reject(Error(data.error));
        worker.onerror = reject;
        worker.postMessage({id: 1, blob: photo});
    });
}

async function uploadJpeg({workerPath, transportPath}) {
    Object.assign(window, {SUPABASE_URL: location.origin, PHOTO_BUCKETS: {'lsn-': 'location_sales_notes_photos'},
        fetchSupabaseRestViaAppApiIfNeeded: async () => null});
    const transport = await import(transportPath);
    const worker = new Worker(workerPath);
    try {
        const jpeg = await window.cameraJpeg(worker);
        const form = new FormData();
        form.append('file', jpeg.blob, 'capture.jpg');
        const object = await transport.getNativeDrivePhotoObject(form, 'lsn-', 'fixture-master-uid');
        const path = object.bucketName + '/' + object.filePath;
        const started = performance.now();
        await transport.uploadNativeDrivePhotoPart(path, object.file, {Authorization:'Bearer fixture'}, () => true, {});
        return {width: jpeg.width, height: jpeg.height, hash: jpeg.hash, uploadMs: Math.round(performance.now() - started)};
    } finally {
        worker.terminate();
    }
}

async function routeCaptureFixture(route, attempts, unexpected) {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<body data-current-view="detail"></body>'});
    if (url.origin === origin && scriptPaths.has(url.pathname)) {
        const body = await readFile(new URL('..' + url.pathname, import.meta.url), 'utf8');
        return route.fulfill({contentType:'application/javascript',body});
    }
    if (url.origin === origin && url.pathname.startsWith('/storage/v1/object/') && request.method() === 'POST') {
        attempts.push({path:url.pathname, headers:await request.allHeaders(), bytes:request.postDataBuffer()});
        return route.fulfill({status:attempts.length === 1 ? 503 : 200, json:{}});
    }
    unexpected.push(url.pathname);
    await route.abort();
}

test('camera worker JPEG reaches the exact raw Storage object after a transient response', async t => {
    const browser = await chromium.launch({headless:true});
    t.after(() => browser.close());
    const page = await browser.newPage({isMobile:true, viewport:{width:390,height:844}, serviceWorkers:'block'});
    const attempts = [], unexpected = [];
    await page.route('**/*', route => routeCaptureFixture(route, attempts, unexpected));
    await page.goto(origin);
    await page.addScriptTag({content:cameraJpeg.toString()});
    const result = await page.evaluate(uploadJpeg, {workerPath, transportPath});
    assert.deepEqual([result.width, result.height], [1920, 1152]);
    assert.deepEqual(unexpected, []);
    assert.equal(attempts.length, 2);
    const uid = Buffer.from('fixture-master-uid').toString('hex');
    for (const attempt of attempts) {
        assert.equal(attempt.path, '/storage/v1/object/location_sales_notes_photos/drive-evidence/' + uid + '/v2/' + result.hash + '.jpg');
        assert.equal(attempt.headers.authorization, 'Bearer fixture');
        assert.equal(attempt.headers.referer, undefined);
        assert.equal(attempt.headers['content-type'], 'image/jpeg');
        assert.match(attempt.headers['cache-control'], /31536000/);
        assert.equal(attempt.bytes.subarray(0,3).toString('hex'), 'ffd8ff');
        assert.equal(createHash('sha256').update(attempt.bytes).digest('hex'), result.hash);
    }
    t.diagnostic('Fixture Storage 503 then 200 in ' + result.uploadMs + ' ms for ' + attempts[0].bytes.length + ' JPEG bytes');
});
