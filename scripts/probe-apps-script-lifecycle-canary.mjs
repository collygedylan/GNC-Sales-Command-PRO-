const deploymentId = String(process.env.APPS_SCRIPT_DEPLOYMENT_ID || '').trim();
const requiredRecipients = [
  'dylan_collyge@greenleafnursery.com',
  'jd_jones@greenleafnursery.com',
  'kayla_knepp@greenleafnursery.com'
];
const expectedPolicyVersion = 'plant-request-lifecycle-v2';

if (!deploymentId) throw new Error('APPS_SCRIPT_DEPLOYMENT_ID_MISSING');

const endpoint = `https://script.google.com/macros/s/${encodeURIComponent(deploymentId)}/exec`;

async function post(payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok || result?.ok !== true) {
    throw new Error(`APPS_SCRIPT_LIFECYCLE_CANARY_HTTP_${response.status}`);
  }
  return result;
}

function assertReceipt(result, expectedMode = '') {
  const recipients = Array.isArray(result?.recipients)
    ? [...new Set(result.recipients.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].sort()
    : [];
  const expected = requiredRecipients.slice().sort();
  if (JSON.stringify(recipients) !== JSON.stringify(expected)) {
    throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_RECIPIENT_MISMATCH');
  }
  if (result.lifecycleRecipientPolicyVersion !== expectedPolicyVersion) {
    throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_POLICY_MISMATCH');
  }
  if (Number(result.requiredRecipientCount) !== requiredRecipients.length || result.requiredRecipientsSatisfied !== true) {
    throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_REQUIRED_RECIPIENTS_UNVERIFIED');
  }
  if (result.submitterRecorded !== true || result.submitterIncluded !== true) {
    throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_SUBMITTER_UNVERIFIED');
  }
  if (expectedMode && result.mode !== expectedMode) {
    throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_THREAD_MODE_MISMATCH');
  }
}

const canaryId = `INTERNAL-LIFECYCLE-CANARY-${Date.now()}`;
const sharedPayload = {
  type: 'email',
  folderId: canaryId,
  requestFolder: canaryId,
  customer: 'INTERNAL TEST - NO CUSTOMER DATA',
  requestedBy: 'dylan_collyge',
  repName: 'dylan_collyge',
  requestCreatedByUsername: 'dylan_collyge',
  submittedByUsername: 'dylan_collyge',
  internalRecipients: requiredRecipients,
  itemsCount: 1,
  requestItems: [{
    unique_id: `${canaryId}-ITEM`,
    commonname: 'INTERNAL TEST ITEM',
    contsize: 'TEST',
    locationcode: 'TEST',
    lotcode: 'TEST',
    qty: 1,
    request_created_by_username: 'dylan_collyge'
  }]
};

const submitted = await post({ ...sharedPayload, emailType: 'new_request' });
assertReceipt(submitted);
if (!String(submitted.threadId || '').trim() || !String(submitted.messageId || '').trim()) {
  throw new Error('APPS_SCRIPT_LIFECYCLE_CANARY_THREAD_METADATA_MISSING');
}

const completed = await post({
  ...sharedPayload,
  emailType: 'request_complete',
  threadId: submitted.threadId,
  messageId: submitted.messageId
});
assertReceipt(completed, 'gmail_api_threaded');

process.stdout.write(`${JSON.stringify({
  ok: true,
  submitted: true,
  completed: true,
  threaded: true,
  recipientCount: requiredRecipients.length,
  lifecycleRecipientPolicyVersion: expectedPolicyVersion,
  submitterRecorded: true
})}\n`);
