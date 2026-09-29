BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ph_sales_office contains customer/order details, sales notes, and workflow
-- data. Browser access must go through app-api's role checks.
DROP POLICY IF EXISTS app_public_read
ON public.ph_sales_office;

REVOKE SELECT
ON TABLE public.ph_sales_office
FROM PUBLIC, anon, authenticated;

-- Column-level SELECT grants are independent of table-level grants.
DO $revoke_column_select$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO v_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'ph_sales_office';

  IF v_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE SELECT (%s) ON TABLE public.ph_sales_office FROM PUBLIC, anon, authenticated',
      v_columns
    );
  END IF;
END
$revoke_column_select$;

COMMIT;
