begin;

-- The authenticated Data API role inherits an eight-second statement timeout.
-- The full replacement can upsert the complete source and prune stale rows in
-- one atomic transaction, so raise the limit only for this trusted finalizer.
alter function public.finalize_customer_rep_mapping_import_v1(uuid)
  set statement_timeout = '55s';

notify pgrst, 'reload schema';

commit;
