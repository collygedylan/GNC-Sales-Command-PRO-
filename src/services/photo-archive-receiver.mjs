export function photoArchiveCanonicalRequest(payload) {
  return JSON.stringify([payload.type, payload.action, payload.timestamp, payload.nonce, payload.folderId,
    payload.fileName, payload.sourceKey, payload.sha256, payload.folderIds, payload.archivePaths,
    payload.driveFileId, payload.sourceSize, payload.mimeType]);
}

export function validatePhotoArchivePaths(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Photo archive paths are invalid.');
  const paths = value.map(path => {
    if (!Array.isArray(path) || path.length !== 5) throw new Error('Photo archive path must contain five folders.');
    return path.map(part => {
      if (typeof part !== 'string' || !part.trim() || part.length > 500 || /[\u0000-\u001f]/.test(part)) {
        throw new Error('Photo archive folder name is invalid.');
      }
      return part;
    });
  });
  const unique = new Map(paths.map(path => [JSON.stringify(path), path]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, path]) => path);
}

function iteratorValues(iterator) {
  const entries = [];
  while (iterator.hasNext()) entries.push(iterator.next());
  return entries.sort((left, right) => left.getId().localeCompare(right.getId()));
}

function findOrCreateFolder(parent, name) {
  return iteratorValues(parent.getFoldersByName(name))[0] || parent.createFolder(name);
}

function archiveFolders(root, paths) {
  if (!paths.length) return [{ path: [], folder: root }];
  return paths.map(path => ({ path, folder: path.reduce(findOrCreateFolder, root) }));
}

function verifiedFileReceipt(file, expected, hashBytes) {
  const actualHash = hashBytes(file.getBlob().getBytes());
  if (file.getSize() !== expected.size || actualHash !== expected.sha256) {
    throw new Error('Google Drive verification did not match the source file.');
  }
  return { id: file.getId(), name: file.getName(), size: file.getSize(), sha256: actualHash };
}

export function photoArchiveIdentityMatches(metadata, sourceKey, sha256) {
  return metadata?.archive === 'gnc-supabase-photo'
    && metadata.sourceKey === sourceKey && metadata.sha256 === sha256;
}

export function parsePhotoArchiveDescription(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

export function photoArchiveDescription(source, path) {
  return JSON.stringify({ archive: 'gnc-supabase-photo', sourceKey: source.sourceKey,
    sha256: source.sha256, originalName: source.name, archivePath: path });
}

function existingArchive(folder, name, sourceKey, sha256) {
  const matches = iteratorValues(folder.getFilesByName(name));
  const verified = matches.find(file => photoArchiveIdentityMatches(
    parsePhotoArchiveDescription(file.getDescription()), sourceKey, sha256));
  return verified || matches.find(file => !file.getDescription());
}

function storeArchiveCopy(target, source, dependencies) {
  const { hashBytes, utilities } = dependencies;
  const extension = source.name.match(/\.[a-z0-9]{1,10}$/i)?.[0] || '';
  const name = `${source.sourceKey}__${source.sha256}${extension.toLowerCase()}`;
  const existing = existingArchive(target.folder, name, source.sourceKey, source.sha256);
  if (existing) {
    const receipt = verifiedFileReceipt(existing, source, hashBytes);
    if (!existing.getDescription()) existing.setDescription(photoArchiveDescription(source, target.path));
    return { ...receipt, folderId: target.folder.getId(), path: target.path };
  }
  const file = target.folder.createFile(utilities.newBlob(source.bytes, source.mimeType, name));
  try {
    file.setDescription(photoArchiveDescription(source, target.path));
    return { ...verifiedFileReceipt(file, source, hashBytes), folderId: target.folder.getId(), path: target.path };
  } catch (error) {
    file.setTrashed(true);
    throw error;
  }
}

function archiveSource(payload, dependencies) {
  const bytes = dependencies.utilities.base64Decode(String(payload.imageBase64 || ''));
  if (!bytes.length || bytes.length > dependencies.maxBytes) throw new Error('Photo archive file size is invalid.');
  const sha256 = dependencies.hashBytes(bytes);
  if (sha256 !== String(payload.sha256 || '').toLowerCase()) throw new Error('Photo archive source hash does not match.');
  const sourceKey = String(payload.sourceKey || '');
  if (!/^[a-f0-9]{64}$/i.test(sourceKey)) throw new Error('Photo archive source identity is invalid.');
  return { bytes, size: bytes.length, sha256, sourceKey,
    name: dependencies.sanitizeName(payload.fileName || 'archived-photo'),
    mimeType: String(payload.mimeType || 'application/octet-stream').trim() };
}

function uploadArchive(payload, dependencies) {
  const root = dependencies.requireRoot(payload.folderId);
  const paths = validatePhotoArchivePaths(payload.archivePaths);
  if (paths.length && root.getId() !== dependencies.requestPhotoRoot) {
    throw new Error('Request archive paths require the approved Request photo root.');
  }
  const source = archiveSource(payload, dependencies);
  if (!dependencies.lock.tryLock(10_000)) throw new Error('Photo archive worker is busy; retry this request.');
  try {
    const copies = archiveFolders(root, paths).map(target => storeArchiveCopy(target, source, dependencies));
    return { ok: true, verified: true, ...copies[0], rootFolderId: root.getId(),
      sourceKey: source.sourceKey, archiveCopies: copies };
  } finally {
    dependencies.lock.releaseLock();
  }
}

function existingArchiveSource(payload, dependencies) {
  const driveFileId = String(payload.driveFileId || '').trim();
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(driveFileId)) throw new Error('Archived Drive file identity is invalid.');
  const file = dependencies.getFileById(driveFileId);
  if (file.isTrashed?.()) throw new Error('Archived Drive source is unavailable.');
  const expectedSize = Number(payload.sourceSize);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || file.getSize() !== expectedSize
    || expectedSize > dependencies.maxBytes) {
    throw new Error('Archived Drive source did not match its verified receipt.');
  }
  const sourceKey = String(payload.sourceKey || '');
  if (!/^[a-f0-9]{64}$/i.test(sourceKey)) throw new Error('Photo archive source identity is invalid.');
  const sha256 = String(payload.sha256 || '').toLowerCase();
  const description = file.getDescription();
  const identity = description ? parsePhotoArchiveDescription(description) : dependencies.getArchiveProperties?.(driveFileId);
  if (!photoArchiveIdentityMatches(identity, sourceKey, sha256)) {
    throw new Error('Archived Drive source metadata did not match its receipt.');
  }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length !== expectedSize || dependencies.hashBytes(bytes) !== sha256) {
    throw new Error('Archived Drive source bytes did not match its receipt.');
  }
  return { bytes, size: expectedSize, sha256, sourceKey,
    name: dependencies.sanitizeName(payload.fileName || file.getName() || 'archived-photo'),
    mimeType: String(payload.mimeType || blob.getContentType?.() || 'application/octet-stream').trim() };
}

function copyExistingArchive(payload, dependencies) {
  const root = dependencies.requireRoot(payload.folderId);
  const paths = validatePhotoArchivePaths(payload.archivePaths);
  if (!paths.length || root.getId() !== dependencies.requestPhotoRoot) {
    throw new Error('Verified Request archive copies require approved five-folder paths.');
  }
  const source = existingArchiveSource(payload, dependencies);
  if (!dependencies.lock.tryLock(10_000)) throw new Error('Photo archive worker is busy; retry this request.');
  try {
    const copies = archiveFolders(root, paths).map(target => storeArchiveCopy(target, source, dependencies));
    return { ok: true, verified: true, recoveredFromDrive: true, ...copies[0],
      rootFolderId: root.getId(), sourceKey: source.sourceKey, archiveCopies: copies };
  } finally {
    dependencies.lock.releaseLock();
  }
}

export function createPhotoArchiveReceiver(dependencies) {
  return { handle(payload) {
    dependencies.verify(payload);
    if (payload.action === 'probe') {
      const folders = (Array.isArray(payload.folderIds) ? payload.folderIds : []).map(folderId => {
        const folder = dependencies.requireRoot(folderId);
        return { id: folder.getId(), name: folder.getName() };
      });
      return { ok: true, verified: true, folders };
    }
    if (payload.action === 'upload') return uploadArchive(payload, dependencies);
    if (payload.action === 'copy_existing') return copyExistingArchive(payload, dependencies);
    throw new Error('Unsupported photo archive action.');
  } };
}
