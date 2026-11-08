export const productionMaintenanceContractSql = `SELECT
  coalesce((SELECT i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND i.indnkeyatts=2 AND i.indnatts=2 AND a.amname='btree'
    AND i.indrelid='public.ph_customer_consignee_sales_reps'::regclass
    AND (SELECT array_agg(att.attname::text ORDER BY key.ordinality)
      FROM unnest(i.indkey) WITH ORDINALITY key(attnum,ordinality)
      JOIN pg_attribute att ON att.attrelid=i.indrelid AND att.attnum=key.attnum)
      = ARRAY['customername','consigneename']
    AND pg_get_expr(i.indpred,i.indrelid)=
      '((customerstatus = ''A''::text) AND (consigneestatus = ''A''::text))'
    FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam
    WHERE i.indexrelid=to_regclass('public.ph_ccsr_active_customer_consignee_names_idx')),
    false) AS customer_index_installed,
  coalesce((SELECT reloptions @> ARRAY['autovacuum_vacuum_scale_factor=0.1',
      'autovacuum_vacuum_threshold=1000']
    FROM pg_class WHERE oid='public.ph_drive_around_report_rows'::regclass),
    false) AS archive_autovacuum_installed`;

export function requireProductionMaintenanceContract(rows) {
  if (rows.length !== 1 || rows[0]?.customer_index_installed !== true
      || rows[0]?.archive_autovacuum_installed !== true) {
    throw new Error('PRODUCTION_MAINTENANCE_CONTRACT_NOT_INSTALLED');
  }
  return rows[0];
}
