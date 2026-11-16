CREATE FUNCTION pg_temp.reclass_erp_file_rows_v1(p_rows jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $fixture_file$
  SELECT coalesce(jsonb_agg(CASE WHEN nullif(btrim(entry.value#>>'{values,filename}'),'') IS NULL
    THEN jsonb_set(entry.value,'{values,filename}',to_jsonb('canonical-reclass-ledger.xlsx'::text))
    ELSE entry.value END ORDER BY entry.ordinality),'[]'::jsonb)
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY entry(value,ordinality)
$fixture_file$;
