import { verifyAppsScriptDeploymentOwnership } from '../../scripts/lib/production-release-guard.mjs';

const observationDelays = [0, 1000, 2000, 4000, 5000, 5000];
export const APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS = 'deploymentId,deploymentConfig(versionNumber,manifestFileName,description)';

export function sameAppsScriptDeploymentConfig(left, right) {
  return Boolean(left && right && left.versionNumber === right.versionNumber
    && left.manifestFileName === right.manifestFileName && (left.description ?? '') === (right.description ?? ''));
}

export function captureAppsScriptDeploymentConfig(config) {
  const { versionNumber, manifestFileName } = config ?? {};
  const description = config?.description ?? '';
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1 || typeof manifestFileName !== 'string'
    || !manifestFileName.trim() || typeof description !== 'string') throw new Error('APPS_SCRIPT_DEPLOYMENT_CONFIG_UNVERIFIED');
  return { versionNumber, manifestFileName, description };
}

async function readDeploymentConfig(target) {
  const deployment = await verifyAppsScriptDeploymentOwnership({ ...target, fields: APPS_SCRIPT_DEPLOYMENT_CONFIG_FIELDS,
    requestOptions: { timeout: 3000, retry: false } });
  return captureAppsScriptDeploymentConfig(deployment.deploymentConfig);
}

export async function assertAppsScriptDeploymentConfig(target, expected, errorCode) {
  if (!sameAppsScriptDeploymentConfig(await readDeploymentConfig(target), expected)) throw new Error(errorCode);
}

export function appsScriptApiStatus(error) {
  const status = Number(error?.response?.status ?? error?.response?.statusCode ?? error?.status ?? error?.statusCode ?? error?.code);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function isAmbiguousAppsScriptDeploymentUpdate(error) {
  const status = appsScriptApiStatus(error);
  return status === null || status === 408 || status >= 500;
}

async function observeConfigTransition({ target, from, to, sleep, externalCode }) {
  let readError;
  for (const delay of observationDelays) {
    if (delay) await sleep(delay);
    let active;
    try {
      active = await readDeploymentConfig(target);
      readError = undefined;
    } catch (error) {
      readError = error;
      continue;
    }
    if (sameAppsScriptDeploymentConfig(active, to)) return true;
    if (!sameAppsScriptDeploymentConfig(active, from)) throw new Error(externalCode);
  }
  if (readError) throw readError;
  return false;
}

export async function rollbackAppsScriptDeployment({ target, previousConfig, candidateConfig, authorize, sleep }) {
  const externalCode = 'APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED_DURING_ROLLBACK';
  const observe = (from, to) => observeConfigTransition({ target, from, to, sleep, externalCode });
  if (!await observe(previousConfig, candidateConfig)) return false;
  await authorize();
  const active = await readDeploymentConfig(target);
  if (sameAppsScriptDeploymentConfig(active, previousConfig)) return false;
  if (!sameAppsScriptDeploymentConfig(active, candidateConfig)) throw new Error(externalCode);
  const { script, scriptId, deploymentId } = target;
  await script.projects.deployments.update({ scriptId, deploymentId,
    requestBody: { deploymentConfig: previousConfig } }, { timeout: 12000, retry: false });
  if (!await observe(candidateConfig, previousConfig)) throw new Error('APPS_SCRIPT_SCOPED_ROLLBACK_READBACK_MISMATCH');
  return true;
}
