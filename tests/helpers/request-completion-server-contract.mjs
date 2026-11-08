import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
export function requestCompletionServerContract() {
  const source = readFileSync(new URL('../../supabase/functions/app-api/index.ts', import.meta.url), 'utf8');
  const manualSyncStart = source.lastIndexOf('if (action === "manual_sync_status")');
  const requestWorkStart = source.lastIndexOf('if (action === "request_work")', manualSyncStart);
  const command = source.slice(requestWorkStart, manualSyncStart);
  assert.doesNotMatch(command, /app_dataset_revisions/);
  assert.doesNotMatch(command, /retryData|retryError/);
  assert.match(source, /let \{data,error\} = await supabase\.rpc\("request_work_command_v1"/);
  assert.match(command, /expectedLifecycle = payload\.complete === true \? "completed_history" : "pending_active"/);
  assert.match(command, /REQUEST_LIFECYCLE_UNCONFIRMED/);
  assert.match(command, /REQUEST_VERSION_CONFLICT/);
  assert.match(command, /p_expected_version: Number\(latest\.data\.row_version\)/);
  assert.match(command, /request_completion_receipt_v2372/);
}
