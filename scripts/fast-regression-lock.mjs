import { readFile, readdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { verifyDriveGeometryReceipt } from './drive-mobile-geometry.mjs';
import { inspectProgram, canonicalEngineFailures, forbiddenAssetText, liveAssetVersionFailures } from './fast-regression-contracts.mjs';

const started = performance.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const syntaxFiles = ['assets/app-runtime.js', 'assets/row-workflow-functions.js', 'assets/runtime-watchdog.js','assets/app-update-state.js','assets/live-app-update.js','assets/app-lifecycle.js','sw.js'];
const readCache = new Map();
const readAbsolute = file => { if (!readCache.has(file)) readCache.set(file,readFile(file,'utf8')); return readCache.get(file); };
const read = file => readAbsolute(path.join(root,file));
const fail = message => errors.push(message);
const requireMatch = (source, expression, label) => { if (!expression.test(source)) fail(label); };
// Contract checks inspect implementation, not comments or documentation labels.
const codeCache = new Map();
function program(source) {
  if (!codeCache.has(source)) codeCache.set(source,inspectProgram(source));
  return codeCache.get(source);
}
function codeOnly(source) { return program(source).code; }

async function assetTextFiles(directory) {
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory() && entry.name!=='node_modules') files.push(...await assetTextFiles(file));
    else if(entry.isFile() && /\.(?:[cm]?js|tsx?|css|html?|json|svg|txt|md|webmanifest)$/i.test(entry.name)) files.push(file);
  }
  return files;
}
async function assertAssetText(directory,label) {
  await Promise.all((await assetTextFiles(directory)).map(async file=>{
    for(const phrase of forbiddenAssetText(await readAbsolute(file))) fail(label+': '+path.relative(directory,file)+': forbidden asset text '+phrase);
  }));
}

function checkSyntax(file) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--check', path.join(root, file)], { windowsHide: true });
    let detail = '';
    child.stderr.on('data', chunk => { detail += chunk; });
    child.on('error', error => { fail(`${file}: ${error.message}`); resolve(); });
    child.on('close', code => { if (code) fail(`${file}: syntax invalid\n${detail.trim()}`); resolve(); });
  });
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!/^(?:vendor|node_modules|tests?|fixtures?|__tests__)$/.test(entry.name)) files.push(...await sourceFiles(path.join(directory, entry.name)));
    } else if (entry.isFile() && /\.(?:[cm]?js|tsx?)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) files.push(path.join(directory, entry.name));
  }
  return files;
}

function forbiddenBlocks(source, file) {
  if (!/request photo|PHOTO_REQUIRED|APPROVED BUNCH NOTE:/i.test(source)) return;
  const code = codeOnly(source);
  if (/["'`]Take or upload at least one request photo/i.test(code)) fail(`${file}: request-photo completion block`);
  // A detector regex/catalog mentioning an incident code is not a user gate.
  if (/(?:throw\s+(?:new\s+)?(?:Error|TypeError|Object\.assign)?\s*\([^;]{0,300}|(?:showToast|errorResponse|showRequestWorkFieldValidation)\s*\([^;]{0,300})\b[A-Z_]*PHOTO_REQUIRED\b/.test(code)
    || /\b(?:code|error)\s*:\s*["'][A-Z_]*PHOTO_REQUIRED["'][^;]{0,180}\b(?:status\s*:\s*4\d\d|return\s+false)/.test(code)) fail(`${file}: PHOTO_REQUIRED action block`);
  if (/APPROVED BUNCH NOTE:/i.test(code) && /["'`][^\n]{0,4000}APPROVED BUNCH NOTE:/i.test(code)) fail(`${file}: approved Bunch Note card banner`);
}

function featureContracts(composed, engine, label = 'source') {
  const code = codeOnly(composed), reports = codeOnly(engine);
  requireMatch(reports, /aggregate\.hasLowStockCurrent[^;]+reports\[['"]low-stock['"]\]\.push\(row\)/, `${label}: Low Stock classifier missing`);
  requireMatch(reports, /if\s*\(!aggregate\.hasValidF1\)\s*reports\[['"]not-in-f1['"]\]\.push\(row\)/, `${label}: Not in F1 classifier missing`);
  requireMatch(code, /GncEvalReports/, `${label}: report engine integration missing`);
  requireMatch(code, /function\s+fieldAuditMatchingRows\s*\([^)]*\)\s*\{[\s\S]{0,1800}season\.includes\(state\.season\)[\s\S]{0,600}year>2026/, `${label}: Season Y/year filtering missing`);
  requireMatch(code, /season\s*:\s*['"]Y['"][^\n]{0,80}year\s*:\s*['"]2026max['"]/, `${label}: Season Y default missing`);
  requireMatch(code, /function\s+fieldAuditSetAnswer\s*\([^)]*\)\s*\{[\s\S]{0,2500}is_product_there[\s\S]{0,1500}fieldAuditFlush/, `${label}: product-presence persistence missing`);
  requireMatch(code, /function\s+requireReclassExplanation\s*\([^)]*\)\s*\{[\s\S]{0,1000}isReclassExplanationExempt\(\)[\s\S]{0,1000}return false/, `${label}: non-admin Reclass Explanation validation missing`);
  requireMatch(code, /if\s*\(!requireReclassExplanation\(row\.unique_id\)\)\s*throw/, `${label}: Reclass Explanation submission guard missing`);
  requireMatch(code, /function\s+resolveCanonicalInventoryRow\s*\([^)]*\)\s*\{[\s\S]{0,4500}masterInventoryById\.get[\s\S]{0,4500}noteScope/, `${label}: canonical inventory resolver missing`);
  requireMatch(code, /function\s+publishRowEvaluationToMasterAndNotes\s*\([^)]*\)\s*\{[\s\S]{0,7500}beginRowEvaluationMemoryPublication[\s\S]{0,7500}saveSecureDriveEvidence/, `${label}: canonical evaluation publisher missing`);
  requireMatch(code, /await\s+publishRowEvaluationToMasterAndNotes\(itemToSave,requestPatch/, `${label}: Request publisher integration missing`);
  const inspected=program(composed);
  const headerFields=inspected.functions.get('getDriveExcelHeaderFields')?.[0]?.source || '';
  for(const key of ['lotcode','contsize','holdstopcode'])requireMatch(headerFields,new RegExp('["\']'+key+'["\']'),label+': missing Drive Excel '+key);
  requireMatch(inspected.functions.get('getDriveFilteredItems')?.[0]?.source || '',/getDriveBaseFilteredItems[\s\S]*applyInventoryExcelFilters\(['"]drive['"]/,label+': Drive Excel filters must combine with searched candidates');
  requireMatch(inspected.functions.get('getDriveBaseFilterKey')?.[0]?.source || '',/getInventoryExcelState\(['"]drive['"]\)\.revision/,label+': Drive caches must include Excel revision');
  requireMatch(inspected.functions.get('buildDrivePlantFilterState')?.[0]?.source || '',/getInventoryExcelState\(['"]drive['"]\)\.revision,\s*String\(driveBaseFilterCacheKey/,label+': Drive plant caches must include search and Excel revision');
  const bootOwner=name=>inspected.functions.get(name)?.[0]?.source || '';
  for(const name of ['initializeAppSessionOnLoad','restoreWorkStateAfterAppUpdate']) {
    const owner=bootOwner(name);
    requireMatch(owner,/Promise\.race\(/,label+': '+name+' must race a boot deadline');
    requireMatch(owner,/setTimeout\([\s\S]*?,\s*1200\)/,label+': '+name+' must retain the 1200ms deadline');
  }
  requireMatch(bootOwner('initializeAppSessionOnLoad'),/finishAppSessionBootFallback/,label+': boot timeout must expose shell or login inputs');
  if(/await\s+(?:withAgDataBootDeadline|ensureCurrentShellBuild|restoreWorkStateAfterAppUpdate)/.test(bootOwner('initializeAppSessionOnLoad')))fail(label+': pre-entry work serializes boot');
  requireMatch(bootOwner('finishAppSessionBootFallback'),/resetLoginUiState\(true\)/,label+': cached hints cannot suppress interactive login fallback');
  requireMatch(bootOwner('runAppUpdateRestoreAfterShell'),/typeof\s+restoreWorkStateAfterAppUpdate\s*===\s*["']function["']/,label+': optional update restore must be guarded');
  requireMatch(bootOwner('restoreCachedNativeBootProfile'),/readCachedNativeBootSession\(/,label+': cached session must precede SDK network restoration');
  requireMatch(bootOwner('expireAppUpdateRestore'),/state\.revision\s*\+=\s*1/,label+': timed-out restoration must fence late UI work');
  const contracts={
    engines:['resolveCanonicalInventoryRow','publishRowEvaluationToMasterAndNotes','renderManagerEvalReport2DrillGroupCard','setMobileFilterSheetBodyLock','saveWorkStateBeforeAppUpdate','restoreWorkStateAfterAppUpdate'],
    routes:[
      ['openAppShellAfterLogin','restoreWorkStateAfterAppUpdate'],
      ['renderFieldAuditReportDrillGroup','renderManagerEvalReport2DrillGroupCard'],
      ['renderManagerEvalReport2Records','renderManagerEvalReport2DrillGroupCard'],
      ['persistDrivePhotoAttachment','publishRowEvaluationToMasterAndNotes'],
      ['persistQueuePhotoAttachment','publishRowEvaluationToMasterAndNotes'],
      ['persistSuspendTagUploadedPhoto','publishRowEvaluationToMasterAndNotes'],
      ['flushPendingRequestWorkEdits','publishRowEvaluationToMasterAndNotes'],
      ['saveDockSuspendDcRequestMirrorData','publishRowEvaluationToMasterAndNotes'],
      ['saveData','publishRowEvaluationToMasterAndNotes'],
      ["generateCard","resolveCanonicalInventoryRow"],
      ["getQueueCardInventoryRow","resolveCanonicalInventoryRow"],
      ["renderManagerEvalReport2SelectableCard","resolveCanonicalInventoryRow"],
      ["fieldAuditTable","resolveCanonicalInventoryRow"],
      ["getDockCardLiveInventoryDisplayRow","resolveCanonicalInventoryRow"],
      ["buildDockSuspendDcRequestCardDisplayItem","resolveCanonicalInventoryRow"],
      ["writeSocReviewThroughAppApi","publishRowEvaluationToMasterAndNotes"],
      ["persistSharedPhotoMasterFields","publishRowEvaluationToMasterAndNotes"],
      ["saveSalesOfficeAvNote","publishRowEvaluationToMasterAndNotes"],
      ["saveSeasonSalesOfficeAvNoteSnapshot","publishRowEvaluationToMasterAndNotes"],
      ["publishNcrDraftToAv","publishRowEvaluationToMasterAndNotes"],
      ["persistConfirmedRowEvaluation","publishRowEvaluationToMasterAndNotes"],
      ["closeTaskDropdowns","closeIosTaskFilterSheet"],
      ["setIosTaskFilterSheetBodyLock","setMobileFilterSheetBodyLock"],
      ["setDockMobileFilterBodyLock","setMobileFilterSheetBodyLock"]
    ],
    transports:{saveSecureDriveEvidence:['publishRowEvaluationToMasterAndNotes','saveSecureDriveEvidence']},
    rpcOwners:{"save_drive_evidence_v3":["saveSecureDriveEvidence"],"save_request_work":["clearCurrentSectionData","persistConfirmedRowEvaluation","flushPendingRequestWorkEdits"]},
    rawMasterOwners:["patchBloomActionRowFormRow","persistNcrCurrentCropInheritance","writeNcrApprovalMasterPayload","writeNcrApprovalReverseCleanupPayload","writeNotOnInventoryApprovalMasterPayload","createNotOnInventoryRow","submitEvalTaskAssignment","completeEvalTaskFromDetail","forceTaskSeasonSalesNoteOverride","patchCropRollMasterInventoryRow","submitEndCap","persistConfirmedRowEvaluation"],
    seasonSaveOwners:["saveSalesOfficeAvNote","saveSeasonSalesOfficeAvNoteSnapshot"],
    requestPhotoOwners:["persistQueuePhotoAttachment"],
    dynamicSuspendOwners:["runSuspendTagRowCommand","emailSuspendTagFromCard","sendSuspendTagApproval"],
    suspendOwners:{"complete":["emailSuspendTagFromCard","persistDockSuspendDcRequestCompletion"],"close":["closeDockSuspendDcRequestFromCard","markDockSuspendDcRequestHandled"]},
    reportRenderers:['renderManagerEvalReport2BrowseRegionHtml','renderManagerEvalReport2ReportsPanel','renderManagerEvalReport2MoreMenu','renderManagerEvalReports2LegacyPanel','renderManagerEvalReport2DrillGroupCard','renderFieldAuditReportDrillGroup','renderFieldAuditReport','fieldAuditBody']
  };
  for(const error of canonicalEngineFailures(inspected,contracts))fail(label+': '+error);
  const body=name=>inspected.functions.get(name)?.[0]?.source||'';
  requireMatch(body('bindFastPressTarget'), /fastPressBound/, label+': delegated press registration guard missing');
  requireMatch(body('initializeInteractiveChrome'), /if\s*\(interactiveChromeInitialized\)\s*return/, label+': chrome registration guard missing');
  requireMatch(body('initializeInteractiveChrome'), /if\s*\(scrollFramePending\)\s*return[\s\S]*requestAnimationFrame/, label+': scroll frame coalescing missing');
  requireMatch(body('initializeInteractiveChrome'), /addEventListener\(['"]scroll['"],\s*onMainScroll,\s*\{\s*passive:\s*true/, label+': main scroll must be passive');
  if(/\b(?:renderAV|renderDrive|renderViewContent)\s*\(/.test(body('initializeInteractiveChrome')))fail(label+': full view rendering added to chrome scroll owner');
  requireMatch(body('setMobileFilterSheetBodyLock'), /owners\.has\(owner\)[\s\S]*owners\.delete\(owner\)[\s\S]*!lock\.owners\.size/, label+': shared overlay ownership cleanup missing');
  requireMatch(body('hasOpenInteractiveSurfaceForBack')+body('closeOpenInteractiveSurfaceForBack'), /iosTaskFilterSheetState\??\.open/, label+': retained task sheet absent from Back ownership');
  for(const name of ['getCardPtrOnHandValue','resolveCanonicalInventoryRow','getQueueCardInventoryRow'])if(/order_qty/i.test(body(name)))fail(label+': order quantity cannot hydrate On Hand');
  if(/\b(?:spec|caliper|av_note|photo_link|photo_name|saved_photo_link|saved_photo_name)\s*:/i.test(body('buildBloomActionRowFormPayload')))fail(label+': Bloom planning metadata cannot bypass evidence publication');
  const groupCard=inspected.functions.get('renderManagerEvalReport2DrillGroupCard')?.[0];
  if(groupCard && /summaryHtml|field-audit-(?:compact|standard)-drill/.test(groupCard.source))fail(label+': bespoke report group-card layout');
}

function cardLayoutContracts(css, label = 'source') {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];
  const owns = (selector, declaration) => rules.some(rule => selector.test(rule.split('{')[0]) && declaration.test(rule.slice(rule.indexOf('{') + 1)));
  if (!owns(/#av-content/, /grid-auto-rows\s*:\s*max-content\s*!important/)) fail(label + ': AV natural grid rows missing');
  if (!owns(/\.app-av-catalog-card/, /flex-shrink\s*:\s*0\s*!important[\s\S]*min-height\s*:\s*max-content/)) fail(label + ': AV non-shrinking natural card height missing');
  if (!owns(/\.agdata-results-scroll/, /display\s*:\s*block\s*!important[\s\S]*overflow-y\s*:\s*auto/)) fail(label + ': results scroller block layout missing');
  if (!owns(/\[data-av-load-more\]/, /position\s*:\s*static\s*!important/)) fail(label + ': AV continuation must remain in flow');
}

function versionContracts(version, index, worker, runtime, label) {
  const expected = String(version.version || '');
  const numbers=expected.split('.').map(Number);
  if(numbers.length!==3 || !numbers.every(Number.isInteger) || numbers[0]<3 || numbers[0]===3 && (numbers[1]<0 || numbers[1]===0 && numbers[2]<25))fail(label+': release predates canonical engine lock');
  if (!/^\d+\.\d+\.\d+$/.test(expected) || version.release !== `AgData v${expected}`) fail(`${label}: version.json invalid`);
  for (const issue of liveAssetVersionFailures(index, expected)) fail(label + ': ' + issue);
  const escaped = expected.replaceAll('.', '\\.');
  requireMatch(index, new RegExp(`name=["']agdata-release["']\\s+content=["']${escaped}["']`), `${label}: index release mismatch`);
  for (const name of ['__APP_SHELL_VERSION__', '__APP_RELEASE_VERSION__']) requireMatch(index, new RegExp(`${name}\\s*=\\s*["']AgData v${escaped}["']`), `${label}: ${name} mismatch`);
  for (const [name, prefix] of [['APP_SHELL_BUILD','AgData v'], ['APP_ASSET_VERSION',''], ['CACHE_VERSION','agdata-v']]) requireMatch(worker, new RegExp(`const ${name}\\s*=\\s*["']${prefix}${escaped}["']`), `${label}: ${name} mismatch`);
  requireMatch(runtime, new RegExp(`const APP_VERSION\\s*=\\s*["']${escaped}["']`), `${label}: runtime version mismatch`);
  requireMatch(runtime, new RegExp(`APP_SHELL_VERSION[^;]+["']AgData v${escaped}["']`), `${label}: runtime shell fallback mismatch`);
  return expected;
}

function liveUpdateContracts(source, label) {
  const parsed=program(source);
  for(const name of ['saveWorkStateBeforeAppUpdate','getAppUpdateBusyState','isAppUpdateSnapshotCurrent','commitAppUpdateSnapshotForReload'])if(!parsed.calls.some(call=>call.name===name))fail(label+': update handoff missing '+name);
  requireMatch(parsed.code, /checkForLiveAppUpdate/, label+': live version poller missing');
  requireMatch(parsed.code, /updateViaCache\s*:\s*['"]none['"]/, label+': worker registration may use stale HTTP cache');
  requireMatch(parsed.code, /cache\s*:\s*['"]no-store['"]/, label+': live version read must bypass HTTP cache');
  requireMatch(parsed.code, /45_?000/, label+': live version interval changed');
}

try {
  const syntax = Promise.all(syntaxFiles.map(checkSyntax));
  const [runtime, row, index, worker, versionText, engine, files] = await Promise.all([
    read(syntaxFiles[0]), read(syntaxFiles[1]), read('index.html'), read('sw.js'), read('version.json'), read('assets/eval-reports-engine.js'),
    Promise.all(['assets', 'supabase/functions'].map(directory => sourceFiles(path.join(root, directory)))).then(groups => groups.flat()),
  ]);
  const fragments = [...runtime.matchAll(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g)];
  if (!fragments.some(match => match[1] === 'assets/row-workflow-functions.js')) fail('composed runtime does not include row-workflow-functions.js');
  const fragmentSources = new Map(await Promise.all(fragments.map(async match => [match[1], match[1] === syntaxFiles[1] ? row : await read(match[1])])));
  const composed = runtime.replace(/\/\* @runtime-fragment (assets\/[a-z0-9-]+\.js) \*\//g, (_, file) => fragmentSources.get(file));
  const expected = versionContracts(JSON.parse(versionText), index, worker, runtime, 'source');
  liveUpdateContracts(await read('assets/live-app-update.js'), 'source');
  await read('assets/app-update-state.js');
  await read('assets/app-lifecycle.js');
  requireMatch(index, /live-app-update\.js\?v=/, 'source: live update owner script missing');
  requireMatch(index,/id=["']drive-excel-header-filters["']/, 'source: Drive Excel toolbar host missing');
  for(const key of ['lotcode','contsize','holdstopcode'])if(!index.includes('data-drive-excel-field="'+key+'"'))fail('source: missing Drive header control '+key);
  const packageVersion=JSON.parse(await read('package.json')).version;
  if(packageVersion!==expected)fail('source: package/version.json release mismatch');
  const sourceScripts=[...index.matchAll(/<script\b[^>]*>/gi)].map(match=>match[0]);
  const updateFragmentPosition=sourceScripts.findIndex(tag=>/assets\/app-update-state\.js\?v=/.test(tag));
  const runtimePosition=sourceScripts.findIndex(tag=>/assets\/app-runtime\.js\?v=/.test(tag));
  if(updateFragmentPosition<0 || runtimePosition<0 || updateFragmentPosition>=runtimePosition)fail('source: update restore fragment must load before runtime');
  if(sourceScripts.some(tag=>/\btype=["']module["']/i.test(tag)&&/app-runtime|row-workflow|state-store|api-sync/i.test(tag)))fail('source: classic runtime loading changed');
  await assertAssetText(path.join(root,'assets'),'source');
  await access(path.join(root, '.nojekyll')).catch(() => fail('source: root .nojekyll missing'));
  featureContracts(composed, engine);
  await verifyDriveGeometryReceipt(root);
  cardLayoutContracts(await read('assets/app-styles.css'));
  requireMatch(composed, /root:\s*getMainAreaScrollTarget\(\),\s*rootMargin:\s*['"]400px['"]/, 'AV continuation must observe active results scroller');
  // The composed source contains every executable byte of these constituent files.
  // Check it once, then scan all remaining source files independently.
  forbiddenBlocks(composed, 'composed runtime');
  const composedFiles = new Set([syntaxFiles[0], ...fragmentSources.keys()].map(file => path.resolve(root, file)));
  await Promise.all(files.filter(file => !composedFiles.has(path.resolve(file))).map(async file => forbiddenBlocks(await readAbsolute(file), path.relative(root, file))));
  const artifactFlag = process.argv.indexOf('--artifact-root');
  if (artifactFlag >= 0) {
    if (!process.argv[artifactFlag + 1]) throw new Error('--artifact-root requires a directory');
    const artifact = path.resolve(process.argv[artifactFlag + 1]);
    const [artifactIndex, artifactWorker, artifactVersionText, artifactRuntime, artifactEngine] = await Promise.all([
      'index.html','sw.js','version.json','assets/live-app-runtime-v2026082010.min.js','assets/eval-reports-engine.js',
    ].map(file => readFile(path.join(artifact,file),'utf8')));
    const actual = versionContracts(JSON.parse(artifactVersionText),artifactIndex,artifactWorker,artifactRuntime,'Pages artifact');
    liveUpdateContracts(await readFile(path.join(artifact,'assets/live-app-update.js'),'utf8'),'Pages artifact');
    if (actual !== expected) fail('Pages artifact differs from source release');
    await access(path.join(artifact,'.nojekyll')).catch(() => fail('Pages artifact: root .nojekyll missing'));
    await assertAssetText(path.join(artifact,'assets'),'Pages artifact');
    forbiddenBlocks(artifactRuntime,'Pages artifact runtime');
    // The minifier preserves names; enforce the same implementation contracts.
    featureContracts(artifactRuntime,artifactEngine,'Pages artifact');
    cardLayoutContracts(await readFile(path.join(artifact,'assets/app-styles.css'),'utf8'), 'Pages artifact');
    await verifyDriveGeometryReceipt(root,artifact);
  }
  await syntax;
} catch (error) { fail(error.message); }
const elapsed = performance.now() - started;
if (elapsed >= 2000) fail(`fast lock exceeded 2 seconds (${Math.round(elapsed)} ms)`);
if (errors.length) {
  console.error(`FAST REGRESSION LOCK FAILED (${Math.round(elapsed)} ms)\n${errors.map(error => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else console.log(`FAST REGRESSION LOCK PASS (${Math.round(elapsed)} ms): syntax, forbidden blocks, core features, .nojekyll, matching versions.`);
