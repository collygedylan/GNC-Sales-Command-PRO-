import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?e2e=photo-egress-v1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).getDirectImageUrl === 'function');
});

test('legacy and V2 card URLs never point at the original object', async ({ page }) => {
  const urls = await page.evaluate(() => {
    const hash = 'a'.repeat(64);
    const legacy = 'https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/2026-09-04/legacy.webp';
    const v2 = `https://kzrnyjsosryejjejliii.supabase.co/storage/v1/object/public/request_photos/v2/${hash}.webp`;
    return {
      legacy: (window as any).getDirectImageUrl(legacy, 'card-feature'),
      v2: (window as any).getDirectImageUrl(v2, 'card-feature'),
      fallback: (window as any).getDeferredCardPhotoFallbackSrc(legacy),
    };
  });
  expect(urls.legacy).toContain('/storage/v1/render/image/public/request_photos/');
  expect(urls.legacy).toMatch(/[?&]width=(320|640)(?:&|$)/);
  expect(urls.legacy).toContain('quality=62');
  expect(urls.legacy).toContain('resize=contain');
  expect(urls.v2).toContain(`/storage/v1/object/public/request_photos/_thumbs/v2/${'a'.repeat(64)}-w320.webp`);
  expect(urls.fallback).toBe('');
});

test('main-thread iPhone fallback emits bounded JPEG or WebP plus both thumbnails', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1000;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#025f3f');
    gradient.addColorStop(0.5, '#d4efbc');
    gradient.addColorStop(1, '#69340c');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 140; index += 1) {
      context.fillStyle = `hsl(${(index * 29) % 360} 70% 50%)`;
      context.fillRect((index * 83) % 1400, (index * 47) % 1000, 120, 70);
    }
    const source = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('png encode failed')), 'image/png'));
    const optimized = await (window as any).optimizePhotoBlobOnMainThread(source);
    return {
      type: optimized.contentType,
      displayBytes: optimized.blob.size,
      displaySignature: await (window as any).getPhotoBlobEncoding(optimized.blob),
      thumb144Bytes: optimized.thumbnail144Blob.size,
      thumb144Signature: await (window as any).getPhotoBlobEncoding(optimized.thumbnail144Blob),
      thumb320Bytes: optimized.thumbnail320Blob.size,
      thumb320Signature: await (window as any).getPhotoBlobEncoding(optimized.thumbnail320Blob),
      width: optimized.width,
      height: optimized.height,
      hash: optimized.hash,
    };
  });
  expect(['image/jpeg', 'image/webp']).toContain(result.type);
  expect(result.displaySignature).toBe(result.type);
  expect(result.thumb144Signature).toBe(result.type);
  expect(result.thumb320Signature).toBe(result.type);
  expect(result.displayBytes).toBeLessThanOrEqual(1_280_000);
  expect(result.thumb144Bytes).toBeLessThanOrEqual(80 * 1024);
  expect(result.thumb320Bytes).toBeLessThanOrEqual(160 * 1024);
  expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1920);
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
});
