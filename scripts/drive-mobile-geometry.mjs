import { measureDriveGeometry } from '../src/ui/drive-geometry-fixture.mjs';
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
const controlIds = ['drive-mobile-mode', 'drive-excel-salesyear-btn', 'drive-excel-season-btn', 'drive-excel-lotcode-btn', 'drive-excel-contsize-btn', 'drive-excel-holdstopcode-btn', 'drive-filters-btn'];
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
  if (stack.length || children.length !== 7 || children.some((child, i) => child.id !== controlIds[i] || child.name !== (i ? 'button' : 'select')))
    throw Error('Mode, Year, Season, Lot, Size, Hold and Filters must be static direct siblings in that order');
  for (const [i, key] of ['salesyear', 'season', 'lotcode', 'contsize', 'holdstopcode'].entries())
    if (children[i + 1].field !== key) throw Error('Drive static Excel field missing: ' + key);
}

async function geometryInputs(target) {
  const index = await fs.readFile(path.join(target, 'index.html'), 'utf8');
  assertStaticDriveToolbar(index);
  const sheets = [...index.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]).filter(tag => attr(tag, 'rel') === 'stylesheet').map(tag => attr(tag, 'href')).filter(href => href && !/^(?:https?:)?\/\//.test(href)).map(href => href.split('?')[0].replace(/^\.\//, ''));
  const compiled = 'assets/live-app-runtime-v2026082010.min.js';
  const runtimeFile = index.includes(compiled) ? compiled : 'assets/app-runtime.js';
  const runtimeText = await fs.readFile(path.join(target,runtimeFile),'utf8');
  const fragments = [...runtimeText.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g)].map(match=>match[1]);
  const files = [...new Set(['index.html', 'version.json', runtimeFile, 'assets/row-workflow-functions.js',
    'assets/manager-table-layout.js', 'assets/ops-precision-pilot.js', 'assets/navigation-preferences.js',
    'assets/aura-voice.js', 'components/common/auraVoiceWidget.js', ...sheets, ...fragments])];
  const contents = await Promise.all(files.map(async file => [file, await fs.readFile(path.join(target, file), 'utf8')]));
  const outdoorBlocks=s=>(s.replace(/\/\*[^]*?\*\//g,'').match(/[^{}]+\{[^{}]*\}/g)||[]).filter(block=>/\.outdoor-mode(?![\w-])/.test(block.slice(0,block.indexOf('{')))).map(x=>x.replace(/\s+/g,' ').trim()).sort().join('\n');
  const outdoorHash=createHash('sha256').update(sheets.map(file=>outdoorBlocks(contents.find(([f])=>f===file)[1])).filter(Boolean).sort().join('\n')).digest('hex');
  if(outdoorHash!=='a22a475d5e1d6d3eb7601c1772cb3cfa6b25af0b26de0a8a78f3de2997ac7a8f' || index.includes('daylight-mode.css') || index.includes('Auto 7AM'))throw Error('Outdoor CSS must match v3.0.31');
  const inputsToHash = [modulePath, new URL('./drive-permission-fixture.mjs', import.meta.url), new URL('../src/ui/drive-geometry-fixture.mjs', import.meta.url)];
  const hash = createHash('sha256');
  for (const file of inputsToHash) hash.update((await fs.readFile(file, 'utf8')).replaceAll('\r\n', '\n'));
  for (const [file, text] of contents) hash.update(file + '\0' + text.replaceAll('\r\n', '\n') + '\0');
  return { index, files: new Map(contents), runtime: contents.find(([f]) => f === runtimeFile)[1], fingerprint: hash.digest('hex') };
}

function assertMeasurement(m) {
  const profile = profiles.find(p => p.name === m.profile);
  if (!profile || m.width !== profile.width || m.height !== profile.height || !levels.includes(m.level)) throw Error('Invalid Drive device/level coverage');
  if (m.rail.scrollWidth > m.rail.clientWidth || m.controls.some(c=>c.left<m.rail.left-1||c.right>m.rail.right+1||c.radius!=='8px')) throw Error('Drive seven-control row requires horizontal scrolling or has mismatched corners: '+JSON.stringify(m.controls));
  if (m.controls.length !== 7 || m.controls.some((c, i) => c.id !== controlIds[i] || c.parent !== 'drive-toolbar-rail' || c.offsetWidth <= 0 || c.width <= 0 || Math.abs(c.height - 32) > 0.5 || c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0 || !c.reachable)) throw Error('Drive toolbar controls must be visible direct siblings and horizontally reachable: ' + JSON.stringify(m));
  if (Math.max(...m.controls.map(c => c.top)) - Math.min(...m.controls.map(c => c.top)) > 1) throw Error('Drive controls must share one row');
  if (m.controls.some((c, i) => i && c.left < m.controls[i - 1].right)) throw Error('Drive control order changed');
  if (Math.abs(m.scroll.bottom - m.dock.top) > 2 || m.scroll.height < 250) throw Error('Drive scroll viewport clipped: ' + JSON.stringify(m));
  if (m.ancestors.some(a => a.maxHeight !== 'none' || Number.parseFloat(a.marginBottom) > 0)) throw Error('Drive retains a clipping inline/CSS reserve');
  if (m.modeSelect.clientWidth < 88 || m.modeSelect.scrollWidth > m.modeSelect.clientWidth || m.modeSelect.textWidth > m.modeSelect.textSpace) throw Error('Common name is truncated');
  if (m.header.back.width > 38 || m.header.back.height > 38 || m.header.back.width <= 0 || m.header.bloom.left < m.header.search.right - 1 || m.header.bloom.right > m.width || m.header.bloomParent !== 'global-header-search-row' || Math.abs(m.header.search.top - m.header.back.top) > 1 || m.header.bloom.left - m.header.search.right > 8) throw Error('Compact Back/search/Bloom header geometry changed: '+JSON.stringify(m.header));
  if (m.aura.parent !== 'bottom-nav' || m.aura.width <= 0 || m.aura.floatingCount || !m.aura.togglePassed) throw Error('AURA footer ownership/toggle failed');
  if (m.navSlots.join(',')!=='1,2,3,4,5,6,7,8' || m.navIds[4]!=='footer-communication-btn' || m.navIds[7]!=='footer-aura-btn') throw Error('Fixed eight-slot nav order changed');
  if (m.cardCount !== 20 || !m.cardHit || !m.lastCardHit) throw Error('No real Drive card at the dock edge: '+JSON.stringify({profile:m.profile,level:m.level,cardHit:m.cardHit,lastCardHit:m.lastCardHit,hitTag:m.hitTag,scroll:m.scroll,dock:m.dock}));
  if (m.level !== 'static-common-name' && !m.stableNodes) throw Error('Drive guard replaces existing controls or loses focus');
}

export async function verifyDriveGeometryReceipt(repo, target = repo) {
  const inputs = await geometryInputs(target);
  const receipt = JSON.parse(await fs.readFile(path.join(repo, '.gnc-local/drive-mobile-geometry.json'), 'utf8').catch(() => { throw Error('Run node scripts/drive-mobile-geometry.mjs: geometry proof missing'); }));
  const entry = receipt.entries.find(entry => entry.fingerprint === inputs.fingerprint);
  if (receipt.schema !== 4 || !entry || entry.measurements.length !== profiles.length * levels.length) throw Error('Run node scripts/drive-mobile-geometry.mjs: geometry proof is stale');
  for (const profile of profiles) for (const level of levels)
    if (!entry.measurements.some(m => m.profile === profile.name && m.level === level)) throw Error('Four-device Drive coverage incomplete');
  entry.measurements.forEach(assertMeasurement);
  if(entry.permissions?.length!==profiles.length||entry.permissions.some(p=>p.passed!==13||!p.routerBlockedBeforeEffects))throw Error('Permission parity proof missing');
  if(entry.outdoor?.length!==profiles.length || entry.home?.length!==profiles.length)throw Error('Outdoor/Home coverage missing');
  for(const m of entry.outdoor)if(!m.legacyToggle||!m.darkSurface)throw Error('Legacy Outdoor Mode regression: '+JSON.stringify(m));
  for(const m of entry.home)if(m.microphones||!m.drawerTools||!m.sameRow||!m.bloomInHeader)throw Error('Home header/drawer ownership regression: '+JSON.stringify(m));
  return entry;
}


if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const repo = path.resolve(path.dirname(modulePath), '..'), { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const entries = []; for (const target of [repo, path.join(repo, '_site')]) entries.push(await measureDriveGeometry(target, browser, { geometryInputs, assertMeasurement, profiles, levels, controlIds, attr }));
    const receipt = { schema: 4, checkedAt: new Date().toISOString(), entries };
    await fs.mkdir(path.join(repo, '.gnc-local'), { recursive: true });
    await fs.writeFile(path.join(repo, '.gnc-local/drive-mobile-geometry.json'), JSON.stringify(receipt, null, 2) + '\n');
    const portable = { schema: receipt.schema, checkedAt: receipt.checkedAt, entries: [entries[0]] };
    await fs.writeFile(path.join(repo, 'tests/fixtures/drive-geometry-receipt.json'), JSON.stringify(portable) + '\n');
    for(const target of [repo,path.join(repo,'_site')])await verifyDriveGeometryReceipt(repo,target);
    console.log(JSON.stringify({ ok: true, version: entries[0].version, targets: entries.length, measurements: entries.flatMap(e => e.measurements).map(m => ({ profile: m.profile, level: m.level, viewport: [m.width, m.height], gap: m.dock.top - m.scroll.bottom, controlWidths: m.controls.map(c => c.offsetWidth) })) }));
  } finally { await browser.close(); }
}
