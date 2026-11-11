import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
import {extractGoldenFunction} from '../../src/core/golden-function-extractor.mjs';

const read = file => fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const moduleSource = file => read(file).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
export const accessMatrixSource = moduleSource('src/core/access-matrix-policy.js');

export async function assertExistingSuspendExactReceiptContract() {
    const {suspendExactReceiptContract} = await import('./golden-dock-domain-contract.mjs');
    suspendExactReceiptContract();
}

function fixture(username = 'new_authorized_actor', matrix = {}) {
    const row = {UNIQUE_ID:'master-row',ITEMCODE:'PLANT',LOCATIONCODE:'A.01',LOTCODE:'26.F1',SOURCE_TABLE:'ph_master_inventory'};
    const context = vm.createContext({currentUser:username,currentRole:'REP',activeItem:row,activeDetailSourceView:'drive',lastView:'drive',
        nativeAuthSessionActive:true,nativeAuthSessionUserId:'profile-current',
        nativeAuthProfile:{id:'profile-current',username,display_name:'Verified Actor',role:'REP',active:true},
        normalizeEvalAssignableUser:value => String(value || '').trim().toLowerCase(),
        firstNonEmptyValue:(...values) => values.find(value => value != null && value !== '') ?? '',
        getManagerAssignedColumnState:() => ({}),getCardEvalOwnerIndex:() => ({exact:new Map(),family:new Map([['PLANT',username]])}),
        buildManagerEvalAssignmentKey:value => String(value || '').trim().toUpperCase(),
        getEditableDetailItemForPrefix:(_prefix,item) => item || context.activeItem,
        getCurrentVisibleViewId:() => 'detail',isDockSuspendDcRequestMirrorRow:item => item?.DOCK_SUSPEND_DC_REQUEST === true,
        canCurrentUserViewDockSuspendDcRequests:() => true,
        buildCardActivationAttrs:(dom,uid,source) => `open-detail:${dom}:${uid}:${source}`,
        requestCapabilityState:{status:'ready',stale:false,username,profileId:'profile-current',capabilities:{canTakePhoto:true,canEdit:true,canComplete:true}}
    });
    context.window = context;
    vm.runInContext(accessMatrixSource + '\n' + read('assets/user-access-control.js'),context);
    vm.runInContext(moduleSource('src/engine/row-access-policy.js')+'\n'+moduleSource('src/views/av-detail-readonly.js'),context);
    vm.runInContext(extractGoldenFunction(read('assets/row-workflow-functions.js'),'resolveUserAccessMatrix'),context);
    const defaults = {username,profile_id:'profile-current',role:'REP',edit_any_row:'N',can_edit_all_rows:'N',edit_assigned_rows_only:'N',can_edit_assigned_items:'N',
        view_permissions:{view_drive_mode:'Y',view_av:'Y',view_que:'Y'}};
    context.GncUserAccessControl.setAccessMatrixRows([{...defaults,...matrix}]);
    return {context,row};
}

function assertNoNameCanGrantAuthority() {
    for (const actor of ['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson','melissa_dowty','admin','manager','unlisted_actor']) {
        const {context:c,row} = fixture(actor);
        assert.equal(c.resolveCanonicalRowAccess(actor,row).canUploadPhoto,false,actor);
        assert.equal(c.canEditRowDetails('lsn-',row),false,actor);
        assert.equal(c.canCurrentUserWorkRequestItem({...row,UNIQUE_ID:'REQ-foreign'}),false,actor);
        c.GncUserAccessControl.state.userAccess = [];
        assert.equal(c.GncUserAccessControl.resolveUserAccessMatrix(actor).edit_any_row,'N','display roster is not a grant: '+actor);
    }
    const denied = fixture('dylan_collyge',{role:'Admin'});
    assert.equal(denied.context.resolveCanonicalRowAccess('dylan_collyge',denied.row).canEdit,false,'explicit N defeats role defaults');
    const pending = fixture('pending_writer',{edit_any_row:'Y',can_edit_all_rows:'Y',__pendingAccessWrite:true});
    assert.equal(pending.context.resolveCanonicalRowAccess('pending_writer',pending.row).canEdit,false,'an optimistic permission edit is not a saved grant');
}

function assertTableGrantDrivesRealDetailEntry() {
    const {context:c,row} = fixture(' Unlisted_Writer ',{username:'unlisted_writer',edit_any_row:'Y',can_edit_all_rows:'Y'});
    assert.equal(c.canEditRowDetails('lsn-',row),true);
    assert.equal(c.resolveCanonicalRowAccess(c.currentUser,row).canUploadPhoto,true);
    c.activeDetailSourceView = 'av';
    assert.equal(c.isAvDetailReadOnlyContext(),false);
    assert.equal(c.getPrimaryDetailTabForItemContext(row,'av'),'location');
    assert.match(c.buildAuthorizedAvCardActivationAttrs(row,'av',true),/^open-detail:/);
    assert.equal(c.canCurrentUserWorkRequestItem({...row,UNIQUE_ID:'REQ-foreign'},'complete'),true);
    c.hasConfirmedCurrentAccountRevocation = () => true;
    assert.equal(c.canEditRowDetails('lsn-',row),false,'confirmed revocation defeats a retained grant');
    c.hasConfirmedCurrentAccountRevocation = () => false;
    const changed = c.GncUserAccessControl.resolveUserAccessMatrix('unlisted_writer');
    c.GncUserAccessControl.setAccessMatrixRows([{...changed,profile_id:'foreign-profile'}]);
    assert.equal(c.canEditRowDetails('lsn-',row),false,'the matrix belongs to the verified profile');
    c.GncUserAccessControl.setAccessMatrixRows([{...changed,view_permissions:{...changed.view_permissions,view_av:'N'}}]);
    assert.equal(c.isAvDetailReadOnlyContext(),true);
    assert.match(c.buildAuthorizedAvCardActivationAttrs(row,'av',true),/activateAvCardPhotos/);
    c.nativeAuthSessionUserId = 'another-profile';
    assert.equal(c.resolveCanonicalRowAccess(c.currentUser,row).canEdit,false);
}

function assertAccessInstallationPreservesConfirmedRows() {
    const {context:c} = fixture();
    const installed = c.GncUserAccessControl;
    vm.runInContext(read('assets/user-access-control.js'),c);
    assert.equal(c.GncUserAccessControl,installed);
    assert.equal(c.GncUserAccessControl.state.userAccess.length,1);
}

function assertExactAssignedAndRequestScopes() {
    const {context:c,row} = fixture('assigned_eval',{role:'EVAL',edit_assigned_rows_only:'Y',can_edit_assigned_items:'Y'});
    assert.equal(c.resolveCanonicalRowAccess(c.currentUser,row).canEdit,false,'a family alias is not an assignment');
    const owned = {...row,effective_worker:'assigned_eval'};
    assert.equal(c.canEditRowDetails('lsn-',owned),true);
    assert.equal(c.canCurrentUserWorkRequestItem({...owned,DOCK_SUSPEND_DC_REQUEST:true},'photo'),true);
    assert.equal(c.canCurrentUserWorkRequestItem({...row,DOCK_SUSPEND_DC_REQUEST:true},'complete'),false);
    const rep = fixture();
    const own = {...rep.row,UNIQUE_ID:'REQ-own',submitted_by:'profile-current'};
    assert.equal(rep.context.canCurrentUserWorkRequestItem(own,'photo'),true);
    assert.equal(rep.context.canCurrentUserWorkRequestItem({...own,submitted_by:'someone-else'}),false);
    rep.context.requestCapabilityState.capabilities.canComplete = false;
    assert.equal(rep.context.canCurrentUserWorkRequestItem(own,'complete'),false,'a current exact action denial is authoritative');
    rep.context.requestCapabilityState.capabilities.canComplete = true;
    rep.context.requestCapabilityState.capabilities.scope = 'global';
    assert.equal(rep.context.canCurrentUserWorkRequestItem({...own,submitted_by:'someone-else'}),false,'global visibility never grants a foreign write');
    rep.context.requestCapabilityState.capabilities.canViewQueue = false;
    assert.equal(rep.context.canCurrentUserWorkRequestItem(own,'edit'),false,'a current matching queue denial defeats contradictory action flags');
    rep.context.requestCapabilityState.capabilities.canViewQueue = true;
    rep.context.nativeAuthProfile.active = false;
    assert.equal(rep.context.canCurrentUserWorkRequestItem(own),false);
}

async function assertCanonicalPublisherChecksTheTablePolicy() {
    const {context:c,row} = fixture();
    let published = 0;
    c.publishRequestWorkEvaluation = async () => { published++; return {status:'saved'}; };
    const source = read('assets/row-workflow-functions.js');
    const node = parseExpressionAt(source,source.indexOf('async function publishRowEvaluationToMasterAndNotes('),{ecmaVersion:'latest'});
    vm.runInContext(source.slice(node.start,node.end),c);
    await assert.rejects(c.publishRowEvaluationToMasterAndNotes({...row,UNIQUE_ID:'REQ-foreign'},{req_spec:'size'},
        {requestWork:true,complete:false}),/ROW_EVALUATION_FORBIDDEN/);
    assert.equal(published,0);
    assert.equal((await c.publishRowEvaluationToMasterAndNotes({...row,UNIQUE_ID:'REQ-own',submitted_by:'profile-current'},
        {req_spec:'size'},{requestWork:true,complete:false})).status,'saved');
    assert.equal(published,1);
    const matrix = c.GncUserAccessControl.resolveUserAccessMatrix(c.currentUser);
    c.GncUserAccessControl.setAccessMatrixRows([{...matrix,view_permissions:{...matrix.view_permissions,view_que:'N'}}]);
    await assert.rejects(c.publishRowEvaluationToMasterAndNotes({...row,UNIQUE_ID:'REQ-own',submitted_by:'profile-current'},
        {req_spec:'size'},{requestWork:true,complete:false}),/ROW_EVALUATION_FORBIDDEN/);
    assert.equal(published,1);
}

export async function assertTableDrivenRowAuthorization() {
    assertNoNameCanGrantAuthority();
    assertTableGrantDrivesRealDetailEntry();
    assertAccessInstallationPreservesConfirmedRows();
    assertExactAssignedAndRequestScopes();
    await assertCanonicalPublisherChecksTheTablePolicy();
    await assertLegacySessionUsesServerAccessReceipt();
    await assertLegacySessionRejectsDeniedAndLateReceipts();
}

function legacySessionFixture() {
    const {context:c,row} = fixture('legacy_authorized_actor');
    c.nativeAuthSessionActive = false;
    c.nativeAuthProfile = null;
    c.navigator = {onLine:true};
    c.sessionRecord = {token:'valid-app-session',expiresAt:Date.now()+60000,username:c.currentUser,role:'ADMIN'};
    c.readPersistedAppSessionRecord = () => c.sessionRecord;
    c.getCurrentAppSessionToken = () => c.sessionRecord?.token || '';
    c.canonicalUserAccessAccount = '';
    c.canonicalUserAccessRevision = 0;
    c.refreshNavigationDisplayCache = () => {};
    c.APP_API_FUNCTION_URL = 'https://fixture.invalid';
    c.document = {getElementById:() => null};
    for (const name of ['invalidateRequestViewResolvedCaches','applyRolePermissions','updateFooterNavState','promoteNavigationDisplayAfterAccess']) c[name] = () => {};
    c.isViewVisible = () => false;
    c.shouldRedirectForConfirmedViewDenial = () => false;
    c.initializeAppAccessSnapshot = async () => null;
    c.getRequestMappedRepDirectory = () => ({options:[]});
    const permissions = Object.fromEntries(c.GncUserAccessControl.permissionKeys.map(key => [key,key.startsWith('can_access_') && !key.includes('manager') && !key.includes('eval_reports')]));
    const response = {ok:true,profile:{id:'legacy-profile',username:c.currentUser,role:'REP',display_name:'Server Actor'},
        baseline:{role:'REP',permissions},effective_permissions:permissions,permission_overrides:{},revision:1,
        data_hydration_policy:{use_shared_instant_snapshot:true,av_season_rule:'all',av_visibility_rule:'role'},
        matrix:{username:c.currentUser,profile_id:'legacy-profile',role:'REP',edit_any_row:'N',edit_assigned_rows_only:'Y',
            view_permissions:{view_drive_mode:'Y',view_av:'Y',view_que:'Y'}}};
    c.postAppFunctionJson = async (_url,envelope) => {
        assert.equal(envelope.action,'user_access');
        assert.equal(envelope.operation,'resolve');
        return response;
    };
    vm.runInContext(extractGoldenFunction(read('assets/app-runtime.js'),'configureCanonicalUserAccess'),c);
    row.eval_user = c.currentUser;
    return {c,row,response};
}

async function assertLegacySessionUsesServerAccessReceipt() {
    const {c,row,response} = legacySessionFixture();
    assert.equal(c.canEditRowDetails('lsn-',row),false,'local session/display/matrix state is not write proof');
    await c.configureCanonicalUserAccess();
    assert.equal(c.GncUserAccessControl.getSelfState().verified,true);
    assert.equal(c.canEditRowDetails('lsn-',row),true,'eligible app-only session uses the existing authenticated resolver');
    const own = {...row,UNIQUE_ID:'REQ-own',eval_user:'other',submitted_by:'legacy-profile'};
    assert.equal(c.canCurrentUserWorkRequestItem(own,'complete'),true);
    assert.equal(c.canCurrentUserWorkRequestItem({...own,submitted_by:'other'},'edit'),false);
    c.navigator.onLine = false;
    assert.equal(c.canEditRowDetails('lsn-',row),false,'offline retained access is display-only');
    c.navigator.onLine = true;
    c.sessionRecord = {...c.sessionRecord,token:'another-app-session'};
    assert.equal(c.GncUserAccessControl.getSelfState().verified,false,'a response cannot cross app sessions');
    assert.equal(c.canEditRowDetails('lsn-',row),false);
    await c.configureCanonicalUserAccess();
    c.postAppFunctionJson = async () => { throw new Error('NETWORK'); };
    await c.GncUserAccessControl.loadSelf({force:true});
    assert.equal(c.canEditRowDetails('lsn-',row),false,'a stale server receipt cannot authorize app-only writes');
    c.postAppFunctionJson = async () => response;
    await c.GncUserAccessControl.loadSelf({force:true});
    c.currentUser = 'someone_else';
    assert.equal(c.canEditRowDetails('lsn-',row),false,'cached identity cannot cross users');
    c.currentUser = response.profile.username;
    c.sessionRecord.expiresAt = Date.now()-1;
    assert.equal(c.canEditRowDetails('lsn-',row),false,'an expired app session cannot reuse server proof');
}

async function assertLegacySessionRejectsDeniedAndLateReceipts() {
    const {c,row,response} = legacySessionFixture();
    await c.configureCanonicalUserAccess();
    response.matrix.view_permissions = {view_drive_mode:'N',view_av:'N',view_que:'N'};
    await c.GncUserAccessControl.loadSelf({force:true});
    assert.equal(c.canEditRowDetails('lsn-',row),false,'server module N defeats an eligible app-session identity');
    assert.equal(c.canCurrentUserWorkRequestItem({...row,submitted_by:'legacy-profile'},'complete'),false);
    let release;
    c.postAppFunctionJson = () => new Promise(resolve => { release = resolve; });
    const late = c.GncUserAccessControl.loadSelf({force:true});
    c.sessionRecord = {...c.sessionRecord,token:'new-app-session'};
    response.matrix = {...response.matrix,edit_any_row:'Y',can_edit_all_rows:'Y',view_permissions:{view_drive_mode:'Y'}};
    release(response);
    await late;
    assert.equal(c.GncUserAccessControl.getSelfState().verified,false,'a late server reply belongs to its dispatched token');
    assert.equal(c.canEditRowDetails('lsn-',row),false);
    assert.equal(c.GncUserAccessControl.resolveUserAccessMatrix(c.currentUser).edit_any_row,'N','late transport cannot replace the matrix');
    c.postAppFunctionJson = async () => ({...response,profile:{...response.profile,username:'foreign-user'}});
    await c.configureCanonicalUserAccess();
    assert.equal(c.GncUserAccessControl.getSelfState().verified,false,'a mismatched server profile cannot verify local identity');
    assert.equal(c.canEditRowDetails('lsn-',row),false);
}
