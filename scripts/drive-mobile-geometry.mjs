import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const modulePath=fileURLToPath(import.meta.url);
const attr=(tag,name)=>tag.match(new RegExp('\\b'+name+'=["\']([^"\']+)'))?.[1];
async function geometryInputs(target) {
  const index=await fs.readFile(path.join(target,'index.html'),'utf8');
  const sheets=[...index.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(tag=>attr(tag,'rel')==='stylesheet').map(tag=>attr(tag,'href')).filter(href=>href&&!/^(?:https?:)?\/\//.test(href)).map(href=>href.split('?')[0].replace(/^\.\//,''));
  const compiled='assets/live-app-runtime-v2026082010.min.js';
  const runtimeFile=index.includes(compiled)?compiled:'assets/app-runtime.js';
  const files=[...new Set(['index.html','version.json',runtimeFile,'assets/row-workflow-functions.js','components/common/auraVoiceWidget.js',...sheets])];
  const contents=await Promise.all(files.map(async file=>[file,await fs.readFile(path.join(target,file),'utf8')]));
  const hash=createHash('sha256').update(await fs.readFile(modulePath));
  for(const [file,text]of contents)hash.update(file+'\0'+text.replaceAll('\r\n','\n')+'\0');
  return {index,sheets,files:new Map(contents),runtime:contents.find(([f])=>f===runtimeFile)[1],fingerprint:hash.digest('hex')};
}
function assertMeasurement(m) {
  if(m.width!==390||m.height!==844)throw Error('Drive geometry must use 390x844');
  if(m.controls.length!==5||m.controls.some(c=>c.offsetWidth<=0||c.display==='none'||c.visibility==='hidden'||c.left<m.rail.left-1||c.right>Math.min(m.rail.right,m.width)+1))throw Error('Drive toolbar controls must all be visible without horizontal scrolling');
  if(Math.max(...m.controls.map(c=>c.top))-Math.min(...m.controls.map(c=>c.top))>1)throw Error('Drive controls must share one row');
  if(Math.abs(m.scroll.bottom-m.dock.top)>4||m.scroll.height<250)throw Error('Drive scroll viewport is clipped above the dock: '+JSON.stringify(m));
}
export async function verifyDriveGeometryReceipt(repo,target=repo) {
  const inputs=await geometryInputs(target);
  const receipt=JSON.parse(await fs.readFile(path.join(repo,'.gnc-local/drive-mobile-geometry.json'),'utf8').catch(()=>{throw Error('Run node scripts/drive-mobile-geometry.mjs: mobile geometry receipt missing');}));
  const entry=receipt.entries.find(entry=>entry.fingerprint===inputs.fingerprint);
  if(receipt.schema!==1||!entry||entry.measurements.length!==3)throw Error('Run node scripts/drive-mobile-geometry.mjs: mobile geometry receipt is stale');
  if(!['normal','ios-retained','ios-safe-area'].every(mode=>entry.measurements.some(m=>m.mode===mode)))throw Error('Drive geometry coverage incomplete');
  entry.measurements.forEach(assertMeasurement);
  return entry;
}
async function measure(repo,target,browser) {
  const inputs=await geometryInputs(target),{parse}=await import('acorn');
  const program=parse(inputs.runtime,{ecmaVersion:'latest'}),names=['syncUniversalPinnedResultsLayout','syncIosFixedTopChromeMetrics','removeImportantStyleProps'];
  const functions=names.map(name=>{const n=program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);if(!n)throw Error('Missing geometry owner '+name);return inputs.runtime.slice(n.start,n.end);}).join('\n');
  const html=inputs.index.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,tag=>{const file=attr(tag,'href')?.split('?')[0].replace(/^\.\//,'');return attr(tag,'rel')==='stylesheet'&&inputs.files.has(file)?'<style>'+inputs.files.get(file)+'</style>':'';});
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try {
    await page.route('**/*',route=>route.abort());await page.setContent(html);
    const auraCss=inputs.files.get('components/common/auraVoiceWidget.js').match(/const CSS = `([\s\S]*?)`;/)?.[1];
    if(!auraCss)throw Error('AURA style owner missing');await page.addStyleTag({content:auraCss});
    await page.addScriptTag({content:`function getCurrentVisibleViewId(){return 'drive'}function releaseFixedFilterRail(el){for(const key of ['position','top','bottom','height'])el.style.removeProperty(key)}\n`+functions});
    await page.evaluate(()=>{
      document.body.classList.add('agdata-pinned-results','current-view-drive');
      const app=document.getElementById('app-wrapper');app.classList.remove('hidden');
      for(const el of document.body.children)if(el!==app&&!['STYLE','SCRIPT'].includes(el.tagName))el.style.display='none';
      document.querySelectorAll('[id^="view-"]').forEach(el=>{if(el.id!=='view-wrapper')el.classList.add('hidden');});
      document.getElementById('view-drive').classList.remove('hidden');
      document.getElementById('drive-content').innerHTML=Array.from({length:35},(_,i)=>'<article class="app-smart-card" style="height:100px;min-height:100px">Plant '+i+'</article>').join('');
    });
    const measurements=[];
    for(const mode of ['normal','ios-retained','ios-safe-area']) {
      const m=await page.evaluate(mode=>{
        const main=document.getElementById('main-scroll-area'),dock=document.getElementById('bottom-nav');
        if(mode!=='normal'){
          document.body.classList.add('ios-device','app-standalone','gnc-mobile-workspace','ios-fixed-top-chrome','ios-shell-gap-repair');
          for(const [key,value]of Object.entries({position:'absolute',top:'140px',bottom:'90px',height:'auto','padding-bottom':'84px'}))main.style.setProperty(key,value,'important');
        }
        if(mode==='ios-safe-area')dock.style.setProperty('padding-bottom','34px','important');
        document.documentElement.style.setProperty('--mobile-visible-height','844px');
        document.documentElement.style.setProperty('--mobile-bottom-nav-height',dock.getBoundingClientRect().height+'px');
        syncUniversalPinnedResultsLayout();syncIosFixedTopChromeMetrics('geometry-late-ios-callback');
        const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}};
        const rail=document.getElementById('drive-toolbar-rail');rail.scrollLeft=0;
        const controls=['#drive-mobile-mode','[data-drive-excel-field="lotcode"]','[data-drive-excel-field="contsize"]','[data-drive-excel-field="holdstopcode"]','#drive-advanced-filters > summary'].map(selector=>{const el=document.querySelector(selector),css=getComputedStyle(el);return {selector,offsetWidth:el.offsetWidth,display:css.display,visibility:css.visibility,...rect(el)}});
        const ancestors=['app-wrapper','app-top-chrome','main-scroll-area','view-wrapper','view-drive'].map(id=>{const el=document.getElementById(id),c=getComputedStyle(el);return {id,...rect(el),height:c.height,maxHeight:c.maxHeight,padding:c.padding,margin:c.margin,position:c.position,bottom:c.bottom,top:c.top}});const legacy=[];function scan(rules){for(const rule of rules){if(rule.cssRules)scan(rule.cssRules);if(rule.selectorText?.includes('#main-scroll-area') && (rule.style?.bottom || rule.style?.position)){try{if(main.matches(rule.selectorText))legacy.push(rule.cssText)}catch{}}}}for(const sheet of document.styleSheets)scan(sheet.cssRules);return {legacy,ancestors,mode,width:innerWidth,height:innerHeight,controls,rail:rect(rail),scroll:rect(document.getElementById('drive-content')),dock:rect(dock)};
      },mode);
      assertMeasurement(m);measurements.push(m);
    }
    return {fingerprint:inputs.fingerprint,version:JSON.parse(inputs.files.get('version.json')).version,measurements};
  }finally{await page.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===modulePath) {
  const repo=path.resolve(path.dirname(modulePath),'..'),{chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true});
  try {
    const entries=[];for(const target of [repo,path.join(repo,'_site')])entries.push(await measure(repo,target,browser));
    const receipt={schema:1,checkedAt:new Date().toISOString(),entries};
    await fs.mkdir(path.join(repo,'.gnc-local'),{recursive:true});await fs.writeFile(path.join(repo,'.gnc-local/drive-mobile-geometry.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(JSON.stringify({ok:true,version:entries[0].version,targets:entries.length,measurements:entries.flatMap(e=>e.measurements).map(m=>({mode:m.mode,viewport:[m.width,m.height],gap:m.dock.top-m.scroll.bottom,controlWidths:m.controls.map(c=>c.offsetWidth)}))}));
  } finally {await browser.close();}
}
