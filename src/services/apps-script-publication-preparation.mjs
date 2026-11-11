import { buildPhotoArchiveReceiver } from '../../scripts/build-photo-archive-receiver.mjs';
import { patchAppsScriptFunctions, appsScriptFilesDigest, PHOTO_ARCHIVE_PATCH_FUNCTIONS } from '../../scripts/apps-script-function-patch.mjs';
import { mergeAppsScriptProjectFiles } from './apps-script-project-files.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

async function buildRequestCompletionCompanions(source) {
  if (!source.includes('AgDataRequestCompletion.')) return [];
  const result = await build({entryPoints:[fileURLToPath(new URL('./request-completion-email.js',import.meta.url))],
    bundle:true,write:false,format:'iife',globalName:'AgDataRequestCompletion',platform:'neutral',target:'es2020'});
  return [{name:'RequestCompletion',type:'SERVER_JS',source:result.outputFiles[0].text}];
}

async function buildPhotoArchiveCompanions(source, selected) {
  if (!source.includes('AgDataPhotoArchiveReceiver.')
    || (selected && !selected.some(name => PHOTO_ARCHIVE_PATCH_FUNCTIONS.includes(name)))) return [];
  return [{ name: 'PhotoArchiveReceiver', type: 'SERVER_JS', source: await buildPhotoArchiveReceiver() }];
}

function selectPatchFunctions(manifest, scoped) {
  const allowed = manifest.appsScriptPatchFunctions;
  if (!scoped) return allowed;
  const selected = manifest.appsScriptScopedPatchFunctions;
  if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length
    || !Array.isArray(allowed) || selected.some(name => typeof name !== 'string' || !name || !allowed.includes(name))) {
    throw new Error('APPS_SCRIPT_SCOPED_FUNCTIONS_INVALID');
  }
  return selected;
}

export async function prepareAppsScriptPublication({ script, scriptId, source, manifest, githubSha, applyFingerprint, deployedVersion }) {
  const functionNames = selectPatchFunctions(manifest, Boolean(deployedVersion));
  if (functionNames === undefined) {
    const companionFiles = [...await buildPhotoArchiveCompanions(source),...await buildRequestCompletionCompanions(source)];
    return { source, companionFiles, patchEvidence: null, expectedRemoteDigest: '', publishedDigest: '' };
  }
  const current = await script.projects.getContent({ scriptId });
  const headFiles = current.data?.files;
  const files = deployedVersion ? (await script.projects.getContent({ scriptId, versionNumber: deployedVersion })).data?.files : headFiles;
  const code = files?.find(file => String(file.name).replace(/\.(gs|js)$/i, '') === 'Code' && file.type === 'SERVER_JS');
  if (!code?.source) throw new Error('APPS_SCRIPT_PATCH_REMOTE_SOURCE_MISSING');
  const patch = patchAppsScriptFunctions({ remoteSource: code.source, localSource: source, functionNames,
    includeRelease: manifest.appsScriptPatchRelease === true });
  const companionFiles = [...await buildPhotoArchiveCompanions(patch.source, deployedVersion ? functionNames : undefined),
    ...await buildRequestCompletionCompanions(patch.source)];
  const expectedRemoteDigest = appsScriptFilesDigest(headFiles);
  const published = mergeAppsScriptProjectFiles({ files, source: applyFingerprint(patch.source, githubSha), companionFiles });
  const publishedDigest = appsScriptFilesDigest(published);
  return { source: patch.source, companionFiles, expectedRemoteDigest, publishedDigest, headFiles,
    deployedBaseFiles: deployedVersion ? files : undefined,
    patchEvidence: { functions: patch.functions, protectedSourceDigest: patch.protectedSourceDigest,
      remoteFilesDigestBefore: expectedRemoteDigest, remoteFilesDigestAfter: publishedDigest } };
}

export async function verifyScopedAppsScriptFiles({ script, scriptId, versionNumber, expectedDigest }) {
  const installed = await script.projects.getContent({ scriptId, versionNumber });
  if (appsScriptFilesDigest(installed.data?.files || []) !== expectedDigest) {
    throw new Error('APPS_SCRIPT_SCOPED_DEPLOYED_FILES_MISMATCH');
  }
}

export async function restoreAppsScriptHead({ script, scriptId, headFiles, expectedRemoteDigest, publishedDigest, authorize }) {
  const current = await script.projects.getContent({ scriptId });
  const currentDigest = appsScriptFilesDigest(current.data?.files || []);
  if (currentDigest === expectedRemoteDigest) return;
  if (currentDigest !== publishedDigest) throw new Error('APPS_SCRIPT_SCOPED_HEAD_CHANGED_DURING_RELEASE');
  await authorize();
  const before = await script.projects.getContent({ scriptId });
  if (appsScriptFilesDigest(before.data?.files || []) !== publishedDigest) throw new Error('APPS_SCRIPT_SCOPED_HEAD_CHANGED_DURING_RELEASE');
  await script.projects.updateContent({ scriptId, requestBody: { files: headFiles } });
  const restored = await script.projects.getContent({ scriptId });
  if (appsScriptFilesDigest(restored.data?.files || []) !== expectedRemoteDigest) throw new Error('APPS_SCRIPT_SCOPED_HEAD_RESTORE_MISMATCH');
}
