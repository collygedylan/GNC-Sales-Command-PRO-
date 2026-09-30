BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Remove browser roles' non-RLS privileges on the unrelated tables identified
-- by the live security audit. RLS does not restrict TRUNCATE.
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON TABLE public.ph_app_settings,
          public.ph_av_notes,
          public.ph_bunch_counts
FROM anon, authenticated;

-- Raw inventory reads must go through app-api's role checks or the separate
-- bounded HL availability RPC. Remove the compatibility policy and direct
-- browser table grants. The service-role app-api client retains its access.
DROP POLICY IF EXISTS app_public_read
ON public.ph_master_inventory;

REVOKE SELECT
ON TABLE public.ph_master_inventory
FROM PUBLIC, anon, authenticated;

-- Column-level grants are independent of table-level grants, so revoke them
-- explicitly as well. Newly added columns are not included automatically in
-- existing column grants and need no special handling here.
DO $revoke_column_select$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ph_master_inventory';

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.ph_master_inventory FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END
$revoke_column_select$;

COMMIT;
