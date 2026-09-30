BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Browser reads and writes for these operational datasets must go through
-- app-api's role checks. Remove every unfiltered permissive policy applying
-- to PUBLIC or the browser roles, regardless of command or policy name.
DO $drop_broad_policies$
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
      AND c.relname = ANY (ARRAY[
        'ph_app_settings',
        'ph_av_notes',
        'ph_bunch_counts',
        'ph_inventory_edit_requests',
        'ph_spread_counts',
        'ph_shear_list',
        'ph_soc_master'
      ])
      AND p.polpermissive
      AND coalesce(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
      AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true'
      AND p.polroles && ARRAY[0::oid, v_anon, v_authenticated]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %s',
      policy_row.polname,
      policy_row.relation_name
    );
  END LOOP;
END
$drop_broad_policies$;

-- Remove direct table privileges. Backend service-role grants remain intact.
DO $revoke_table_privileges$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'ph_app_settings',
    'ph_av_notes',
    'ph_bunch_counts',
    'ph_inventory_edit_requests',
    'ph_spread_counts',
    'ph_shear_list',
    'ph_soc_master'
  ] LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_table_name
      );
    END IF;
  END LOOP;
END
$revoke_table_privileges$;

-- Table-level REVOKE does not remove column-level grants.
DO $revoke_column_privileges$
DECLARE
  v_table_name text;
  v_columns text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'ph_app_settings',
    'ph_av_notes',
    'ph_bunch_counts',
    'ph_inventory_edit_requests',
    'ph_spread_counts',
    'ph_shear_list',
    'ph_soc_master'
  ] LOOP
    IF to_regclass(format('public.%I', v_table_name)) IS NOT NULL THEN
      SELECT string_agg(format('%I', c.column_name), ', ' ORDER BY c.ordinal_position)
      INTO v_columns
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = v_table_name;

      IF v_columns IS NOT NULL THEN
        EXECUTE format(
          'REVOKE SELECT (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
          v_columns, v_table_name
        );
        EXECUTE format(
          'REVOKE INSERT (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
          v_columns, v_table_name
        );
        EXECUTE format(
          'REVOKE UPDATE (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
          v_columns, v_table_name
        );
        EXECUTE format(
          'REVOKE REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
          v_columns, v_table_name
        );
      END IF;
    END IF;
  END LOOP;
END
$revoke_column_privileges$;

COMMIT;
