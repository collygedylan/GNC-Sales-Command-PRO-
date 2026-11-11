function normalizedName(file) {
  return String(file?.name || '').trim().replace(/\.(gs|js)$/i, '');
}

export function mergeAppsScriptProjectFiles({ files, source, companionFiles = [] }) {
  if (!Array.isArray(files) || !files.length) throw new Error('APPS_SCRIPT_PROJECT_CONTENT_EMPTY');
  const companions = new Map();
  for (const file of companionFiles) {
    const name = normalizedName(file);
    if (!['PhotoArchiveReceiver','RequestCompletion'].includes(name) || file.type !== 'SERVER_JS' || !String(file.source || '').trim() || companions.has(name)) {
      throw new Error('APPS_SCRIPT_COMPANION_ALLOWLIST_INVALID');
    }
    companions.set(name, { ...file, name });
  }
  const result = [];
  const seen = new Set();
  for (const file of files) {
    const name = normalizedName(file);
    if (seen.has(name)) throw new Error('APPS_SCRIPT_PROJECT_DUPLICATE_FILE');
    seen.add(name);
    if (name === 'Code' && file.type !== 'SERVER_JS') throw new Error('APPS_SCRIPT_CODE_TYPE_INVALID');
    if (['PhotoArchiveReceiver','RequestCompletion'].includes(name) && file.type !== 'SERVER_JS') throw new Error('APPS_SCRIPT_COMPANION_TYPE_INVALID');
    if (name === 'Code' && file.type === 'SERVER_JS') result.push({ ...file, source });
    else if (companions.has(name)) {
      result.push({ ...file, ...companions.get(name) });
    } else result.push(file);
  }
  if (!seen.has('Code')) result.push({ name: 'Code', type: 'SERVER_JS', source });
  for (const [name, file] of companions) if (!seen.has(name)) result.push(file);
  if (source.includes('AgDataPhotoArchiveReceiver.') && !result.some(file => normalizedName(file) === 'PhotoArchiveReceiver')) {
    throw new Error('APPS_SCRIPT_PHOTO_ARCHIVE_COMPANION_MISSING');
  }
  if (source.includes('AgDataRequestCompletion.') && !result.some(file => normalizedName(file) === 'RequestCompletion')) {
    throw new Error('APPS_SCRIPT_REQUEST_COMPLETION_COMPANION_MISSING');
  }
  return result;
}
