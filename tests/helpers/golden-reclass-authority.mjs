import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const policy = fs.readFileSync(new URL('../../assets/reclass-access-policy.js', import.meta.url), 'utf8');
const actorKey = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

export function withGoldenReclassAuthority(context) {
    const state = context.argosInventoryTransactionState;
    const uid = state?.snapshot?.uniqueId || 'row';
    const row = { UNIQUE_ID: uid, ITEMCODE: 'ITEM', LOCATIONCODE: 'A.01', LOTCODE: '27.F1', SEASON: 'F1' };
    if (state) {
        state.item ||= row;
        state.inquiryModel ||= { locationRows: [{ unique_id: uid, sourceRow: row }] };
    }
    context.currentUserDisplay ||= context.currentUser;
    context.argosInventoryTransactionState ||= null;
    context.normalizeEvidenceActor ||= actorKey;
    context.nativeAuthProfile ||= { id: 'golden-profile', username: context.currentUser, role: 'eval', active: true };
    context.getCanonicalAccessSessionIdentity ||= () => ({ id: 'golden-profile', username: actorKey(context.currentUser), authenticated: true });
    context.resolveUserAccessMatrix ||= () => ({ username: actorKey(context.currentUser), profile_id: 'golden-profile',
        role: 'eval', verified: true, view_permissions: { view_drive_mode: 'Y' } });
    context.GncUserAccessControl ||= { getSelfState: () => ({ denied: false }) };
    context.getArgosReclassRowEditorEntry ||= key => state?.inquiryModel?.locationRows.find(entry => entry.unique_id === key);
    context.isEvalReclassRowAssigned ||= () => true;
    vm.createContext(context);
    vm.runInContext(policy, context);
    return context;
}

export function assertGoldenEvalReclassBoundaries({ runFunctions, functionSource, read }) {
    const context = runFunctions('assets/app-runtime.js', ['isEvalReclassRowAssigned', 'isWarehouseAssignedDriveCardForCurrentUser', 'canCurrentUserUseDriveCardOptions'], {
        currentRole: 'Evaluator', currentUser: 'taylor_eval', currentUserDisplay: 'Taylor Eval',
        getRoleAccessState: () => ({ isEval: true, isAdmin: false }),
        canUserReclassRow: (user, row) => context.isRowAssignedToUser(user, row),
        canUserMakeLiveChangesOnRow: (user, row) => context.isRowAssignedToUser(user, row),
        isAlwaysDriveCardOptionsUser: () => false,
        isRowAssignedToUser: (user, row) => actorKey(user) === 'taylor_eval' && row?.unique_id === 'assigned',
        firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '') ?? '', showToast() {},
    });
    withGoldenReclassAuthority(context);
    for (const assigned of [true, false]) {
        const row = { unique_id: assigned ? 'assigned' : 'other', SEASON: 'F1', LOTCODE: '27.F1' };
        assert.equal(context.canCurrentUserUseDriveCardOptions(row, 'drive'), assigned);
        assert.equal(context.isEvalReclassRowAssigned('taylor_eval', row), assigned);
        assert.equal(context.authorizeArgosReclassRow(row, 'drive', 'open'), assigned);
    }
    const y = { unique_id: 'other', SEASON: 'Y', LOTCODE: '27.Y' };
    assert.equal(context.authorizeArgosReclassRow(y, 'drive', 'open'), false);
    const matrix = { username: context.currentUser, profile_id: 'golden-profile', role: 'Admin', verified: true, view_permissions: {} };
    context.resolveUserAccessMatrix = () => matrix;
    assert.equal(context.authorizeArgosReclassRow(y, 'drive', 'open'), true);
    assert.equal(context.authorizeArgosReclassRow({ ...y, SEASON: 'F1', LOTCODE: '27.F1' }, 'drive', 'open'), false);
    matrix.view_permissions.view_drive_mode = 'N';
    assert.equal(context.authorizeArgosReclassRow(y, 'drive', 'open'), false);
    delete matrix.view_permissions.view_drive_mode;
    matrix.profile_id = 'foreign';
    assert.equal(context.authorizeArgosReclassRow(y, 'drive', 'open'), false);
    assert.match(functionSource('assets/app-runtime.js', 'canSubmitArgosReclassForRow'), /authorizeArgosReclassSubmissionRows\(payload, state\)/);
    assert.match(read('supabase/functions/app-api/reclass-inquiry-transport.ts'), /authorize_reclass_command_v3076/);
    assert.match(read('supabase/migrations/20261111180000_agdata3076_reclass_y_authority.sql'), /edit_assigned_rows_only[\s\S]*inventory_row_assigned_to_actor_v2392/);
}

export function assertGoldenReclassExplanations({ functionSource }) {
    const drafts = { a: { reclassExplanation: '  ' }, b: { reclassExplanation: '  Wrong grade  ' } };
    const matrix = { username: 'manager', profile_id: 'golden-profile', role: 'Manager', verified: true, view_permissions: {} };
    const context = withGoldenReclassAuthority({ currentUser: 'manager', getArgosReclassRowProposalMap: uid => drafts[uid],
        resolveUserAccessMatrix: () => matrix, getArgosReclassRowEditorEntry: uid => ({ sourceRow: { UNIQUE_ID: uid, LOTCODE: '27.F1', SEASON: 'F1' } }),
        focusArgosReclassRow() {}, document: { querySelectorAll: () => [] }, showToast() {}, escapeHtml: value => String(value).replaceAll('<', '&lt;') });
    vm.runInContext(['isReclassExplanationExempt', 'getReclassExplanation', 'requireReclassExplanation', 'buildReclassExplanationField', 'collectReclassExplanations']
        .map(name => functionSource('assets/row-workflow-functions.js', name)).join('\n'), context);
    for (const role of ['EVAL', 'QC', 'QC Supervisor', 'Manager', 'CSR', 'REP', 'Foreman', 'data entry', '']) {
        matrix.role = role;
        assert.equal(context.requireReclassExplanation('a'), false);
        assert.equal(context.requireReclassExplanation('b'), true);
    }
    assert.match(context.buildReclassExplanationField('a'), /Reclass Explanation \* \(Required\)/);
    assert.throws(() => context.collectReclassExplanations({ rowOverlays: [{ unique_id: 'a', proposals: [{}] }, { unique_id: 'b', fieldEdits: [{}] }] }), /Reclass Explanation is required/);
    assert.deepEqual(JSON.parse(JSON.stringify(context.collectReclassExplanations({ rowOverlays: [{ unique_id: 'a', proposals: [] }, { unique_id: 'b', fieldEdits: [{}] }] }))), { b: 'Wrong grade' });
    for (const role of ['admin', 'SUPER_ADMIN', ' super admin ']) {
        matrix.role = role;
        assert.equal(context.requireReclassExplanation('a'), true);
        assert.match(context.buildReclassExplanationField('a'), /Optional for Admin/);
    }
    matrix.role = 'Manager';
    matrix.username = context.currentUser = context.nativeAuthProfile.username = 'dylan_collyge';
    context.nativeAuthProfile.role = 'Admin';
    assert.equal(context.requireReclassExplanation('a'), false, 'a name or stale profile role cannot grant exemption');
    matrix.role = 'Admin';
    matrix.profile_id = 'foreign';
    assert.equal(context.requireReclassExplanation('a'), false, 'the table grant must belong to the verified actor');
}
