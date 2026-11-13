import assert from 'node:assert/strict';
import vm from 'node:vm';

export function invariant241({ read, functionSource }) {
  const context=vm.createContext({console}); vm.runInContext((read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js')),context);
  const access=context.GncUserAccessControl;
  assert.equal(typeof access.resolveUserAccessMatrix,'function');
  access.setAccessMatrixRows([{username:'nelly_aguilar',role:'Admin',make_request:'Y',can_make_request:'Y',request_all_reps:'Y',edit_any_row:'Y',flyer_folder_access:'Y',sales_rep_access:{abbey_burka:'Y',nate_douglas:'N'}}]);
  const nelly=access.resolveUserAccessMatrix('Nally Aguilar');
  assert.equal(nelly.username,'nelly_aguilar'); assert.equal(nelly.edit_any_row,'Y'); assert.equal(nelly.flyer_folder_access,'Y');
  assert.equal(access.canRequestSalesRep(nelly,'Abbey Burka'),true); assert.equal(access.canRequestSalesRep(nelly,'Nate Douglas'),true);
  access.setAccessMatrixRows([{...nelly,make_request:'N',can_make_request:'N'}]);
  assert.equal(access.canRequestSalesRep(access.resolveUserAccessMatrix('nelly_aguilar'),'Abbey Burka'),false);
  assert.doesNotMatch(functionSource('assets/app-runtime.js','filterRepList'),/Loading active users/);
}

export function invariant306({ read }) {
 const ctx=vm.createContext({});vm.runInContext((read('assets/access-matrix-policy.js')+'\n'+read('assets/user-access-control.js')),ctx);const access=ctx.GncUserAccessControl;
 for(const alias of ['Chance Alldredge - South TX','Alldredge, Chance - South TX','Alldredge, Chance','chance_alldredge_south_tx','chance_alldredge']){assert.equal(access.formatSalesRepDisplayName(alias),'Chance Alldredge');assert.equal(access.normalizeSalesRepKey(alias),'chance_alldredge');}
 assert.equal(access.formatSalesRepDisplayName('Abbey Burka - North TX'),'Abbey Burka');assert.equal(access.formatSalesRepDisplayName('Unknown Person - North TX'),'Unknown Person - North TX');
 access.setAccessMatrixRows([{username:'chance_alldredge',role:'REP',make_request:'Y',can_make_request:'Y',sales_rep_access:{chance_alldredge:'Y',chance_alldredge_south_tx:'N'}}]);
 assert.equal(access.canRequestSalesRep(access.resolveUserAccessMatrix('chance_alldredge'),'Chance Alldredge - South TX'),true);
 const reps=access.getAccessSalesReps();assert.equal(reps.filter(r=>r.username==='chance_alldredge').length,1);assert.equal(reps.filter(r=>/South TX/i.test(r.label)).length,0);
 access.setAccessMatrixRows([{username:'chance_alldredge',make_request:'N',can_make_request:'N'}]);
 assert.equal(access.canRequestSalesRep(access.resolveUserAccessMatrix('chance_alldredge'),'Chance Alldredge - South TX'),false);
}

export function invariant525({ read, functionSource }) {
 const access={yn:v=>String(v||'').toUpperCase(),normalizeSalesRepKey:v=>String(v||'')};vm.createContext(access);vm.runInContext(functionSource('assets/user-access-control.js','canRequestSalesRep'),access);
 assert.equal(access.canRequestSalesRep({make_request:'Y',can_make_request:'Y',request_all_reps:'N',sales_rep_access:{toby_brown:'N'}},'toby_brown'),true);assert.equal(access.canRequestSalesRep({make_request:'N',can_make_request:'N'},'toby_brown'),false);
 const state={modes:{eval:'legacy',drive:'legacy'}};
 const context={isEvalAggregateDashboardVisible:()=>false,canViewManagerEvalReports2:()=>true,fieldAuditState:()=>state,syncEvalOverviewAuditRows(){},
  renderManagerEvalReports2LegacyPanel:()=>'<Low Stock><Not in F1><Other Reports>',renderFieldAuditReport:()=>'<Field Audit>'};
 vm.createContext(context);vm.runInContext(functionSource('assets/eval-report2-controls.js','renderManagerEvalReports2Panel'),context);
 assert.equal(context.renderManagerEvalReports2Panel(),'<Low Stock><Not in F1><Other Reports>');
 state.modes.eval='audit';assert.equal(context.renderManagerEvalReports2Panel(),'<Field Audit>');
 context.canViewManagerEvalReports2=()=>false;assert.match(context.renderManagerEvalReports2Panel(),/Not in F1/);
 const mapping={};vm.createContext(mapping);vm.runInContext(read('assets/request-submission.js'),mapping);const payload=mapping.AgMetricRequestSubmission.resolveCustomerMappingPayload({customername:'N/A',consigneename:'N/A',request_selected_salesrep_id:'S26'},[],false);assert.equal(payload.customeridentityid,'N/A');assert.equal(payload.consigneeidentityid,'N/A');assert.equal(payload.request_selected_salesrep_id,'S26');
}

