import { startReleaseTestServer } from './serve-release-tests.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function localBackendOrigin(value = 'http://127.0.0.1:54321') {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:'
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PREVIEW_LOCAL_BACKEND_REQUIRED');
  return url.origin;
}
export function isolationHeaders(backend) {
  const origin = localBackendOrigin(backend);
  return { 'Content-Security-Policy': [
    "default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${origin} ${origin.replace('http:', 'ws:')}`, "img-src 'self' data: blob:",
    "font-src 'self' data:", "media-src 'self' blob:", "frame-src 'none'", "object-src 'none'",
    "form-action 'none'", "base-uri 'self'", "worker-src 'none'", "frame-ancestors 'none'"
  ].join('; '), 'Referrer-Policy': 'no-referrer', 'X-GNC-Environment': 'isolated-preview' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await startReleaseTestServer({ port: 43117, responseHeaders: isolationHeaders(process.env.SUPABASE_LOCAL_URL) });
    console.log('Isolated compiled preview: http://127.0.0.1:43117 (remote APIs, email, frames and workers blocked). Use local/fixture data; production reads are deliberately unavailable.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
