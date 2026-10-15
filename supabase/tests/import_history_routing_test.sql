-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('import_private','import_history_files','snapshot manifest is stored in the private schema');
select has_table('import_private','import_history_rows','source rows are stored in the private schema');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'import_private.import_history_files'::regclass,'import_private.import_history_rows'::regclass)),
  'RLS is enabled on both history tables');
select ok(not has_schema_privilege('anon','import_private','usage')
  and not has_schema_privilege('authenticated','import_private','usage'),
  'browser roles cannot enter the private history schema');
select ok(not has_table_privilege('service_role','import_private.import_history_files','select')
  and not has_table_privilege('service_role','import_private.import_history_rows','select'),
  'importer can access history only through the bounded RPC surface');
select ok(has_function_privilege('service_role',
  'public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)','execute')
  and has_function_privilege('service_role','public.stage_import_history_rows_v1(uuid,jsonb)','execute')
  and has_function_privilege('service_role','public.publish_import_history_v1(uuid)','execute'),
  'service role has the three ingestion RPCs');
select ok(not has_function_privilege('anon',
  'public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)','execute')
  and not has_function_privilege('authenticated','public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)','execute')
  and not has_function_privilege('authenticated','public.stage_import_history_rows_v1(uuid,jsonb)','execute'),
  'browser roles cannot stage or publish source history');
select ok(has_function_privilege('authenticated','public.list_import_history_v1(text,date,integer,integer)','execute')
  and has_function_privilege('authenticated','public.get_import_history_rows_v1(uuid,integer,integer)','execute')
  and not has_function_privilege('anon','public.list_import_history_v1(text,date,integer,integer)','execute'),
  'authenticated clients can use manager-gated read RPCs only');
select ok((select pg_get_functiondef('public.list_import_history_v1(text,date,integer,integer)'::regprocedure)
  ilike '%private.can_manage_eval_assignments%')
  and (select pg_get_functiondef('public.get_import_history_rows_v1(uuid,integer,integer)'::regprocedure)
  ilike '%private.can_manage_eval_assignments%'),
  'both read RPCs apply the existing manager authorization helper');
select ok((select pg_get_functiondef('public.stage_import_history_rows_v1(uuid,jsonb)'::regprocedure)
  ilike '%jsonb_array_length(p_rows)>500%'),
  'history staging is bounded to 500 rows per request');
select ok((select bool_and(p.proconfig @> array['statement_timeout=55s'])
  from pg_proc p where p.oid in (
    'public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure,
    'public.stage_import_history_rows_v1(uuid,jsonb)'::regprocedure,
    'public.publish_import_history_v1(uuid)'::regprocedure)),
  'importer write RPCs have bounded 55-second execution timeouts');
select ok((select pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48%'
  and pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA%'
  and pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE%'
  and pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo%'
  and pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG%'
  and pg_get_functiondef('public.begin_import_history_v1(text,text,text,text,date,timestamptz,integer,text[],text)'::regprocedure)
  like '%1u4Vk5L92zmcXXT2qNWzImWTud73Bpole%'),
  'routing destinations are server-fixed for all three import datasets');
select ok((select pg_get_indexdef('import_private.import_history_files_ready_page_idx'::regclass)
  not ilike '%include%columns%'),
  'manifest page index avoids copying arbitrarily wide source headers');

do $$
declare manager_id uuid;
begin
  select id into manager_id from public.profiles where lower(username)='dylan_collyge' limit 1;
  if manager_id is null then
    manager_id := 'd6f60000-0000-4000-8000-000000000001';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(manager_id,'history-manager@example.invalid','{}','{}') on conflict(id) do nothing;
    insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
    values(manager_id,'dylan_collyge','History Manager','ADMIN',false,null,null)
    on conflict(id) do update set username='dylan_collyge',role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null;
  else
    update public.profiles set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null
    where id=manager_id;
  end if;
  insert into public.ph_eval_assignment_users(username,display_name,active,source)
  values('dylan_collyge','History Manager',true,'pgtap_import_history')
  on conflict(username) do update set active=true,display_name=excluded.display_name;
end;
$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
 ('d6f60000-0000-4000-8000-000000000002','history-csr@example.invalid','{}','{}')
on conflict(id) do nothing;
insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until) values
 ('d6f60000-0000-4000-8000-000000000002','history_csr','History CSR','CSR',false,null,null)
on conflict(id) do update set role='CSR',must_change_password=false,disabled_at=null,locked_until=null;
create temporary table import_history_test_sessions(username text primary key,user_id uuid,session_id uuid) on commit drop;
insert into import_history_test_sessions(username,user_id,session_id)
select 'history_manager',id,gen_random_uuid() from public.profiles where lower(username)='dylan_collyge'
union all
select 'history_csr',id,gen_random_uuid() from public.profiles where lower(username)='history_csr';
insert into auth.sessions(id,user_id)
select session_id,user_id from import_history_test_sessions;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',user_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from import_history_test_sessions where username='history_csr'),true);
select set_config('request.jwt.claim.sub','d6f60000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.begin_import_history_v1('drive','forbidden','v','x.csv','2026-10-15','2026-10-15T12:00:00Z',1,array['A'],repeat('c',64))$$,
  '42501','IMPORT_HISTORY_IMPORTER_FORBIDDEN','authenticated clients cannot ingest snapshots');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$select public.begin_import_history_v1('unknown','f','v','x.csv','2026-10-15','2026-10-15T12:00:00Z',2,array['A'],'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  '22023','IMPORT_HISTORY_BEGIN_INVALID','unknown dataset is rejected');
select throws_ok($$select public.begin_import_history_v1('drive','f','v','x.csv','2026-10-15','2026-10-15T12:00:00Z',2,array['A'],'bad')$$,
  '22023','IMPORT_HISTORY_BEGIN_INVALID','malformed content hash is rejected');

create temporary table history_test_ids(snapshot_id uuid,display_label text) on commit drop;
insert into history_test_ids
select (r->>'snapshotId')::uuid,r->>'displayLabel'
from (select public.begin_import_history_v1('drive','history-file-1','v1','DriveAroundMC-10-06313120261015063131.xlsx',
  '2026-10-15','2026-10-15T06:31:31Z',4,array['Item','Item',''],repeat('a',64)) r) q;
select is((select display_label from history_test_ids),'2026-10-15 01','first daily snapshot has a stable clean date and sequence label');
select is(public.begin_import_history_v1('drive','history-file-1','renamed-version','archive-copy.xlsx',
  '2026-10-16','2026-10-16T06:31:31Z',4,array['Item','Item',''],repeat('a',64))->>'snapshotId',
  (select snapshot_id::text from history_test_ids),'retry after a filename/version change reuses the same snapshot');
select throws_ok($$select public.begin_import_history_v1('drive','history-file-1','v2','x.csv','2026-10-15','2026-10-15T06:31:31Z',5,array['Item','Item',''],repeat('a',64))$$,
  '22023','IMPORT_HISTORY_RETRY_CONFLICT','same identity with a changed row count is rejected');
select throws_ok($$select public.begin_import_history_v1('drive','history-file-1','v2','x.csv','2026-10-15','2026-10-15T06:31:31Z',4,array['Item','Changed',''],repeat('a',64))$$,
  '22023','IMPORT_HISTORY_RETRY_CONFLICT','same identity with changed headers is rejected');

select ok((public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":1,"values":["one","dup","x"]},{"row_number":2,"values":["two","dup","y"]}]'::jsonb)->>'stagedRows')='2',
  'bounded staging records its contiguous resume point');
select ok((public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":1,"values":["one","dup","x"]},{"row_number":2,"values":["two","dup","y"]}]'::jsonb)->>'acceptedRows')='0',
  'exact retry rows are idempotently acknowledged');
select throws_ok($$select public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":4,"values":["four","dup","z"]}]'::jsonb)$$,
  '22023','IMPORT_HISTORY_STAGE_GAP','resumption cannot skip unacknowledged row numbers');
select throws_ok($$select public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":1,"values":["different","dup","z"]}]'::jsonb)$$,
  '22023','IMPORT_HISTORY_ROW_RETRY_CONFLICT','retry cannot change an already stored row');
select throws_ok($$select public.publish_import_history_v1((select snapshot_id from history_test_ids))$$,
  '55000','IMPORT_HISTORY_ROWS_INCOMPLETE','partial source cannot be published');
select ok((public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":3,"values":["","","blank source row"]}]'::jsonb)->>'stagedRows')='3',
  'blank physical source rows are retained positionally');
select is(public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":4,"values":["four","dup","z"]}]'::jsonb)->>'stagedRows','4',
  'next contiguous chunk advances the durable resume point');
select is(public.publish_import_history_v1((select snapshot_id from history_test_ids))->>'status','ready',
  'complete source is published atomically');
select is(public.publish_import_history_v1((select snapshot_id from history_test_ids))->>'status','ready',
  'publication retry returns the ready manifest');
select throws_ok($$select public.stage_import_history_rows_v1((select snapshot_id from history_test_ids),
  '[{"row_number":1,"values":["one","dup","x"]}]'::jsonb)$$,
  '55000','IMPORT_HISTORY_ALREADY_PUBLISHED','published source rows are immutable');

insert into history_test_ids
select (r->>'snapshotId')::uuid,r->>'displayLabel'
from (select public.begin_import_history_v1('drive','history-file-2','v1','second.xlsx',
  '2026-10-15','2026-10-15T07:00:00Z',1,array['Item'],repeat('b',64)) r) q;
select is((select display_label from history_test_ids order by display_label desc limit 1),'2026-10-15 02',
  'second file on one source date gets the next sequence');
select public.stage_import_history_rows_v1((select snapshot_id from history_test_ids order by display_label desc limit 1),
  '[{"row_number":1,"values":["second"]}]'::jsonb);
select public.publish_import_history_v1((select snapshot_id from history_test_ids order by display_label desc limit 1));

do $$
declare i integer;
begin
  for i in 3..99 loop
    perform public.begin_import_history_v1('drive','history-fill-'||i,'v1','fill-'||i||'.xlsx',
      '2026-10-15','2026-10-15T08:00:00Z',0,array['Item'],lpad(to_hex(i),64,'0'));
  end loop;
end;
$$;
select is(public.begin_import_history_v1('drive','history-fill-100','v1','fill-100.xlsx',
  '2026-10-15','2026-10-15T08:00:00Z',0,array['Item'],lpad(to_hex(100),64,'0'))->>'displayLabel',
  '2026-10-15 100','daily sequence formatting preserves all digits after 99');
create temporary table wide_manifest_id(snapshot_id uuid) on commit drop;
insert into wide_manifest_id
select (public.begin_import_history_v1('reserves','wide-header-file','v1','wide-headers.xlsx',
  '2026-10-15','2026-10-15T08:30:00Z',0,
  array(select 'Column '||g.i::text from generate_series(1,171) g(i)),repeat('e',64))->>'snapshotId')::uuid;
select public.publish_import_history_v1((select snapshot_id from wide_manifest_id));

select set_config('request.jwt.claims','{"role":"anon"}',true);
select set_config('request.jwt.claim.role','anon',true);
select throws_ok($$select public.list_import_history_v1('drive',null,null,1)$$,
  '42501','IMPORT_HISTORY_FORBIDDEN','unauthenticated caller cannot browse history');
select throws_ok($$select public.get_import_history_rows_v1((select snapshot_id from history_test_ids limit 1),0,1)$$,
  '42501','IMPORT_HISTORY_FORBIDDEN','unauthenticated caller cannot read source rows');
select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',user_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from import_history_test_sessions where username='history_csr'),true);
select set_config('request.jwt.claim.sub','d6f60000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select public.list_import_history_v1('drive',null,null,1)$$,
  '42501','IMPORT_HISTORY_FORBIDDEN','authenticated non-manager cannot browse history');
select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',user_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from import_history_test_sessions where username='history_manager'),true);
select set_config('request.jwt.claim.sub',(select user_id::text from import_history_test_sessions where username='history_manager'),true);
select set_config('request.jwt.claim.role','authenticated',true);
select is(jsonb_array_length(public.list_import_history_v1('drive',null,null,1)->'files'),1,
  'manager list returns a bounded file page');
select ok((public.list_import_history_v1('drive',null,null,1)->>'hasMore')::boolean,
  'manifest listing reports another page');
select ok((public.list_import_history_v1('drive',null,null,1)->'nextCursor') ?& array['reportDate','sequence'],
  'manifest listing exposes a date and sequence continuation cursor');
select is(jsonb_array_length(public.list_import_history_v1('reserves',null,null,1)->'files'->0->'columns'),171,
  'manifest page reads preserve all 171 source headers without a wide covering index');
select is(jsonb_array_length(public.get_import_history_rows_v1((select snapshot_id from history_test_ids order by display_label asc limit 1),0,1)->'rows'),1,
  'manager row reads return one requested source row');
select ok((public.get_import_history_rows_v1((select snapshot_id from history_test_ids order by display_label asc limit 1),0,1)->>'hasMore')::boolean,
  'source row pagination reports its continuation');
select is(((public.get_import_history_rows_v1((select snapshot_id from history_test_ids order by display_label asc limit 1),0,1)->'rows'->0->>'values')::jsonb)->>0,
  'one','history values preserve original header order and positional data');

select * from finish();
rollback;
