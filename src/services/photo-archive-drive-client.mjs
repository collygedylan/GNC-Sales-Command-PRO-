import { createHash, createHmac, randomBytes } from 'node:crypto';
import { parsePhotoArchiveDescription, photoArchiveCanonicalRequest, photoArchiveDescription,
  photoArchiveIdentityMatches, validatePhotoArchivePaths } from './photo-archive-receiver.mjs';

export { photoArchiveCanonicalRequest } from './photo-archive-receiver.mjs';

async function postArchive(endpoint, signed, fetchImpl) {
  const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'follow',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
  let body;
  try { body = JSON.parse(await response.text()); }
  catch { throw new Error(`Apps Script returned non-JSON ${response.status}.`); }
  if (!response.ok || body?.ok === false || body?.status === 'error') {
    throw new Error(`Apps Script ${response.status}: ${String(body?.message || body?.error || 'request failed').slice(0, 300)}`);
  }
  return body;
}

export function createAppsScriptDriveClient(deploymentId, signingKey, { retry, fetchImpl = globalThis.fetch }) {
  const endpoint = `https://script.google.com/macros/s/${encodeURIComponent(deploymentId)}/exec`;
  const call = async payload => {
    const signed = { type: 'photo_archive', ...payload, timestamp: Date.now(), nonce: randomBytes(18).toString('hex') };
    signed.signature = createHmac('sha256', signingKey).update(photoArchiveCanonicalRequest(signed)).digest('hex');
    return retry('Apps Script Drive request', () => postArchive(endpoint, signed, fetchImpl), { attempts: 3, baseMs: 1000 });
  };
  return {
    async verifyFolders(folderIds) {
      const result = await call({ action: 'probe', folderIds });
      if (result.verified !== true || !Array.isArray(result.folders) || result.folders.length !== folderIds.length) {
        throw new Error('Apps Script did not verify every archive folder.');
      }
      return result.folders;
    },
    async upload({ folderId, name, bytes, mimeType, sourceKey, sha256, archivePaths }) {
      const paths = validatePhotoArchivePaths(archivePaths);
      const result = await call({ action: 'upload', folderId, fileName: name, sourceKey, sha256,
        ...(paths.length ? { archivePaths: paths } : {}), mimeType: mimeType || 'application/octet-stream', imageBase64: bytes.toString('base64') });
      const root = result.rootFolderId || result.folderId;
      if (result.verified !== true || result.sourceKey !== sourceKey || result.sha256 !== sha256
        || Number(result.size) !== bytes.length || root !== folderId) {
        throw new Error('Apps Script Drive verification did not match source size/hash metadata.');
      }
      return result;
    },
    async copyExisting({ folderId, driveFileId, name, mimeType, sourceKey, sha256, sourceSize, archivePaths }) {
      const paths = validatePhotoArchivePaths(archivePaths);
      const result = await call({ action: 'copy_existing', folderId, driveFileId, fileName: name,
        sourceKey, sha256, sourceSize, archivePaths: paths, mimeType });
      const root = result.rootFolderId || result.folderId;
      if (result.verified !== true || result.recoveredFromDrive !== true || result.sourceKey !== sourceKey || result.sha256 !== sha256
        || Number(result.size) !== Number(sourceSize) || root !== folderId) {
        throw new Error('Apps Script Drive recovery did not match the verified archive receipt.');
      }
      return result;
    },
  };
}

function driveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listDriveFiles(accessToken, query, driveFetch) {
  const parameters = new URLSearchParams({ q: query, fields: 'files(id,name,size,appProperties,parents,trashed)', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  return (await (await driveFetch(accessToken, `https://www.googleapis.com/drive/v3/files?${parameters}`)).json()).files || [];
}

async function directArchiveFolder(accessToken, parent, name, driveFetch) {
  const query = `'${driveQueryValue(parent)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${driveQueryValue(name)}'`;
  const existing = await listDriveFiles(accessToken, query, driveFetch);
  if (existing.length) return existing.sort((a, b) => a.id.localeCompare(b.id))[0].id;
  const response = await driveFetch(accessToken, 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  });
  return (await response.json()).id;
}

async function existingDirectArchive(accessToken, args, folderId, dependencies) {
  const query = `'${driveQueryValue(folderId)}' in parents and trashed = false and appProperties has { key='sourceKey' and value='${driveQueryValue(args.sourceKey)}' } and appProperties has { key='sha256' and value='${driveQueryValue(args.sha256)}' }`;
  const existing = await listDriveFiles(accessToken, query, dependencies.driveFetch);
  return existing.sort((a, b) => a.id.localeCompare(b.id))[0];
}

async function directArchiveCopy(accessToken, args, folderId, path, dependencies) {
  const existing = await existingDirectArchive(accessToken, args, folderId, dependencies);
  return existing || dependencies.uploadDriveFile(accessToken, { ...args, folderId,
    description: photoArchiveDescription(args, path) });
}

async function directDriveFile(accessToken, fileId, dependencies) {
  const fields = 'id,name,size,mimeType,description,appProperties,parents,trashed';
  const response = await dependencies.driveFetch(accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`);
  return await response.json();
}

async function verifyDirectArchiveSource(accessToken, args, dependencies) {
  const source = await directDriveFile(accessToken, args.driveFileId, dependencies);
  const description = parsePhotoArchiveDescription(source.description);
  if (source.trashed || Number(source.size) !== Number(args.sourceSize)
    || !(photoArchiveIdentityMatches(source.appProperties, args.sourceKey, args.sha256)
      || photoArchiveIdentityMatches(description, args.sourceKey, args.sha256))) {
    throw new Error('Archived Drive source did not match its verified receipt.');
  }
  await verifiedDriveBytes(accessToken, args.driveFileId, args, dependencies, 'Archived Drive source');
}

async function directExistingCopy(accessToken, args, folderId, path, dependencies) {
  const existing = await existingDirectArchive(accessToken, args, folderId, dependencies);
  if (existing) return existing;
  const response = await dependencies.driveFetch(accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.driveFileId)}/copy?supportsAllDrives=true&fields=id,name,size,appProperties,parents,trashed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: args.name, parents: [folderId], description: photoArchiveDescription(args, path),
        appProperties: { archive: 'gnc-supabase-photo', sourceKey: args.sourceKey, sha256: args.sha256 } }),
    });
  return await response.json();
}

async function verifiedDriveBytes(accessToken, fileId, args, dependencies, label) {
  const response = await dependencies.driveFetch(accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== Number(args.sourceSize) || sha256 !== args.sha256) {
    throw new Error(`${label} bytes did not match its receipt.`);
  }
  return { sha256, size: bytes.length };
}

async function verifyDirectArchiveCopy(accessToken, copy, args, folderId, dependencies) {
  const validMetadata = !copy.trashed && Number(copy.size) === Number(args.sourceSize)
    && Array.isArray(copy.parents) && copy.parents.includes(folderId)
    && copy.appProperties?.sourceKey === args.sourceKey && copy.appProperties?.sha256 === args.sha256;
  if (!validMetadata) throw new Error('Recovered Drive copy metadata did not match its receipt.');
  return { ...copy, folderId, ...await verifiedDriveBytes(accessToken, copy.id, args, dependencies, 'Recovered Drive copy') };
}

async function directPathFolder(accessToken, root, path, driveFetch) {
  let folderId = root;
  for (const name of path) folderId = await directArchiveFolder(accessToken, folderId, name, driveFetch);
  return folderId;
}

async function copyExistingPaths(accessToken, args, requestPhotoRoot, dependencies) {
  const paths = validatePhotoArchivePaths(args.archivePaths);
  if (!paths.length || args.folderId !== requestPhotoRoot) throw new Error('Verified Request archive copies require approved five-folder paths.');
  await verifyDirectArchiveSource(accessToken, args, dependencies);
  const copies = [];
  for (const path of paths) {
    const folderId = await directPathFolder(accessToken, args.folderId, path, dependencies.driveFetch);
    const copy = await directExistingCopy(accessToken, args, folderId, path, dependencies);
    copies.push({ ...await verifyDirectArchiveCopy(accessToken, copy, args, folderId, dependencies), path });
  }
  return { ...copies[0], rootFolderId: args.folderId, recoveredFromDrive: true, archiveCopies: copies };
}

export function createDirectDriveClient(accessToken, dependencies, requestPhotoRoot) {
  return {
    verifyFolders: folderIds => Promise.all(folderIds.map(id => dependencies.verifyDriveFolder(accessToken, id))),
    async upload(args) {
      const paths = validatePhotoArchivePaths(args.archivePaths);
      if (paths.length && args.folderId !== requestPhotoRoot) throw new Error('Request archive paths require the approved Request photo root.');
      const copies = [];
      for (const path of paths.length ? paths : [[]]) {
        const folderId = await directPathFolder(accessToken, args.folderId, path, dependencies.driveFetch);
        const copy = await directArchiveCopy(accessToken, args, folderId, path, dependencies);
        const verified = await verifyDirectArchiveCopy(accessToken, copy, { ...args, sourceSize: args.bytes.length }, folderId, dependencies);
        copies.push({ ...verified, path });
      }
      return { ...copies[0], rootFolderId: args.folderId, archiveCopies: copies };
    },
    copyExisting: args => copyExistingPaths(accessToken, args, requestPhotoRoot, dependencies),
  };
}
