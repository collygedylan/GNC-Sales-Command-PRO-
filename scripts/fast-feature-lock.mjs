import {parentPort, workerData, isMainThread} from 'node:worker_threads';
import {inspectProgram, canonicalEngineFailures} from './fast-regression-contracts.mjs';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {syntaxFailures} from './syntax-lock-worker.mjs';

const codeCache = new Map();
export function program(source) {
  if (!codeCache.has(source)) codeCache.set(source,inspectProgram(source));
  return codeCache.get(source);
}
function codeOnly(source) { return program(source).code; }


export function forbiddenFailures(source, file) {
  const errors = [], fail = message => errors.push(message);
  if (!/request photo|PHOTO_REQUIRED|APPROVED BUNCH NOTE:/i.test(source)) return errors;
  const code = codeOnly(source);
  if (/["'`]Take or upload at least one request photo/i.test(code)) fail(`${file}: request-photo completion block`);
  // A detector regex/catalog mentioning an incident code is not a user gate.
  if (/(?:throw\s+(?:new\s+)?(?:Error|TypeError|Object\.assign)?\s*\([^;]{0,300}|(?:showToast|errorResponse|showRequestWorkFieldValidation)\s*\([^;]{0,300})\b[A-Z_]*PHOTO_REQUIRED\b/.test(code)
    || /\b(?:code|error)\s*:\s*["'][A-Z_]*PHOTO_REQUIRED["'][^;]{0,180}\b(?:status\s*:\s*4\d\d|return\s+false)/.test(code)) fail(`${file}: PHOTO_REQUIRED action block`);
  if (/APPROVED BUNCH NOTE:/i.test(code) && /["'`][^\n]{0,4000}APPROVED BUNCH NOTE:/i.test(code)) fail(`${file}: approved Bunch Note card banner`);
  return errors;
}

function requireMatch(source, expression, label, fail) {
  if (!expression.test(source)) fail(label);
}

function coreFeatures(code, reports, label, fail) {
  requireMatch(reports, /aggregate\.hasLowStockCurrent[^;]+reports\[['"]low-stock['"]\]\.push\(row\)/, `${label}: Low Stock classifier missing`,fail);
  requireMatch(reports, /if\s*\(!aggregate\.hasValidF1\)\s*reports\[['"]not-in-f1['"]\]\.push\(row\)/, `${label}: Not in F1 classifier missing`,fail);
  requireMatch(code, /GncEvalReports/, `${label}: report engine integration missing`,fail);
  requireMatch(code, /function\s+fieldAuditMatchingRows\s*\([^)]*\)\s*\{[\s\S]{0,1800}season\.includes\(state\.season\)[\s\S]{0,600}year>2026/, `${label}: Season Y/year filtering missing`,fail);
  requireMatch(code, /season\s*:\s*['"]Y['"][^\n]{0,80}year\s*:\s*['"]2026max['"]/, `${label}: Season Y default missing`,fail);
  requireMatch(code, /function\s+fieldAuditSetAnswer\s*\([^)]*\)\s*\{[\s\S]{0,2500}is_product_there[\s\S]{0,1500}fieldAuditFlush/, `${label}: product-presence persistence missing`,fail);
  requireMatch(code, /function\s+requireReclassExplanation\s*\([^)]*\)\s*\{[\s\S]{0,1000}isReclassExplanationExempt\(\)[\s\S]{0,1000}return false/, `${label}: non-admin Reclass Explanation validation missing`,fail);
  requireMatch(code, /if\s*\(!requireReclassExplanation\(row\.unique_id\)\)\s*throw/, `${label}: Reclass Explanation submission guard missing`,fail);
  requireMatch(code, /function\s+publishRowEvaluationToMasterAndNotes\s*\([^)]*\)\s*\{[\s\S]{0,7500}beginRowEvaluationMemoryPublication[\s\S]{0,7500}saveSecureDriveEvidence/, `${label}: canonical evaluation publisher missing`,fail);
  requireMatch(code, /await\s+publishRowEvaluationToMasterAndNotes\(itemToSave,requestPatch/, `${label}: Request publisher integration missing`,fail);
}

function ownershipFeatures(inspected, label, fail) {
  checkInventoryResolverOwnership(inspected,label,fail);
  const headerFields=inspected.functions.get('getDriveExcelHeaderFields')?.[0]?.source || '';
  for(const key of ['salesyear','season','lotcode','contsize','holdstopcode'])requireMatch(headerFields,new RegExp('["\']'+key+'["\']'),label+': missing Drive Excel '+key,fail);
  requireMatch(inspected.functions.get('getDriveFilteredItems')?.[0]?.source || '',/getDriveBaseFilteredItems[\s\S]*applyInventoryExcelFilters\(['"]drive['"]/,label+': Drive Excel filters must combine with searched candidates',fail);
  requireMatch(inspected.functions.get('getDriveBaseFilterKey')?.[0]?.source || '',/getInventoryExcelState\(['"]drive['"]\)\.revision/,label+': Drive caches must include Excel revision',fail);
  requireMatch(inspected.functions.get('buildDrivePlantFilterState')?.[0]?.source || '',/getInventoryExcelState\(['"]drive['"]\)\.revision,\s*String\(driveBaseFilterCacheKey/,label+': Drive plant caches must include search and Excel revision',fail);
  const bootOwner=name=>inspected.functions.get(name)?.[0]?.source || '';
  for(const name of ['initializeAppSessionOnLoad','restoreWorkStateAfterAppUpdate']) {
    const owner=bootOwner(name);
    requireMatch(owner,/Promise\.race\(/,label+': '+name+' must race a boot deadline',fail);
    requireMatch(owner,/setTimeout\([\s\S]*?,\s*1200\)/,label+': '+name+' must retain the 1200ms deadline',fail);
  }
  requireMatch(bootOwner('initializeAppSessionOnLoad'),/finishAppSessionBootFallback/,label+': boot timeout must expose shell or login inputs',fail);
  if(/await\s+(?:withAgDataBootDeadline|ensureCurrentShellBuild|restoreWorkStateAfterAppUpdate)/.test(bootOwner('initializeAppSessionOnLoad')))fail(label+': pre-entry work serializes boot');
  requireMatch(bootOwner('finishAppSessionBootFallback'),/resetLoginUiState\(true\)/,label+': cached hints cannot suppress interactive login fallback',fail);
  requireMatch(bootOwner('runAppUpdateRestoreAfterShell'),/typeof\s+restoreWorkStateAfterAppUpdate\s*===\s*["']function["']/,label+': optional update restore must be guarded',fail);
  requireMatch(bootOwner('restoreCachedNativeBootProfile'),/readCachedNativeBootSession\(/,label+': cached session must precede SDK network restoration',fail);
  requireMatch(bootOwner('expireAppUpdateRestore'),/state\.revision\s*\+=\s*1/,label+': timed-out restoration must fence late UI work',fail);
  const contracts={
    engines:['resolveCanonicalInventoryRow','publishRowEvaluationToMasterAndNotes','renderManagerEvalReport2DrillGroupCard','setMobileFilterSheetBodyLock','saveWorkStateBeforeAppUpdate','restoreWorkStateAfterAppUpdate'],
    routes:[
      ['openAppShellAfterLogin','restoreWorkStateAfterAppUpdate'],
      ...['renderDrive','renderDriveCommonNameDrill','renderDriveLocationDrill','renderDriveQuickCardResultsOnly','renderDriveCompleteCommonNames'].map(name=>[name,'ensureDriveToolbarControls']),
      ['syncUniversalPinnedResultsLayout','syncDriveViewportLayout'],
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
}

function checkInventoryResolverOwnership(inspected, label, fail) {
  const source = name => inspected.functions.get(name)?.[0]?.source || '';
  requireMatch(source('resolveCanonicalInventoryRow'),/return\s+projectCanonicalInventoryRow\(row\)/,`${label}: canonical inventory resolver missing`,fail);
  requireMatch(source('projectCanonicalInventoryRow'),/resolveCanonicalInventoryTarget\(row,\s*masterInventoryById,\s*masterInventoryByItemCode\)[\s\S]+noteScope/,`${label}: canonical inventory resolver lost indexed row and scoped evidence`,fail);
  requireMatch(source('resolveCanonicalInventoryTarget'),/byId\.get\([\s\S]+canonicalInventorySameLot/,`${label}: canonical inventory resolver lost exact lot validation`,fail);
}

function uiFeatures(inspected, label, fail) {
  const body=name=>inspected.functions.get(name)?.[0]?.source||'';
  requireMatch(body('getOutdoorModePreference'),/===\s*['"]1['"]/,label+': legacy Outdoor preference required',fail);
  requireMatch(body('persistOutdoorModePreference'),/enabled\s*\?\s*['"]1['"]\s*:\s*['"]0['"]/,label+': legacy Outdoor persistence required',fail);
  if(/getHours|setInterval/.test(body('initializeOutdoorMode')+body('syncOutdoorModeUi')))fail(label+': automatic Outdoor activation forbidden');
  requireMatch(body('canAccessView'),/hasExplicitViewPermission/,label+': verified view Y gate missing',fail);
  requireMatch(body('hasExplicitViewPermission'),/matrix\?\.verified/,label+': unverified view matrix allowed',fail);
  requireMatch(body('switchView'),/^function\s+switchView[^]*?\{\s*if\s*\(!canAccessView/,label+': router must deny before navigation effects',fail);
  requireMatch(body('syncRoleAccessUi'),/canAccessView\(viewId,userOverride\)/,label+': drawer must use canonical view access',fail);
  requireMatch(body('bindFastPressTarget'), /fastPressBound/, label+': delegated press registration guard missing',fail);
  requireMatch(body('initializeInteractiveChrome'), /if\s*\(interactiveChromeInitialized\)\s*return/, label+': chrome registration guard missing',fail);
  requireMatch(body('initializeInteractiveChrome'), /if\s*\(scrollFramePending\)\s*return[\s\S]*requestAnimationFrame/, label+': scroll frame coalescing missing',fail);
  requireMatch(body('initializeInteractiveChrome'), /addEventListener\(['"]scroll['"],\s*onMainScroll,\s*\{\s*passive:\s*true/, label+': main scroll must be passive',fail);
  if(/\b(?:renderAV|renderDrive|renderViewContent)\s*\(/.test(body('initializeInteractiveChrome')))fail(label+': full view rendering added to chrome scroll owner');
  requireMatch(body('setMobileFilterSheetBodyLock'), /owners\.has\(owner\)[\s\S]*owners\.delete\(owner\)[\s\S]*!lock\.owners\.size/, label+': shared overlay ownership cleanup missing',fail);
  requireMatch(body('hasOpenInteractiveSurfaceForBack')+body('closeOpenInteractiveSurfaceForBack'), /iosTaskFilterSheetState\??\.open/, label+': retained task sheet absent from Back ownership',fail);
  for(const name of ['getCardPtrOnHandValue','resolveCanonicalInventoryRow','getQueueCardInventoryRow'])if(/order_qty/i.test(body(name)))fail(label+': order quantity cannot hydrate On Hand');
  if(/\b(?:spec|caliper|av_note|photo_link|photo_name|saved_photo_link|saved_photo_name)\s*:/i.test(body('buildBloomActionRowFormPayload')))fail(label+': Bloom planning metadata cannot bypass evidence publication');
  const groupCard=inspected.functions.get('renderManagerEvalReport2DrillGroupCard')?.[0];
  if(groupCard && /summaryHtml|field-audit-(?:compact|standard)-drill/.test(groupCard.source))fail(label+': bespoke report group-card layout');
}

export function featureFailures(composed, engine, label) {
  const errors = [], fail = message => errors.push(message);
  const inspected = program(composed);
  coreFeatures(inspected.code, codeOnly(engine), label, fail);
  ownershipFeatures(inspected, label, fail);
  uiFeatures(inspected, label, fail);
  return [...errors, ...forbiddenFailures(composed, label + ' runtime')];
}

if (!isMainThread) {
  const {root, files, syntaxFiles, composed, engine, label} = workerData;
  const issues = [...syntaxFailures(root, syntaxFiles), ...featureFailures(composed, engine, label)];
  for (const file of files) issues.push(...forbiddenFailures(readFileSync(file, 'utf8'), path.relative(root, file)));
  parentPort.postMessage(issues);
}
