import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../../' + file, import.meta.url), 'utf8');

function classicFunction(source, name) {
    const match = source.match(new RegExp('^( *)function ' + name + '\\([^]*?^\\1}', 'm'));
    assert.ok(match, name);
    return match[0];
}

function restoreOlderOfficeSelection(context) {
    Object.assign(context, {
        activeMovesTab: 'main', activeInventoryOfficeApprovalType: 'move-up', managerMoveCardSearchTerm: '',
        managerMoveCardSelectedCommonName: '', managerMoveCardSelectedContSize: '',
        managerMoveCardSelectedSalesYear: '', managerMoveInstructionText: '',
        appFilterText: (value, fallback) => String(value ?? fallback),
        appFilterNumber: (value, fallback) => Number(value ?? fallback),
        appFilterNullableText: value => value ?? null
    });
    const restore = classicFunction(read('assets/app-filter-restore.js'), 'restoreMovesFilters');
    vm.runInContext(restore + '\nrestoreMovesFilters({activeMovesTab:"office",activeInventoryOfficeApprovalType:"crop-roll"});', context);
    assert.equal(context.activeMovesTab, 'office');
    assert.equal(context.activeInventoryOfficeApprovalType, 'move-up');
}

export function assertCropRollRetiredFromLiveApp() {
    const context = vm.createContext({ isFullAppAdministrator() { throw Error('Retired route consulted access'); } });
    const runtime = read('assets/app-runtime.js');
    const route = classicFunction(runtime, 'canAccessView');
    const office = classicFunction(runtime, 'normalizeInventoryOfficeApprovalType');
    const ncr = classicFunction(runtime, 'normalizeNcrApprovalType');
    vm.runInContext([read('assets/live-sync-registry.js'), route, office, ncr].join('\n'), context);
    const registry = context.AgMetricLiveSyncRegistry;
    for (const view of ['crop-roll', 'manager-crop-roll']) {
        assert.equal(context.canAccessView(view), false);
        assert.throws(() => registry.getViewAdapters(view), /Unregistered live-sync view/);
    }
    for (const view of ['moves', 'managers']) {
        assert.throws(() => registry.getViewAdapters(view, {surfaces:[view + ':crop-roll']}), /Unregistered live-sync surface/);
    }
    assert.ok(registry.getViewAdapters('move-up').includes('core:master'));
    assert.ok(registry.getViewAdapters('request').includes('core:requests'));
    assert.ok(registry.getViewAdapters('av').includes('core:master'));
    assert.ok(registry.sourceKeys.every(key => !/crop_roll/i.test(key)));
    assert.doesNotMatch(read('index.html'), /drawer-crop-roll|view-crop-roll|inventory-open-crop-roll|moves-office-tab-crop-roll|dtab-crop-roll|det-crop-roll/);
    restoreOlderOfficeSelection(context);
}
