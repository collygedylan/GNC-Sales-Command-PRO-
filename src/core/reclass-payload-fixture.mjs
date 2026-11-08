import { readComposedAppSource } from '../../scripts/composed-app-source.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const html = readComposedAppSource();
const workflow = readFileSync('assets/row-workflow-functions.js', 'utf8');
function prepareContext(context) {
  context.nativeAuthProfile = { role: 'manager' };
  context.getArgosReclassRowProposalMap = () => ({ reclassExplanation: 'Verified field review' });
  vm.createContext(context);
  for (const name of ['isReclassExplanationExempt', 'getReclassExplanation', 'requireReclassExplanation', 'collectReclassExplanations']) {
    const match = workflow.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
}

export function loadClientPayloadBuilder(values = {}, draftOverride = null) {
  const policyStart = html.indexOf('function getArgosReclassActionWorkflowPolicyVersionV3(');
  const policyEnd = html.indexOf('\n        }', policyStart) + '\n        }'.length;
  const start = html.indexOf('function buildArgosInventoryTransactionPayload');
  const end = html.indexOf('async function postArgosInventoryTransactionPayload', start);
  assert.ok(policyStart > 0 && policyEnd > policyStart && start > 0 && end > start);
  const context = {
    document: { addEventListener() {} },
    argosInventoryTransactionState: {
      idempotencyToken: 'reclass-token-123456',
      snapshot: {
        uniqueId: 'u1',
        sourceTable: 'ph_master_inventory',
        itemCode: 'A1',
        lotCode: '27.F1',
        locationCode: 'A.1',
        season: 'F1',
        salesYear: '2027',
      },
    },
    currentUser: 'tester',
    currentUserDisplay: 'Test User',
    APP_SHELL_VERSION: 'test',
    APP_SHELL_BUILD: 'test',
    RECLASS_ACTION_WORKFLOW_V3_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V3_POLICY_VERSION: 'reclass-action-workflow-v3-row-actions-20260826',
    RECLASS_ACTION_WORKFLOW_V4_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V4_POLICY_VERSION: 'reclass-action-workflow-v4-split-moves-20261006',
    RECLASS_ACTION_WORKFLOW_V5_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V5_POLICY_VERSION: 'reclass-action-workflow-v5-sheared-20261008',
    RECLASS_ACTION_WORKFLOW_V6_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V6_POLICY_VERSION: 'reclass-action-workflow-v6-smart-shield-20261009',
    RECLASS_ACTION_WORKFLOW_V7_POLICY_VERSION: 'reclass-action-workflow-v7-editable-fields-20261009',
    RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: ['hold', 'take_off_hold', 'stop_ship', 'off_stop_ship'],
    RECLASS_ACTION_WORKFLOW_V2_ENABLED: true,
    RECLASS_ACTION_WORKFLOW_V2_POLICY_VERSION: 'reclass-action-workflow-v2-live-20260826',
    getReclassActionWorkflowV2Config: (value) => ({ hold: { kind: 'hold_on' }, recount: { kind: 'recount' }, move_up: { kind: 'move' } }[value] || null),
    getArgosInventoryTransactionInputValue: (id) => values[id] ?? '',
    parseAppNumber: (value) => Number(String(value).replaceAll(',', '')),
    normalizeArgosInventoryTransactionRequestAction: (value) => String(value || '').trim().toLowerCase(),
    isArgosInventoryTransactionMoveSeasonRequestAction: (value) => ['move_up', 'move_down'].includes(value),
    collectArgosReclassV3Draft: () => draftOverride || ({
      requestActions: ['hold', 'priority_change'],
      holdStopProposals: [{ action: 'hold', reason: 'field review', sourceUid: 'u1' }],
      scope: { season: 'F1', salesYear: 2027 },
      rowOverlays: [{ unique_id: 'u1', expected: {}, proposals: [
        { action: 'priority_change', priority: '2' },
      ] }],
    }),
    collectArgosReclassInquiryOverlays: () => [],
    generateArgosInventoryTransactionId: () => 'reclass-token-123456',
    getArgosInventoryTransactionActorEmail: () => 'tester@example.invalid',
    getCurrentRoleAccessValue: () => 'Manager',
  };
  prepareContext(context);
  vm.runInContext(`${html.slice(policyStart, policyEnd)}\n${html.slice(start, end)}; this.buildArgosInventoryTransactionPayload = buildArgosInventoryTransactionPayload;`, context);
  return context.buildArgosInventoryTransactionPayload;
}

