import { getDockOrderBusinessKey } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

export const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
export const rows = read('assets/row-workflow-functions.js') + '\n' + read('assets/suspend-exact-owner.js') + '\n' + read('assets/canonical-row-unlock.js');
export const runtime = read('assets/app-runtime.js');
const rowAccess = read('src/engine/row-access-policy.js').replace(/^export /gm,'');
export function fixture(names, extra = {}) {
    const ctx = vm.createContext({
        currentUser: 'chris_fisher', currentRole: 'EVAL', fullInventory: [], getDockOrderBusinessKey,
        activeDetailSourceView:'drive',lastView:'drive',nativeAuthSessionActive:true,nativeAuthSessionUserId:'fixture-profile',
        nativeAuthProfile:{id:'fixture-profile',username:'chris_fisher',role:'EVAL',active:true},
        isDockSuspendDcRequestMirrorRow: () => false, isDockSuspendDcRequestSource: () => false,
        getDockSuspendToValue: row => String(row.suspend_to || '').toLowerCase(),
        getManagerAssignedColumnState: () => state, resolveUserAccessMatrix: () => ({verified:true,profile_id:'fixture-profile',role:'EVAL',
            edit_any_row:'N',edit_assigned_rows_only:'Y',view_permissions:{view_drive_mode:'Y',view_av:'Y',view_que:'Y'}}),
        buildManagerEvalAssignmentKey: code => String(code || '').trim().toUpperCase(),
        EVAL_TASK_USER_ALIASES: { nally_aguilar: 'nelly_aguilar', charlie_robertson: 'charley_robertson', kayla_knapp: 'kayla_knepp', abigail_vasquez: 'abigail_vazquez' },
        ...extra
    });
    vm.runInContext(rowAccess,ctx);
    Object.assign(ctx,extra);
    const state = { itemcodeDefaultOwners: new Map([['004380.010.1','chris_fisher'],['004424.020.1','chris_fisher'],['001973.030.1','other_eval']]) };
    for (const name of names) {
        if (typeof ctx[name] === 'function') continue;
        const marker = 'function ' + name + '(';
        const source = rows.includes(marker) ? rows : runtime;
        const at = source.indexOf(marker);
        assert.ok(at >= 0, name);
        const start = source.lastIndexOf('\n', at) + 1;
        const indent = source.slice(start, at).replace('async ', '');
        const end = source.indexOf('\n' + indent + '}', at) + indent.length + 2;
        vm.runInContext(source.slice(start, end), ctx);
    }
    return {ctx, state};
}
export const engines = ['normalizeSuspendOwnerCode','validSuspendOwner','suspendOwnerFromRow','resolveSuspendOwnerFallback','collectSuspendOwnerCandidates','resolveSuspendOwner','resolveExactSuspendOwner','normalizeEvalAssignableUser','getCardEvalOwnerIndex','getAssignedQueueOwner','resolveInventoryRowOwner','resolveCanonicalRowAccess','canUserReclassRow','canUserUnlockRow','canUserEditRow','canUserUploadRowPhoto'];
