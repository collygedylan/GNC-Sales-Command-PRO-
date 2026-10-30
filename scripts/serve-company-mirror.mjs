import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };

export async function startCompanyMirror({ directory = path.join(repository, '_site'), port = 4173 } = {}) {
  const base = await realpath(directory);
  await stat(path.join(base, 'index.html'));
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('INVALID_PATH');
      const file = await realpath(path.join(base, pathname.endsWith('/') ? pathname + 'index.html' : pathname));
      const relative = path.relative(base, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !mime[path.extname(file).toLowerCase()]) throw new Error('INVALID_PATH');
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = await startCompanyMirror();
  console.log('AgData company mirror: http://127.0.0.1:4173');
  for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => server.close());
}
