import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const RELEASE = 'V2026.08.16.01';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.resolve(root, process.env.LIVE_SITE_DIR || '_site');
const htmlPath = path.join(root, 'index.html');
const sourceHtml = await readFile(htmlPath, 'utf8');
const inlineScriptPattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const candidates = [...sourceHtml.matchAll(inlineScriptPattern)]
  .map((match) => ({ match: match[0], source: match[1] || '', index: match.index || 0 }))
  .sort((a, b) => b.source.length - a.source.length);
const runtime = candidates[0];

if (!runtime || runtime.source.length < 1_000_000) {
  throw new Error('Unable to locate the live inline application runtime.');
}

const minified = await minify(runtime.source, {
  compress: false,
  mangle: false,
  module: false,
  keep_fnames: true,
  keep_classnames: true,
  format: { comments: false }
});

if (!minified.code || minified.code.length < 500_000) {
  throw new Error('Live runtime output was unexpectedly small.');
}

const runtimeName = 'live-app-runtime-v2026081601.min.js';
const runtimeTarget = path.join(siteRoot, 'assets', runtimeName);
await mkdir(path.dirname(runtimeTarget), { recursive: true });
await writeFile(runtimeTarget, `${minified.code}\n`, 'utf8');

const runtimeTag = `<script defer src="./assets/${runtimeName}?v=${RELEASE}"></script>`;
const deployedHtml = sourceHtml.slice(0, runtime.index)
  + runtimeTag
  + sourceHtml.slice(runtime.index + runtime.match.length);
await mkdir(siteRoot, { recursive: true });
await writeFile(path.join(siteRoot, 'index.html'), deployedHtml, 'utf8');

const deployedBytes = Buffer.byteLength(deployedHtml);
if (deployedBytes > 1_500_000) {
  throw new Error(`Deployed HTML is still too large (${deployedBytes} bytes).`);
}

console.log(`Built ${RELEASE}: index ${deployedBytes} bytes, runtime ${Buffer.byteLength(minified.code)} bytes.`);
