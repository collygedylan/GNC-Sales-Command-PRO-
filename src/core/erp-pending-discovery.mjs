const FOLDER_MIME = 'application/vnd.google-apps.folder';

function eligiblePendingFile(file, stage) {
  const name = String(file?.name || '');
  if (!file?.id || file.mimeType === FOLDER_MIME || /^(?:temp_|~\$)/i.test(name)) return false;
  return stage === 'hl_po_parsed' ? /\.pdf$/i.test(name) : /\.(?:xlsx|xls|csv)$/i.test(name);
}

function isDriveDropFolder(file) {
  return file?.mimeType === FOLDER_MIME && /^drivearound$/i.test(String(file.name || '').trim());
}

async function driveRoots(fetcher, token, folderId, api) {
  const roots = new Set([folderId]);
  const metadata = await api.driveJson(fetcher, token, `files/${encodeURIComponent(folderId)}`,
    { fields: 'id,name,parents', supportsAllDrives: true });
  for (const parentId of metadata.parents || []) {
    const parent = await api.driveJson(fetcher, token, `files/${encodeURIComponent(parentId)}`,
      { fields: 'id,name', supportsAllDrives: true });
    if (isDriveDropFolder({ ...parent, mimeType: FOLDER_MIME })) roots.add(parentId);
  }
  return [...roots];
}

async function walkDropFolders(fetcher, token, roots, excluded, api) {
  const visited = new Set();
  const pending = [...roots];
  const files = [];
  while (pending.length) {
    const id = pending.shift();
    if (!id || visited.has(id) || excluded.has(id)) continue;
    if (visited.size >= 1000) throw new Error('ERP_DROP_FOLDER_LIMIT');
    visited.add(id);
    const children = await api.listFiles(fetcher, token, id);
    for (const child of children) {
      if (child.mimeType !== FOLDER_MIME) { files.push(child); continue; }
      if (/^(?:processed|archive)$/i.test(String(child.name || '').trim())) continue;
      if (!visited.has(child.id) && !excluded.has(child.id)) pending.push(child.id);
    }
  }
  return files;
}

export async function discoverPendingErpFiles(fetcher, token, folders, stage, api) {
  const folderId = String(folders[stage.key] || api.sourceFolders[stage.key]?.[0] || '').trim();
  if (!folderId) throw new Error('ERP_DROP_FOLDER_ID_MISSING');
  const roots = stage.key === 'drive' ? await driveRoots(fetcher, token, folderId, api) : [folderId];
  const excluded = new Set([folders.processed?.[stage.key], folders[`${stage.key}_processed`],
    api.sourceFolders[stage.key]?.[1]].filter(Boolean));
  const files = (await walkDropFolders(fetcher, token, roots, excluded, api))
    .filter(file => eligiblePendingFile(file, stage.key));
  return [...new Map(files.map(file => [file.id, file])).values()]
    .sort((left, right) => api.compareErpFiles(right, left));
}

async function findLegacyByName(fetcher, token, stage, api, eligible, files) {
  const names = { drive: ['DriveAroundMC-10'], soc: ['SOC-10 Open Orders'],
    reserves: ['SOC-10 Reserves'], cav: ['Dylan Wide Open', 'CAV'] }[stage.key];
  if (!names) return;
  const query = 'trashed=false and (' + names.map(name => "name contains '" + name + "'").join(' or ') + ')';
  try { files.push(...(await api.listFiles(fetcher, token, '', true, query)).filter(eligible)); }
  catch (error) { if (!files.length) throw error; }
}

export async function discoverLatestErpFile(fetcher, token, folders, stage, api) {
  const folderId = String(folders[stage.key] || api.sourceFolders[stage.key]?.[0] || '').trim();
  if (!folderId) throw new Error('ERP_DROP_FOLDER_ID_MISSING');
  const processed = folders.processed?.[stage.key] || folders[`${stage.key}_processed`];
  const metadata = await api.driveJson(fetcher, token, `files/${encodeURIComponent(folderId)}`,
    { fields: 'id,parents', supportsAllDrives: true }).catch(() => ({}));
  const locations = [...new Set([folderId, processed, ...(metadata.parents || []),
    ...(api.sourceFolders[stage.key] || [])].filter(Boolean))];
  const prefixes = { drive: /^DriveAround/i, cav: /^(?:Dylan Wide Open|CAV)/i,
    reserves: /^SOC-10\s+Reserves/i, soc: /^SOC-10\s+Open Orders/i };
  const eligible = file => prefixes[stage.key]?.test(file.name || '') && eligiblePendingFile(file, stage.key);
  const batches = await Promise.allSettled(locations.map(id => api.listFiles(fetcher, token, id, true)));
  const files = batches.flatMap(batch => batch.status === 'fulfilled' ? batch.value : []).filter(eligible);
  const drop = batches[locations.indexOf(folderId)];
  if (drop?.status !== 'fulfilled' || !drop.value.some(eligible)) {
    await findLegacyByName(fetcher, token, stage, api, eligible, files);
  }
  if (!files.length && batches.every(batch => batch.status === 'rejected')) throw new Error('ERP_DROP_FOLDER_READ_FAILED');
  return [...new Map(files.map(file => [file.id, file])).values()].sort(api.compareErpFiles).slice(0, 1);
}
