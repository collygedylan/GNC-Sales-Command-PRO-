import { createHmac, timingSafeEqual } from 'node:crypto';

const HEALTH_ACTOR = Object.freeze({ system: 'apps-script-deployment-health' });

export function createSignedAppsScriptActionEnvelope(command, serviceRoleKey, now = Date.now()) {
  const key = String(serviceRoleKey || '').trim();
  if (!key) throw new Error('APPS_SCRIPT_SIGNING_KEY_MISSING');
  const timestamp = new Date(Number(now)).toISOString();
  const deliveryJson = JSON.stringify(command);
  const signature = createHmac('sha256', key).update(`${timestamp}.${deliveryJson}`).digest('base64url');
  return { type: 'apps_script_action_v1', timestamp, signature, deliveryJson };
}

export function createSignedDeploymentHealthEnvelope(serviceRoleKey, now = Date.now()) {
  return createSignedAppsScriptActionEnvelope({
    contractVersion: 'apps-script-action-v1',
    action: 'deployment_health',
    payload: { type: 'deployment_health' },
    actor: HEALTH_ACTOR
  }, serviceRoleKey, now);
}

export function createSignedLifecycleCanaryEnvelope(payload, serviceRoleKey, now = Date.now()) {
  return createSignedAppsScriptActionEnvelope({
    contractVersion: 'apps-script-action-v1',
    action: 'email',
    payload,
    actor: { system: 'apps-script-lifecycle-canary' }
  }, serviceRoleKey, now);
}

export function isSignedDeploymentHealthEnvelope(body, serviceRoleKey, now = Date.now()) {
  const key = String(serviceRoleKey || '').trim();
  if (!key || !body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'deliveryJson,signature,timestamp,type'
      || body.type !== 'apps_script_action_v1') return false;
  const timestamp = String(body.timestamp || '');
  const timestampMs = Date.parse(timestamp);
  const deliveryJson = String(body.deliveryJson || '');
  if (!Number.isFinite(timestampMs) || Math.abs(Number(now) - timestampMs) > 300000 || !deliveryJson) return false;
  const expected = createHmac('sha256', key).update(`${timestamp}.${deliveryJson}`).digest();
  let command;
  let actual;
  try {
    command = JSON.parse(deliveryJson);
    actual = Buffer.from(String(body.signature || ''), 'base64url');
  } catch { return false; }
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) return false;
  return !!command && command.contractVersion === 'apps-script-action-v1'
    && command.action === 'deployment_health'
    && JSON.stringify(command.payload) === JSON.stringify({ type: 'deployment_health' })
    && JSON.stringify(command.actor) === JSON.stringify(HEALTH_ACTOR);
}
