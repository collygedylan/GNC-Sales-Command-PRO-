-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select plan(6);

-- These functions create temporary relations at runtime. Keep the canonical
-- fixture empty and roll every call back; the assertions cover their normal
-- empty-data paths while the lint helper derives the same shapes with WITH NO DATA.
insert into public.ph_hold_learning_refresh_jobs(job_name,status)
values('sql_lint_temp_itemcode_runtime','running');
insert into public.ph_hold_learning_refresh_itemcodes(job_name,itemcode,processed_at,summary_processed_at)
values('sql_lint_temp_itemcode_runtime','__SQL_LINT_TEMP_ITEMCODE__',now(),now());
select lives_ok($$select * from public.ph_refresh_hold_learning_itemcode_batch('sql_lint_temp_itemcode_runtime',1)$$,
  'itemcode batch reaches its temporary batch relation on an empty pending set');

insert into public.ph_hold_learning_refresh_jobs(job_name,status)
values('sql_lint_temp_summary_runtime','summarizing');
insert into public.ph_hold_learning_refresh_itemcodes(job_name,itemcode,processed_at,summary_processed_at)
values('sql_lint_temp_summary_runtime','__SQL_LINT_TEMP_SUMMARY__',now(),now());
select lives_ok($$select * from public.ph_refresh_hold_learning_summary_batch('sql_lint_temp_summary_runtime',1)$$,
  'summary batch reaches its temporary relation on an empty pending set');

select lives_ok($$select * from public.ph_refresh_hold_stop_itemcode_cycles_fast('1900-01-01','1900-01-02')$$,
  'legacy fast cycle refresh reaches its temporary relations with an empty date range');
insert into public.ph_app_settings(key,value,updated_by,updated_at)
values('current_season_salesyear','{"seasonCode":"F1","salesYear":27,"revision":0}'::jsonb,'sql_lint_temp_runtime',now())
on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
select lives_ok($$select public.reconcile_season_sales_office_v1(array[]::text[],true,null,null)$$,
  'season sales reconciliation reaches its temporary target relations in dry-run mode');
select lives_ok($$select public.v2_refresh_hold_learning_profiles()$$,
  'profile refresh reaches its temporary staging relation');
select lives_ok($$select * from public.v2_refresh_hold_stop_itemcode_episode_learning('1900-01-01','1900-01-02',1)$$,
  'episode refresh reaches its temporary relations with an explicit empty date range');

select * from finish();
rollback;
