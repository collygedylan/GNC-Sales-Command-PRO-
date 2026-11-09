import assert from 'node:assert/strict';

function evidenceLifecycle(currentOnHand, now, expiresAt) {
  const baselineOnHand = 500;
  const locMatchPct = 50;
  const initialPhotoMatchQty = Math.round(baselineOnHand * (locMatchPct / 100));
  const currentPhotoMatchQty = Math.max(0, initialPhotoMatchQty - Math.max(0, baselineOnHand - currentOnHand));
  const active = currentPhotoMatchQty > 0 && now <= expiresAt;
  return { initialPhotoMatchQty, currentPhotoMatchQty, active,
    photo: active ? 'photo.webp' : null, spec: active ? '8-10" H' : null,
    avNote: active ? 'SPEC - 8-10" H' : null, pickNote: active ? 'Pick evenly' : null,
    salesNote: active ? 'Saleable shear' : null };
}

export function assertEvidenceLifecycle({ runFunctions, read }) {
  const context = runFunctions('assets/app-runtime.js', ['normalizeDriveEvidenceLocationPart', 'isSameDriveEvidenceLocation'], {
    firstNonEmptyValue: (...values) => values.find(value => value != null && String(value).trim() !== '') ?? '',
  });
  assert.equal(context.isSameDriveEvidenceLocation(
    { ITEMCODE: '001884.011.1', LOCATIONCODE: 'E.10.000', LOTCODE: '27.S1', UNIQUE_ID: 'old' },
    { itemcode: '001884.011.1', locationcode: 'e.10.000', lotcode: '27.F1', unique_id: 'new' },
  ), true);
  const expiresAt = Date.parse('2026-11-03T05:59:59Z');
  const day5 = evidenceLifecycle(450, Date.parse('2026-10-28T17:00:00Z'), expiresAt);
  assert.deepEqual([day5.initialPhotoMatchQty, day5.currentPhotoMatchQty, day5.active], [250, 200, true]);
  assert.ok(day5.photo && day5.spec && day5.avNote && day5.pickNote && day5.salesNote);
  const day10Expired = evidenceLifecycle(450, expiresAt + 1, expiresAt);
  assert.deepEqual([day10Expired.currentPhotoMatchQty, day10Expired.active], [200, false]);
  assert.deepEqual([day10Expired.photo, day10Expired.spec, day10Expired.avNote,
    day10Expired.pickNote, day10Expired.salesNote], [null, null, null, null, null]);
  const unified = read('supabase/migrations/20261024203000_unified_request_sync_sales_impact_v1.sql');
  assert.match(unified, /request_master_has_valid_evidence_v1\(master,clock_timestamp\(\)\)/);
  assert.doesNotMatch(unified, /delete from public\.ph_request_history/);
  const depleted = evidenceLifecycle(250, Date.parse('2026-10-27T17:00:00Z'), expiresAt);
  assert.deepEqual([depleted.currentPhotoMatchQty, depleted.active, depleted.photo,
    depleted.spec, depleted.avNote, depleted.pickNote, depleted.salesNote], [0, false, null, null, null, null, null]);
  const migration = read('supabase/migrations/20261023235500_inventory_location_evidence_lifecycle_v2.sql');
  for (const field of ['baseline_on_hand', 'loc_match_pct', 'initial_photo_match_qty', 'current_photo_match_qty']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
  assert.match(migration, /America\/Chicago/);
  assert.match(migration, /time '23:59:59'/);
  assert.match(migration, /greatest\(0,p_initial_photo_match_qty-greatest\(0,p_baseline_on_hand-p_current_on_hand\)\)/);
  assert.match(migration, /spec=null,match=null,loc_match_qty=null,av_note=null,pic_note=null,sales_note=null/);
  const canonical = read('supabase/migrations/20261025013000_agdata_v2362_canonical_requests.sql');
  for (const field of ['photos', 'photo_url', 'photo_date', 'loc_match_pct', 'baseline_on_hand',
    'initial_photo_match_qty', 'loc_photo_match', 'pick_note', 'photo_expires_at']) {
    assert.match(canonical, new RegExp(`add column if not exists ${field}\\b`));
  }
  for (const field of ['spec', 'caliper', 'av_note', 'sales_note']) assert.match(canonical, new RegExp(`new\\.${field}:=`));
  assert.match(canonical, /round\(canonical_baseline\*canonical_match\/100\.0\)/);
  assert.match(canonical, /inventory_location_evidence_qty_v2\([^]*canonical_baseline,canonical_initial,current_on_hand/);
  assert.match(canonical, /clock_timestamp\(\)<=canonical_expiry/);
}
