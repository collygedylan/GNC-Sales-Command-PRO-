import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readComposedRuntimeSource } from '../../scripts/composed-app-source.mjs';

const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const runtime = readComposedRuntimeSource();
function declaration(name) {
    const start = runtime.indexOf('function ' + name + '(');
    assert.ok(start >= 0, `missing ${name}`);
    const indent = runtime.slice(runtime.lastIndexOf('\n', start) + 1, start);
    const end = runtime.indexOf('\n' + indent + '}', start);
    assert.ok(end > start, `unterminated ${name}`);
    return runtime.slice(start, end + indent.length + 2);
}

export function queueOwnerContract() {
    const ctx = vm.createContext({
        currentUser: 'chris_fisher', currentUserDisplay: 'Chris Fisher', currentRole: 'EVAL', safeRole: 'EVAL',
        activeReqTab: 'pending', requestsInventory: [], requestScopedItemsCacheKey: '', requestScopedItemsCache: null,
        resolvedViewStateEpoch: 1, getDatasetLoadSignature: () => 'fixture', incrementInternalPerfCounter: () => {},
        warehouseAssignedItemsInventory: [], rebuildWarehouseAssignedItemIndexes: () => {},
        normalizeLiveChangeUsername: value => String(value || '').trim().toLowerCase().replaceAll(' ', '_'),
        normalizeWarehouseAssignedCompactPart: value => String(value || '').trim().toUpperCase(),
        firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') || '',
        getWarehouseAssignedIdentityParts: () => ({ itemcode: '' }),
        resolveSuspendOwner: row => String(row?.ITEMCODE || '').startsWith('004380') ? 'chris_fisher' : 'someone_else',
        resolveUserAccessMatrix: () => ({ edit_assigned_rows_only: 'Y' }),
        getRoleAccessState: () => ({ isEval: true }),
        isEvalTaskItem: () => false, hasEvalTaskRequestMeta: () => false,
        isWarehouseAssignedDriveCardForCurrentUser: () => false,
        getRequestCapabilities: () => ({ canViewQueue: true, scope: 'global' }),
        canViewAllRequests: () => false,
        getRequestAssignedItemcodeScope: () => new Set(['A']),
        getRequestAssignedItemcodeScope: () => new Set(['A']),
        doesCurrentUserOwnCreatedRequestItem: row => row?.submitted_by === 'test_eval',
        isRequestPendingVisible: () => true,
        isRegularRequestQueueItem: () => true,
        canReadSuspendQueue: () => false,
        normalizeEvalAssignableUser: value => String(value || '').trim().toLowerCase().replaceAll(' ', '_'),
        getRequestTabQueueCounts: () => ({ pending: 0, 'suspend-tag': 7, moves: 12, recount: 4, 'shear-list': 5, 'eval-work': 2, 'bunch-notes': 3, 'bunch-count-review': 1 })
    });
    vm.runInContext([
        'isRowAssignedToUser', 'canUserMakeLiveChangesOnRow',
        'canUseRequestSuspendTagAssignedToFilter', 'getScopedRequestItems',
        'getRequestQueueAlertCount'
    ].map(declaration).join('\n'), ctx);
    const row = { ITEMCODE: '004380.010.1', LOCATIONCODE: 'C.09.000' };
    assert.equal(ctx.isRowAssignedToUser('chris_fisher', row), true, 'canonical Assigned Items owner resolves exact itemcode');
    assert.equal(ctx.canUserMakeLiveChangesOnRow('chris_fisher', row), true,
        'the shared edit authorization accepts the canonical Assigned Items owner');
    assert.match(declaration('canRestrictedEvalUserUpdateItem'), /canUserMakeLiveChangesOnRow\(actor, item\)/,
        'photo and row edit gates call the shared assigned-row authorization');
    assert.equal(ctx.canUserMakeLiveChangesOnRow('chris_fisher', { ITEMCODE: '009999.010.1' }), false,
        'an unrelated item remains restricted');

    const rows = [
        { UNIQUE_ID: 'assigned', ITEMCODE: 'A' },
        { UNIQUE_ID: 'submitted-unassigned', ITEMCODE: 'B', submitted_by: 'test_eval' },
        { UNIQUE_ID: 'other-owner', ITEMCODE: 'D' }
    ];
    ctx.currentUser = 'test_eval';
    ctx.currentRole = 'EVAL';
    ctx.getRoleAccessState = () => ({ isEval: true });
    ctx.getManagerAssignedItemsDisplayRows = () => [{ ITEMCODE: 'A', effective_worker: 'test_eval' }];
    ctx.requestsInventory = rows;
    ctx.requestScopedItemsCacheKey = '';
    assert.deepEqual(Array.from(ctx.getScopedRequestItems(rows, { strictQueueVisibility: true }), item => item.UNIQUE_ID), ['assigned']);
    assert.equal(ctx.getRequestQueueAlertCount(), 7, 'non-admin badge counts only owned Request and Suspend rows');
    assert.equal(ctx.canUseRequestSuspendTagAssignedToFilter(), false, 'non-admins cannot switch the queue owner');
    ctx.currentUser = 'jd_jones';
    assert.equal(ctx.canUseRequestSuspendTagAssignedToFilter(), true, 'authorized queue administrators retain all-owner filtering');

    const css = read('assets/app-shell-style-16.css');
    assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(css, /height:\s*16px;[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis/);
    assert.match(css, /height:\s*40px;[^}]*-webkit-appearance:\s*none;[^}]*appearance:\s*none/);
    assert.match(css, /align-items:\s*end/);

    const sql = read('supabase/migrations/20261103143000_v23154_owner_master_mirror.sql');
    assert.match(sql, /set default_owner=a\.default_assignedto, effective_worker=a\.assignedto, eval_user=a\.assignedto/);
    assert.match(sql, /a\.master_unique_id=m\.unique_id and a\.present_in_drive/);
    assert.match(sql, /a\.itemcode_normalized=any\(changed_itemcodes\)/);
    assert.match(sql, /is distinct from\s*\(a\.default_assignedto,a\.assignedto,a\.assignedto\)/);
    assert.match(sql, /SET LOCAL lock_timeout = '4s'/);
    assert.match(sql, /SET LOCAL statement_timeout = '15s'/);
}
