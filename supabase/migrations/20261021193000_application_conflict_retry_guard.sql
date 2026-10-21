begin;
set local lock_timeout = '1s';
set local statement_timeout = '15s';

-- Application revision conflicts are HTTP 409, never PostgreSQL serialization
-- failures (40001). PostgREST may retry 40001 internally without a bound.
-- Recreate only affected application functions; pg_get_functiondef preserves
-- signatures, security mode, volatility and search_path, and CREATE OR REPLACE
-- retains ownership and grants. Real engine serialization errors remain 40001.
do $migration$
declare fn record; definition text;
begin
  -- Load pg_trgm before preserving its function-level GUC on managed Postgres.
  perform extensions.similarity('a','a');
  for fn in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private','app_sync_private','suspend_tag_private')
      and p.prokind='f' and p.prosrc like '%40001%'
  loop
    definition := regexp_replace(fn.definition,
      $pattern$errcode\s*=\s*'40001'$pattern$, $$errcode='PT409'$$, 'gi');
    definition := replace(definition, $$exception when sqlstate '40001' then$$,
      $$exception when sqlstate '40001' or sqlstate 'PT409' then$$);
    definition := replace(definition, $$SQLSTATE in ('40001','55P03','57014')$$,
      $$SQLSTATE in ('40001','PT409','55P03','57014')$$);
    if definition is distinct from fn.definition then execute definition; end if;
  end loop;
end
$migration$;

-- Resolve the Advisor's per-row auth.uid() evaluation without broadening read
-- access or changing the source permission check.
alter policy ph_27s1_hl_po_manager_read on public.ph_27s1_hl_po
using (app_sync_private.can_read_source('ph_27s1_hl_po') and exists (
  select 1 from public.profiles p where p.id=(select auth.uid())
    and upper(p.role)=any(array['ADMIN','MANAGER'])
));

-- Existing resumable 500-row imports stay valid; new 2,000-row batches match
-- begin_master_snapshot_stage_v1's contract introduced in v2.3.33.
alter table app_sync_private.ph_master_snapshot_stage_v1
  drop constraint if exists ph_master_snapshot_stage_v1_check;
alter table app_sync_private.ph_master_snapshot_stage_v1
  add constraint ph_master_snapshot_stage_v1_check check (
    expected_chunks = (expected_rows + 499) / 500
    or expected_chunks = (expected_rows + 1999) / 2000
  );
notify pgrst, 'reload schema';
commit;
