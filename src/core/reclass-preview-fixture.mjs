import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const workflow = readFileSync('assets/row-workflow-functions.js', 'utf8');
export function createReclassPreviewFixture(extractAppFunction) {
  const dom = new JSDOM('<div id="argos-reclass-item-inquiry"></div>');
  const rules = { priority_change: { kind: 'priority', label: 'Priority Change' }, move_up: { kind: 'move', label: 'Move Up' } };
  const physical = { unique_id: 'source-uid', itemcode: 'ITEM-1', locationcode: 'A.01.001', lotcode: '27.F1',
    season: 'F1', ptronhand: '1000', ptravailable: '1000', s_lts: '1000', priority: '2' };
  const model = rows => ({ rows, locationRows: rows.map(row => ({ unique_id: row.unique_id, values: { ...row }, sourceRow: row })) });
  const state = { item: physical, snapshot: { uniqueId: physical.unique_id }, inquiryModel: model([physical]), focusedReclassRowUid: physical.unique_id };
  const ctx = { document: dom.window.document, window: dom.window, Map,
    argosInventoryTransactionState: state,
    argosReclassMultiActionState: { rowProposals: new Map([['source-uid', { reclassExplanation: 'Reviewed stock' }]]), rowResolutions: new Map(), holdStopProposals: {} },
    argosReclassRowEditorEntries: new Map(), RECLASS_ACTION_WORKFLOW_V2_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V3_ENABLED: true, RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: [],
    RECLASS_ACTION_WORKFLOW_V5_ORDER: Object.keys(rules), RECLASS_ACTION_WORKFLOW_V2_SEASONS: ['F1', 'U1'],
    ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS: {}, isArgosReclassMobileEditorViewport: () => false,
    canCurrentUserSubmitRepInventoryOperations: () => false, getReclassActionWorkflowV5Config: action => rules[action],
    getReclassActionWorkflowV2Config: action => rules[action], getArgosReclassTemporaryOverlay: () => null,
    getArgosReclassScopeSettings: () => ({ season: 'F1', salesYear: 2027 }),
    getEvalWorkInquiryRowResolution: () => '', renderArgosReclassInventoryFields: () => '',
    getArgosReclassRowCurrentSeason: entry => entry.values.season,
    getItemInquiryItemCode: row => row?.itemcode || '', buildItemInquiryViewModel: (_item, rows) => model(rows),
    parseAppNumber: value => value == null ? null : Number(value),
    firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== ''),
    generateArgosInventoryTransactionId: () => 'draft-id', captureEvalWorkLocalDraftSoon() {},
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
  };
  ctx.getConfiguredCurrentSalesYearCode = () => 27;
  ctx.getConfiguredCurrentSeasonCode = () => 'F1';
  ctx.nativeAuthProfile = { role: 'manager' };
  ctx.currentUser = 'tester';
  vm.createContext(ctx);
  for (const name of ['isReclassExplanationExempt', 'getReclassExplanation', 'requireReclassExplanation', 'buildReclassExplanationField']) {
    const match = workflow.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], ctx);
  }
  for (const name of ['getArgosReclassRowProposalMap', 'getArgosReclassV3Proposal', 'getArgosReclassV3HoldProposal',
    'cloneArgosReclassProposal', 'getArgosReclassLotOpenStock', 'getArgosReclassLotKey', 'getArgosReclassMoveUpLotState', 'getArgosReclassMoveBalance', 'getArgosReclassMoveBalanceText',
    'markArgosReclassProposalEdited', 'getArgosReclassV3ScopeActionsForEntry', 'getArgosReclassV3ActionCountForEntry',
    'refreshArgosReclassMultiActionUi', 'toggleArgosReclassV3Action', 'handleArgosReclassV3ProposalInput',
    'buildArgosReclassV3ProposalHtml', 'isArgosReclassLocationDetailsOpen', 'buildArgosReclassActionFieldsHtml',
    'buildArgosReclassRowFieldsHtml', 'getArgosReclassRowEditorEntry', 'renderArgosReclassHoldScopeNotice',
    'getArgosReclassRowRenderSignature', 'getArgosReclassProposalRenderSignature', 'getArgosReclassRowBodyId',
    'setArgosReclassAttributeIfChanged', 'renderArgosReclassInquiryEditor', 'reconcileArgosReclassCardDraftState',
    'findArgosReclassCardControl', 'reconcileArgosReclassInquiryMarkup', 'renderArgosInventoryTransactionInquiryModel',
    'normalizeNcrSalesYearValue', 'reclassStockSeason', 'buildOptimisticInventoryReclassMoveModel', 'setArgosReclassMoveInputsLocked']) {
    vm.runInContext(extractAppFunction(name), ctx);
  }
  return { dom, model, state, ctx };
}
