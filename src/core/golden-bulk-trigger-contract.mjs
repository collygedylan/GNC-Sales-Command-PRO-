import assert from 'node:assert/strict';
import {assertBulkMasterTriggerState,EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT} from '../services/bulk-master-http-contract.mjs';

export async function assertMultiRowLocationUpload(runFunctions,read) {
  let uploadOptions = null;
  const storage = { from: () => ({
    upload: async (_path, _blob, options) => { uploadOptions = options; return { error: null }; },
    getPublicUrl: filePath => ({ data: { publicUrl: `https://photos.invalid/${filePath}` } }),
  }) };
  const context = runFunctions('assets/app-runtime.js', ['uploadOptimizedBlobToStorage'], {
    PHOTO_BUCKETS: { REQUEST: 'request_photos' }, HIGH_VOLUME_PLANT_PHOTO_BUCKETS: new Set(),
    optimizePhotoBlobForUpload: async () => ({ blob: new Blob(['photo'], { type: 'image/jpeg' }), fileName: 'photo.jpg', contentType: 'image/jpeg', hash: 'sha' }),
    getSupabaseStorageClient: () => storage, withTimeout: promise => promise, SUPABASE_UPLOAD_TIMEOUT_MS: 30000,
    Blob, Object, String, Math,
  });
  const result = await context.uploadOptimizedBlobToStorage('request_photos', '007779.021.1/C.12.019/27.F1/photo.jpg', new Blob(['raw'], { type: 'image/jpeg' }));
  assert.equal(uploadOptions.upsert, true);
  assert.match(result.publicUrl, /photo\.jpg$/);
  const identity = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart', 'isSameDriveEvidenceLocation'], {
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  });
  assert.equal(identity.isSameDriveEvidenceLocation(
    { ITEMCODE: '007779.021.1', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1' },
    { ITEMCODE: '007779.021.1', LOCATIONCODE: 'C.12.019', LOTCODE: '27.F1', DESIGITEM: 'DESIGITEM #' },
  ), true);
  assert.match(read('supabase/migrations/20261023220000_drive_location_evidence_and_request_reconciliation_v1.sql'), /where upper\(btrim\(m\.itemcode\)\)=stable_item and upper\(btrim\(m\.locationcode\)\)=stable_location[^]*limit 1/);
}

export function assertBulkTriggerContract() {
  const safe={total:53,enabled:53,handover:1,handover_enabled:1,evidence_delta:2,evidence_delta_enabled:2};
  assert.equal(EXPECTED_MASTER_PRODUCTION_TRIGGER_COUNT,53);
  assert.doesNotThrow(()=>assertBulkMasterTriggerState(safe));
  for(const changed of [{total:51},{total:54},{enabled:52},{handover:0},{handover_enabled:0},
    {evidence_delta:1},{evidence_delta:3},{evidence_delta_enabled:1}]) {
    assert.throws(()=>assertBulkMasterTriggerState({...safe,...changed}),assert.AssertionError);
  }
}
