import { normalizeRelease } from '../../scripts/deployment-fingerprint-lib.mjs';
import { mergeAppsScriptProjectFiles } from './apps-script-project-files.mjs';
import { assertAppsScriptDeploymentConfig, captureAppsScriptDeploymentConfig, isAmbiguousAppsScriptDeploymentUpdate,
  rollbackAppsScriptDeployment } from './apps-script-deployment-rollback.mjs';

async function updateProjectHead(context) {
  const { options: o, dependencies: d } = context;
  if (!o.scriptId) throw d.error('APPS_SCRIPT_SCRIPT_ID_MISSING');
  if (!String(o.source || '').trim()) throw d.error('APPS_SCRIPT_SOURCE_EMPTY');
  if (typeof o.beforeMutation !== 'function') throw d.error('APPS_SCRIPT_MUTATION_GUARD_INVALID');
  context.deploymentRequested = !!String(o.deploymentId || '').trim();
  context.deploymentSource = context.deploymentRequested ? d.applyDeploymentFingerprint(o.source, o.githubSha) : String(o.source);
  const current = await o.script.projects.getContent({ scriptId: o.scriptId });
  const files = mergeAppsScriptProjectFiles({ files: o.deployedBaseFiles ?? current.data?.files,
    source: context.deploymentSource, companionFiles: o.companionFiles });
  await o.beforeMutation();
  await o.script.projects.updateContent({ scriptId: o.scriptId, requestBody: { files } });
  context.versions = await d.listVersions(o.script, o.scriptId);
  context.versionCount = context.versions.length;
  context.versionCapacityExhausted = context.versionCount >= d.versionLimit;
  if (context.versionCount >= d.warningThreshold) {
    o.logger.warn(`WARNING: APPS_SCRIPT_VERSION_CAPACITY_LOW (${context.versionCount}/${d.versionLimit})`);
  }
}

function headResult(context) {
  return { ok: true, headUpdated: true, ...(context.options.headOnly ? { headOnly: true } : {}),
    versionCapacityExhausted: context.versionCapacityExhausted, versionCreated: false,
    versionCountBefore: context.versionCount, sourceUpdated: true, deploymentUpdated: false };
}

async function createProjectVersion(context) {
  const { options: o } = context;
  await o.beforeMutation();
  try {
    const response = await o.script.projects.versions.create({ scriptId: o.scriptId, requestBody: { description: context.description } });
    context.versionNumber = Number(response?.data?.versionNumber);
    return true;
  } catch (error) {
    const message = [error?.code, error?.message, error?.response?.data?.error?.message].join(' ');
    if (!/APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED|quota exceeded|maximum number of versions|version.{0,80}(?:limit|quota)/i.test(message)) throw error;
    context.versionCapacityExhausted = true;
    return false;
  }
}

async function recoverVersionCapacity(context) {
  const { options: o, dependencies: d } = context;
  const deleted = await d.tryDeleteVersion({ script: o.script, scriptId: o.scriptId, versions: context.versions,
    deleteVersionRequest: o.deleteVersionRequest, beforeMutation: o.beforeMutation, logger: o.logger });
  if (deleted == null) return;
  context.versions.splice(context.versions.findIndex(version => Number(version.versionNumber) === deleted), 1);
  context.versionCapacityExhausted = context.versions.length >= d.versionLimit;
  if (!context.versionCapacityExhausted) await createProjectVersion(context);
}

async function prepareProjectVersion(context) {
  const { options: o, dependencies: d } = context;
  const release = normalizeRelease(context.deploymentSource.match(/const APP_RELEASE_VERSION_\s*=\s*['"]([^'"]+)['"]/)?.[1]);
  context.description = release ? `${release} (${String(o.githubSha).slice(0, 7)})` : `GitHub Code.gs sync ${String(o.githubSha).slice(0, 7)}`;
  if (context.versionCapacityExhausted) await recoverVersionCapacity(context);
  else if (!(await createProjectVersion(context))) await recoverVersionCapacity(context);
  if (context.versionCapacityExhausted) {
    if (o.requireVersionCreation) throw d.error('APPS_SCRIPT_SCOPED_VERSION_CREATION_REQUIRED');
    context.versionNumber = Math.max(0, ...context.versions.map(version => Number(version.versionNumber)).filter(Number.isSafeInteger));
    o.logger.warn(`WARNING: APPS_SCRIPT_VERSION_CAPACITY_EXHAUSTED; @HEAD updated; web app retains existing version ${context.versionNumber}.`);
  }
  if (!Number.isInteger(context.versionNumber) || context.versionNumber <= 0) throw d.error('APPS_SCRIPT_VERSION_NUMBER_MISSING');
}

async function verifyProjectDeployment(context, target, candidateConfig) {
  const { options: o, dependencies: d } = context;
  const deployedVersionNumber = await d.verifyVersion({ script: o.script, scriptId: o.scriptId, deploymentId: o.deploymentId,
    versionNumber: context.versionNumber, sleep: o.sleep,
    onObservation: observation => o.logger.warn(`APPS_SCRIPT_DEPLOYMENT_VERSION_PENDING ${JSON.stringify(observation)}`) });
  if (o.rollbackDeployment) {
    await assertAppsScriptDeploymentConfig(target, candidateConfig, 'APPS_SCRIPT_SCOPED_CANDIDATE_CONFIG_MISMATCH');
  }
  let health = null;
  if (!context.versionCapacityExhausted) {
    await d.reconcileSigningKey({ deploymentId: o.deploymentId, serviceRoleKey: o.serviceRoleKey, githubSha: o.githubSha, fetchImpl: o.fetchImpl });
    health = await d.verifyHealth({ deploymentId: o.deploymentId, githubSha: o.githubSha, serviceRoleKey: o.serviceRoleKey,
      fetchImpl: o.fetchImpl, sleep: o.sleep, attempts: o.healthAttempts, retryDelayMs: o.healthRetryDelayMs });
  }
  if (o.verifyPublishedVersion) await o.verifyPublishedVersion(deployedVersionNumber);
  return { ok: true, headUpdated: true, versionCapacityExhausted: context.versionCapacityExhausted,
    versionCreated: !context.versionCapacityExhausted, versionCountBefore: context.versionCount,
    versionCountAfter: context.versions.length + (context.versionCapacityExhausted ? 0 : 1), sourceUpdated: true,
    deploymentUpdated: true, versionNumber: context.versionNumber, deployedVersionNumber, health };
}

async function recoverProjectDeployment(o, target, candidateConfig, publicationError) {
  if (!o.rollbackDeployment) return;
  try {
    const rolledBack = await rollbackAppsScriptDeployment({ target, ...o.rollbackDeployment, candidateConfig, sleep: o.sleep });
    if (rolledBack) o.logger.warn(`WARNING: APPS_SCRIPT_SCOPED_DEPLOYMENT_ROLLED_BACK (${candidateConfig.versionNumber} → ${o.rollbackDeployment.previousConfig.versionNumber})`);
  } catch (rollbackError) {
    const reason = String(rollbackError?.code || rollbackError?.message || '');
    const code = /^[A-Z0-9_]+$/.test(reason) ? reason : 'APPS_SCRIPT_SCOPED_ROLLBACK_FAILED';
    throw new AggregateError([publicationError, rollbackError], code);
  }
}

async function authorizeProjectDeployment(context, target) {
  const { options: o, dependencies: d } = context;
  if (!o.rollbackDeployment) return o.beforeMutation();
  const { previousConfig, authorize } = o.rollbackDeployment;
  const captured = captureAppsScriptDeploymentConfig(previousConfig);
  if (captured.versionNumber >= context.versionNumber || typeof authorize !== 'function') {
    throw d.error('APPS_SCRIPT_SCOPED_ROLLBACK_CONFIGURATION_INVALID');
  }
  await authorize();
  await assertAppsScriptDeploymentConfig(target, captured, 'APPS_SCRIPT_SCOPED_DEPLOYMENT_CHANGED');
}

async function publishProjectDeployment(context) {
  const { options: o } = context;
  const target = { script: o.script, scriptId: o.scriptId, deploymentId: o.deploymentId };
  const candidateConfig = { versionNumber: context.versionNumber,
    manifestFileName: o.rollbackDeployment?.previousConfig?.manifestFileName ?? 'appsscript',
    description: context.versionCapacityExhausted ? `Existing version ${context.versionNumber}; @HEAD synced ${String(o.githubSha).slice(0, 7)}` : context.description };
  await authorizeProjectDeployment(context, target);
  let acknowledged = false;
  try {
    await o.script.projects.deployments.update({ scriptId: o.scriptId, deploymentId: o.deploymentId,
      requestBody: { deploymentConfig: candidateConfig } }, o.rollbackDeployment ? { timeout: 12000, retry: false } : undefined);
    acknowledged = true;
    const result = await verifyProjectDeployment(context, target, candidateConfig);
    if (o.recordDeploymentEvidence) await o.recordDeploymentEvidence(result, candidateConfig);
    else if (o.rollbackDeployment) {
      await assertAppsScriptDeploymentConfig(target, candidateConfig, 'APPS_SCRIPT_SCOPED_CANDIDATE_CONFIG_MISMATCH');
    }
    return result;
  } catch (error) {
    if (acknowledged || isAmbiguousAppsScriptDeploymentUpdate(error)) {
      await recoverProjectDeployment(o, target, candidateConfig, error);
    }
    throw error;
  }
}

export async function synchronizeAppsScriptProject(options, dependencies) {
  const context = { options, dependencies };
  await updateProjectHead(context);
  if (options.headOnly || !context.deploymentRequested) return headResult(context);
  await prepareProjectVersion(context);
  if (options.verifyPreparedVersion) await options.verifyPreparedVersion(context.versionNumber);
  if (options.afterPreparedVersion) await options.afterPreparedVersion(context.versionNumber);
  return publishProjectDeployment(context);
}
