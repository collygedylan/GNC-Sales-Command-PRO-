// Manual PDF reports remain active until Dylan confirms a replacement. Their
// integrity and receipt-adjusted projection determine health; age stays visible.
export function verifyPoManagementHealth(snapshot, now = Date.now()) {
  if (snapshot?.contract_version !== 'po-management-native-auth-v1'
      || !['source_authenticated_select', 'view_authenticated_select', 'anonymous_access_denied',
        'authenticated_writes_denied', 'manager_policy_present', 'security_invoker_enabled']
        .every(key => snapshot[key] === true)) {
    throw new Error('production_po_management_auth_contract_unhealthy');
  }
  const rowCount = Number(snapshot.row_count);
  if (!Number.isSafeInteger(rowCount) || rowCount < 1) throw new Error('production_po_management_empty');
  if (snapshot.source_authority_valid !== true) throw new Error('production_po_management_source_invalid');
  const builtAt = Date.parse(String(snapshot.latest_built_at || ''));
  const ageMs = now - builtAt;
  if (!Number.isFinite(ageMs) || ageMs < 0) throw new Error('production_po_management_stale');
  const manual = snapshot.source_format === 'pdf';
  if (manual) {
    if (snapshot.freshness_mode !== 'manual_pdf' || snapshot.pdf_health_contract !== 'confirmed-pdf-ledger-v1'
        || snapshot.pdf_report_valid !== true || snapshot.projection_matches_ledger !== true
        || snapshot.season_access_healthy !== true) {
      throw new Error('production_po_management_pdf_contract_unhealthy');
    }
  } else if (!['legacy', undefined].includes(snapshot.source_format)
      || snapshot.freshness_mode === 'manual_pdf' || ageMs > 72 * 60 * 60 * 1000) {
    throw new Error('production_po_management_stale');
  }
  return { rowCount, ageMinutes: Math.round(ageMs / 60000),
    freshnessMode: manual ? 'manual_pdf' : 'scheduled_import',
    reportAgeNotice: manual && ageMs > 72 * 60 * 60 * 1000 ? 'confirmed_pdf_older_than_72_hours' : null };
}
