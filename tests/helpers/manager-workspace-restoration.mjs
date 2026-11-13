import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import { functionSource } from './golden-test-environment.mjs';
import { applyUniversalPinnedResultsLayout } from '../../src/ui/manager-table-layout.js';
import { renderManagerTableWorkspaceMarkup } from '../../src/views/manager-table-workspace.js';
import { renderEvalReport2PickerMarkup } from '../../src/views/eval-report2-controls.js';

function restorationRuntime(names,extra={}) {
  const scope = vm.createContext(extra);
  vm.runInContext(names.map(name=>functionSource('assets/app-runtime.js',name)).join('\n'),scope);
  return scope;
}

export function assertManagerTableLayoutRestoration() {
  const keys = ['assigned-items','company-directory','inquiry-coverage','customer-assignments','user-role-access'];
  const items = keys.map(id=>({id,label:id,section:'editable'}));
  const dom = new JSDOM('<body class="agdata-pinned-results"><div id="view-managers" class="agdata-pinned-view"></div><div id="view-drive"><div id="drive-content"></div></div></body>');
  try {
    const document = dom.window.document, view = document.getElementById('view-managers');
    for (const key of keys) {
      view.innerHTML = renderManagerTableWorkspaceMarkup('<div id="existing-controller" class="agdata-results-host"><div class="tm-scroll agdata-results-scroll">rows</div></div>',key,items,'',String);
      assert.equal(applyUniversalPinnedResultsLayout(document,'managers',()=>{}),false);
      assert.equal(document.body.classList.contains('agdata-pinned-results'),false);
      assert.equal(view.querySelectorAll('.agdata-results-host,.agdata-results-scroll,.agdata-results-bridge').length,0);
      assert.equal(view.querySelectorAll('[data-table-selector]').length,1);
      assert.ok(view.querySelector('[data-table-workspace] #existing-controller'));
      assert.equal(view.querySelector('[data-table-switch]').options.length,6);
    }
    assert.equal(applyUniversalPinnedResultsLayout(document,'drive',()=>{}),true);
    assert.ok(document.getElementById('drive-content').classList.contains('agdata-results-scroll'));
  } finally { dom.window.close(); }
}

export function assertEvalReportSelectionRestoration() {
  const reports = [{id:'low-stock',label:'Low Stock',count:2},{id:'not-in-f1',label:'Not in F1',count:3}];
  const html = renderEvalReport2PickerMarkup(reports,['low-stock'],{ready:true},String);
  const dom = new JSDOM('<div id="manager-eval-report-2-records"></div>'+html);
  try {
    const document = dom.window.document, picker = document.querySelector('[data-manager-eval2-report-picker]');
    assert.equal(picker.tagName,'FIELDSET');
    assert.equal(picker.querySelectorAll('input[data-eval2-report-id]').length,2);
    assert.doesNotMatch(html,/<summary|All reports|EVAL REPORTS #2\s*(?:&gt;|>)/i);
    const calls = [], runtime = restorationRuntime(['setManagerEvalReport2PickerChecks','toggleManagerEvalReport2ReportPicker','applyManagerEvalReport2ReportPicker'],{document,setManagerEvalReport2Reports:ids=>{calls.push([...ids]);return true;}});
    picker.querySelector('[value="not-in-f1"]').checked = true;
    runtime.toggleManagerEvalReport2ReportPicker(picker.querySelector('input'));
    assert.equal(calls.length,0);
    runtime.applyManagerEvalReport2ReportPicker(picker.querySelector('button'));
    assert.deepEqual(calls,[['low-stock','not-in-f1']]);
    runtime.setManagerEvalReport2PickerChecks(picker.querySelector('button'),false);
    assert.equal(picker.querySelectorAll('input:checked').length,0);
    assert.equal(calls.length,1);
  } finally { dom.window.close(); }
}

export function assertEvalReportWorkspaceEntry() {
  const state = {selected:'field-audit'}, audit = {modes:{eval:'audit'}};
  const runtime = restorationRuntime(['enterEvalAggregateDashboard','isEvalAggregateDashboardVisible','backEvalAggregateDashboard'],{evalAggregateDashboardState:()=>state,fieldAuditState:()=>audit});
  runtime.enterEvalAggregateDashboard();
  assert.equal(state.selected,'');
  assert.equal(audit.modes.eval,'audit');
  assert.equal(runtime.isEvalAggregateDashboardVisible(),true);
  assert.equal(runtime.backEvalAggregateDashboard(),false);
}

export function assertEvalReportOptionalFilters() {
  const runtime = restorationRuntime(['renderManagerEvalReport2OptionalFilters','renderEvalReport2PriorityMarkup'],{
    getManagerEvalReport2Rows:()=>[],useManagerReportPages:()=>false,
    getManagerEvalReportFilterOptions:()=>({seasons:['F1'],contSizes:['#3']}),
    getManagerEvalReport2LocationOptions:()=>['A.01'],
    managerEvalReport2LocationFilter:'A.01',managerEvalReport2ContSizeFilter:'#3',managerEvalReport2PriorityFilter:'with',
    buildManagerEvalReport2Select:(label,key,value)=>'<label>'+label+'<select data-key="'+key+'"><option selected>'+value+'</option></select></label>',
    buildManagerEvalReport2SeasonPicker:()=>'<fieldset data-seasons>F1</fieldset>'
  });
  const dom = new JSDOM(runtime.renderManagerEvalReport2OptionalFilters());
  try {
    const document = dom.window.document;
    assert.equal(document.querySelector('[data-key="locationcode"]').value,'A.01');
    assert.equal(document.querySelector('[data-key="contsize"]').value,'#3');
    assert.equal(document.querySelector('select[onchange]').value,'with');
    assert.equal(document.querySelectorAll('[data-seasons]').length,1);
    assert.equal(document.querySelectorAll('summary').length,0);
    assert.equal(runtime.managerEvalReport2LocationFilter,'A.01');
  } finally { dom.window.close(); }
}

export function assertEval2InitialSelection(engine) {
  const get = name => functionSource('assets/app-runtime.js',name);
  const scope = vm.createContext({getManagerEvalReports2Api:()=>engine,managerEvalReport2SelectionInitialized:false,managerEvalReport2SelectedReportIds:[],activeManagerEvalReport2:''});
  vm.runInContext(get('getManagerEvalReport2SelectedReportIds'),scope);
  assert.deepEqual(Array.from(scope.getManagerEvalReport2SelectedReportIds()),['low-stock']);
  assert.doesNotMatch(get('toggleManagerEvalReport2ReportPicker'),/setManagerEvalReport2Reports/);
  assert.match(get('applyManagerEvalReport2ReportPicker'),/setManagerEvalReport2Reports\(ids\)/);
  assert.match(get('renderManagerEvalReport2ReportsPanel'),/Choose a report from the Eval Reports dashboard/);
}

export function assertManagerWorkspaceRestoration() {
  assertManagerTableLayoutRestoration();
  assertEvalReportSelectionRestoration();
  assertEvalReportWorkspaceEntry();
  assertEvalReportOptionalFilters();
}
