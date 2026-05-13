/**
 * Google Drive disease/lab-report mirror for the GNC ML pipeline.
 *
 * Paste this into Apps Script, then set Script Properties:
 *   SUPABASE_URL = https://your-project-ref.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY = your service role key
 *   DISEASE_DRIVE_ROOT_FOLDER_ID = the parent folder that contains Willow, Viburnum, LAB REPORTS, etc.
 *
 * Run runDiseaseDriveToSupabaseSync() manually first.
 * Add a time trigger later if you want Drive to stay mirrored automatically.
 */

const DISEASE_ASSET_BUCKET = 'disease_training_assets';
const DISEASE_ASSET_TABLE = 'v2_disease_training_assets';
const DISEASE_SYNC_MAX_FILES_PER_RUN = 350;
const DISEASE_SYNC_PROPERTY_PREFIX = 'DISEASE_SYNC_';

function runDiseaseDriveToSupabaseSync() {
  const config = getDiseaseSyncConfig_();
  const root = DriveApp.getFolderById(config.rootFolderId);
  const state = {
    scanned: 0,
    uploaded: 0,
    skipped: 0,
    errors: []
  };
  syncDiseaseFolder_(config, root, '', state);
  PropertiesService.getScriptProperties().setProperty(DISEASE_SYNC_PROPERTY_PREFIX + 'LAST_RUN_AT', new Date().toISOString());
  Logger.log(JSON.stringify(state, null, 2));
  return state;
}

function getDiseaseSyncConfig_() {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = String(props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = String(props.getProperty('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const rootFolderId = String(props.getProperty('DISEASE_DRIVE_ROOT_FOLDER_ID') || '').trim();
  if (!supabaseUrl) throw new Error('Missing Script Property SUPABASE_URL.');
  if (!serviceRoleKey) throw new Error('Missing Script Property SUPABASE_SERVICE_ROLE_KEY.');
  if (!rootFolderId) throw new Error('Missing Script Property DISEASE_DRIVE_ROOT_FOLDER_ID.');
  return { supabaseUrl, serviceRoleKey, rootFolderId };
}

function syncDiseaseFolder_(config, folder, relativePath, state) {
  if (state.scanned >= DISEASE_SYNC_MAX_FILES_PER_RUN) return;
  const safeRelativePath = sanitizeDiseasePath_(relativePath);
  const files = folder.getFiles();
  while (files.hasNext() && state.scanned < DISEASE_SYNC_MAX_FILES_PER_RUN) {
    const file = files.next();
    state.scanned += 1;
    try {
      syncDiseaseFile_(config, file, safeRelativePath, state);
    } catch (error) {
      state.errors.push({
        fileName: file.getName(),
        fileId: file.getId(),
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  const folders = folder.getFolders();
  while (folders.hasNext() && state.scanned < DISEASE_SYNC_MAX_FILES_PER_RUN) {
    const child = folders.next();
    const childPath = safeRelativePath ? safeRelativePath + '/' + child.getName() : child.getName();
    syncDiseaseFolder_(config, child, childPath, state);
  }
}

function syncDiseaseFile_(config, file, folderPath, state) {
  const mimeType = String(file.getMimeType() || '').trim();
  const assetKind = getDiseaseAssetKind_(mimeType);
  if (assetKind === 'other') {
    state.skipped += 1;
    return;
  }

  const fileName = file.getName();
  const driveFileId = file.getId();
  const label = getDiseaseLabelFromPath_(folderPath);
  const storagePath = buildDiseaseStoragePath_(folderPath, driveFileId, fileName, mimeType);
  const blob = getDiseaseFileBlob_(file, mimeType);
  uploadDiseaseAssetToSupabase_(config, storagePath, blob);
  const publicUrl = config.supabaseUrl + '/storage/v1/object/public/' + DISEASE_ASSET_BUCKET + '/' + encodeStoragePath_(storagePath);
  upsertDiseaseAssetRow_(config, {
    unique_id: 'drive_' + sanitizeDiseaseToken_(driveFileId),
    drive_file_id: driveFileId,
    drive_parent_id: getFirstParentFolderId_(file),
    drive_path: folderPath ? folderPath + '/' + fileName : fileName,
    folder_path: folderPath,
    label: label,
    asset_kind: assetKind,
    bucket: DISEASE_ASSET_BUCKET,
    storage_path: storagePath,
    public_url: publicUrl,
    mime_type: blob.getContentType() || mimeType,
    file_name: fileName,
    file_size: Number(file.getSize() || 0),
    checksum: String(file.getMd5Checksum() || ''),
    processed_status: 'pending_ml',
    metadata: {
      drive_url: file.getUrl(),
      drive_last_updated: file.getLastUpdated() ? file.getLastUpdated().toISOString() : '',
      original_mime_type: mimeType
    }
  });
  state.uploaded += 1;
}

function getDiseaseAssetKind_(mimeType) {
  const safeMime = String(mimeType || '').toLowerCase();
  if (safeMime.indexOf('image/') === 0) return 'diagnostic_photo';
  if (safeMime === 'application/pdf') return 'lab_report';
  if (safeMime.indexOf('application/vnd.google-apps.document') === 0) return 'lab_report';
  if (safeMime.indexOf('application/vnd.google-apps.spreadsheet') === 0) return 'lab_report';
  if (safeMime.indexOf('application/vnd.openxmlformats-officedocument') === 0) return 'lab_report';
  if (safeMime.indexOf('application/msword') === 0) return 'lab_report';
  if (safeMime.indexOf('text/') === 0) return 'lab_report';
  return 'other';
}

function getDiseaseFileBlob_(file, mimeType) {
  const safeMime = String(mimeType || '').toLowerCase();
  if (safeMime.indexOf('application/vnd.google-apps.') === 0) {
    return file.getAs(MimeType.PDF).setName(file.getName() + '.pdf');
  }
  return file.getBlob();
}

function getDiseaseLabelFromPath_(folderPath) {
  const parts = String(folderPath || '').split('/').map(function(part) {
    return part.trim();
  }).filter(Boolean);
  return parts[0] || 'Unlabeled';
}

function buildDiseaseStoragePath_(folderPath, driveFileId, fileName, mimeType) {
  const safeFolderPath = sanitizeDiseasePath_(folderPath) || 'Unlabeled';
  const baseName = sanitizeDiseaseFileName_(fileName || driveFileId);
  const extension = getDiseaseFileExtension_(fileName, mimeType);
  const suffix = extension && baseName.toLowerCase().slice(-extension.length) !== extension.toLowerCase()
    ? extension
    : '';
  return safeFolderPath + '/' + sanitizeDiseaseToken_(driveFileId) + '-' + baseName + suffix;
}

function getDiseaseFileExtension_(fileName, mimeType) {
  const nameMatch = String(fileName || '').match(/(\.[a-zA-Z0-9]{1,8})$/);
  if (nameMatch) return nameMatch[1].toLowerCase();
  const safeMime = String(mimeType || '').toLowerCase();
  if (safeMime.indexOf('image/jpeg') === 0) return '.jpg';
  if (safeMime.indexOf('image/png') === 0) return '.png';
  if (safeMime.indexOf('image/webp') === 0) return '.webp';
  if (safeMime.indexOf('application/pdf') === 0) return '.pdf';
  if (safeMime.indexOf('application/vnd.google-apps.') === 0) return '.pdf';
  return '';
}

function uploadDiseaseAssetToSupabase_(config, storagePath, blob) {
  const url = config.supabaseUrl + '/storage/v1/object/' + DISEASE_ASSET_BUCKET + '/' + encodeStoragePath_(storagePath);
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    contentType: blob.getContentType() || 'application/octet-stream',
    payload: blob.getBytes(),
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: 'Bearer ' + config.serviceRoleKey,
      'x-upsert': 'true'
    }
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase storage upload failed: HTTP ' + code + ' ' + response.getContentText());
  }
}

function upsertDiseaseAssetRow_(config, row) {
  const url = config.supabaseUrl + '/rest/v1/' + DISEASE_ASSET_TABLE + '?on_conflict=drive_file_id';
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    payload: JSON.stringify(row),
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: 'Bearer ' + config.serviceRoleKey,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase row upsert failed: HTTP ' + code + ' ' + response.getContentText());
  }
}

function sanitizeDiseasePath_(value) {
  return String(value || '')
    .split('/')
    .map(function(part) {
      return sanitizeDiseaseFileName_(part);
    })
    .filter(Boolean)
    .join('/');
}

function sanitizeDiseaseFileName_(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|#%{}~[\]`^]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120) || 'file';
}

function sanitizeDiseaseToken_(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 80) || Utilities.getUuid().replace(/-/g, '');
}

function encodeStoragePath_(path) {
  return String(path || '')
    .split('/')
    .map(function(part) {
      return encodeURIComponent(part);
    })
    .join('/');
}

function getFirstParentFolderId_(file) {
  const parents = file.getParents();
  return parents.hasNext() ? parents.next().getId() : '';
}
