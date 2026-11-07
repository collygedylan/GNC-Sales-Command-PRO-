export async function verifyViewPermissionFixtures(page, runtime) {
  const names=['hasExplicitViewPermission','canAccessView','switchView','syncRoleAccessUi','canViewManagerEvalReports','canViewManagerEvalReports2'];
  const code=names.map(name=>{const fn=runtime.functions.get(name);if(!fn)throw Error('Permission owner missing '+name);return fn;}).join('\n');
  await page.addScriptTag({content:`
    var currentUser='permission-fixture',currentRole='Admin',permissionFixtureSuper=false,permissionToasts=[];
    var permissionMatrix={verified:true,view_permissions:{view_drive_mode:'N',view_av:'Y',view_docks:'Y',view_comm:'Y'}};
    const HOME_MODULE_REGISTRY=${runtime.variables.get('HOME_MODULE_REGISTRY')};
    const ROLE_VIEW_ELEMENT_IDS=${runtime.variables.get('ROLE_VIEW_ELEMENT_IDS')};
    const QUICK_ACCESS_NESTED_ROUTES=${runtime.variables.get('QUICK_ACCESS_NESTED_ROUTES')};
    function resolveUserAccessMatrix(){return permissionMatrix}
    function isFullAppAdministrator(){return permissionFixtureSuper}
    function navigationPreferencesAllowed(view,baseline){return baseline}
    function getRoleAccessState(){return {allowedViews:new Set(['drive','av','docks']),isAdmin:true}}
    function isSalesShellAccess(){return false}
    function ensureHomeModuleRegistry(){return document.getElementById('home-dashboard-grid')}
    function getHomeModuleRegistry(){return HOME_MODULE_REGISTRY}
    function scheduleHomeDashboardFitSettle(){}
    function showToast(...args){permissionToasts.push(args)}
  `+code});
  const result=await page.evaluate(async()=>{
    const assert=(condition,message)=>{if(!condition)throw Error(message)};
    assert(!canAccessView('drive'),'Explicit Drive N bypassed by authenticated identity or Admin role');
    assert(canAccessView('av')&&canAccessView('docks'),'Explicit module Y lost');
    assert(!canAccessView('sales'),'Missing view permission must fail closed');
    permissionMatrix.verified=false;assert(!canAccessView('av'),'Unverified matrix granted a view');permissionMatrix.verified=true;
    assert(switchView('drive')===false&&permissionToasts.length===1,'Denied router path did not return before navigation effects');
    assert(!canViewManagerEvalReports(),'Reports subtab bypassed missing permission');
    assert(!canViewManagerEvalReports2(),'Reports 2 subtab bypassed missing permission');
    syncRoleAccessUi();
    assert(document.getElementById('home-tile-drive').hidden,'Unauthorized Home card visible');
    assert(document.getElementById('drawer-drive-btn').hidden,'Unauthorized drawer item visible');
    assert(!document.getElementById('home-tile-av').hidden,'Authorized Home card hidden');
    GncNavigationPreferences.configure({username:'permission-fixture',canAccess:canAccessView,call:async()=>({username:'permission-fixture',footerRevision:1,shortcuts:['drive','av','docks'],views:[{view:'drive',label:'Drive',selectable:true,allowed:false},{view:'av',label:'AV',selectable:true,allowed:true},{view:'docks',label:'Docks',selectable:true,allowed:true}]})});
    const editor=document.createElement('div');document.body.append(editor);await GncNavigationPreferences.renderShortcutEditor(editor);
    assert(!editor.querySelector('[data-nav-module="drive"]')&&editor.querySelector('[data-nav-module="av"]'),'Shortcut picker ignores explicit view access');
    assert(editor.querySelectorAll('[data-nav-slot]').length===4,'Four custom slots required');editor.remove();
    GncNavigationPreferences.applyFooter(document.getElementById('bottom-nav'));
    assert(!document.querySelector('#bottom-nav [data-footer-view="drive"]'),'Unauthorized footer shortcut retained');
    assert(document.getElementById('footer-communication-btn').dataset.footerSlot==='5'&&document.getElementById('footer-aura-btn').dataset.footerSlot==='8','Fixed footer slots shifted around missing permissions');
    permissionFixtureSuper=true;assert(canAccessView('drive'),'Verified super-admin exemption lost');permissionFixtureSuper=false;
    permissionMatrix={verified:true,view_permissions:Object.fromEntries(['drive_mode','av','docks','comm','managers','sales','sales_office','historical_requests','qc','office','inventory','production','hl_order','bloom'].map(key=>['view_'+key,'Y']))};syncRoleAccessUi();
    GncNavigationPreferences.configure({username:'dylan_collyge',canAccess:()=>true});GncNavigationPreferences.applyFooter(document.getElementById('bottom-nav'));
    return {passed:13,routerBlockedBeforeEffects:true,home:true,drawer:true,picker:true,footer:true,superAdmin:true};
  });
  return result;
}
