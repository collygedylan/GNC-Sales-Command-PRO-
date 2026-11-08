import vm from 'node:vm';

export function createEvalCardFilterScope(rows) {
  return vm.createContext({
    Map, Set, Array, String, Object,
    managerEvalReport2ContSizeFilter:'all', managerEvalReport2LocationFilter:'all', managerEvalReport2PriorityFilter:'all',
    useManagerReportPages:() => false,
    managerEvalReport2AssignedToFilters:new Set(),
    getManagerEvalReport2Rows:() => rows, getManagerEvalReport2SeasonFilters:() => new Set(),
    doesManagerEvalReport2RowMatchSeasonFilter:() => true,
    getManagerEvalReportRowContSize:() => '', getManagerEvalReportRowLocation:() => '', getManagerEvalReportRowPriority:() => '',
    managerEvalReportRowMatchesSearch:() => true,
    getManagerEvalReport2ItemCode:sourceRow => String(sourceRow.ITEMCODE || '').toUpperCase(),
    getManagerEvalReportRowAssignedToUsers:sourceRow => Array.isArray(sourceRow.ASSIGNEDTO_USERS) ? sourceRow.ASSIGNEDTO_USERS.map(value => value || '(Unassigned)') : ['(Unassigned)'],
    compareManagerEvalReport2Natural:(left, right) => String(left).localeCompare(String(right)),
    escapeHtml:value => String(value),
    getManagerEvalAssignedUsers:() => [],
    getManagerEvalReport2UserFilterOptions:() => [{value:'all',label:'All Users (3)'},{value:'(Unassigned)',label:'Unassigned (2)'},{value:'Alice',label:'Alice (1)'},{value:'Bob',label:'Bob (1)'}]
  });
}
