import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const RELEASE = 'V2026.09.11.01';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteRoot = path.resolve(root, process.env.LIVE_SITE_DIR || '_site');
const htmlPath = path.join(root, 'index.html');
const sourceHtml = await readFile(htmlPath, 'utf8');
const pilotCss = await readFile(path.join(root, 'assets', 'ops-precision-pilot.css'), 'utf8');
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

const runtimeName = 'live-app-runtime-v2026082010.min.js';
const runtimeTarget = path.join(siteRoot, 'assets', runtimeName);
await mkdir(path.dirname(runtimeTarget), { recursive: true });
await writeFile(runtimeTarget, `${minified.code}\n`, 'utf8');
// These synchronous dependencies must accompany the extracted production
// runtime in local verification as well as the Pages artifact.
await Promise.all(['live-sync-registry.js', 'live-sync-adapters.js', 'live-sync-coordinator.js', 'inventory-list-contract.js', 'master-detail-snapshots.js'].map((name) =>
  copyFile(path.join(root, 'assets', name), path.join(siteRoot, 'assets', name))));

const asyncStylesheetMarkup = (href) => `<link rel="stylesheet" href="${href}" media="print" fetchpriority="low" onload="this.onload=null;this.media='all'">
    <noscript><link rel="stylesheet" href="${href}"></noscript>`;

// Wait for the login image and styles, then give the browser two paint opportunities
// before parsing the multi-megabyte legacy runtime. Starting at DOMContentLoaded can
// monopolize the main thread before the already-downloaded LCP image is painted.
const runtimeTag = `<script>
(() => {
  const boot = () => {
    const runtime = document.createElement('script');
    runtime.src = './assets/${runtimeName}?v=${RELEASE}';
    runtime.defer = true;
    document.body.appendChild(runtime);
  };
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(boot));
  if (document.readyState !== 'complete') {
    window.addEventListener('load', afterPaint, { once: true });
  } else {
    afterPaint();
  }
})();
</script>`;
const runtimeDeployedHtml = sourceHtml.slice(0, runtime.index)
  + runtimeTag
  + sourceHtml.slice(runtime.index + runtime.match.length);

// The legacy shell carries hundreds of kilobytes of route-specific CSS in the
// document head. Parsing those rules delays the login logo even though none of
// them are needed for the first screen. Keep the small critical/prepaint rules
// inline, preserve the original cascade on either side of the pilot stylesheet,
// and preload the route styles without blocking the first paint.
const headEnd = runtimeDeployedHtml.indexOf('</head>');
const headHtml = runtimeDeployedHtml.slice(0, headEnd);
const opsStylesheetIndex = headHtml.indexOf('./assets/ops-precision-pilot.css');
if (headEnd < 0 || opsStylesheetIndex < 0) {
  throw new Error('Unable to locate the live document head or pilot stylesheet.');
}

const baseStyles = [];
const authorityStyles = [];
let styleOrdinal = 0;
let baseLinkWritten = false;
let authorityLinkWritten = false;
const stylePattern = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi;
let optimizedHead = headHtml.replace(stylePattern, (match, css, offset) => {
  const currentOrdinal = styleOrdinal++;
  if (currentOrdinal < 4) return match;

  const beforePilotStylesheet = offset < opsStylesheetIndex;
  const collectedStyles = beforePilotStylesheet ? baseStyles : authorityStyles;
  collectedStyles.push(css.trim());

  if (beforePilotStylesheet && !baseLinkWritten) {
    baseLinkWritten = true;
    return asyncStylesheetMarkup(`./assets/live-app-styles-base-v2026090503.css?v=${RELEASE}`);
  }
  if (!beforePilotStylesheet && !authorityLinkWritten) {
    authorityLinkWritten = true;
    return asyncStylesheetMarkup(`./assets/live-app-styles-authority-v2026090503.css?v=${RELEASE}`);
  }
  return '';
});

if (!baseStyles.length || !authorityStyles.length) {
  throw new Error('Unable to extract the non-critical live application styles.');
}

const deferrableStylesheets = [
  `./assets/live-tailwind-v2026082010.min.css?v=${RELEASE}`,
  './assets/vendor/phosphor/regular/style.css?v=2.1.2',
  './assets/vendor/phosphor/bold/style.css?v=2.1.2',
  './assets/vendor/phosphor/duotone/style.css?v=2.1.2',
  './assets/vendor/phosphor/fill/style.css?v=2.1.2',
  './assets/vendor/phosphor/light/style.css?v=2.1.2'
];
for (const href of deferrableStylesheets) {
  const blockingTag = `<link rel="stylesheet" href="${href}">`;
  if (!optimizedHead.includes(blockingTag)) {
    throw new Error(`Unable to locate deferrable stylesheet: ${href}`);
  }
  optimizedHead = optimizedHead.replace(blockingTag, asyncStylesheetMarkup(href));
}

const loginStylesMarker = '/* V2026.08.15.11 — compact enterprise shell';
const loginStylesStart = pilotCss.indexOf(':root {', pilotCss.indexOf(loginStylesMarker));
const loginStylesEnd = pilotCss.indexOf('body.ops-precision-pilot {', loginStylesStart);
if (loginStylesStart < 0 || loginStylesEnd < 0) {
  throw new Error('Unable to extract the pilot login-critical stylesheet.');
}
const loginCriticalReset = `
*,::before,::after{box-sizing:border-box}
html,body{margin:0}
img{display:block;max-width:100%}
button,input{font:inherit}
.hidden{display:none!important}
`;
const loginCriticalStyles = loginCriticalReset + pilotCss.slice(loginStylesStart, loginStylesEnd).trim();
const pilotStylesheetHref = `./assets/ops-precision-pilot.css?v=${RELEASE}`;
const pilotStylesheetTag = `<link rel="stylesheet" href="${pilotStylesheetHref}">`;
if (!optimizedHead.includes(pilotStylesheetTag)) {
  throw new Error('Unable to locate the blocking pilot stylesheet.');
}
optimizedHead = optimizedHead.replace(
  pilotStylesheetTag,
  `<style id="login-critical-styles">${loginCriticalStyles}</style>\n    ${asyncStylesheetMarkup(pilotStylesheetHref)}`
);

const stylesRoot = path.join(siteRoot, 'assets');
await writeFile(path.join(stylesRoot, 'live-app-styles-base-v2026090503.css'), `${baseStyles.join('\n')}\n`, 'utf8');
await writeFile(path.join(stylesRoot, 'live-app-styles-authority-v2026090503.css'), `${authorityStyles.join('\n')}\n`, 'utf8');

const deployedHtml = optimizedHead + runtimeDeployedHtml.slice(headEnd);
await mkdir(siteRoot, { recursive: true });
await writeFile(path.join(siteRoot, 'index.html'), deployedHtml, 'utf8');

const deployedBytes = Buffer.byteLength(deployedHtml);
if (deployedBytes > 1_500_000) {
  throw new Error(`Deployed HTML is still too large (${deployedBytes} bytes).`);
}

console.log(`Built ${RELEASE}: index ${deployedBytes} bytes, runtime ${Buffer.byteLength(minified.code)} bytes, deferred CSS ${Buffer.byteLength(baseStyles.join('\n')) + Buffer.byteLength(authorityStyles.join('\n'))} bytes.`);
