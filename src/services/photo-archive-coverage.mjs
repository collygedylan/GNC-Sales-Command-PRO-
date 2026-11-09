import { validatePhotoArchivePaths } from './photo-archive-receiver.mjs';

function exactReceipt(receipt, sha256, size) {
  return receipt && typeof receipt.id === 'string' && receipt.id.length > 0
    && typeof receipt.folderId === 'string' && receipt.folderId.length > 0
    && /^[a-f0-9]{64}$/i.test(sha256 || '') && Number.isSafeInteger(Number(size)) && Number(size) > 0
    && (receipt.sha256 || receipt.appProperties?.sha256) === sha256 && Number(receipt.size) === Number(size);
}

export function uncoveredRequestArchivePaths(job) {
  const paths = validatePhotoArchivePaths(job.request_archive_paths);
  const receipts = Array.isArray(job.archive_path_receipts) ? job.archive_path_receipts : [];
  const covered = new Set(receipts.filter(receipt => exactReceipt(receipt, job.sha256, job.source_size))
    .map(receipt => JSON.stringify(receipt.path)));
  return paths.filter(path => !covered.has(JSON.stringify(path)));
}

export function mergeVerifiedPathReceipts(job, paths, copies, sha256, size) {
  const old = Array.isArray(job.archive_path_receipts) ? job.archive_path_receipts : [];
  const receipts = new Map(old.map(receipt => [JSON.stringify(receipt.path), receipt]));
  const copied = new Map((Array.isArray(copies) ? copies : []).map(receipt => [JSON.stringify(receipt.path), receipt]));
  for (const path of paths) {
    const key = JSON.stringify(path);
    const receipt = copied.get(key);
    if (!exactReceipt(receipt, sha256, size)) throw new Error('Request archive leaf receipt did not match the source object.');
    receipts.set(key, { path, id: receipt.id, name: receipt.name, folderId: receipt.folderId, sha256, size });
  }
  return [...receipts.values()];
}
