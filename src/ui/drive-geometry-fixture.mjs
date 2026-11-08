import { parse } from 'acorn';
import { verifyViewPermissionFixtures } from '../../scripts/drive-permission-fixture.mjs';

export const geometryLayoutOwners = Object.freeze([
  'releaseManagerTablePinnedLayout', 'applyUniversalPinnedResultsLayout'
]);

function isAstNode(item) { return !!item && typeof item.type === 'string'; }

function recordNode(node, source, functions, variables) {
  if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start, node.end));
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) variables.set(node.id.name, source.slice(node.init.start, node.init.end));
}

function appendNodeChildren(node, pending) {
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) pending.push(...value.filter(isAstNode));
    else if (value?.type) pending.push(value);
  }
}

function nodes(source) {
  const functions = new Map(), variables = new Map();
  const pending = [parse(source, { ecmaVersion: 'latest' })];
  while (pending.length) {
    const node = pending.pop();
    recordNode(node, source, functions, variables);
    appendNodeChildren(node, pending);
  }
  return { functions, variables };
}

function prepareGeometry(inputs, attr) {
  const runtime = nodes(inputs.runtime);
  const row = nodes(inputs.files.get('assets/row-workflow-functions.js'));
  const layout = nodes(inputs.files.get('assets/manager-table-layout.js'));
  const ops = nodes(inputs.files.get('assets/ops-precision-pilot.js'));
  const owners = [
    'syncUniversalPinnedResultsLayout', 'syncIosFixedTopChromeMetrics', 'removeImportantStyleProps',
    'ensureDriveToolbarControls', 'syncDriveViewportLayout', 'renderDriveCommonNameGroupCard',
    'normalizeEscapedDisplayText', 'syncHeaderBloomPlacement', 'getOutdoorModePreference',
    'syncOutdoorModeUi', 'setOutdoorMode', 'persistOutdoorModePreference'
  ];
  const functions = owners.map(name => {
    if (!runtime.functions.has(name)) throw Error('Missing geometry owner ' + name);
    return runtime.functions.get(name);
  });
  for (const name of geometryLayoutOwners) {
    if (!layout.functions.has(name)) throw Error('Missing geometry layout owner ' + name);
    functions.push(layout.functions.get(name));
  }
  functions.push(row.functions.get('getDriveExcelHeaderFields'), row.functions.get('getInventoryExcelState'));
  for (const name of ['compactBrowseRailKey', 'restoreCompactBrowseRail', 'decorateCompactBrowseRail',
    'decorateCompactBrowseRails', 'measureRuntimeViewport']) functions.push(ops.functions.get(name));
  const setup = `var outdoorModeEnabled=false; const OUTDOOR_MODE_STORAGE_KEY='gnc_outdoor_mode_v1'; function esc(v){return String(v)} function buildFastInvokeAttrs(){return ''} function getCurrentVisibleViewId(){return 'drive'} function getSupabaseReadIdentityScope(){return 'geometry-fixture'} function getEffectiveTheme(){return 'dark'} function releaseFixedFilterRail(el){for(const key of ['position','top','bottom','height'])el.style.removeProperty(key)} const BROWSE_RAIL_SELECTOR=${ops.variables.get('BROWSE_RAIL_SELECTOR')}; const compactBrowseRailState=new WeakMap(),compactBrowseRailOpenState=new Map(); const shared={compactBrowseRailFrame:0,hasCompactBrowseRails:false};`;
  const html = inputs.index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*>/gi, tag => {
      const file = attr(tag, 'href')?.split('?')[0].replace(/^\.\//, '');
      return attr(tag, 'rel') === 'stylesheet' && inputs.files.has(file)
        ? '<style>' + inputs.files.get(file) + '</style>' : '';
    });
  const auraCss = inputs.files.get('components/common/auraVoiceWidget.js').match(/const CSS = `([\s\S]*?)`;/)?.[1];
  if (!auraCss) throw Error('AURA style owner missing');
  return { runtime, html, auraCss, script: setup + functions.join('\n') };
}

async function initializePage(page, profile, inputs, prepared) {
      await page.route('**/*', route => route.request().url() === 'https://agdata.fixture/shell' ? route.fulfill({contentType:'text/html',body:prepared.html}) : route.request().url() === 'https://agdata.fixture/aura-voice.js' ? route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:inputs.files.get('assets/aura-voice.js')}) : route.abort());
      await page.goto('https://agdata.fixture/shell'); await page.addScriptTag({type:'application/json',content:inputs.files.get('version.json')}).then(handle=>handle.evaluate(el=>el.id='geometry-version')); await page.addStyleTag({ content: prepared.auraCss });
      await page.addScriptTag({ content: prepared.script });
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
      const permission = await verifyViewPermissionFixtures(page,prepared.runtime);
      await page.waitForFunction(()=>!document.getElementById('footer-aura-btn').disabled);
      await page.locator('#footer-aura-btn').click();
      if (!await page.locator('[data-aura-root] .aura-panel').isVisible()) throw Error('AURA footer did not open the actual assistant');
      await page.locator('#footer-aura-btn').click();
      if (await page.locator('[data-aura-root] .aura-panel').isVisible()) throw Error('AURA footer did not close the actual assistant');
      await page.evaluate(()=>globalThis.auraTogglePassed=true);
      return permission;
}

function captureLevel({ profile, level, controlIds }) {
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
}

async function measureLevel(page, profile, level, controlIds) {
  return page.evaluate(captureLevel, { profile, level, controlIds });
}

async function measureOutdoor(page) {
      return await page.evaluate(()=>{
        document.body.dataset.opsTheme='dark'; setOutdoorMode(true,{silent:true});
        const legacyToggle=localStorage.getItem(OUTDOOR_MODE_STORAGE_KEY)==='1'&&document.getElementById('drawer-outdoor-mode-label').textContent==='On'&&document.body.classList.contains('outdoor-mode');
        const surface=getComputedStyle(document.body).getPropertyValue('--field-surface').trim();
        setOutdoorMode(false,{silent:true});
        return {width:innerWidth,legacyToggle:legacyToggle&&localStorage.getItem(OUTDOOR_MODE_STORAGE_KEY)==='0'&&!document.body.classList.contains('outdoor-mode'),darkSurface:surface==='#0a1711',surface};
      });
}

async function measureHome(page) {
      return await page.evaluate(()=>{
        setOutdoorMode(false,{silent:true}); document.body.classList.remove('outdoor-mode','current-view-drive','global-back-active');document.documentElement.classList.remove('outdoor-mode');document.body.classList.add('current-view-home');
        syncHeaderBloomPlacement('home');document.getElementById('global-header-search-row').classList.add('hidden');
        const header=document.querySelector('.nav-header'),bloom=document.getElementById('footer-cart-btn'),version=document.getElementById('header-version');
        document.getElementById('header-user').textContent='dylan_collyge';version.textContent='AgData v'+JSON.parse(document.getElementById('geometry-version').textContent).version;
        const br=bloom.getBoundingClientRect(),vr=version.getBoundingClientRect();
        const drawer=document.getElementById('side-drawer');
        return {width:innerWidth,microphones:header.querySelectorAll('#aura-standby-control,[class*=microphone],.user-mic-badge,#header-voice-btn').length,drawerTools:drawer.contains(document.getElementById('drawer-outdoor-mode-btn'))&&drawer.contains(document.getElementById('runtime-watchdog-header-badge')),sameRow:Math.abs((br.top+br.bottom)/2-(vr.top+vr.bottom)/2)<=2,bloomInHeader:header.contains(bloom)&&br.width>0&&br.right<=innerWidth};
      });
}

async function teardownFixture(page) {
  await page.evaluate(() => {
    auraFixture.destroy();
    if (!document.getElementById('footer-aura-btn').disabled || document.querySelector('[data-aura-root]')) throw Error('AURA teardown retained an interactive owner');
  });
}

export async function measureDriveGeometry(target, browser, options) {
  const { geometryInputs, assertMeasurement, profiles, levels, controlIds, attr } = options;
  const inputs = await geometryInputs(target), prepared = prepareGeometry(inputs, attr);
  const measurements = [], outdoor = [], home = [], permissions = [];
  for (const profile of profiles) {
    const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.mobile, hasTouch: profile.mobile });
    try {
      permissions.push(await initializePage(page, profile, inputs, prepared));
      for (const level of levels) {
        const measurement = await measureLevel(page, profile, level, controlIds);
        assertMeasurement(measurement);
        measurements.push(measurement);
      }
      outdoor.push(await measureOutdoor(page));
      home.push(await measureHome(page));
      await teardownFixture(page);
    } finally { await page.close(); }
  }
  return { fingerprint: inputs.fingerprint, version: JSON.parse(inputs.files.get('version.json')).version, measurements, outdoor, home, permissions };
}
