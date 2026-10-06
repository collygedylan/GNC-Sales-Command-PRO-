import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

function argumentsMap(values) {
  const result = new Map();
  for (let index = 2; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith('--') || !values[index + 1]) throw new Error('Use --root <directory> --prefix <path> --port <number>.');
    result.set(key.slice(2), values[++index]);
  }
  return result;
}

const args = argumentsMap(process.argv);
const root = path.resolve(args.get('root') || '_staging');
const prefix = `/${String(args.get('prefix') || 'gnc-teardown-staging/').replace(/^\/+|\/+$/g, '')}/`;
const port = Number(args.get('port') || 43191);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.webp', 'image/webp'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.woff2', 'font/woff2'],
]);

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed.'); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', `http://${request.headers.host}`).pathname); }
  catch (error) { response.writeHead(400); response.end(`Invalid path: ${String(error.message).slice(0, 80)}`); return; }
  if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end('Not found.'); return; }
  const relative = pathname.slice(prefix.length);
  let target = path.resolve(root, relative || 'index.html');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end('Path rejected.'); return; }
  try {
    if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html');
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime.get(path.extname(target).toLowerCase()) || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    response.writeHead(404); response.end(`File unavailable: ${String(error.message).slice(0, 80)}`);
  }
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`Staging artifact: http://127.0.0.1:${port}${prefix}`));
