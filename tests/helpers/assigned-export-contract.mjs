import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export async function assertAssignedExportSnapshot() {
    const state = {filters:{},viewMode:'rows'};
    const rows = Array.from({length:9695}, (_,index) => ({ITEMCODE:String(index),
        ASSIGNEDTO:index % 3 === 0 ? 'megan_kelly' : 'dylan_collyge', COMMONNAME:index % 7 === 0 ? 'Rose' : 'Acer'}));
    const exports = [];
    const context = vm.createContext({
        getManagerAssignedColumnState:() => state,
        managerEvalAssignmentSelection:new Set(), managersSearchTerm:'',
        getManagerAssignedItemsActiveAssigneeKey:() => 'all',
        rememberManagerAssignedColumnLabels:() => null,
        getManagerAssignedFilterCandidates:() => ({required:[]}),
        matchesManagerAssignedColumnFilters:row => Object.entries(state.filters)
            .every(([field,values]) => values.includes(row[field].toLowerCase())),
        sortManagerAssignedColumnRows:values => values,
        canViewAssignedItemsExport:() => true,
        getSupabaseReadIdentityScope:() => 'fixture',
        isMasterFullProjectionReady:() => true,
        ensureDatasetLoaded:() => { throw Error('An in-memory export must not wait for warehouse pages.'); },
        getManagerAssignedColumnDefinitions:() => [['ASSIGNEDTO','Effective Worker'],['DEFAULT_ASSIGNEDTO','Itemcode Default Owner'],
            ['WAREHOUSEI','Warehouse'],['LOCATIONCODE','Location'],['ITEMCODE','Item Code'],['CONTSIZE','Container Size'],
            ['COMMONNAME','Common Name'],['GENUSNAME','Genus Name']],
        downloadExcelWorkbook:(columns,values) => exports.push({columns,rows:values})
    });
    const source = fs.readFileSync(new URL('../../src/ui/assigned-items-dataset.js',import.meta.url),'utf8');
    vm.runInContext(source.replace(/^export /gm,''),context);
    context.getManagerAssignedItemsDisplayRows = () => rows;
    await context.exportManagerAssignedItemsToExcel();
    assert.equal(exports[0].rows.length,9695);
    assert.equal(exports[0].columns.length,8);
    state.filters = {ASSIGNEDTO:['megan_kelly']};
    await context.exportManagerAssignedItemsToExcel();
    assert.equal(exports[1].rows.length,3232);
    assert.ok(exports[1].rows.every(row => row.ASSIGNEDTO === 'megan_kelly'));
    state.filters = {COMMONNAME:['rose']};
    await context.exportManagerAssignedItemsToExcel();
    assert.equal(exports[2].rows.length,1385);
    context.canViewAssignedItemsExport = () => false;
    await context.exportManagerAssignedItemsToExcel();
    assert.equal(exports.length,3);
}
