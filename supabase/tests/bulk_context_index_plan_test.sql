-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, private, extensions, pg_temp;
select plan(21);

-- Reproduce the production planner state: compile a generic plan while the
-- context is empty, then insert a production-sized request. The statement
-- trigger must refresh statistics before inventory row triggers do lookups.
truncate table
  app_sync_private.ph_master_bulk_import_context_v1,
  app_sync_private.ph_master_inventory_import_lineage_seen,
  app_sync_private.ph_master_inventory_item6_alias_seen_v7;
analyze app_sync_private.ph_master_bulk_import_context_v1;

select ok(exists(
  select 1 from pg_trigger t
  where t.tgrelid='app_sync_private.ph_master_bulk_import_context_v1'::regclass
    and t.tgname='ph_master_bulk_context_analyze_v1' and not t.tgisinternal
    and t.tgtype=4
), 'request-context statistics refresh once after each insert statement');
select ok((select p.prosecdef from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='ph_master_bulk_context_v1'),
  'context lookup remains SECURITY DEFINER');
select ok((select p.proconfig @> array['search_path=""']::text[] from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='ph_master_bulk_context_v1'),
  'context lookup retains its empty search_path');
select ok(not has_function_privilege('anon','private.ph_master_bulk_context_v1(uuid,text)','execute')
  and not has_function_privilege('authenticated','private.ph_master_bulk_context_v1(uuid,text)','execute')
  and not has_function_privilege('service_role','private.ph_master_bulk_context_v1(uuid,text)','execute'),
  'context lookup ACL remains private');
select ok(to_regclass('app_sync_private.ph_master_bulk_import_context_v1_pkey') is not null,
  'the source identity lookup index remains available');
select ok(to_regclass('app_sync_private.ph_master_bulk_import_context_run_pid_xid_idx') is not null,
  'the canonical identity lookup index remains available');
select ok(to_regclass('app_sync_private.ph_master_inventory_import_lineage_seen_pkey') is not null,
  'the lineage lookup index remains available');
select ok(to_regclass('app_sync_private.ph_master_inventory_item6_alias_seen_v7_pkey') is not null,
  'the item6 alias lookup index remains available');

do $body$
begin
  perform private.ph_master_bulk_context_v1(
    'b9030000-0000-4000-8000-000000000001','bulk-context-plan-9539'
  );
end
$body$;

create temporary table bulk_context_plan_probe(label text primary key, plan jsonb) on commit drop;

set local enable_seqscan = on;
set local plan_cache_mode = force_generic_plan;
prepare bulk_context_cached_empty_plan(uuid,integer,bigint,text) as
  select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
  where c.run_id=$1 and c.backend_pid=$2 and c.transaction_id=$3 and c.source_unique_id=$4;
do $body$
declare v_plan jsonb;
begin
  execute $explain$
    explain (analyze,buffers,format json)
    execute bulk_context_cached_empty_plan(
      'b9030000-0000-4000-8000-000000000001',pg_backend_pid(),txid_current(),'bulk-context-plan-9539'
    )
  $explain$ into v_plan;
  insert into bulk_context_plan_probe values ('cached-empty-table',v_plan);
end
$body$;

insert into app_sync_private.ph_master_bulk_import_context_v1(
  run_id,request_id,backend_pid,transaction_id,source_unique_id,canonical_unique_id,
  raw_values,raw_item6_fields,source_hash
)
select 'b9030000-0000-4000-8000-000000000001'::uuid,
  'b9030000-0000-4000-8000-000000000002'::uuid,
  pg_backend_pid(),txid_current(),
  'bulk-context-plan-'||lpad(g::text,4,'0'),
  'bulk-context-canonical-plan-'||g,
  jsonb_build_object('source',g),array[]::text[],repeat('a',64)
from generate_series(1,9539) g;
insert into app_sync_private.ph_master_inventory_import_lineage_seen(
  run_id,canonical_unique_id,imported_unique_id,lineage_key
) values (
  'b9030000-0000-4000-8000-000000000001','bulk-context-lineage',
  'bulk-context-lineage-source','synthetic-lineage-key'
);
insert into app_sync_private.ph_master_inventory_item6_alias_seen_v7(
  run_id,canonical_unique_id,imported_unique_id,stable_identity_key
) values (
  'b9030000-0000-4000-8000-000000000001','bulk-context-alias',
  'bulk-context-alias-source','synthetic-stable-identity'
);
insert into app_sync_private.ph_master_bulk_import_context_v1(
  run_id,request_id,backend_pid,transaction_id,source_unique_id,canonical_unique_id,
  raw_values,raw_item6_fields,source_hash
) values
  ('b9030000-0000-4000-8000-000000000001','b9030000-0000-4000-8000-000000000003',
    pg_backend_pid(),txid_current(),'bulk-context-canonical-source','bulk-context-canonical',
    '{"path":"canonical"}',array[]::text[],repeat('b',64)),
  ('b9030000-0000-4000-8000-000000000001','b9030000-0000-4000-8000-000000000004',
    pg_backend_pid(),txid_current(),'bulk-context-lineage-source','bulk-context-lineage-source-canonical',
    '{"path":"lineage"}',array[]::text[],repeat('c',64)),
  ('b9030000-0000-4000-8000-000000000001','b9030000-0000-4000-8000-000000000005',
    pg_backend_pid(),txid_current(),'bulk-context-alias-source','bulk-context-alias-source-canonical',
    '{"path":"alias"}',array[]::text[],repeat('d',64));

do $body$
declare v_plan jsonb;
begin
  execute $explain$
    explain (analyze,buffers,format json)
    execute bulk_context_cached_empty_plan(
      'b9030000-0000-4000-8000-000000000001',pg_backend_pid(),txid_current(),'bulk-context-plan-9539'
    )
  $explain$ into v_plan;
  insert into bulk_context_plan_probe values ('replanned-after-analyze',v_plan);
end
$body$;
do $body$
declare v_plan jsonb;
begin
  execute $explain$
    explain (analyze,buffers,format json)
    select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
    where c.run_id='b9030000-0000-4000-8000-000000000001'::uuid
      and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
      and c.source_unique_id='bulk-context-plan-9539'
  $explain$ into v_plan;
  insert into bulk_context_plan_probe values ('indexed',v_plan);
  execute $all_arms$
    explain (analyze,buffers,format json)
    select matched.* from (
      select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
      where c.run_id='b9030000-0000-4000-8000-000000000001'::uuid
        and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
        and c.source_unique_id='bulk-context-plan-9539'
      union all
      select c.* from app_sync_private.ph_master_bulk_import_context_v1 c
      where c.run_id='b9030000-0000-4000-8000-000000000001'::uuid
        and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
        and c.canonical_unique_id='bulk-context-canonical'
      union all
      select c.* from app_sync_private.ph_master_inventory_import_lineage_seen seen
      join app_sync_private.ph_master_bulk_import_context_v1 c
        on c.run_id=seen.run_id and c.source_unique_id=seen.imported_unique_id
      where seen.run_id='b9030000-0000-4000-8000-000000000001'::uuid
        and seen.canonical_unique_id='bulk-context-lineage'
        and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
      union all
      select c.* from app_sync_private.ph_master_inventory_item6_alias_seen_v7 seen
      join app_sync_private.ph_master_bulk_import_context_v1 c
        on c.run_id=seen.run_id and c.source_unique_id=seen.imported_unique_id
      where seen.run_id='b9030000-0000-4000-8000-000000000001'::uuid
        and seen.canonical_unique_id='bulk-context-alias'
        and c.backend_pid=pg_backend_pid() and c.transaction_id=txid_current()
    ) matched limit 1
  $all_arms$ into v_plan;
  insert into bulk_context_plan_probe values ('all-lookup-arms',v_plan);
end
$body$;

select diag('lookup plan summary: '||(select jsonb_build_object(
  'cached_empty_plan_replanned_to_index',(select plan::text like '%Index Scan%' from bulk_context_plan_probe where label='replanned-after-analyze'),
  'warm_lookup_ms',(select (plan #>> '{0,Plan,Actual Total Time}')::numeric from bulk_context_plan_probe where label='indexed'),
  'context_rows_estimate',(select reltuples::bigint from pg_class where oid='app_sync_private.ph_master_bulk_import_context_v1'::regclass),
  'context_index_paths',(select jsonb_agg(jsonb_build_object(
    'index',node->>'Index Name','index_cond',node->>'Index Cond','filter',node->>'Filter',
    'rows_removed',node->>'Rows Removed by Filter','loops',node->>'Actual Loops'
  )) from jsonb_array_elements(jsonb_path_query_array(plan,
    'strict $.** ? (@."Relation Name" == "ph_master_bulk_import_context_v1")')) node),
  'jit',plan::text like '%JIT%'
)::text from bulk_context_plan_probe where label='all-lookup-arms'));
select ok((select plan::text like '%Index Scan%'
  from bulk_context_plan_probe where label='replanned-after-analyze'),
  'ANALYZE invalidates the generic plan compiled while the request context was empty');
select ok((select plan::text like '%Index Scan%'
  from bulk_context_plan_probe where label='indexed'),
  'the populated request context selects an index path');
select ok((select (plan #>> '{0,Plan,Actual Total Time}')::numeric < 100
  from bulk_context_plan_probe where label='indexed'),
  'the warm-cache indexed context lookup completes under 100 ms');
select ok((select
    plan::text like '%ph_master_bulk_import_context_v1_pkey%'
    and plan::text like '%ph_master_bulk_import_context_run_pid_xid_idx%'
    and plan::text like '%ph_master_inventory_import_lineage_seen_pkey%'
    and plan::text like '%ph_master_inventory_item6_alias_seen_v7_pkey%'
    and plan::text not like '%JIT%'
  from bulk_context_plan_probe where label='all-lookup-arms'),
  'all four context resolution arms use their existing indexes without JIT fallback');
select ok((select jsonb_path_exists(plan,
  '$.** ? (@."Index Name" == "ph_master_bulk_import_context_run_pid_xid_idx" && @."Index Cond" like_regex "canonical_unique_id")')
  from bulk_context_plan_probe where label='all-lookup-arms'),
  'canonical resolution constrains canonical identity in the index condition');
select ok((select
  jsonb_array_length(jsonb_path_query_array(plan,
    'strict $.** ? (@."Relation Name" == "ph_master_bulk_import_context_v1")'))=4
  and not exists (
    select 1 from jsonb_array_elements(jsonb_path_query_array(plan,
      'strict $.** ? (@."Relation Name" == "ph_master_bulk_import_context_v1")')) node
    where coalesce(node->>'Index Cond','') not like '%source_unique_id%'
      and coalesce(node->>'Index Cond','') not like '%canonical_unique_id%'
  )
  from bulk_context_plan_probe where label='all-lookup-arms'),
  'every context relation in the four resolution arms has a full identity index condition');
select ok((select plan::text not like '%"Filter": "(canonical_unique_id =%'
  from bulk_context_plan_probe where label='all-lookup-arms'),
  'canonical resolution does not scan the request prefix and filter afterward');

set local enable_seqscan = on;
select is((select (private.ph_master_bulk_context_v1(
  'b9030000-0000-4000-8000-000000000001','bulk-context-plan-9539'
 )).raw_values->>'source'),'9539',
 'direct source identity still resolves the matching context row');
select is(current_setting('enable_seqscan'),'on',
 'the context lookup leaves the caller planner setting unchanged');
select is((select (private.ph_master_bulk_context_v1(
  'b9030000-0000-4000-8000-000000000001','bulk-context-canonical'
 )).raw_values->>'path'),'canonical',
 'canonical identity still resolves its matching context row');
select is((select (private.ph_master_bulk_context_v1(
  'b9030000-0000-4000-8000-000000000001','bulk-context-lineage'
 )).raw_values->>'path'),'lineage',
 'lineage identity still resolves its imported context row');
select is((select (private.ph_master_bulk_context_v1(
  'b9030000-0000-4000-8000-000000000001','bulk-context-alias'
 )).raw_values->>'path'),'alias',
 'item6 alias identity still resolves its imported context row');
select ok((private.ph_master_bulk_context_v1(
  'b9030000-0000-4000-8000-000000000099','bulk-context-plan-9539'
 )).source_unique_id is null,
 'unmatched run identities still resolve to an empty context');

select * from finish();
rollback;
