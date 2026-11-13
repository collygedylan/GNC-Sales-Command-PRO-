import assert from 'node:assert/strict';
import vm from 'node:vm';

export function bloomRoleActionContract(runFunctions) {
  const makeElement = initialClasses => {
    const classes = new Set(initialClasses || []);
    return { dataset: {}, innerText: '', className: '', setAttribute() {},
      classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
      hasClass: name => classes.has(name) };
  };
  const actionIds = ['global-action-bar','footer-cart-btn','footer-cart-badge','sel-count','cart-helper-text',
    'bloom-picker-actions-toggle','bloom-picker-actions-icon','bloom-picker-actions-list','batch-share-menu-wrap',
    'batch-btn-assign','batch-btn-eval-task','batch-btn-ncr','batch-btn-request','batch-btn-move','batch-btn-flyer',
    'batch-btn-take-back','batch-btn-endcap','batch-btn-shear','batch-btn-bloom-order','batch-btn-project'];
  const roleCases = ['Sales Rep','sales_rep','salesrep','Sales','Manager'];
  for (const role of roleCases) {
    const elements = Object.fromEntries(actionIds.map(id => [id, makeElement(id === 'bloom-picker-actions-list' ? ['hidden'] : [])]));
    const context = vm.createContext({
      canAccessView: () => true, currentRole: role, currentUser: 'rep-user', document: { getElementById: id => elements[id] || null }, window: {},
      selectedItems: new Set(['row-1']), selectedItemSources: new Map(), cartPanelOpen: true, bloomPickerActionsOpen: true,
      getCartSelectedItems: () => [{ DOM_ID: 'row-1' }], renderBloomPickerTrayRows() {}, syncBloomShareMenuUi() {}, syncGlobalHeaderChrome() {},
      canUseFullDriveBloomPickerActions: () => true, canUseCartInventoryActions: () => true, canSubmitBloomPickerOrder: () => true,
      canUseDriveQuickRequest: () => true, isRequestLikeItem: () => false, isDockLikeItem: () => false,
      isSalesOfficeLikeItem: () => false, canUseEvalTaskAssignment: () => false, getEvalTaskSelectionItems: () => [],
      canCreateLocationWorkJob: () => false, canUseGroupedBloomNcr: () => false, canCreateShearLocationInquiry: () => false,
    });
    runFunctions('assets/app-runtime.js', ['normalizeRoleAccessToken','getBloomPickerActionVisibility','updateGlobalActionBar'], context);
    vm.runInContext(`currentRole = ${JSON.stringify(role)}; getRoleAccessState = () => { const normalized = normalizeRoleAccessToken(currentRole); const isSalesRole = ['SALES','SALE','SALESUSER','SALESROLE'].includes(normalized); const isRep = isSalesRole || normalized === 'REP' || normalized === 'SALESREP' || normalized.includes('SALESREP'); return { isRep, isRepLike: isRep, isCsr: false }; };`, context);
    context.updateGlobalActionBar();
    assert.equal(elements['batch-share-menu-wrap'].hasClass('hidden'), false, `${role}: Share remains visible`);
    assert.equal(elements['batch-btn-request'].hasClass('hidden'), false, `${role}: Request remains visible`);
    if (role === 'Manager') {
      assert.equal(elements['batch-btn-project'].hasClass('hidden'), false, 'Project remains visible to non-Sales-Rep roles');
      continue;
    }
    assert.equal(elements['batch-btn-project'].hasClass('hidden'), true, `${role}: Project is hidden`);
    for (const id of ['batch-btn-assign','batch-btn-eval-task','batch-btn-ncr','batch-btn-move','batch-btn-flyer',
      'batch-btn-take-back','batch-btn-endcap','batch-btn-shear','batch-btn-bloom-order']) {
      assert.equal(elements[id].hasClass('hidden'), true, `${role}: ${id} is hidden`);
    }
  }
}

export async function bloomProjectContract(runFunctions,read) {
  let shown=0;const nodes=new Map();const modal={innerHTML:'',querySelectorAll:()=>[],showModal:()=>shown++,querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',setAttribute(){}});return nodes.get(selector);}};
  const ctx=runFunctions('assets/app-runtime.js',['setBloomProjectPickerOptions','renderBloomProjectSavedVariables','buildBloomProjectSummary','addInventoryRowsToProject','dispatchBloomProjectPartyChange'],{
    queueInventoryProjectsLoad:null,CSS:{escape:String},fullInventory:[],masterInventory:[],ensureQueueInventoryProjectsScope(){},ensureQueueInventoryProjectsData:async()=>{},bloomInventoryProjectDraft:null,crypto:{randomUUID:()=> 'command'},getSupabaseReadIdentityScope:()=> 'owner',isRepReadOnlyUser:()=>false,
    document:{getElementById:()=>modal,querySelector:()=>null},getAllRequestModalRepOptions:()=>[{label:'Rep One'}],getAssignableAppUserOptions:()=>[{username:'grader',display:'Grade Person'}],
    ensureRequestRepUserOptionsReady:async()=>[],ensureAssignableAppUsers:async()=>[],normalizeRepDisplayOrder:value=>value,esc:String
  });
  vm.runInContext(read('assets/bloom-inventory-project.js'), ctx);
  await ctx.addInventoryRowsToProject([{ITEMCODE:'x',COMMONNAME:'Tree',LOCATIONCODE:'A.01.000'}]);
  assert.equal(shown,1);for(const label of ['Sales Rep Name','Customer Name','Consignee Name','Grade Best N count','What They Are Marked With','Assigned User'])assert.ok(modal.innerHTML.includes(label),label);
  assert.doesNotMatch(modal.innerHTML,/Load More|Create an Inventory Project before/);
  assert.match(read('supabase/migrations/20261029210000_agdata_v23107_row_workflows.sql'),/PROJECT_COMMAND_CONFLICT/);
}






