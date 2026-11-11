import { discoverPendingErpFiles } from './erp-pending-discovery.mjs';

async function listSecondaryStage(fetcher, token, stage, api, pendingOnly) {
  if (stage.key === 'hl_po_parsed' && pendingOnly) {
    return discoverPendingErpFiles(fetcher, token,
      { [stage.key]: stage.folder, processed: { [stage.key]: stage.processed } }, stage,
      { listFiles: api.listFiles, driveJson: api.driveJson, compareErpFiles: api.compare, sourceFolders: {} });
  }
  let files = await api.listFiles(fetcher, token, stage.folder);
  if (stage.includeParent) {
    const parent = await api.driveJson(fetcher, token, `files/${stage.folder}`,
      { fields: 'parents', supportsAllDrives: true });
    const lists = await Promise.all((parent.parents || []).map(id => api.listFiles(fetcher, token, id)));
    files = [...files, ...lists.flat()];
    if (stage.key === 'hl_po_parsed') files.push(...await api.listFiles(fetcher, token, stage.processed));
  }
  const eligible = files.filter(file => file.id && file.mimeType !== 'application/vnd.google-apps.folder'
    && !api.shouldIgnore(file.name) && (stage.key !== 'hl_po_parsed' || /\.pdf$/i.test(file.name || '')));
  const unique = [...new Map(eligible.map(file => [file.id, file])).values()];
  return stage.key === 'hl_po_parsed' ? unique.sort(api.compare).slice(0, 1) : unique;
}

export async function discoverSecondaryFolders(fetcher, token, stages, api, pendingOnly = false) {
  return Object.fromEntries(await Promise.all(stages.map(async stage => {
    const started = performance.now();
    const files = await listSecondaryStage(fetcher, token, stage, api, pendingOnly);
    return [stage.key, { files, listDurationMs: Math.round(performance.now() - started) }];
  })));
}
