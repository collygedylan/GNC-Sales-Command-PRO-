import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

const httpError = status => Object.assign(new Error(`Release test server HTTP ${status}`), { status });
const equivalentPath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

async function checkedRoot(directory) {
  const resolved = path.resolve(directory);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()
    || !equivalentPath(await realpath(resolved), resolved)) throw new Error('Release test server root must be a real directory without symlinks.');
  return resolved;
}

function decodedRequestPath(requestUrl) {
  const raw = String(requestUrl || '').split(/[?#]/, 1)[0];
  if (!raw.startsWith('/') || raw.startsWith('//') || /%2f|%5c/i.test(raw)) throw httpError(400);
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw httpError(400); }
  if (/[\\%:<>"|?*#\x00-\x1f\x7f]/.test(decoded)) throw httpError(400);
  const parts = decoded.slice(1).split('/');
  if (parts.at(-1) === '') parts.pop();
  if (parts.some(part => !part || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw httpError(400);
  return parts;
}

async function openFile(root, parts) {
  let candidate = root;
  const fileParts = parts.length ? [...parts] : ['index.html'];
  for (let index = 0; index < fileParts.length; index++) {
    candidate = path.join(candidate, fileParts[index]);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw httpError(400);
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw httpError(403);
    if (index < fileParts.length - 1 && !info.isDirectory()) throw httpError(404);
    if (index === fileParts.length - 1 && info.isDirectory()) fileParts.push('index.html');
    else if (index === fileParts.length - 1 && !info.isFile()) throw httpError(403);
  }
  if (!equivalentPath(await realpath(candidate), candidate)) throw httpError(403);
  const file = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const info = await file.stat();
  if (!info.isFile()) { await file.close(); throw httpError(403); }
  return { file, size: info.size, contentType: mimeTypes[path.extname(candidate).toLowerCase()] || 'application/octet-stream' };
}

export async function createReleaseTestServer({
  siteDir = path.join(repositoryRoot, '_site'),
  fixtureDir = path.join(repositoryRoot, 'tests', 'fixtures'),
} = {}) {
  const site = await checkedRoot(siteDir);
  const fixtures = await checkedRoot(fixtureDir);
  // Refuse startup without the compiled entry point; there is no checkout fallback.
  const entry = await openFile(site, ['index.html']);
  await entry.file.close();
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let opened;
    try {
      const parts = decodedRequestPath(request.url);
      const alias = parts[0] === '_site';
      const artifactParts = alias ? parts.slice(1) : parts;
      try { opened = await openFile(site, artifactParts); }
      catch (error) {
        // Only files in the browser fixture directory may come from checkout. Their
        // relative CSS/JS/image requests still resolve into the sealed artifact.
        if (error.code !== 'ENOENT' || alias || parts[0] !== 'tests' || parts[1] !== 'fixtures') throw error;
        opened = await openFile(fixtures, parts.slice(2));
      }
      const bytes = request.method === 'HEAD' ? undefined : await opened.file.readFile();
      response.writeHead(200, { 'Content-Type': opened.contentType, 'Content-Length': opened.size });
      response.end(bytes);
    } catch (error) {
      const status = error.status || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      if (!response.headersSent) response.writeHead(status);
      response.end();
    } finally {
      await opened?.file.close();
    }
  });
}

export async function startReleaseTestServer({ port = 43116, ...options } = {}) {
  const server = await createReleaseTestServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/serve-release-tests.mjs [site-directory]');
    await startReleaseTestServer(process.argv[2] ? { siteDir: process.argv[2] } : {});
    console.log('Release test artifact server listening on http://127.0.0.1:43116');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
