import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(name) {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `Missing live implementation: ${name}`);
  const end = html.indexOf('\n        function ', start + 1);
  assert.ok(end > start, `Missing boundary: ${name}`);
  return html.slice(start, end);
}
const pureNames = [
  'normalizeManagerEvalReport2HeaderFilterValue', 'getManagerEvalReport2HeaderRowValue',
  'getManagerEvalReport2HeaderSelections', 'getManagerEvalReport2HeaderFilterKey',
  'hasManagerEvalReport2HeaderFilters', 'doesManagerEvalReport2RowMatchHeaderFilters',
  'resetManagerEvalReport2HeaderFilters', 'getManagerEvalReport2HeaderFilterOptions',
  'getManagerEvalReport2RowsBeforeCommonName', 'getFilteredManagerEvalReport2Rows',
  'getManagerEvalReport2DrillGroups', 'getManagerEvalReport2VisibleItemGroups',
  'getManagerEvalReport2SelectedRows',
];
function harness(rows, reportRows = rows) {
  const context = vm.createContext({
    Map, Set, JSON, Object, Array, String,
    MANAGER_EVAL2_HEADER_COLUMNS: ['plantgroupcode','contsize','genusname'],
    managerEvalReport2HeaderFilters: { plantgroupcode:new Set(), contsize:new Set(), genusname:new Set() }, managerEvalReport2HeaderMenuDrafts:{},
    managerEvalReport2CacheKey:'fixture', managerEvalReport2VisibleGroupsCacheKey:'', managerEvalReport2VisibleGroupsCache:[],
    managerEvalReport2AssignmentFilterRefreshing:false, managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    managerEvalReport2BrowseMode:'plant', managerEvalReport2DrillLevel:0, managerEvalReport2SelectedBlockAlpha:'',
    managerEvalReport2SelectedLocationCode:'', managerEvalReport2SelectedCommonName:'', managerEvalReport2SelectedContSize:'',
    managersSearchTerm:'', selectedSeasons:new Set(), selectedEntries:[], reportRows,
    compareManagerEvalReport2Natural: (a,b) => String(a).localeCompare(String(b), undefined, { numeric:true, sensitivity:'base' }),
    getManagerEvalReport2Rows: () => context.reportRows,
    getManagerEvalReport2SelectedReportIds: () => ['u1'],
    getManagerEvalAssignedUsers: () => ['dylan_collyge'],
    managerEvalAssignedUserMatches: row => row.ASSIGNEDTO !== 'other',
    getManagerEvalReport2SeasonFilters: () => context.selectedSeasons,
    getManagerEvalReport2SeasonFilterKey: () => [...context.selectedSeasons].sort().join('|') || 'all',
    doesManagerEvalReport2RowMatchSeasonFilter: (row,seasons) => !seasons.size || seasons.has(row.SEASON),
    getManagerEvalReportRowLocation: row => row.LOCATIONCODE,
    getManagerEvalReportRowPriority: row => row.PRIORITY || '',
    managerEvalReportRowMatchesSearch: row => !context.managersSearchTerm || row.COMMONNAME.toLowerCase().includes(context.managersSearchTerm.toLowerCase()),
    normalizeSearchValue: value => String(value).toLowerCase().trim(),
    getDriveBlockAlphaValue: row => row.LOCATIONCODE.split('.')[0],
    getDriveBlockAlphaLabel: value => value,
    getManagerEvalReport2ItemCode: row => row.ITEMCODE,
    getManagerEvalReportRowCommonName: row => row.COMMONNAME,
    getManagerEvalReportRowContSize: row => row.CONTSIZE || '-',
    getManagerEvalReportRowAssignedToUsers: row => [row.ASSIGNEDTO || 'dylan_collyge'],
    getManagerEvalReport2RowKey: row => row.UNIQUE_ID,
    getManagerEvalReport2AllCurrentAssignedRows: item => rows.filter(row => row.ITEMCODE === item),
    getManagerEvalReport2ItemKey: item => item,
    getManagerEvalReport2ItemReportIds: () => ['u1'],
    getManagerEvalReport2SelectedEntries: () => context.selectedEntries,
  });
  vm.runInContext(pureNames.map(extract).join('\n'), context);
  context.select = values => {
    context.managerEvalReport2HeaderFilters = Object.fromEntries(['plantgroupcode','contsize','genusname'].map(kind => [kind,new Set((values[kind] || []).map(context.normalizeManagerEvalReport2HeaderFilterValue))]));
  };
  return context;
}
const row = (id, patch={}) => ({ UNIQUE_ID:id, ITEMCODE:'ITEM.A', COMMONNAME:'Sample Plant', PLANTGROUPCODE:'330_TREES', CONTSIZE:'#3', GENUSNAME:'Acer', SEASON:'U1', LOCATIONCODE:'A.01.001', PRIORITY:'1', ...patch });
const plain = value => JSON.parse(JSON.stringify(value));

test('header row matching uses OR within each column and AND across all columns', () => {
  const context = harness([]);
  context.select({ plantgroupcode:['330_TREES','210_SHRUBS'], contsize:['#3','#5'], genusname:['Acer','Rosa'] });
  for (const group of ['330_TREES','210_SHRUBS']) for (const size of ['#3','#5']) for (const genus of ['Acer','Rosa']) {
    assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('match',{PLANTGROUPCODE:group, CONTSIZE:size, GENUSNAME:genus})), true);
  }
  for (const patch of [{PLANTGROUPCODE:'OTHER'}, {CONTSIZE:'#7'}, {GENUSNAME:'Ilex'}]) {
    assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('no-match',patch)), false);
  }
});

test('trimmed case-insensitive matching supports lowercase aliases and explicit blank selection', () => {
  const context = harness([]);
  context.select({ plantgroupcode:[' 330_trees '], contsize:[' #3 '], genusname:[' acer '] });
  assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters({ plantgroupcode:' 330_TREES ', contsize:' #3 ', genusname:' aCER ' }), true);
  context.select({ genusname:[''] });
  for (const value of ['', ' ', null, undefined]) assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('blank',{GENUSNAME:value})), true);
  assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('nonblank')), false);
  assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('canonical-blank',{GENUSNAME:'',genusname:'stale'})), true);
  const blankKey = context.getManagerEvalReport2HeaderFilterKey();
  context.select({});
  assert.equal(context.doesManagerEvalReport2RowMatchHeaderFilters(row('any')), true);
  assert.notEqual(context.getManagerEvalReport2HeaderFilterKey(), blankKey, 'All and blank-only are distinct');
});

test('choices use report and assignment scope, natural ordering, and preserve unavailable selections', () => {
  const rows = [row('one',{PLANTGROUPCODE:'Group 10'}), row('two',{PLANTGROUPCODE:' group 2 '}), row('three',{PLANTGROUPCODE:'GROUP 2'}), row('blank',{PLANTGROUPCODE:''}), row('other',{PLANTGROUPCODE:'Other User',ASSIGNEDTO:'other'})];
  const context = harness(rows);
  context.select({plantgroupcode:['Missing'],genusname:['Never Matches']});
  context.managersSearchTerm = 'No matches';
  assert.deepEqual(plain(context.getManagerEvalReport2HeaderFilterOptions('plantgroupcode')).map(({value,unavailable}) => ({value,unavailable:!!unavailable})), [
    {value:'',unavailable:false}, {value:'GROUP 2',unavailable:false}, {value:'GROUP 10',unavailable:false}, {value:'MISSING',unavailable:true}
  ]);
  context.reportRows = [];
  assert.deepEqual(plain(context.getManagerEvalReport2HeaderFilterOptions('plantgroupcode')), [{value:'MISSING',label:'MISSING',unavailable:true}]);
  assert.deepEqual([...context.managerEvalReport2HeaderFilters.plantgroupcode], ['MISSING']);
  assert.equal(context.getFilteredManagerEvalReport2Rows().length, 0);
  context.managerEvalReport2HeaderMenuDrafts.plantgroupcode = {selected:new Set(['UNCOMMITTED']),search:'Uncommitted'};
  assert.ok(context.getManagerEvalReport2HeaderFilterOptions('plantgroupcode').some(option => option.value === 'UNCOMMITTED' && option.unavailable));
  assert.deepEqual([...context.managerEvalReport2HeaderFilters.plantgroupcode], ['MISSING'], 'a refreshed draft must not commit itself');
});

test('every physical row must match after ITEMCODE expansion; representative rows cannot admit mismatches', () => {
  const rows = [row('first-wrong',{GENUSNAME:'Rosa'}), row('matching-report'), row('wrong-group',{PLANTGROUPCODE:'OTHER',SEASON:'F1'}), row('wrong-size',{CONTSIZE:'#7',SEASON:'F1'}), row('matching-expanded',{SEASON:'F1',LOCATIONCODE:'B.01.001'})];
  const context = harness(rows, rows.slice(0,2));
  context.select({plantgroupcode:['330_TREES'],contsize:['#3'],genusname:['ACER']});
  const groups = context.getManagerEvalReport2VisibleItemGroups();
  assert.deepEqual(plain(groups.map(group => ({item:group.itemCode, rows:group.rows.map(row=>row.UNIQUE_ID),rowCount:group.rowCount,locationCount:group.locationCount}))), [
    {item:'ITEM.A',rows:['matching-report','matching-expanded'],rowCount:2,locationCount:2}
  ]);
  context.selectedEntries = [{itemCode:'ITEM.A'}];
  assert.deepEqual(plain(context.getManagerEvalReport2SelectedRows().map(row=>row.UNIQUE_ID)), rows.map(row=>row.UNIQUE_ID), 'Queue remains all current physical rows');
});

test('equal-count replacements change cached contents; normalized selection order does not change the key', () => {
  const context = harness([row('acer'),row('rosa',{GENUSNAME:'Rosa'})]);
  context.select({genusname:['ACER']});
  assert.deepEqual(plain(context.getManagerEvalReport2VisibleItemGroups()[0].rows.map(row=>row.UNIQUE_ID)), ['acer']);
  const key = context.getManagerEvalReport2HeaderFilterKey();
  context.select({genusname:['ROSA']});
  assert.notEqual(context.getManagerEvalReport2HeaderFilterKey(), key);
  assert.deepEqual(plain(context.getManagerEvalReport2VisibleItemGroups()[0].rows.map(row=>row.UNIQUE_ID)), ['rosa']);
  context.select({genusname:['ROSA','ACER']});
  const unionKey = context.getManagerEvalReport2HeaderFilterKey();
  context.select({genusname:[' acer ','Rosa']});
  assert.equal(context.getManagerEvalReport2HeaderFilterKey(), unionKey);
});

test('header filters compose with Season, Location, Priority, assignment, search, and Location drill counts', () => {
  const rows = [
    row('included'), row('size',{CONTSIZE:'#5'}), row('genus',{GENUSNAME:'Rosa'}), row('group',{PLANTGROUPCODE:'OTHER'}),
    row('season',{SEASON:'U2'}), row('location',{LOCATIONCODE:'B.01.001'}), row('priority',{PRIORITY:''}),
    row('assignment',{ASSIGNEDTO:'other'}), row('search',{COMMONNAME:'Another Plant'}),
  ];
  const context = harness(rows);
  context.select({plantgroupcode:['330_TREES'],contsize:['#3'],genusname:['Acer']});
  context.selectedSeasons = new Set(['U1']);
  context.managerEvalReport2LocationFilter = 'A.01.001';
  context.managerEvalReport2PriorityFilter = 'with';
  context.managersSearchTerm = 'Sample';
  assert.deepEqual(plain(context.getFilteredManagerEvalReport2Rows().map(row=>row.UNIQUE_ID)), ['included']);
  context.managerEvalReport2BrowseMode = 'location';
  assert.deepEqual(plain(context.getManagerEvalReport2DrillGroups().map(group=>({value:group.value,rowCount:group.rowCount,itemCount:group.itemCount,locationCount:group.locationCount}))), [{value:'A',rowCount:1,itemCount:1,locationCount:1}]);
  assert.deepEqual(plain(context.getManagerEvalReport2VisibleItemGroups()[0].rows.map(row=>row.UNIQUE_ID)), ['included']);
});

test('header clear is session-scoped and cannot clear Queue drafts or reset drill navigation on Apply', () => {
  const context = harness([]);
  context.select({genusname:['ROSA']});
  context.managerEvalReport2VisibleGroupsCacheKey = 'old';
  context.resetManagerEvalReport2HeaderFilters();
  assert.deepEqual(Object.values(context.managerEvalReport2HeaderFilters).map(values=>values.size), [0,0,0]);
  assert.equal(context.managerEvalReport2VisibleGroupsCacheKey, '');
  assert.match(extract('clearInMemorySessionIdentity'), /resetManagerEvalReport2HeaderFilters\(\)/);
  assert.match(extract('clearManagerEvalReport2Filters'), /resetManagerEvalReport2HeaderFilters\(\)/);
  assert.doesNotMatch(extract('applyManagerEvalReport2HeaderFilter'), /(?:clearManagerEvalReport2Selection|resetManagerEvalReport2Drill|invalidateManagerEvalReport2Cache|ensureDatasetLoaded)\(/);
  assert.doesNotMatch(extract('getManagerEvalReport2SelectedRows'), /doesManagerEvalReport2RowMatchHeaderFilters/);
  assert.match(extract('getManagerEvalReport2VisibleItemGroups'), /getManagerEvalReport2HeaderFilterKey\(\)/);
  assert.match(extract('renderManagerEvalReport2Records'), /getManagerEvalReport2HeaderFilterKey\(\)/);
});
