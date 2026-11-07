import { verifyViewPermissionFixtures } from './drive-permission-fixture.mjs';
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
  const files = [...new Set(['index.html', 'version.json', runtimeFile, 'assets/row-workflow-functions.js', 'assets/ops-precision-pilot.js', 'assets/navigation-preferences.js', 'assets/aura-voice.js', 'components/common/auraVoiceWidget.js', ...sheets])];
  const contents = await Promise.all(files.map(async file => [file, await fs.readFile(path.join(target, file), 'utf8')]));
  const outdoorBlocks=s=>(s.replace(/\/\*[^]*?\*\//g,'').match(/[^{}]+\{[^{}]*\}/g)||[]).filter(block=>/\.outdoor-mode(?![\w-])/.test(block.slice(0,block.indexOf('{')))).map(x=>x.replace(/\s+/g,' ').trim()).sort().join('\n');
  const outdoorHash=createHash('sha256').update(sheets.map(file=>outdoorBlocks(contents.find(([f])=>f===file)[1])).filter(Boolean).sort().join('\n')).digest('hex');
  if(outdoorHash!=='a22a475d5e1d6d3eb7601c1772cb3cfa6b25af0b26de0a8a78f3de2997ac7a8f' || index.includes('daylight-mode.css') || index.includes('Auto 7AM'))throw Error('Outdoor CSS must match v3.0.31');
  const hash = createHash('sha256').update(await fs.readFile(modulePath)).update(await fs.readFile(new URL('./drive-permission-fixture.mjs',import.meta.url)));
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
  const owners = ['syncUniversalPinnedResultsLayout', 'syncIosFixedTopChromeMetrics', 'removeImportantStyleProps', 'ensureDriveToolbarControls', 'syncDriveViewportLayout', 'renderDriveCommonNameGroupCard', 'normalizeEscapedDisplayText', 'syncHeaderBloomPlacement', 'getOutdoorModePreference', 'syncOutdoorModeUi', 'setOutdoorMode', 'persistOutdoorModePreference'];
  const functions = owners.map(name => { if (!runtime.functions.has(name)) throw Error('Missing geometry owner ' + name); return runtime.functions.get(name); });
  functions.push(row.functions.get('getDriveExcelHeaderFields'), row.functions.get('getInventoryExcelState'));
  for (const name of ['compactBrowseRailKey', 'decorateCompactBrowseRails', 'measureRuntimeViewport']) functions.push(ops.functions.get(name));
  const setup = `var outdoorModeEnabled=false; const OUTDOOR_MODE_STORAGE_KEY='gnc_outdoor_mode_v1'; function esc(v){return String(v)} function buildFastInvokeAttrs(){return ''} function getCurrentVisibleViewId(){return 'drive'} function getSupabaseReadIdentityScope(){return 'geometry-fixture'} function getEffectiveTheme(){return 'dark'} function releaseFixedFilterRail(el){for(const key of ['position','top','bottom','height'])el.style.removeProperty(key)} const BROWSE_RAIL_SELECTOR=${ops.variables.get('BROWSE_RAIL_SELECTOR')}; const compactBrowseRailState=new WeakMap(),compactBrowseRailOpenState=new Map(); let compactBrowseRailFrame=0,hasCompactBrowseRails=false;`;
  const html = inputs.index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, tag => { const file = attr(tag, 'href')?.split('?')[0].replace(/^\.\//, ''); return attr(tag, 'rel') === 'stylesheet' && inputs.files.has(file) ? '<style>' + inputs.files.get(file) + '</style>' : ''; });
  const auraCss = inputs.files.get('components/common/auraVoiceWidget.js').match(/const CSS = `([\s\S]*?)`;/)?.[1];
  if (!auraCss) throw Error('AURA style owner missing');
  const measurements = [],outdoor=[],home=[],permissions=[];
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.mobile, hasTouch: profile.mobile });
    try {
      await page.route('**/*', route => route.request().url() === 'https://agdata.fixture/shell' ? route.fulfill({contentType:'text/html',body:html}) : route.request().url() === 'https://agdata.fixture/aura-voice.js' ? route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:inputs.files.get('assets/aura-voice.js')}) : route.abort());
      await page.goto('https://agdata.fixture/shell'); await page.addScriptTag({type:'application/json',content:inputs.files.get('version.json')}).then(handle=>handle.evaluate(el=>el.id='geometry-version')); await page.addStyleTag({ content: auraCss });
      await page.addScriptTag({ content: setup + functions.join('\n') });
      await page.addScriptTag({content:inputs.files.get('assets/navigation-preferences.js')});
      await page.addScriptTag({type:'module',content:"import {mountAuraWidgetReact} from 'https://agdata.fixture/aura-voice.js'; globalThis.mountAuraFixture=mountAuraWidgetReact;"});
      await page.waitForFunction(()=>typeof globalThis.mountAuraFixture==='function');
      await page.evaluate(profile => {
        document.body.classList.add('agdata-pinned-results', 'current-view-drive');
        if (profile.ios) document.body.classList.add('ios-device', 'app-standalone', 'gnc-mobile-workspace');
        const app = document.getElementById('app-wrapper'); app.classList.remove('hidden');
        for (const el of document.body.children) if (el !== app && !['STYLE', 'SCRIPT'].includes(el.tagName)) el.style.display = 'none';
        document.querySelectorAll('[id^="view-"]').forEach(el => { if (el.id !== 'view-wrapper') el.classList.add('hidden'); });
        const view = document.getElementById('view-drive'); view.classList.remove('hidden'); view.classList.add('agdata-pinned-view');
        const list = document.getElementById('drive-content'); list.classList.add('agdata-results-scroll');
        list.innerHTML = Array.from({ length: 20 }, (_, i) => renderDriveCommonNameGroupCard({name:'Plant '+i,rowCount:5,sizeCount:2})).join('');
        const header = document.getElementById('global-header-search-row'); header.classList.remove('hidden'); header.hidden=false;
        document.body.classList.add('global-back-active');
        document.getElementById('global-header-inline-back').classList.remove('hidden');
        const slot=document.getElementById('global-header-search-slot'); slot.classList.remove('hidden'); slot.append(document.getElementById('drive-search-container'));
        document.getElementById('footer-cart-btn').classList.remove('hidden');
        GncNavigationPreferences.configure({username:'dylan_collyge',canAccess:()=>true});
        GncNavigationPreferences.applyFooter(document.getElementById('bottom-nav'));
        const host=document.createElement('div');document.body.append(host);
        globalThis.auraFixture=mountAuraFixture(host,{isAuthorized:()=>true,userId:'geometry-fixture'});
        const dock = document.getElementById('bottom-nav'); if (profile.ios) dock.style.setProperty('padding-bottom', '34px', 'important');
        document.documentElement.style.setProperty('--mobile-visible-height', profile.height + 'px');
        document.documentElement.style.setProperty('--mobile-bottom-nav-height', dock.getBoundingClientRect().height + 'px');
      }, profile);
      permissions.push(await verifyViewPermissionFixtures(page,runtime));
      await page.waitForFunction(()=>!document.getElementById('footer-aura-btn').disabled);
      await page.locator('#footer-aura-btn').click();
      if (!await page.locator('[data-aura-root] .aura-panel').isVisible()) throw Error('AURA footer did not open the actual assistant');
      await page.locator('#footer-aura-btn').click();
      if (await page.locator('[data-aura-root] .aura-panel').isVisible()) throw Error('AURA footer did not close the actual assistant');
      await page.evaluate(()=>globalThis.auraTogglePassed=true);
      for (const level of levels) {
        const measurement = await page.evaluate(({ profile, level, controlIds }) => {
          const rail = document.getElementById('drive-toolbar-rail');
          if (level === 'common-name') for (const id of controlIds.slice(1, 6)) document.getElementById(id).remove();
          else if (level !== 'static-common-name') for (const id of controlIds.slice(1, 6)) {
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
          const reachable=new Map();
          for (const id of controlIds) { const el=document.getElementById(id);el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});const r=el.getBoundingClientRect(),railRect=rail.getBoundingClientRect();reachable.set(id,r.left>=railRect.left-1&&r.right<=railRect.right+1&&document.elementsFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2).includes(el)); }
          rail.scrollLeft=0;
          const controls = controlIds.map(id => { const el = document.getElementById(id), css = getComputedStyle(el); return { id, parent: el.parentElement.id, reachable:reachable.get(id), offsetWidth: el.offsetWidth, display: css.display, visibility: css.visibility, opacity: css.opacity, radius:css.borderRadius, ...rect(el) }; });
          const mode=document.getElementById('drive-mobile-mode'),modeCss=getComputedStyle(mode),canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=modeCss.font;
          const modeSelect={clientWidth:mode.clientWidth,scrollWidth:mode.scrollWidth,textWidth:context.measureText(mode.options[mode.selectedIndex].text).width,textSpace:mode.clientWidth-parseFloat(modeCss.paddingLeft)-parseFloat(modeCss.paddingRight)};
          const header={back:rect(document.getElementById('global-header-inline-back')),search:rect(document.getElementById('drive-search')),bloom:rect(document.getElementById('footer-cart-btn')),bloomParent:document.getElementById('footer-cart-btn').parentElement.id};
          const auraButton=document.getElementById('footer-aura-btn'),aura={...rect(auraButton),parent:auraButton.parentElement.id,floatingCount:document.querySelectorAll('.aura-fab,.aura-fab-container').length,togglePassed:globalThis.auraTogglePassed===true};
          const list=document.getElementById('drive-content'),dock=document.getElementById('bottom-nav'),x=list.getBoundingClientRect().left+list.clientWidth/2,y=dock.getBoundingClientRect().top-30;
          list.scrollTop=0;const firstHit=document.elementFromPoint(x,y),cardHit=!!firstHit?.closest('.drive-card');
          list.scrollTop=list.scrollHeight;const lastCardHit=!!document.elementFromPoint(x,y)?.closest('.drive-card');list.scrollTop=0;
          const navButtons=Array.from(dock.children).filter(el=>el.matches('.footer-nav-btn')),navSlots=navButtons.map(el=>Number(el.dataset.footerSlot)),navIds=navButtons.map(el=>el.id);
          const cardCount=list.querySelectorAll('.drive-card').length;
          const ancestors = ['view-drive', 'drive-content'].map(id => { const css = getComputedStyle(document.getElementById(id)); return { id, maxHeight: css.maxHeight, marginBottom: css.marginBottom }; });
          return { profile: profile.name, level, width: innerWidth, height: innerHeight, stableNodes, controls, navSlots, navIds, modeSelect, header, aura, cardCount, cardHit, lastCardHit, hitTag:firstHit?.outerHTML.slice(0,120), ancestors, rail: {...rect(rail),clientWidth:rail.clientWidth,scrollWidth:rail.scrollWidth}, scroll: rect(document.getElementById('drive-content')), dock: rect(document.getElementById('bottom-nav')) };
        }, { profile, level, controlIds });
        assertMeasurement(measurement); measurements.push(measurement);
      }
      outdoor.push(await page.evaluate(()=>{
        document.body.dataset.opsTheme='dark'; setOutdoorMode(true,{silent:true});
        const legacyToggle=localStorage.getItem(OUTDOOR_MODE_STORAGE_KEY)==='1'&&document.getElementById('drawer-outdoor-mode-label').textContent==='On'&&document.body.classList.contains('outdoor-mode');
        const surface=getComputedStyle(document.body).getPropertyValue('--field-surface').trim();
        setOutdoorMode(false,{silent:true});
        return {width:innerWidth,legacyToggle:legacyToggle&&localStorage.getItem(OUTDOOR_MODE_STORAGE_KEY)==='0'&&!document.body.classList.contains('outdoor-mode'),darkSurface:surface==='#0a1711',surface};
      }));
      home.push(await page.evaluate(()=>{
        setOutdoorMode(false,{silent:true}); document.body.classList.remove('outdoor-mode','current-view-drive','global-back-active');document.documentElement.classList.remove('outdoor-mode');document.body.classList.add('current-view-home');
        syncHeaderBloomPlacement('home');document.getElementById('global-header-search-row').classList.add('hidden');
        const header=document.querySelector('.nav-header'),bloom=document.getElementById('footer-cart-btn'),version=document.getElementById('header-version');
        document.getElementById('header-user').textContent='dylan_collyge';version.textContent='AgData v'+JSON.parse(document.getElementById('geometry-version').textContent).version;
        const br=bloom.getBoundingClientRect(),vr=version.getBoundingClientRect();
        const drawer=document.getElementById('side-drawer');
        return {width:innerWidth,microphones:header.querySelectorAll('#aura-standby-control,[class*=microphone],.user-mic-badge,#header-voice-btn').length,drawerTools:drawer.contains(document.getElementById('drawer-outdoor-mode-btn'))&&drawer.contains(document.getElementById('runtime-watchdog-header-badge')),sameRow:Math.abs((br.top+br.bottom)/2-(vr.top+vr.bottom)/2)<=2,bloomInHeader:header.contains(bloom)&&br.width>0&&br.right<=innerWidth};
      }));
      await page.evaluate(()=>{auraFixture.destroy();if(!document.getElementById('footer-aura-btn').disabled||document.querySelector('[data-aura-root]'))throw Error('AURA teardown retained an interactive owner');});
    } finally { await page.close(); }
  }
  return { fingerprint: inputs.fingerprint, version: JSON.parse(inputs.files.get('version.json')).version, measurements, outdoor, home, permissions };
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const repo = path.resolve(path.dirname(modulePath), '..'), { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const entries = []; for (const target of [repo, path.join(repo, '_site')]) entries.push(await measure(target, browser));
    const receipt = { schema: 4, checkedAt: new Date().toISOString(), entries };
    await fs.mkdir(path.join(repo, '.gnc-local'), { recursive: true });
    await fs.writeFile(path.join(repo, '.gnc-local/drive-mobile-geometry.json'), JSON.stringify(receipt, null, 2) + '\n');
    for(const target of [repo,path.join(repo,'_site')])await verifyDriveGeometryReceipt(repo,target);
    console.log(JSON.stringify({ ok: true, version: entries[0].version, targets: entries.length, measurements: entries.flatMap(e => e.measurements).map(m => ({ profile: m.profile, level: m.level, viewport: [m.width, m.height], gap: m.dock.top - m.scroll.bottom, controlWidths: m.controls.map(c => c.offsetWidth) })) }));
  } finally { await browser.close(); }
}
