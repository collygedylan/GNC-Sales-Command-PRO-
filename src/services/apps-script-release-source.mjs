export const APPS_SCRIPT_RELEASE_SOURCE_PATHS = Object.freeze([
  'Code.gs',
  'src/services/photo-archive-receiver.mjs',
  'scripts/build-photo-archive-receiver.mjs',
]);

export function isAppsScriptReleaseSource(path) {
  return APPS_SCRIPT_RELEASE_SOURCE_PATHS.includes(path);
}

export function sameAppsScriptSourceBlobs(expected, observed) {
  const isBlob = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (!Array.isArray(expected) || expected.length !== APPS_SCRIPT_RELEASE_SOURCE_PATHS.length
    || !Array.isArray(observed) || observed.length !== expected.length || !isBlob(expected[0])) return false;
  const companions = expected.slice(1);
  return (companions.every(isBlob) || companions.every(blob => blob === null))
    && expected.every((blob, index) => blob === observed[index]);
}
