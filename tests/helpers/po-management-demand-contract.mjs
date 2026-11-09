import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const asset = name => readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8');

export async function assertDemandOnlyPoManagement() {
    const reads = [], committed = [];
    const context = vm.createContext({ poManagementState: { season: '27S1', loaded: false },
        shouldUseProductionLiveSyncSideLoad: () => true, isViewVisible: () => false });
    for (const file of ['live-sync-registry', 'live-sync-adapters', 'po-management-live']) vm.runInContext(asset(file), context);
    const bindings = { 'side:po': { scope: value => value.poSeason,
        stage: async value => { reads.push(value.poSeason); return ['verified PO']; },
        commit: value => { committed.push(value); } } };
    const adapters = context.AgMetricLiveSyncAdapters.create(bindings, context.AgMetricLiveSyncRegistry);
    for (const view of ['home', 'drive', 'av', 'hl-order']) {
        assert.equal(adapters.getAdapter('side:po', { view, poSeason: '27F1' }), null);
    }
    assert.deepEqual(reads, []);
    const [foreground] = adapters.getViewAdapters('po-management', { view: 'po-management', poSeason: '27F1' });
    assert.equal(foreground.id, 'side:po');
    foreground.commit(await foreground.stage());
    context.ensureProductionLiveSyncSideData = async (id, force, options) => {
        assert.equal(id, 'po');
        assert.equal(force, true);
        const explicit = adapters.getAdapter('side:po', { view: 'hl-order', ...options.context });
        explicit.commit(await explicit.stage());
    };
    await context.loadPoManagementData(true);
    assert.deepEqual(reads, ['27F1', '27S1']);
    assert.deepEqual(committed, [['verified PO'], ['verified PO']]);
}
