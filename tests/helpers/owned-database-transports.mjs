import { parse } from 'acorn';
import { ancestor } from 'acorn-walk';

const policies = {
  uploadDrivePhotoWithNativeSession: [
    /attach_drive_photo_blob_v1/, /store_drive_photo_blob_v1/, /getNativeAuthRequestHeaders/,
    /epoch === nativeAuthRecoveryEpoch && owner === getSupabaseReadIdentityScope\(\)/,
    /assertCurrentPhotoUpload\(currentOwner, options\)/, /!headers\?\.Authorization/, /!response\.ok \|\| !saved\?\.id/,
    /p_idempotency_key/, /referrerPolicy:\s*'no-referrer'/,
  ],
  sendSuspendTagTransport: [
    /select_final_suspend_location_v23163/, /getNativeAuthRequestHeaders/, /headers\?\.Authorization/,
    /owner !== getSupabaseReadIdentityScope\(\)/, /!response\.ok/, /p_command_id/, /p_expected_version/,
  ],
  persistCanonicalRowUnlock: [
    /unlock_drive_evidence_v1/, /getNativeAuthRequestHeaders/, /headers\?\.Authorization/,
    /scope === getSupabaseReadIdentityScope\(\)/, /p_master_uid:key/, /result\.row\?\.unique_id/, /!response\.ok/,
  ],
  resolveReviewedWatchdogEvents: [
    /resolve_runtime_watchdog_events_v23158/, /getNativeAuthRequestHeaders/, /headers\?\.Authorization/,
    /scope !== getSupabaseReadIdentityScope\(\)/, /ids\.length > 250/, /WATCHDOG_REVIEW_RECEIPT_INVALID/,
  ],
  readOwnedRequestBatchReceipt: [
    /get_my_request_batch_receipt_v23162/, /getNativeAuthRequestHeaders/, /headers\?\.Authorization/,
    /owner !== getRequestSubmissionOwnerKey\(\)/, /ids\.length > 100/, /!response\.ok/,
  ],
  postReclassRecoveryRpc: [
    /reclass_transport_v1/, /getNativeAuthRequestHeaders/, /headers\?\.Authorization/,
    /scope !== getSupabaseReadIdentityScope\(\)/, /options\.signal\?\.aborted/,
    /!response\.ok/, /response\.status === 401/,
  ],
};

export function inspectOwnedDatabaseTransports(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const findings = [], counts = new Map();
  ancestor(ast, { CallExpression(node, ancestors) {
    if (!['fetch', 'fetchWithTimeout'].includes(node.callee?.name)) return;
    const first = node.arguments[0];
    if (!first || !source.slice(first.start, first.end).includes('/rest/v1/')) return;
    const owner = [...ancestors].reverse().find(item => item.type === 'FunctionDeclaration');
    const name = owner?.id?.name || '<unowned>';
    const rules = policies[name];
    if (!rules) { findings.push(`unowned direct database transport: ${name}`); return; }
    counts.set(name, (counts.get(name) || 0) + 1);
    const body = source.slice(owner.start, owner.end);
    for (const rule of rules) if (!rule.test(body)) findings.push(`${name}: missing owner invariant ${rule}`);
  } });
  for (const [name, count] of counts) if (count !== 1) findings.push(`${name}: unexpected direct transport count ${count}`);
  return findings;
}
