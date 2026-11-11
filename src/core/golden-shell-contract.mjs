import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadWorkerSource } from '../../tests/helpers/root-service-worker-fixture.mjs';

export function invariant67({read}) {
  const runtime = read('assets/app-runtime.js');
  const code = read('Code.gs');
  const migration = read('supabase/migrations/20261027133509_agdata_v2384_runtime_recovery.sql');
  const passkey = runtime.slice(runtime.indexOf('async function signInWithAppPasskey('), runtime.indexOf('async function registerAppPasskey('));
  const startup = runtime.slice(runtime.indexOf('async function initializeAppSessionOnLoad('), runtime.indexOf('let appChromeStartupStarted'));
  assert.ok(passkey.indexOf('invalidateNativeAuthRecovery()') < passkey.indexOf('auth.signInWithPasskey()'));
  assert.match(startup, /epoch === nativeAuthRecoveryEpoch/);
  assert.match(startup, /epoch !== nativeAuthRecoveryEpoch \|\| isAuthenticatedAppShellVisible\(\)/);
  assert.match(runtime, /viewportDefaultBand !== viewportDefaultBand/);
  assert.match(code, /cleanupCompletedImportExtraction_\(sourceIdentity, fileMeta\.file_name\)[^]*moveDriveFileToFolderWithRetry_\(sourceFile/);
  assert.match(migration, /mapped\.source_unique_id[^]*not exists\([^]*live\.unique_id=mapped\.canonical_unique_id[^]*exists\([^]*live\.unique_id=mapped\.source_unique_id/);
  assert.match(migration, /resolved_in_version='2\.3\.84'/);
}

export function invariant78({read}) {
  const workspace = read('assets/mobile-workspace.js');
  assert.ok(read('index.html').includes(`mobile-workspace.js?v=${JSON.parse(read('version.json')).version}`));
  assert.match(read('scripts/build-live-shell.mjs'), /ASSET_QUERY_OVERRIDES = Object\.freeze\(\{\}\)/);
  assert.match(read('scripts/prepare-release-site.mjs'), /isScopedAssetHotfix[^]*version === `\$\{assetVersion\}\.1`[^]*mobile-workspace\.js[^]*photo-history-v2026090401\.js[^]*inventory-list-contract\.js[^]*live-app-styles-base-v2026090503\.css/);
  assert.match(workspace, /view==='managers'[^]*includes\('setHomeTab\('\)[^]*button\.dataset\.moduleTileId/);
  assert.match(workspace, /byTarget\.get\(targetKey\)[^]*byTarget\.set\(targetKey,keep\)/);
  assert.match(read('.codex/skills/agdata-app-shell-and-navigation/SKILL.md'), /Never deduplicate manager module cards only by their shared `managers` route/);
}

export function invariant211({read, plain}) {
  const version=JSON.parse(read('package.json')).version;
  const expected='./assets/mobile-workspace.js?v='+version;
  const worker=read('sw.js').replace('  ...STATIC_ASSETS,','  ...STATIC_ASSETS, '+JSON.stringify(expected)+',');
  const context=vm.createContext({URL,self:{addEventListener(){},location:{origin:'https://cache.test'},registration:{scope:'https://cache.test/'}}});
  loadWorkerSource(context, worker+'\nglobalThis.cachedAssets=ASSETS_TO_CACHE;');
  assert.ok(context.cachedAssets.includes(expected));
  const manifestLine=read('scripts/build-live-shell.mjs').split('\n').find(line=>line.startsWith('const bootAssets ='));
  const built={deployedHtml:'<script src="'+expected+'"></script>'};
  vm.runInNewContext(manifestLine+'\nglobalThis.urls=bootAssets;',built);
  assert.deepEqual(plain(built.urls),[expected]);
}

export function invariant248({functionSource}) {
 const body=functionSource('assets/app-runtime.js','applyRolePermissions');const tail=body.slice(body.lastIndexOf('const defaultView ='),body.lastIndexOf('}'));const views=[];const ctx=vm.createContext({access:{},hasAppliedInitialHomeView:false,getDefaultViewForAccess:()=> 'sales',shouldRedirectForConfirmedViewDenial:()=>false,shouldPreserveMountedBootView:()=>false,getCurrentVisibleViewId:()=> 'detail',canAccessView:()=>true,setRoleAccessReadyState(){},switchView:view=>views.push(view)});vm.runInContext('function finishAccess(){'+tail+'}',ctx);ctx.finishAccess();assert.deepEqual(views,[]);assert.equal(ctx.hasAppliedInitialHomeView,true);ctx.hasAppliedInitialHomeView=false;ctx.getCurrentVisibleViewId=()=> 'home';ctx.finishAccess();assert.deepEqual(views,['sales']);
}

export function invariant322({read, functionSource}) {
 const source=(read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js')),migration=read('supabase/migrations/20261101050000_v23129_super_admin_role.sql'),api=read('supabase/functions/app-api/index.ts'),apply=read('scripts/apply-item-low-stock-migration.mjs');
 const ctx=vm.createContext({});vm.runInContext(source,ctx);const access=ctx.GncUserAccessControl;
 for(const role of ['super-admin','SUPER_ADMIN','Super Admin','superadmin'])assert.equal(access.isSuperAdminRole(role),true);
 access.setAccessMatrixRows([{username:'dylan_collyge',role:'super-admin',manage_user_access:'Y',use_weather_hold_risk_tools:'Y',use_aura_assistant:'Y',view_permissions:{view_smart_moves:'Y',view_nursery_command_tables:'Y'}}]);
 const matrix=access.resolveUserAccessMatrix('dylan_collyge');assert.equal(matrix.manage_user_access,'Y');assert.equal(matrix.use_weather_hold_risk_tools,'Y');assert.equal(matrix.use_aura_assistant,'Y');assert.equal(access.isAuraOwner('dylan_collyge'),true);
 assert.doesNotMatch(functionSource('assets/app-runtime.js','isAuraProfileCandidate'),/dylan_collyge/);assert.doesNotMatch(functionSource('assets/app-runtime.js','canUseWeatherHoldRiskTools'),/dylan_collyge/);assert.doesNotMatch(functionSource('assets/app-runtime.js','isAuthenticatedExecutiveUser'),/dylan_collyge/);
 assert.match(api,/activeProfileAllows\(actor, "use_aura_assistant"\)/);assert.match(api,/activeProfileAllows\(actor, "manage_user_access"\)/);assert.match(migration,/role='super_admin'/);assert.match(migration,/user_access_capability_v23129/);assert.match(migration,/can_view_access_control_v2[^]*manage_user_access/);assert.match(migration,/use_weather_hold_risk_tools='Y'/);
 const registry=apply.match(/releaseDatabaseMigrations = Object\.freeze\(\[([^\]]+)\]/)?.[1] || '';assert.match(registry,/agdataV23129SuperAdminRoleMigrationName/);
}
export async function invariant218({read, root}) {
  const {auditRuntimeIdentifiers}=await import('../../scripts/check-runtime-identifiers.mjs');
  const result=auditRuntimeIdentifiers(root);
  assert.deepEqual(result.masterUid,[]);assert.deepEqual(result.undeclared,[]);
  const shell=read('index.html'), runtime=shell.indexOf('id="app-script-source"');
  for (const [file,name] of [['location-code.js','LocationCode'],['bunch-note.js','BunchNote'],
    ['sales-workspace.js','SalesWorkspace'],['mobile-workspace.js','GncMobileWorkspace'],['report-pages-live.js','GncReportPagesLive']]) {
    const tag=shell.indexOf(`src="./assets/${file}?v=`), source=read('assets/'+file);
    assert.ok(tag>=0 && tag<runtime,`${file} loads before runtime`);
    assert.match(source,new RegExp(`\\broot\\.${name}\\s*=`));
    assert.match(source,/\}\)\([^\n]*(?:globalThis|window)/);
  }
}
