BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- These imported datasets include customer/consignee details and financial
-- values. Browser access must go through app-api's role checks.
DROP POLICY IF EXISTS app_public_read ON public.ph_reserves;
DROP POLICY IF EXISTS app_public_read ON public.ph_cav_import;

-- Remove any equivalent permissive, unfiltered SELECT/ALL policy that applies
-- to PUBLIC or the browser roles, including policies with a different name.
DO $drop_broad_read_policies$
DECLARE
  policy_row record;
  v_anon oid := 'anon'::regrole::oid;
  v_authenticated oid := 'authenticated'::regrole::oid;
BEGIN
  FOR policy_row IN
    SELECT p.polrelid::regclass AS relation_name, p.polname
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('ph_reserves', 'ph_cav_import')
      AND p.polpermissive
      AND p.polcmd IN ('r', '*')
      AND coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
      AND p.polroles && ARRAY[0::oid, v_anon, v_authenticated]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %s',
      policy_row.polname,
      policy_row.relation_name
    );
  END LOOP;
END
$drop_broad_read_policies$;

REVOKE SELECT
ON TABLE public.ph_reserves, public.ph_cav_import
FROM PUBLIC, anon, authenticated;

-- Column-level SELECT grants are independent of table-level grants.
DO $revoke_column_select$
DECLARE
  v_table_name text;
  v_columns text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY['ph_reserves', 'ph_cav_import'] LOOP
    SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_columns
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = v_table_name;

    IF v_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_columns,
        v_table_name
      );
    END IF;
  END LOOP;
END
$revoke_column_select$;

COMMIT;
