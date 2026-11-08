import { getDockOrderBusinessKey } from './dock-order-domain.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

export const read = file => fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
export const rows = read('assets/row-workflow-functions.js');
export const runtime = read('assets/app-runtime.js');
export function fixture(names, extra = {}) {
    const ctx = vm.createContext({
        GLOBAL_LIVE_CHANGE_USER_KEYS: new Set(['dylan_collyge','megan_kelly','jd_jones','mitch_kaiser','nelly_aguilar','morgan_anderson']),
        currentUser: 'chris_fisher', currentRole: 'EVAL', fullInventory: [], getDockOrderBusinessKey,
        isDockSuspendDcRequestMirrorRow: () => false, isDockSuspendDcRequestSource: () => false,
        getDockSuspendToValue: row => String(row.suspend_to || '').toLowerCase(),
        getManagerAssignedColumnState: () => state, resolveUserAccessMatrix: () => ({}),
        buildManagerEvalAssignmentKey: code => String(code || '').trim().toUpperCase(),
        EVAL_TASK_USER_ALIASES: { nally_aguilar: 'nelly_aguilar', charlie_robertson: 'charley_robertson', kayla_knapp: 'kayla_knepp', abigail_vasquez: 'abigail_vazquez' },
        ...extra
    });
    const state = { itemcodeDefaultOwners: new Map([['004380.010.1','chris_fisher'],['004424.020.1','chris_fisher'],['001973.030.1','other_eval']]) };
    for (const name of names) {
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
export const engines = ['resolveSuspendOwner','normalizeEvalAssignableUser','getCardEvalOwnerIndex','getAssignedQueueOwner','resolveInventoryRowOwner','resolveCanonicalRowAccess','canUserReclassRow','canUserUnlockRow','canUserEditRow','canUserUploadRowPhoto'];
