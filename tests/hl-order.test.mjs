import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const blockStart = html.indexOf('        // HL selections mirror');
const blockEnd = html.indexOf('        function getCartSelectedItems()', blockStart);
assert.ok(blockStart >= 0 && blockEnd > blockStart, 'the HL implementation block must be present');
const source = (name) => {
  const start = html.indexOf(`        function ${name}(`);
  assert.ok(start >= 0, `${name} must be present`);
  return html.slice(start, html.indexOf('\n        }', start) + 10);
};
const row = (unique_id = 'soc-a', changes = {}) => ({ unique_id, itemcode: 'PLANT.003', commonname: 'Synthetic Holly', contsize: '#3',
  locationcode: 'C.12.001', lotcode: '27.F1', quantityordered: '10', dock: '4', planstartdate: '2026-09-15', stopnumber: '2',
  transactionnumber: 'SO-1', purchaseordernumber: 'PO-1', tripnumber: '3', customername: 'Synthetic Customer', consigneename: 'Synthetic Consignee', ...changes });

function runtime() {
  const ctx = vm.createContext({
    currentUser: 'dylan_collyge', nativeAuthSessionActive: true, nativeAuthAccessToken: 'synthetic-token',
    nativeAuthProfile: { id: '12345678-1234-1234-1234-123456789abc', username: 'dylan_collyge', disabled_at: null, locked_until: null, must_change_password: false },
    selectedItems: new Set(), selectedItemSources: new Map(), document: { getElementById: () => null },
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    navigator: { onLine: true }, console,
    productionVerifiedViewKey: () => 'test-view', getCurrentVisibleViewId: () => 'hl-order',
    setSurfaceDisplayPending: () => {}, scheduleTypingAwareUiRender: (_key, render) => render()
  });
  vm.runInContext(source('parseAppNumber') + '\n' + html.slice(blockStart, blockEnd), ctx);
  return ctx;
}
function quantityRuntime() {
  const ctx = vm.createContext({
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  });
  vm.runInContext([
    source('firstNonEmptyValue'),
    source('normalizeCardQuantityValue'),
    source('getCardPtrOnHandValue'),
    source('getCardPtrReviewedValue'),
    source('getCardPtrAvailableValue'),
    source('getCardOpenStockValue')
  ].join('\n'), ctx);
  const quantityStart = html.indexOf('        function buildInventoryQuantityChipsHtml(');
  const quantityEnd = html.indexOf('        function isInventoryCardMeaningfulTextValue(', quantityStart);
  assert.ok(quantityStart >= 0 && quantityEnd > quantityStart, 'shared inventory quantity renderer must be present');
  vm.runInContext(html.slice(quantityStart, quantityEnd), ctx);
  return ctx;
}

function bloomOpenRuntime() {
  const ctx = runtime();
  ctx.cartPanelOpen = false;
  ctx.bloomPickerActionsOpen = false;
  ctx.bloomShareMenuOpen = false;
  ctx.owner = 'first'; ctx.view = 'hl-order'; ctx.reads = 0; ctx.notices = [];
  ctx.captureHlOrderOwnership = () => ctx.owner;
  ctx.isHlOrderOwnershipCurrent = owner => owner === ctx.owner;
  ctx.productionVerifiedViewKey = () => ctx.view;
  ctx.updateGlobalActionBar = () => {};
  ctx.restoreBloomPickerOrderDraftSelection = () => {};
  ctx.showToast = (...args) => ctx.notices.push(args);
  let finish;
  ctx.read = new Promise(resolve => { finish = resolve; });
  ctx.loadHlOrderState = () => { ctx.reads++; return ctx.read; };
  vm.runInContext('hlOrderStatePending=read; hlOrderStateLoadedAt=Date.now();', ctx);
  vm.runInContext(source('toggleCartPanel'), ctx);
  return { ctx, finish: async () => {
    ctx.selectedItems.add('hl-a');
    vm.runInContext('hlOrderStatePending=null; hlOrderStateLoadedAt=Date.now();', ctx);
    finish(); await ctx.read; await Promise.resolve();
  } };
}

test('Bloom waits for saved HL selections and repeated taps open once without an empty warning', async () => {
  const {ctx,finish}=bloomOpenRuntime();
  ctx.toggleCartPanel(); ctx.toggleCartPanel();
  assert.equal(ctx.reads,1);
  assert.equal(ctx.cartPanelOpen,false);
  assert.deepEqual(ctx.notices,[]);
  await finish();
  assert.equal(ctx.cartPanelOpen,true);
  assert.deepEqual(ctx.notices,[]);
});

for (const change of ['close','account','view']) test(`pending Bloom opening cannot override ${change}`, async () => {
  const {ctx,finish}=bloomOpenRuntime();
  ctx.toggleCartPanel();
  if(change==='close') ctx.toggleCartPanel(false);
  if(change==='account') ctx.owner='second';
  if(change==='view') ctx.view='home';
  await finish();
  assert.equal(ctx.cartPanelOpen,false);
});

test('a new Bloom tap after navigation replaces the old pending open request', async () => {
  const {ctx,finish}=bloomOpenRuntime();
  ctx.toggleCartPanel();
  ctx.view='home';
  ctx.toggleCartPanel();
  await finish();
  assert.equal(ctx.cartPanelOpen,true);
  assert.deepEqual(ctx.notices,[]);
});

function bloomRemovalRuntime() {
  const ctx = runtime();
  ctx.cartPanelOpen = true;
  const elements = ['soc-a','soc-b'].map(id => ({dataset:{hlDraftSourceId:id,hlEditRevision:'4'}, removed:false, remove(){this.removed=true;}}));
  ctx.document.querySelectorAll = () => elements;
  for (const name of ['refreshHlBloomStatus','renderHlBloomSection','renderHlOrder','refreshHlOrderWarning','updateGlobalActionBar',
    'refreshCartButtons','syncDriveReturnedSelectionToolbar','clearContainerRenderSignature','closeBloomPickerTraySwipe']) ctx[name] = () => {};
  ctx.clearSelection = () => {};
  ctx.owner = 'first';
  ctx.captureHlOrderOwnership = () => ctx.owner;
  ctx.isHlOrderOwnershipCurrent = owner => ctx.owner === owner;
  ctx.crypto = {randomUUID:()=> '30000000-0000-4000-8000-000000000099'};
  ctx.entries = [
    {source_id:'soc-a',status:'ready',can_remove:true,quantity:3,ship_date:'2026-09-15',source:row('soc-a'),po_balance:{status:'unknown'}},
    {source_id:'soc-b',status:'needs_review',can_remove:false,removal_block_reason:'HL_ORDER_DELIVERY_UNKNOWN',quantity:4,ship_date:'2026-09-16',source:row('soc-b')},
  ];
  vm.runInContext('hlOrderStateData={revision:4,draft:entries,orders:[]}; syncHlOrderDraftSelections();',ctx);
  ctx.selectedItems.add('ordinary-a'); ctx.selectedItemSources.set('ordinary-a','drive');
  return {ctx,elements};
}

test('explicit Bloom clear is one revision-checked command, keeps locked rows and awaits acknowledgment before removing local selections', async () => {
  const {ctx,elements}=bloomRemovalRuntime(); let finish; const calls=[];
  ctx.supabaseRpc=async (_method,command)=>{calls.push(command);return new Promise(resolve=>{finish=resolve;});};
  const first=ctx.clearBloomPickerSelection();
  await ctx.clearBloomPickerSelection();
  assert.equal(calls.length,1);
  assert.equal(calls[0].p_action,'draft_clear');
  assert.equal(JSON.stringify(calls[0].p_payload),JSON.stringify({source_ids:['soc-a']}));
  assert.equal(calls[0].p_expected_revision,4);
  assert.equal(ctx.selectedItems.has('ordinary-a'),true);
  assert.equal(elements[0].removed,false);
  ctx.selectedItems.add('ordinary-added-during-request');
  finish({revision:5,draft:[ctx.entries[1]],orders:[]});
  await first;
  assert.equal(elements[0].removed,true);
  assert.equal(elements[1].removed,false);
  assert.equal(ctx.selectedItems.has('ordinary-a'),false);
  assert.equal(ctx.selectedItems.has('ordinary-added-during-request'),true);
  assert.equal(ctx.selectedItems.has('hl-order:soc-b'),true);
});

test('failed or stale Bloom clears retain every selection and the original displayed revision', async () => {
  const {ctx,elements}=bloomRemovalRuntime(); const calls=[];
  vm.runInContext('hlOrderStateData.revision=6;',ctx);
  ctx.supabaseRpc=async (_method,command)=>{calls.push(command);throw Object.assign(new Error('HL_ORDER_REVISION_CONFLICT'),{status:409});};
  await ctx.clearBloomPickerSelection();
  assert.equal(calls[0].p_expected_revision,4);
  assert.equal(elements.some(row=>row.removed),false);
  assert.equal(ctx.selectedItems.has('ordinary-a'),true);
  assert.equal(vm.runInContext('hlBloomClearIntent',ctx),null);
  assert.match(vm.runInContext('hlBloomRemovalError',ctx),/changed.*review/i);
});

test('uncertain Bloom clear keeps its identity and completes local cleanup only after replay acknowledgment', async () => {
  const {ctx,elements}=bloomRemovalRuntime(); const calls=[];
  ctx.supabaseRpc=async (_method,command)=>{
    calls.push(command);
    if(calls.length===1) throw Object.assign(new Error('statement timeout'),{status:500,code:'57014'});
    return {revision:5,draft:[ctx.entries[1]],orders:[]};
  };
  ctx.loadHlOrderState=async()=>vm.runInContext('hlOrderStateData',ctx);
  await ctx.clearBloomPickerSelection();
  assert.equal(elements[0].removed,false);
  assert.equal(ctx.selectedItems.has('ordinary-a'),true);
  await ctx.retryHlOrderCommand();
  assert.equal(calls.length,2);
  assert.equal(calls[1].p_command_id,calls[0].p_command_id);
  assert.equal(elements[0].removed,true);
  assert.equal(ctx.selectedItems.has('ordinary-a'),false);
  assert.equal(vm.runInContext('hlBloomClearIntent',ctx),null);
});

test('an old-account Bloom acknowledgment cannot clear the current account selections', async () => {
  const {ctx,elements}=bloomRemovalRuntime(); let finish;
  ctx.supabaseRpc=async()=>new Promise(resolve=>{finish=resolve;});
  const pending=ctx.clearBloomPickerSelection();
  ctx.owner='second';
  vm.runInContext('hlBloomClearIntent=null;hlOrderPendingCommand=null;',ctx);
  ctx.selectedItems.clear(); ctx.selectedItems.add('second-account-selection');
  finish({revision:5,draft:[],orders:[]});
  await pending;
  assert.equal(elements.some(row=>row.removed),false);
  assert.deepEqual([...ctx.selectedItems],['second-account-selection']);
});

test('a definite rejection during Bloom reconciliation releases the pending UI without deleting selections', async () => {
  const {ctx,elements}=bloomRemovalRuntime(); let calls=0;
  ctx.showToast=()=>{};
  ctx.supabaseRpc=async()=>{
    if(++calls===1) throw Object.assign(new Error('statement timeout'),{status:500,code:'57014'});
    throw Object.assign(new Error('HL_ORDER_REVISION_CONFLICT'),{status:409});
  };
  await ctx.clearBloomPickerSelection();
  await ctx.retryHlOrderCommand();
  assert.equal(calls,2);
  assert.equal(vm.runInContext('hlBloomClearIntent',ctx),null);
  assert.equal(vm.runInContext('hlOrderPendingCommand',ctx),null);
  assert.equal(elements.some(row=>row.removed),false);
  assert.equal(ctx.selectedItems.has('ordinary-a'),true);
});
const groups = (ctx, rows) => Array.from(ctx.groupHlOrderRows(rows.map((entry) => ctx.getHlOrderSource(entry))));

test('unsent review drafts can leave Bloom without enabling quantity edits or resolving review', async () => {
  const {ctx,elements}=bloomRemovalRuntime();
  ctx.entries[1].can_remove=true; ctx.entries[1].removal_block_reason=null;
  assert.equal(ctx.isHlBloomDraftEditable(ctx.entries[1]),false);
  assert.equal(ctx.isHlBloomDraftRemovable(ctx.entries[1]),true);
  assert.equal(ctx.isHlBloomDraftRemovable({status:'ready'}),false);
  const calls=[];
  ctx.supabaseRpc=async(_method,command)=>{calls.push(command);return {revision:5,draft:[],orders:[],dispositions:[{source_id:'soc-b',status:'needs_review'}]};};
  await ctx.clearBloomPickerSelection();
  assert.equal(calls.length,1);
  assert.equal(calls[0].p_action,'draft_clear');
  assert.deepEqual(Array.from(calls[0].p_payload.source_ids),['soc-a','soc-b']);
  assert.equal(elements.every(row=>row.removed),true);
  assert.equal(vm.runInContext('hlOrderStateData.dispositions[0].status',ctx),'needs_review');
});

test('HL eligibility retains exact location boundaries and dock OR planned start', () => {
  const ctx = runtime();
  for (const locationcode of ['C.05', '0.00.111', ' c.12.002 ', 'B.10.011', 'C.14.888']) {
    for (const schedule of [{ dock: '3', planstartdate: '' }, { dock: '', planstartdate: '2020-01-01' }]) {
      assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a', { locationcode, ...schedule }))), true);
    }
  }
  for (const locationcode of ['C.050', 'C.05.001', '0.00.1112', 'C.12', 'C.120.001', 'B.100.001', 'C.14.', 'A.01.000', '']) {
    assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a', { locationcode }))), false, locationcode);
  }
  assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a', { dock: ' ', planstartdate: null }))), false);
  assert.equal(ctx.isHlOrderSourceEligible(ctx.getHlOrderSource(row('a', { itemcode: '', contsize: '' }))), true);
});

test('HL remains restricted to the active native Dylan identity', () => {
  const ctx = runtime();
  assert.equal(ctx.canUseHlOrder(), true);
  for (const changes of [{ username: 'jd_jones' }, { disabled_at: '2026-01-01' }, { locked_until: '2999-01-01' }, { must_change_password: true }]) {
    ctx.nativeAuthProfile = { username: 'dylan_collyge', ...changes };
    assert.equal(ctx.canUseHlOrder(), false);
  }
  ctx.nativeAuthProfile = { username: 'dylan_collyge' };
  ctx.currentUser = 'jd_jones';
  assert.equal(ctx.canUseHlOrder(), false);
  ctx.currentUser = 'dylan_collyge'; ctx.nativeAuthSessionActive = false;
  assert.equal(ctx.canUseHlOrder(), false);
});

test('raw SOC identity, schedule and order quantity survive linked inventory display enrichment', () => {
  const ctx = runtime();
  const original = row();
  const result = ctx.getHlOrderSource({ HL_SOC_SOURCE: original, UNIQUE_ID: 'master-1', LOCATIONCODE: 'A.01.001', CONTSIZE: '#7',
    QUANTITYORDERED: '999', DOCK: '99', STOPNUMBER: '99', PLANSTARTDATE: '2030-01-01' });
  for (const field of ['unique_id', 'itemcode', 'contsize', 'locationcode', 'quantityordered', 'dock', 'stopnumber', 'planstartdate']) {
    assert.equal(result[field], original[field], field);
  }
});

test('card groups separate item, size, planned date, dock and stop while summing each source once', () => {
  const ctx = runtime();
  const result = groups(ctx, [row(), row(), row('same-group', { quantityordered: '15' }),
    row('item', { itemcode: 'OTHER' }), row('size', { contsize: '#7' }), row('date', { planstartdate: '2026-09-16' }),
    row('dock', { dock: '5' }), row('stop', { stopnumber: '3' })]);
  assert.equal(result.length, 6);
  const combined = result.find((group) => group.rows.some((entry) => entry.unique_id === 'soc-a'));
  assert.equal(combined.quantity, 25);
  assert.equal(combined.rows.length, 2);
  assert.equal(new Set(result.map((group) => group.key)).size, 6);
});

test('group schedule normalization uses the Chicago calendar date for timestamp offsets', () => {
  const ctx = runtime();
  const result = groups(ctx, [row(), row('b', { itemcode: ' plant.003 ', contsize: ' #3 ', dock: ' 4 ', stopnumber: ' 2 ', planstartdate: '2026-09-15T00:15:00+14:00' }),
    row('c', { planstartdate: '2026-09-15T23:45:00-12:00' })]);
  assert.deepEqual(result.map((group) => group.planstartdate), ['2026-09-14', '2026-09-15', '2026-09-16']);
  assert.deepEqual(result.map((group) => group.quantity), [10, 10, 10]);
});

test('ship dates retain the written Apps Script calendar date and render without a browser timezone shift', () => {
  const ctx = runtime();
  assert.equal(ctx.getHlOrderShipDate('Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)'), '2026-09-15');
  assert.equal(ctx.formatHlOrderShipDate('Tue Sep 15 2026 10:00:00 GMT-0500 (Central Daylight Time)'), 'Sep 15, 2026');
  assert.equal(ctx.getHlOrderShipDate('not a date'), '');
  assert.equal(ctx.getHlOrderShipDate('2026-02-30'), '');
  assert.equal(ctx.getHlOrderShipDate('2026-09-16T02:00:00Z'), '2026-09-15');
  assert.equal(ctx.getHlOrderShipDate('2026-09-15'), '2026-09-15');
});

test('ship-date backend errors are surfaced as actionable UI text', () => {
  const ctx = runtime();
  assert.match(ctx.getHlOrderErrorMessage(new Error('HL_ORDER_SHIP_DATE_REQUIRED')), /needs a ship date/i);
  assert.match(ctx.getHlOrderErrorMessage(new Error('HL_ORDER_SELECT_SHIP_DATE')), /Choose one ship date/i);
});

test('same-item different-lot SOC rows retain separate source identities in one schedule group', () => {
  const ctx = runtime();
  const result = groups(ctx, [row(), row('second-lot', { locationcode: 'C.14.002', lotcode: '26.F1' })]);
  assert.equal(result.length, 1);
  assert.deepEqual(Array.from(result[0].rows, (entry) => entry.unique_id).sort(), ['second-lot', 'soc-a']);
  assert.deepEqual(Array.from(result[0].rows, (entry) => entry.lotcode).sort(), ['26.F1', '27.F1']);
});

test('quantity parsing preserves finite decimals and rejects missing or ambiguous numeric input', () => {
  const ctx = runtime();
  for (const value of ['', null, 'bad', '0x10', '1e3', 'Infinity', '1,2', '1,,2']) assert.equal(ctx.getHlOrderQuantity(value), null, String(value));
  assert.equal(ctx.getHlOrderQuantity('1,250'), 1250);
  assert.equal(ctx.getHlOrderQuantity('2.5'), 2.5);
  assert.equal(ctx.getHlOrderQuantity('0'), 0);
});

test('Drive matches ignore display filters while retaining base access and approval visibility', () => {
  const ctx = runtime();
  ctx.fullInventory = [row('visible-f1'), row('visible-s1', { locationcode: 'A.02.001', lotcode: '25.S1' }), row('visible-zero', { locationcode: 'B.01.010', ptravailable: '0' }),
    row('visible-f1'), row('wrong-size', { contsize: '#7' }), row('wrong-item', { itemcode: 'OTHER' }),
    row('rep-hidden', { repVisible: false }), row('foreman-hidden', { foremanVisible: false }), row('approval-hidden', { approvalHidden: true })];
  ctx.filteredInventory = []; ctx.driveSearch = 'unrelated'; ctx.selectedDriveSeason = 'F1';
  ctx.canUseHlOrderVerifiedData = () => true;
  ctx.applyRepU3VisibilityScope = (rows) => rows.filter((entry) => entry.repVisible !== false);
  ctx.applyForemanPriorityRowScope = (rows) => rows.filter((entry) => entry.foremanVisible !== false);
  ctx.shouldHideNotOnInventoryApprovalRowFromInventory = (entry) => entry.approvalHidden === true;
  assert.deepEqual(Array.from(ctx.getHlOrderDriveMatches([row()]), (entry) => entry.unique_id).sort(), ['visible-f1', 'visible-s1', 'visible-zero']);
  ctx.canUseHlOrderVerifiedData = () => false;
  assert.equal(ctx.getHlOrderDriveMatches([row()]).length, 0);
});

test('HL normal Drive quantity cards preserve unknown verified values while retaining numeric zero', () => {
  const ctx = quantityRuntime();
  const unknown = ctx.buildInventoryQuantityChipsHtml({ ptravailable: null, ptronhand: null, ptrreviewed: null, s_lts: null }, { layout: 'row', compact: true, preserveUnknown: true });
  assert.match(unknown, /app-card-qty-label">Available<\/span>.*?app-card-qty-value[^>]*>Unknown<\/span>/);
  assert.match(unknown, /app-card-qty-label">Open Stock<\/span>.*?app-card-qty-value[^>]*>Unknown<\/span>/);
  const zero = ctx.buildInventoryQuantityChipsHtml({ ptravailable: '0', ptronhand: '0', ptrreviewed: '0', s_lts: '0' }, { layout: 'row', compact: true, preserveUnknown: true });
  assert.match(zero, /app-card-qty-label">Available<\/span>.*?app-card-qty-value[^>]*>0<\/span>/);
  assert.doesNotMatch(zero, /Available<\/span>.*?Unknown/);
});

test('HL dirty inputs remain protected after blur until explicitly saved or reset', () => {
  const ctx = runtime();
  const input = { type: 'number', value: '6', defaultValue: '4' };
  const selection = { type: 'checkbox', checked: true, defaultChecked: false };
  ctx.document = { activeElement: null, getElementById: () => ({ querySelectorAll: () => [input, selection] }) };
  assert.equal(ctx.hasHlOrderUnsavedInputs(), true);
  input.value = input.defaultValue;
  assert.equal(ctx.hasHlOrderUnsavedInputs(), true, 'selected receipt lines retain their original edit revision too');
  selection.checked = false;
  assert.equal(ctx.hasHlOrderUnsavedInputs(), false);
});

test('committed HL card markup owns return recognition and ordinary Drive ignores stale HL card identities', () => {
  const ctx = runtime();
  let cards = [{ dataset: { domId: 'master-hl-card' } }];
  const container = { innerHTML: '', __hlOrderHtml: '', querySelectorAll: () => cards };
  ctx.setHlOrderContent(container, '<section data-hl-drive-instance></section>');
  assert.equal(ctx.isHlOrderDriveRenderedDomId('master-hl-card'), true);
  cards = [];
  ctx.setHlOrderContent(container, '<section data-hl-drive-instance></section>');
  assert.equal(ctx.isHlOrderDriveRenderedDomId('master-hl-card'), true, 'a skipped replacement retains the attached card identity');
  ctx.setHlOrderContent(container, '<section>new HL content</section>');
  assert.equal(ctx.isHlOrderDriveRenderedDomId('master-hl-card'), false, 'a committed replacement drops detached card identities');

  const handleStart = html.indexOf('        function handleCardClick');
  const handleEnd = html.indexOf('        function reorderVisibleDetailTabs', handleStart);
  vm.runInContext(html.slice(handleStart, handleEnd), ctx);
  let captures = 0, opened = 0;
  ctx.beginDirectNavigationActivity = () => {};
  ctx.beginInternalPerfMeasure = () => 0;
  ctx.getCurrentVisibleViewId = () => 'drive';
  ctx.isHlOrderDriveRenderedDomId = () => true;
  ctx.captureHlOrderDriveDetailReturnContext = () => { captures++; return {}; };
  ctx.openDetail = () => { opened++; };
  ctx.handleCardClick('master-hl-card', 'master-hl-card', 'drive');
  assert.equal(captures, 0, 'an ordinary Drive card never inherits an HL return parent');
  assert.equal(opened, 1);
});

for (const outcome of ['resolved', 'rejected']) {
  test(`an old-session ${outcome} submission cannot clear the new session's pending command or sending state`, async () => {
    const ctx = runtime();
    let settle;
    const response = new Promise((resolve, reject) => { settle = outcome === 'resolved' ? resolve : reject; });
    const sendButton = { disabled: false };
    const effects = [];
    ctx.document = { getElementById: (id) => id === 'hl-tags-send' ? sendButton : null };
    ctx.crypto = { randomUUID: () => '10000000-0000-4000-8000-000000000001' };
    ctx.activeGeneration = 1;
    ctx.captureHlOrderOwnership = () => ctx.activeGeneration;
    ctx.isHlOrderOwnershipCurrent = (owner) => owner === ctx.activeGeneration;
    ctx.supabaseRpc = () => response;
    ctx.renderHlOrder = () => effects.push('render');
    ctx.renderHlBloomSection = () => effects.push('bloom');
    ctx.applyHlOrderState = () => effects.push('apply-state');
    ctx.showToast = () => effects.push('toast');
    vm.runInContext(`hlOrderStateData = {revision: 1}; hlOrderPreview = {id: 'old-preview', action: 'submit', owner: 1};`, ctx);
    const sending = ctx.sendHlTagsEmail();
    assert.equal(sendButton.disabled, true);
    assert.equal(vm.runInContext('hlOrderBusy && hlOrderSending && !!hlOrderPendingCommand', ctx), true);
    ctx.activeGeneration = 2;
    ctx.resetHlOrderState();
    assert.equal(vm.runInContext('hlOrderBusy || hlOrderSending || !!hlOrderPendingCommand', ctx), false);
    vm.runInContext(`hlOrderStateData = {revision: 99}; hlOrderStateError = 'new-session-error';
      hlOrderPendingCommand = {p_command_id: 'new-command'}; hlOrderBusy = true; hlOrderSending = true;
      hlOrderPreview = {id: 'new-preview', action: 'submit', owner: 2};`, ctx);
    effects.length = 0;
    settle(outcome === 'resolved' ? {revision: 2, draft: []} : Object.assign(new Error('Old request failed'), {status: 409}));
    await sending;
    assert.equal(vm.runInContext('hlOrderPendingCommand.p_command_id', ctx), 'new-command');
    assert.equal(vm.runInContext('hlOrderStateError', ctx), 'new-session-error');
    assert.equal(vm.runInContext('hlOrderBusy && hlOrderSending', ctx), true);
    assert.equal(vm.runInContext('hlOrderPreview.id', ctx), 'new-preview');
    assert.equal(sendButton.disabled, true);
    assert.deepEqual(effects, []);
  });
}

test('saved Bloom quantities use remaining demand and reject increases above that ceiling before RPC', async () => {
  const ctx = runtime(), entry = {source_id: 'soc-a', quantity: 4, source: row()};
  ctx.fixtureEntry = entry;
  vm.runInContext(`hlOrderStateData = {revision: 3, draft: [fixtureEntry], actionable_rows: [{...fixtureEntry.source, available_quantity: 4}], dispositions: []};`, ctx);
  assert.equal(ctx.getHlDraftQuantityCeiling(entry), 4);
  vm.runInContext(`hlOrderStateData.actionable_rows = []; hlOrderStateData.dispositions = [{source_id: 'soc-a', available_quantity: 0}];`, ctx);
  assert.equal(ctx.getHlDraftQuantityCeiling(entry), 0, 'zero uncovered demand must not fall back to SOC quantity');
  vm.runInContext(`hlOrderStateData.dispositions[0].available_quantity = 4;`, ctx);
  assert.equal(ctx.getHlDraftQuantityCeiling(entry), 4);
  const input = {value: '5'}, calls = [], notices = [];
  ctx.document.querySelectorAll = () => [{dataset: {hlDraftSourceId: 'soc-a', hlEditRevision: '3'}, querySelector: () => input}];
  ctx.runHlOrderCommand = async (action, payload) => calls.push({action, payload});
  ctx.showToast = (...args) => notices.push(args);
  await ctx.saveHlDraftQuantity('soc-a');
  assert.equal(calls.length, 0);
  assert.match(notices[0][1], /remaining HL demand/);
  input.value = '4'; await ctx.saveHlDraftQuantity('soc-a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.rows[0].quantity, 4);
});

test('review restore distinguishes an existing source from a missing original and a possible replacement', () => {
  const ctx = runtime();
  ctx.buildFastInvokeAttrs = () => '';
  const render = (entry, tab = 'needs-review') => {
    ctx.fixtureDisposition = {source_id: 'soc-a', source: row(), status: tab === 'removed' ? 'removed' : 'needs_review', ...entry};
    vm.runInContext('hlOrderStateData = {dispositions: [fixtureDisposition]};', ctx);
    return ctx.buildHlOrderDispositionsHtml(tab);
  };
  const sibling = {source_id: 'sibling', source: row('sibling')};
  for (const tab of ['needs-review', 'removed']) {
    const current = render({current_source: row(), replacement_candidates: [sibling]}, tab);
    assert.match(current, /Restore to Needed/);
    assert.doesNotMatch(current, /Review replacement as Needed/);
  }
  const missing = render({current_source: null, replacement_candidates: [sibling]});
  assert.doesNotMatch(missing, /Restore to Needed/);
  assert.match(missing, /Review replacement as Needed/);
  assert.doesNotMatch(render({current_source: row(), review_kind: 'possible_replacement'}), /Restore to Needed/);
  assert.doesNotMatch(render({current_source: row(), replacement_source_id: 'sibling'}), /Restore to Needed/);
});

test('a successful state refresh keeps unresolved command recovery visible until that exact command is acknowledged', () => {
  const ctx = runtime(), container = {innerHTML: '', contains: () => false, querySelectorAll: () => []};
  ctx.document = {getElementById: (id) => id === 'hl-order-content' ? container : null};
  ctx.buildFastInvokeAttrs = () => '';
  ctx.syncHlOrderDraftSelections = () => {};
  ctx.updateGlobalActionBar = () => {};
  ctx.getHlOrderNeededGroups = () => [];
  vm.runInContext(`hlOrderStateData = {revision: 1, draft: [], orders: []};
    hlOrderPendingCommand = {p_command_id: 'lost-submit-command', p_action: 'submit'};
    hlOrderStateError = 'Connection reset';`, ctx);
  ctx.renderHlOrder(true);
  assert.match(container.innerHTML, /Check saved change/);
  ctx.applyHlOrderState({revision: 2, draft: [], orders: []});
  assert.equal(vm.runInContext('hlOrderPendingCommand.p_command_id', ctx), 'lost-submit-command');
  assert.match(container.innerHTML, /Check saved change/, 'read-only refresh is not an acknowledgement of the pending command');
});

test('saving a stale rendered draft sends its original revision and retains the newer saved quantity on conflict', async () => {
  const ctx = runtime(), calls = [], input = {value: '5'};
  const element = {dataset: {hlDraftSourceId: 'soc-a', hlEditRevision: '3'}, getAttribute: () => '3', querySelector: () => input};
  ctx.document.querySelectorAll = () => [element];
  ctx.fixtureEntry = {source_id: 'soc-a', quantity: 7, status: 'ready', source: row()};
  vm.runInContext(`hlOrderStateData = {revision: 9, draft: [fixtureEntry], actionable_rows: [], orders: [], dispositions: []};`, ctx);
  ctx.crypto = {randomUUID: () => '30000000-0000-4000-8000-000000000001'};
  ctx.captureHlOrderOwnership = () => 1;
  ctx.isHlOrderOwnershipCurrent = () => true;
  ctx.renderHlOrder = () => {};
  ctx.renderHlBloomSection = () => {};
  ctx.showToast = () => {};
  ctx.supabaseRpc = async (method, command) => {
    calls.push(command);
    if (command.p_expected_revision !== 9) throw Object.assign(new Error('HL_ORDER_REVISION_CONFLICT'), {status: 409});
    vm.runInContext('hlOrderStateData.draft[0].quantity = 5;', ctx);
    return vm.runInContext('hlOrderStateData', ctx);
  };
  ctx.applyHlOrderState = () => {};
  await ctx.saveHlDraftQuantity('soc-a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_expected_revision, 3, 'the focused input was rendered at revision 3, even though polled state is revision 9');
  assert.equal(vm.runInContext('hlOrderStateData.draft[0].quantity', ctx), 7);
});

test('a state response discarded during permission initialization allows an immediate current-scope read', async () => {
  const ctx = runtime();
  let identity = 'initial', finishFirst, reads = 0;
  let scheduledRenders = 0;
  ctx.canUseProductionLiveSync = () => true;
  ctx.scheduleProductionLiveSyncRender = () => { scheduledRenders++; };
  ctx.getSupabaseReadIdentityScope = () => identity;
  ctx.scheduleHlOrderRefresh = () => {};
  ctx.renderHlOrder = () => {};
  ctx.updateGlobalActionBar = () => {};
  ctx.supabaseRpc = () => ++reads === 1
    ? new Promise(resolve => { finishFirst = resolve; })
    : Promise.resolve({ revision: 2, draft: [], orders: [] });
  const first = ctx.loadHlOrderState();
  identity = 'verified-permissions';
  finishFirst({ revision: 1, draft: [], orders: [] });
  await first;
  assert.equal(vm.runInContext('hlOrderStateData', ctx), null, 'the stale identity response stays discarded');
  await ctx.loadHlOrderState();
  assert.equal(reads, 2, 'current permissions do not wait for the fifteen-second poll');
  assert.equal(vm.runInContext('hlOrderStateData.revision', ctx), 2);
  assert.ok(scheduledRenders > 0, 'polled state uses the interaction-aware render owner');
  await ctx.loadHlOrderState();
  assert.equal(reads, 2, 'a valid same-scope read still coalesces');
});

test('HL timeout retains data, pauses reads, and a manual retry recovers', async () => {
  const ctx=runtime(); let reads=0;
  ctx.canUseProductionLiveSync=()=>true; ctx.scheduleProductionLiveSyncRender=()=>{};
  ctx.getSupabaseReadIdentityScope=()=> 'account'; ctx.scheduleHlOrderRefresh=()=>{};
  ctx.renderHlOrder=()=>{}; ctx.renderHlBloomSection=()=>{}; ctx.updateGlobalActionBar=()=>{};
  ctx.supabaseRpc=async()=>{reads++;if(reads===2)throw Object.assign(new Error('canceling statement due to statement timeout'),{status:500});return {revision:reads,draft:[],orders:[]};};
  await ctx.loadHlOrderState(); await ctx.loadHlOrderState(true);
  assert.equal(vm.runInContext('hlOrderStateData.revision',ctx),1);
  assert.match(vm.runInContext('hlOrderStateError',ctx),/last confirmed data/);
  await ctx.loadHlOrderState(true);assert.equal(reads,2);
  await ctx.refreshHlOrder();assert.equal(reads,3);
  assert.equal(vm.runInContext('hlOrderTimeoutPaused',ctx),false);
});

test('a timed-out command retains its identity even with an HTTP error status', async () => {
  const ctx=runtime();const calls=[];
  ctx.canUseProductionLiveSync=()=>true;ctx.scheduleProductionLiveSyncRender=()=>{};ctx.getSupabaseReadIdentityScope=()=> 'account';
  ctx.renderHlOrder=()=>{};ctx.renderHlBloomSection=()=>{};ctx.updateGlobalActionBar=()=>{};
  ctx.crypto={randomUUID:()=> 'same-command'};
  vm.runInContext('hlOrderStateData={revision:1,draft:[],orders:[]}',ctx);
  ctx.supabaseRpc=async(_name,command)=>{calls.push(command);if(calls.length===1)throw Object.assign(new Error('statement timeout'),{status:500});return {revision:2,draft:[],orders:[]};};
  await assert.rejects(ctx.runHlOrderCommand('receive',{quantity:1}),/too long/);
  const command=vm.runInContext('hlOrderPendingCommand',ctx);assert.equal(command.p_command_id,'same-command');
  await ctx.runHlOrderCommand(command.p_action,command.p_payload,command);
  assert.equal(calls[1].p_command_id,calls[0].p_command_id);
  assert.equal(vm.runInContext('hlOrderPendingCommand',ctx),null);
});

test('stale restock blocks Bloom and TAGS actions independently of the active tab',async()=>{
  const ctx=runtime();
  vm.runInContext("hlOrderTab='needed'; hlRestockStateError='Restocking needs Retry'; hlOrderStateData={revision:1,draft:[{source_kind:'restock',ship_date:'2026-09-20'}],orders:[]};",ctx);
  let calls=0; ctx.supabaseRpc=async()=>{calls++;};
  await assert.rejects(ctx.runHlOrderCommand('restock_draft_save',{}),/needs Retry/);
  await assert.rejects(ctx.runHlOrderCommand('preview',{ship_date:'2026-09-20'}),/needs Retry/);
  vm.runInContext("hlOrderPreview={id:'p',ship_date:'2026-09-20'}",ctx);
  await assert.rejects(ctx.runHlOrderCommand('submit',{preview_id:'p'}),/needs Retry/);
  assert.equal(calls,0);
});
