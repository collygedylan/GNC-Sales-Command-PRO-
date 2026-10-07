-- @test-runtime: isolated-supabase
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select has_function('public','production_schedule_read_cards_v1',
  array['integer','uuid','integer','integer','text','jsonb','integer[]'],
  'compact schedule card RPC exists');
select has_index('public','ph_request_history','idx_ph_request_history_assigned_rep_id',
  'request history assigned-rep foreign key has an index');
select ok(has_function_privilege('service_role',
  'public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute'),
  'service role can call compact schedule cards');
select ok(not has_function_privilege('anon',
  'public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute'),
  'anonymous role cannot call compact schedule cards');
select ok(not has_function_privilege('authenticated',
  'public.production_schedule_read_cards_v1(integer,uuid,integer,integer,text,jsonb,integer[])','execute'),
  'authenticated role cannot bypass the app-api authorization check');

insert into public.production_schedule_snapshots(id,status,requested_by,completed_at)
values ('d0060000-0000-4000-8000-000000000001','ready','github_actions_release',now());
insert into public.production_schedule_sheets(snapshot_id,sheet_index,title,header_row,columns,filter_columns,row_count)
values ('d0060000-0000-4000-8000-000000000001',0,'Main',8,
  '[{"index":1,"header":"Item"},{"index":2,"header":"Quantity"},{"index":3,"header":"Action"}]',
  '[{"index":3,"header":"Action"}]',3);
insert into public.production_schedule_active(slot,snapshot_id)
values (1,'d0060000-0000-4000-8000-000000000001');
insert into public.production_schedule_rows(snapshot_id,sheet_index,source_row,cells,search_text)
values
 ('d0060000-0000-4000-8000-000000000001',0,9,'{"1":"Maple","2":"0","3":"Hold","4":"Extra source data"}','Maple Hold'),
 ('d0060000-0000-4000-8000-000000000001',0,10,'{"1":"Elm","2":"20","3":"Release"}','Elm Release'),
 ('d0060000-0000-4000-8000-000000000001',0,11,'{"1":"Pine","2":"8","3":"Release"}','Pine Release');
insert into public.production_schedule_sheets(snapshot_id,sheet_index,title,header_row,columns,filter_columns,row_count)
select 'd0060000-0000-4000-8000-000000000001',1,'Wide',8,
  (select jsonb_agg(jsonb_build_object('index',column_index,'header','Field '||column_index) order by column_index)
   from generate_series(1,784) column_index), '[]'::jsonb,1;
insert into public.production_schedule_rows(snapshot_id,sheet_index,source_row,cells,search_text)
select 'd0060000-0000-4000-8000-000000000001',1,9,
  (select jsonb_object_agg(column_index::text,repeat('production schedule source value ',2)) from generate_series(1,784) column_index),
  'wide source fixture';

select is((public.production_schedule_read_cards_v1(0,null,0,100,'','{}','{1,3}'::integer[])->'rows'->0->'cells'),
  '{"1":"Maple","3":"Hold"}'::jsonb,'card output contains only requested physical columns');
select is((public.production_schedule_read_cards_v1(0,null,0,100,'','{}','{1,3}'::integer[])->'rows'->0->>'fieldCount'),
  '4','card reports the number of populated source fields');
select is((public.production_schedule_read_cards_v1(0,null,0,100,'','{}','{}'::integer[])->'rows'->0->'cells'),
  '{}'::jsonb,'empty-header sheet cards return an empty projection safely');
select is((public.production_schedule_read_cards_v1(0,null,0,100,'','{}','{}'::integer[])->'rows'->0->>'fieldCount'),
  '4','empty-header cards still report populated source fields');
select is((public.production_schedule_read_cards_v1(0,null,0,100,'','{"3":"Release"}','{1}'::integer[])->>'total'),
  '2','filtering retains the exact matching row count');
select is((public.production_schedule_read_cards_v1(0,null,0,100,'Maple','{}','{1}'::integer[])->>'total'),
  '1','search is applied before paging');
select is((public.production_schedule_read_cards_v1(0,null,0,1,'','{}','{1}'::integer[])->>'nextCursor'),
  '9','cursor is the last returned physical source row');
select is((public.production_schedule_read_cards_v1(0,null,0,1,'','{}','{1}'::integer[])->>'hasMore'),
  'true','bounded page signals that another page exists');
select ok((select octet_length((public.production_schedule_read_cards_v1(1,null,0,1,'','{}','{1,2,3}'::integer[])->'rows'->0->'cells')::text) * 20
    < octet_length(r.cells::text)
  from public.production_schedule_rows r where r.snapshot_id='d0060000-0000-4000-8000-000000000001' and r.sheet_index=1),
  'compact schedule card payload is at least 95 percent smaller than its wide source row');
select throws_ok($$select public.production_schedule_read_cards_v1(0,null,0,100,'','{}','{999}'::integer[])$$,
  '22023','PRODUCTION_SCHEDULE_COLUMNS_INVALID','projection rejects columns outside sheet metadata');
select throws_ok($$select public.production_schedule_read_cards_v1(0,null,0,100,'','{}',array_fill(1,array[33]))$$,
  '22023','PRODUCTION_SCHEDULE_COLUMNS_INVALID','projection caps source columns at 32');

select * from finish();
rollback;
