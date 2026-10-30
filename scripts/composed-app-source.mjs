import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Restore declaration-only fragments at their original locations, without executing them. */
export function readComposedRuntimeSource({ directory = root } = {}) {
  const source = readFileSync(path.join(directory, 'assets', 'app-runtime.js'), 'utf8');
  return source.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g,
    (_marker, file) => readFileSync(path.join(directory, file), 'utf8').trimEnd());
}

/** Read the editable shell with extracted runtime and CSS restored at their original DOM positions. */
export function readComposedAppSource({ directory = root } = {}) {
  let html = readFileSync(path.join(directory, 'index.html'), 'utf8');
  const panelTag = html.match(/<script src="\.\/assets\/runtime-watchdog-panel\.js(?:\?[^"]*)?" data-runtime-watchdog-panel><\/script>/)?.[0];
  const panel = readFileSync(path.join(directory, 'assets', 'runtime-watchdog-panel.js'), 'utf8');
  if (!panelTag || html.split(panelTag).length !== 2) throw new Error('COMPOSED_WATCHDOG_PANEL_MARKER_INVALID');
  html = html.replace(panelTag, () => `<script data-composed-asset="runtime-watchdog-panel.js">${panel}</script>`);
  const runtimeTag = html.match(/<script id="app-script-source" src="\.\/assets\/app-runtime\.js(?:\?[^"]*)?"><\/script>/)?.[0];
  const runtime = readComposedRuntimeSource({ directory });
  if (!runtimeTag || html.split(runtimeTag).length !== 2) throw new Error('COMPOSED_APP_RUNTIME_MARKER_INVALID');
  html = html.replace(runtimeTag, () => `<script id="app-script-source" type="text/plain">${runtime}</script>`);
  html = html.replace(/<script\b[^>]*\bdata-runtime-fragment\b[^>]*><\/script>/g, '');
  const extractedStyle = /<link\b([^>]*\bdata-app-extracted-style\b[^>]*)>/gi;
  const matches = [...html.matchAll(extractedStyle)];
  for (const [match, attrs] of matches.reverse()) {
    const href = attrs.match(/\bhref="([^"]+)"/i)?.[1];
    if (!href || !href.startsWith('./assets/')) throw new Error('COMPOSED_APP_STYLE_URL_INVALID');
    const css = readFileSync(path.join(directory, href.split('?')[0].slice(2)), 'utf8');
    const id = attrs.match(/\bid="([^"]+)"/i)?.[1];
    const media = attrs.match(/\bmedia="([^"]+)"/i)?.[1];
    const title = attrs.match(/\btitle="([^"]+)"/i)?.[1];
    const opening = `<style${id ? ` id="${id}"` : ''}${media ? ` media="${media}"` : ''}${title ? ` title="${title}"` : ''}>`;
    const position = html.indexOf(match);
    html = html.slice(0, position) + opening + css + '</style>' + html.slice(position + match.length);
  }
  return html;
}
