import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
// @test-group: @session-recovery
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readComposedAppSource().replace(/\r\n/g, '\n');
const coordinator = readFileSync(new URL('../assets/live-sync-coordinator.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function declaration(name) {
  const match = html.match(new RegExp(`const ${name} = new Set\\(([\\s\\S]*?)\\);`));
  assert.ok(match, `${name} should exist`);
  return match[1];
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const next = source.slice(start + 1).search(/\n        (?:async )?function /);
  const end = next < 0 ? -1 : start + 1 + next;
  assert.ok(end > start, `${name} boundary`);
  return source.slice(start, end);
}

test('opening Docks and Suspend recount dialogs is not blocked by whole-view freshness', () => {
  assert.doesNotMatch(declaration('DOCKS_WRITE_ACTION_NAMES'), /openDockInfoModal/);
  assert.match(declaration('DOCKS_WRITE_ACTION_NAMES'), /saveDockInfoModal/);
  assert.doesNotMatch(declaration('SUSPEND_TAG_WRITE_ACTION_NAMES'), /openDockSuspendDcNotFoundRecount/);
  assert.match(declaration('SUSPEND_TAG_WRITE_ACTION_NAMES'), /markDockSuspendDcRequestHandled/);
  assert.doesNotMatch(functionBody(html, 'openDockSuspendDcNotFoundRecount'), /requireCurrentSuspendTagWriteProof/);
  assert.match(functionBody(html, 'markDockSuspendDcRequestCompleteAfterRecount'), /persistDockSuspendDcRequestCompletion\(mirrorRow\)/);
});

test('Suspend mutation still requires an exact permitted row and compare-and-set payload', () => {
  const reader = functionBody(html, 'loadCurrentSuspendTagWriteRow');
  assert.match(reader, /canCurrentUserViewDockSuspendDcRequests\(\)/);
  assert.match(reader, /canCurrentUserWorkRequestItem\(item/);
  assert.match(reader, /sourceUid/);
  assert.match(reader, /isReadableSource\(beforeSource\)/);
  assert.match(reader, /isReadableSource\(afterSource\)/);
  assert.match(reader, /beforeSourceToken !== window\.AgMetricLiveSync\.readSourceToken\(afterSource\)/);
  assert.match(reader, /beforeSource\.revision !== afterSource\.revision/);
  const command = functionBody(html, 'runSuspendTagRowCommand');
  assert.match(command, /loadCurrentSuspendTagWriteRow\(mirror, operation, retryCommand\)/);
  assert.match(command, /expectedLastUpdated:\s*expectedRevision/);
  assert.match(command, /expectedVersion:\s*version/);
});

test('readable published snapshots have stable tokens distinct from Up-to-date authorization', () => {
  assert.match(coordinator, /function publishedReadable\(source\)/);
  assert.match(coordinator, /function readable\(source\)/);
  assert.match(coordinator, /isPublishedReadable:\s*publishedReadable/);
  assert.match(coordinator, /isReadableSource:\s*readable/);
  assert.match(coordinator, /readSourceToken:\s*source\s*=>\s*JSON\.stringify/);
});

test('Reclass inquiry reads accept stable readable snapshots while mutation checks remain separate', () => {
  for (const name of ['loadExactMasterDetailRow', 'loadArgosItemInquiryRows']) {
    const body = functionBody(html, name);
    assert.match(body, /isReadableSource/);
    assert.match(body, /readSourceToken/);
    assert.match(body, /permissionVersion/);
  }
  assert.match(functionBody(html, 'loadArgosItemInquiryRows'), /beforeSourceToken !== window\.AgMetricLiveSync\.readSourceToken\(afterSource\)/);
  assert.match(html, /function requireCurrentProductionLiveSyncProof/);
});

test('Reclass detail opens from same-scope full cached rows as display-only and cannot reuse them as mutation proof', () => {
  const cached = functionBody(html, 'getReadableCachedArgosItemInquiryGroup');
  assert.match(cached, /state\.rowCompleteness !== 'complete'/);
  assert.match(cached, /state\.fieldCoverage !== 'full'/);
  assert.match(cached, /state\.liveVerifiedScope !== context\.scope/);
  assert.match(cached, /state\.liveVerifiedPermission !== context\.dataPermissionVersion/);
  assert.match(cached, /rows\.some\(row => !indexedRows\.has\(row\)\)/);
  assert.match(cached, /sourceState: 'published-display-only'/);
  const opener = functionBody(html, 'openArgosInventoryTransactionModal');
  assert.match(opener, /const displayGroup = options\.__displayInquiryGroup \|\|/);
  assert.match(opener, /verifiedInquiryGroup: verifiedGroup \|\| null/);
  assert.match(opener, /openedState\.verifiedInquiryGroup = freshGroup/);
  assert.doesNotMatch(functionBody(html, 'ensureArgosReclassSubmissionVerification'), /loadArgosItemInquiryRows|dataPermissionVersion/);
  const proof = functionBody(html, 'getArgosReclassVerifiedInquiryRevision');
  assert.match(proof, /group\.sourceState === 'ready'/);
  assert.match(proof, /group\.sourceState === 'interrupted' && group\.sourceBracketed === true/);
  assert.match(proof, /group\.sourcePublishedReadable === true && !!group\.sourceToken/);
  assert.doesNotMatch(proof, /published-display-only/);
});

test('Inventory Edit opens from the authorized current master card and refreshes its summary without resetting entered controls', () => {
  const opener = functionBody(html, 'openInventoryEditRequestModal');
  assert.match(opener, /canUseInventoryEditMock\(compactEditItem\)/);
  assert.match(opener, /isMasterInventoryRowVisibleToCurrentUser\(compactEditItem\)/);
  assert.match(opener, /openInventoryEditRequestModal\(uid, \{ \.\.\.safeOptions, __displayMasterDetailFallback: true \}\)/);
  assert.ok(opener.indexOf('__displayMasterDetailFallback: true') < opener.indexOf('readExactWithSingleRevisionRaceRetry()'));
  assert.match(opener, /mergeExactMasterDetailFieldsPreservingLocalChanges\(compactEditItem, openingSnapshot, row\)/);
  assert.match(opener, /sourceView === getCurrentVisibleViewId|liveContextMatches\(\)/);
  assert.doesNotMatch(opener, /showToast\('Row Details Unavailable'/);
});
