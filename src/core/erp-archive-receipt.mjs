function driveHeaders(token, extra = {}) {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra };
}

async function requestMetadata(fetcher, token, file, api) {
  const url = api.driveUrl(`files/${encodeURIComponent(file.id)}`,
    { fields: 'id,parents,modifiedTime,sha256Checksum,version,headRevisionId', supportsAllDrives: true });
  const response = await fetcher(url, { headers: driveHeaders(token), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ERP_DRIVE_API_${response.status}`);
  const data = await response.json();
  const etag = response.headers.get('etag') || '';
  return { data, etag: etag && !etag.startsWith('W/') ? etag : '' };
}

async function contentHash(fetcher, token, file, metadata, api) {
  if (metadata.sha256Checksum) return String(metadata.sha256Checksum).toLowerCase();
  const bytes = await api.sourceBytes(fetcher, token, file);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function verifiedMetadata(fetcher, token, file, api) {
  const first = await requestMetadata(fetcher, token, file, api);
  if (!first.data.version || !Array.isArray(first.data.parents) || !first.data.parents.length) {
    throw new Error('ERP_ARCHIVE_IDENTITY_UNAVAILABLE');
  }
  const digest = await contentHash(fetcher, token, file, first.data, api);
  const latest = await requestMetadata(fetcher, token, file, api);
  if (latest.data.version !== first.data.version || digest !== file.publishedContentHash) {
    throw new Error('ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE');
  }
  return latest;
}

async function patchParents(fetcher, token, file, add, remove, etag, api) {
  const url = api.driveUrl(`files/${encodeURIComponent(file.id)}`, {
    addParents: add.join(','), removeParents: remove.join(','),
    fields: 'id,parents,modifiedTime,sha256Checksum,version,headRevisionId', supportsAllDrives: true
  });
  const response = await fetcher(url, { method: 'PATCH', headers: driveHeaders(token, etag ? { 'if-match': etag } : {}),
    signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(response.status === 412 ? 'ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE' : `ERP_DRIVE_API_${response.status}`);
  return response.json();
}

async function restorePendingParents(fetcher, token, file, originalParents, destination, api) {
  const latest = await requestMetadata(fetcher, token, file, api);
  const parents = Array.isArray(latest.data.parents) ? latest.data.parents : [];
  if (!parents.includes(destination)) return;
  if (parents.some(id => id !== destination && !originalParents.includes(id))) {
    throw new Error('ERP_ARCHIVE_PARENT_CHANGED');
  }
  const add = originalParents.filter(id => !parents.includes(id));
  await patchParents(fetcher, token, file, add, [destination], latest.etag, api);
}

export async function moveVerifiedErpFile(fetcher, token, file, parentId, configuredId, api) {
  const before = await verifiedMetadata(fetcher, token, file, api);
  const originalParents = before.data.parents.map(String);
  const destination = await api.processedFolder(fetcher, token, parentId, configuredId);
  if (originalParents.includes(destination)) return;
  try { await patchParents(fetcher, token, file, [destination], originalParents, before.etag, api); }
  catch (error) {
    if (error?.message === 'ERP_DRIVE_SOURCE_CHANGED_BEFORE_ARCHIVE') throw error;
    try { await restorePendingParents(fetcher, token, file, originalParents, destination, api); }
    catch { throw new Error('ERP_ARCHIVE_RESTORE_FAILED'); }
    throw error;
  }
  try {
    const after = await verifiedMetadata(fetcher, token, file, api);
    if (!after.data.parents.includes(destination)) throw new Error('ERP_ARCHIVE_DESTINATION_UNCONFIRMED');
  } catch (error) {
    try { await restorePendingParents(fetcher, token, file, originalParents, destination, api); }
    catch { throw new Error('ERP_ARCHIVE_RESTORE_FAILED'); }
    throw error;
  }
}
