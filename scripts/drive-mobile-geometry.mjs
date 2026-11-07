import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const modulePath = fileURLToPath(import.meta.url);
const profiles = [
  { name: 'iPhone iOS', width: 390, height: 844, mobile: true, ios: true },
  { name: 'Android', width: 412, height: 915, mobile: true },
  { name: 'iPad Tablet', width: 820, height: 1180, mobile: true, ios: true },
  { name: 'Windows/Mac PC', width: 1440, height: 900, mobile: false }
];
const levels = ['static-common-name', 'common-name', 'location', 'block-alpha', 'itemcode'];
const controlIds = ['drive-mobile-mode', 'drive-excel-lotcode-btn', 'drive-excel-contsize-btn', 'drive-excel-holdstopcode-btn', 'drive-filters-btn'];
const attr = (tag, name) => tag.match(new RegExp('\\b' + name + '=["\']([^"\']+)'))?.[1];

export function assertStaticDriveToolbar(index) {
  const content = index.match(/<div\b[^>]*id=["']drive-toolbar-rail["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!content) throw Error('Drive static toolbar missing');
  const children = [], stack = [];
  for (const [tag, closing, name] of content.matchAll(/<(\/)?([a-z][\w-]*)\b[^>]*>/gi)) {
    if (closing) { if (stack.pop() !== name.toLowerCase()) throw Error('Drive static toolbar has invalid nesting'); continue; }
    if (!stack.length) children.push({ id: attr(tag, 'id'), name: name.toLowerCase(), field: attr(tag, 'data-excel-field') });
    if (!/^(?:input|br|hr|img)$/i.test(name) && !/\/>$/.test(tag)) stack.push(name.toLowerCase());
  }
  if (stack.length || children.length !== 5 || children.some((child, i) => child.id !== controlIds[i] || child.name !== (i ? 'button' : 'select')))
    throw Error('Mode, Lot, Size, Hold and Filters must be static direct siblings in that order');
  for (const [i, key] of ['lotcode', 'contsize', 'holdstopcode'].entries())
    if (children[i + 1].field !== key) throw Error('Drive static Excel field missing: ' + key);
}

async function geometryInputs(target) {
  const index = await fs.readFile(path.join(target, 'index.html'), 'utf8');
  assertStaticDriveToolbar(index);
  const sheets = [...index.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(tag => attr(tag, 'rel') === 'stylesheet').map(tag => attr(tag, 'href')).filter(href => href && !/^(?:https?:)?\/\//.test(href)).map(href => href.split('?')[0].replace(/^\.\//, ''));
  const compiled = 'assets/live-app-runtime-v2026082010.min.js';
  const runtimeFile = index.includes(compiled) ? compiled : 'assets/app-runtime.js';
  const files = [...new Set(['index.html', 'version.json', runtimeFile, 'assets/row-workflow-functions.js', 'assets/ops-precision-pilot.js', 'components/common/auraVoiceWidget.js', ...sheets])];
  const contents = await Promise.all(files.map(async file => [file, await fs.readFile(path.join(target, file), 'utf8')]));
  const hash = createHash('sha256').update(await fs.readFile(modulePath));
  for (const [file, text] of contents) hash.update(file + '\0' + text.replaceAll('\r\n', '\n') + '\0');
  return { index, files: new Map(contents), runtime: contents.find(([f]) => f === runtimeFile)[1], fingerprint: hash.digest('hex') };
}

function assertMeasurement(m) {
  const profile = profiles.find(p => p.name === m.profile);
  if (!profile || m.width !== profile.width || m.height !== profile.height || !levels.includes(m.level)) throw Error('Invalid Drive device/level coverage');
  if (m.controls.length !== 5 || m.controls.some((c, i) => c.id !== controlIds[i] || c.parent !== 'drive-toolbar-rail' || c.offsetWidth <= 0 || c.width <= 0 || Math.abs(c.height - 34) > 0.5 || c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0 || c.left < m.rail.left - 1 || c.right > Math.min(m.rail.right, m.width) + 1)) throw Error('Drive toolbar controls must be visible direct siblings without scrolling: ' + JSON.stringify(m));
  if (Math.max(...m.controls.map(c => c.top)) - Math.min(...m.controls.map(c => c.top)) > 1) throw Error('Drive controls must share one row');
  if (m.controls.some((c, i) => i && c.left < m.controls[i - 1].right)) throw Error('Drive control order changed');
  if (Math.abs(m.scroll.bottom - m.dock.top) > 4 || m.scroll.height < 250) throw Error('Drive scroll viewport clipped: ' + JSON.stringify(m));
  if (m.ancestors.some(a => a.maxHeight !== 'none' || Number.parseFloat(a.marginBottom) > 0)) throw Error('Drive retains a clipping inline/CSS reserve');
  if (m.level !== 'static-common-name' && !m.stableNodes) throw Error('Drive guard replaces existing controls or loses focus');
}

export async function verifyDriveGeometryReceipt(repo, target = repo) {
  const inputs = await geometryInputs(target);
  const receipt = JSON.parse(await fs.readFile(path.join(repo, '.gnc-local/drive-mobile-geometry.json'), 'utf8').catch(() => { throw Error('Run node scripts/drive-mobile-geometry.mjs: geometry proof missing'); }));
  const entry = receipt.entries.find(entry => entry.fingerprint === inputs.fingerprint);
  if (receipt.schema !== 2 || !entry || entry.measurements.length !== profiles.length * levels.length) throw Error('Run node scripts/drive-mobile-geometry.mjs: geometry proof is stale');
  for (const profile of profiles) for (const level of levels)
    if (!entry.measurements.some(m => m.profile === profile.name && m.level === level)) throw Error('Four-device Drive coverage incomplete');
  entry.measurements.forEach(assertMeasurement);
  return entry;
}

async function measure(target, browser) {
  const inputs = await geometryInputs(target), { parse } = await import('acorn');
  function nodes(source) {
    const functions = new Map(), variables = new Map();
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start, node.end));
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) variables.set(node.id.name, source.slice(node.init.start, node.init.end));
      for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(walk); else if (value?.type) walk(value); }
    }
    walk(parse(source, { ecmaVersion: 'latest' })); return { functions, variables };
  }
  const runtime = nodes(inputs.runtime), row = nodes(inputs.files.get('assets/row-workflow-functions.js')), ops = nodes(inputs.files.get('assets/ops-precision-pilot.js'));
  const owners = ['syncUniversalPinnedResultsLayout', 'syncIosFixedTopChromeMetrics', 'removeImportantStyleProps', 'ensureDriveToolbarControls', 'syncDriveViewportLayout'];
  const functions = owners.map(name => { if (!runtime.functions.has(name)) throw Error('Missing geometry owner ' + name); return runtime.functions.get(name); });
  functions.push(row.functions.get('getDriveExcelHeaderFields'), row.functions.get('getInventoryExcelState'));
  for (const name of ['compactBrowseRailKey', 'decorateCompactBrowseRails', 'measureRuntimeViewport']) functions.push(ops.functions.get(name));
  const setup = `function getCurrentVisibleViewId(){return 'drive'} function getSupabaseReadIdentityScope(){return 'geometry-fixture'} function getEffectiveTheme(){return 'dark'} function releaseFixedFilterRail(el){for(const key of ['position','top','bottom','height'])el.style.removeProperty(key)} const BROWSE_RAIL_SELECTOR=${ops.variables.get('BROWSE_RAIL_SELECTOR')}; const compactBrowseRailState=new WeakMap(),compactBrowseRailOpenState=new Map(); let compactBrowseRailFrame=0,hasCompactBrowseRails=false;`;
  const html = inputs.index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, tag => { const file = attr(tag, 'href')?.split('?')[0].replace(/^\.\//, ''); return attr(tag, 'rel') === 'stylesheet' && inputs.files.has(file) ? '<style>' + inputs.files.get(file) + '</style>' : ''; });
  const auraCss = inputs.files.get('components/common/auraVoiceWidget.js').match(/const CSS = `([\s\S]*?)`;/)?.[1];
  if (!auraCss) throw Error('AURA style owner missing');
  const measurements = [];
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.mobile, hasTouch: profile.mobile });
    try {
      await page.route('**/*', route => route.abort()); await page.setContent(html); await page.addStyleTag({ content: auraCss });
      await page.addScriptTag({ content: setup + functions.join('\n') });
      await page.evaluate(profile => {
        document.body.classList.add('agdata-pinned-results', 'current-view-drive');
        if (profile.ios) document.body.classList.add('ios-device', 'app-standalone', 'gnc-mobile-workspace');
        const app = document.getElementById('app-wrapper'); app.classList.remove('hidden');
        for (const el of document.body.children) if (el !== app && !['STYLE', 'SCRIPT'].includes(el.tagName)) el.style.display = 'none';
        document.querySelectorAll('[id^="view-"]').forEach(el => { if (el.id !== 'view-wrapper') el.classList.add('hidden'); });
        const view = document.getElementById('view-drive'); view.classList.remove('hidden'); view.classList.add('agdata-pinned-view');
        const list = document.getElementById('drive-content'); list.classList.add('agdata-results-scroll');
        list.innerHTML = Array.from({ length: 35 }, (_, i) => '<article class="app-smart-card" style="height:100px;min-height:100px">Plant ' + i + '</article>').join('');
        const dock = document.getElementById('bottom-nav'); if (profile.ios) dock.style.setProperty('padding-bottom', '34px', 'important');
        document.documentElement.style.setProperty('--mobile-visible-height', profile.height + 'px');
        document.documentElement.style.setProperty('--mobile-bottom-nav-height', dock.getBoundingClientRect().height + 'px');
      }, profile);
      for (const level of levels) {
        const measurement = await page.evaluate(({ profile, level, controlIds }) => {
          const rail = document.getElementById('drive-toolbar-rail');
          if (level === 'common-name') for (const id of controlIds.slice(1, 4)) document.getElementById(id).remove();
          else if (level !== 'static-common-name') for (const id of controlIds.slice(1, 4)) {
            const el = document.getElementById(id); el.style.setProperty('display', 'none', 'important'); el.style.setProperty('visibility', 'hidden', 'important'); el.style.opacity = '0';
          }
          if (level !== 'static-common-name') {
            for (const id of ['main-scroll-area', 'view-wrapper', 'view-drive', 'drive-content']) {
              const el = document.getElementById(id);
              for (const [key, value] of [['height', '400px'], ['max-height', '400px'], ['margin-bottom', '95px'], ['padding-bottom', '95px']]) el.style.setProperty(key, value, 'important');
            }
            if (profile.ios) { document.body.classList.add('ios-fixed-top-chrome', 'ios-shell-gap-repair'); const main = document.getElementById('main-scroll-area'); main.style.setProperty('position', 'absolute', 'important'); main.style.setProperty('bottom', '95px', 'important'); }
            syncUniversalPinnedResultsLayout(); syncIosFixedTopChromeMetrics('geometry-late-ios-callback');
          }
          // Exercise the actual mobile DOM decorator that caused the production regression.
          decorateCompactBrowseRails(); measureRuntimeViewport();
          let stableNodes = true;
          if (level !== 'static-common-name') {
            const before = controlIds.map(id => document.getElementById(id)); before[1].focus();
            ensureDriveToolbarControls(); stableNodes = before.every(el => document.getElementById(el.id) === el) && document.activeElement === before[1];
          }
          rail.scrollLeft = 0;
          const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          const controls = controlIds.map(id => { const el = document.getElementById(id), css = getComputedStyle(el); return { id, parent: el.parentElement.id, offsetWidth: el.offsetWidth, display: css.display, visibility: css.visibility, opacity: css.opacity, ...rect(el) }; });
          const ancestors = ['view-drive', 'drive-content'].map(id => { const css = getComputedStyle(document.getElementById(id)); return { id, maxHeight: css.maxHeight, marginBottom: css.marginBottom }; });
          return { profile: profile.name, level, width: innerWidth, height: innerHeight, stableNodes, controls, ancestors, rail: rect(rail), scroll: rect(document.getElementById('drive-content')), dock: rect(document.getElementById('bottom-nav')) };
        }, { profile, level, controlIds });
        assertMeasurement(measurement); measurements.push(measurement);
      }
    } finally { await page.close(); }
  }
  return { fingerprint: inputs.fingerprint, version: JSON.parse(inputs.files.get('version.json')).version, measurements };
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const repo = path.resolve(path.dirname(modulePath), '..'), { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const entries = []; for (const target of [repo, path.join(repo, '_site')]) entries.push(await measure(target, browser));
    const receipt = { schema: 2, checkedAt: new Date().toISOString(), entries };
    await fs.mkdir(path.join(repo, '.gnc-local'), { recursive: true });
    await fs.writeFile(path.join(repo, '.gnc-local/drive-mobile-geometry.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, version: entries[0].version, targets: entries.length, measurements: entries.flatMap(e => e.measurements).map(m => ({ profile: m.profile, level: m.level, viewport: [m.width, m.height], gap: m.dock.top - m.scroll.bottom, controlWidths: m.controls.map(c => c.offsetWidth) })) }));
  } finally { await browser.close(); }
}
