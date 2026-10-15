-- Manual disposable-database performance fixture; intentionally excluded from CI.
-- Run only after the import_history_routing migration in a disposable database.
-- This creates 10,000,000 representative narrow index rows across 5,000 ready
-- manifests, plus one source-shaped snapshot with 10,681 rows x 171 columns.
-- The narrow filler payload keeps fixture storage bounded; query cardinality,
-- manifest count, selected snapshot size, and source header width are explicit.
-- All inserted rows are enclosed by this transaction and removed by ROLLBACK.

begin;
set local statement_timeout='0';
set local maintenance_work_mem='512MB';

create temporary table import_history_perf_manifests (
  snapshot_ordinal integer primary key,
  snapshot_id uuid not null,
  dataset text not null,
  report_date date not null,
  daily_sequence integer not null
) on commit drop;

with numbered as (
  select g.i,
    case g.i % 3 when 0 then 'drive' when 1 then 'soc' else 'reserves' end as dataset,
    row_number() over (partition by g.i % 3 order by g.i) as dataset_ordinal
  from generate_series(1,5000) as g(i)
), inserted as (
  insert into import_private.import_history_files(
    dataset,file_id,source_hash,source_version,original_file_name,drop_folder_id,archive_folder_id,
    source_timestamp,report_date,daily_sequence,display_label,expected_rows,staged_rows,columns,status,published_at
  )
  select n.dataset,
    'import-history-perf-'||n.i,
    lpad(to_hex(n.i),64,'0'),
    'perf-v1','perf-'||n.i||'.xlsx',
    case n.dataset when 'drive' then '1MWLYsQJ41bZVcg1SzDIw93uNmQpzPn48'
      when 'soc' then '19kd-yBZZeJfhJsITpyrzzANbJBNTs9eE' else '1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG' end,
    case n.dataset when 'drive' then '1hswTWk4GooXIAXFmfdx9I6IyqLJ1LqSA'
      when 'soc' then '13hwbF-5wUDruKnjFujjtsyuyrPFgsqpo' else '1u4Vk5L92zmcXXT2qNWzImWTud73Bpole' end,
    timestamptz '2026-01-01 00:00:00+00' + n.i * interval '1 minute',
    date '2026-01-01' + ((n.dataset_ordinal-1)/50)::integer,
    ((n.dataset_ordinal-1)%50)::integer + 1,
    to_char(date '2026-01-01' + ((n.dataset_ordinal-1)/50)::integer,'YYYY-MM-DD')||' '||
      lpad((((n.dataset_ordinal-1)%50)+1)::text,2,'0'),
    2000,2000,
    array['itemcode','commonname','contsize','locationcode','lotcode','ptravailable','source','report_date'],
    'ready',clock_timestamp()
  from numbered n
  returning id,file_id,dataset,report_date,daily_sequence
)
insert into import_history_perf_manifests(snapshot_ordinal,snapshot_id,dataset,report_date,daily_sequence)
select n.i,inserted.id,inserted.dataset,inserted.report_date,inserted.daily_sequence
from numbered n join inserted on inserted.file_id='import-history-perf-'||n.i::text;

insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
select m.snapshot_id,((g.n-1)%2000)+1,
  jsonb_build_array(
    'PERF-'||g.n,
    'Hydrangea paniculata '||((g.n%40)+1),
    case when g.n%4=0 then '#1' when g.n%4=1 then '#3' when g.n%4=2 then '2 gal' else '5 gallon' end,
    chr(65+(g.n%26))||'.'||lpad((g.n%100)::text,2,'0'),
    'LOT-'||((g.n%10000)+1),
    (g.n%900)::text,
    case when g.n%3=0 then 'SOC' when g.n%3=1 then 'DRIVE' else 'RESERVES' end,
    to_char(date '2026-01-01'+(g.n%365),'YYYY-MM-DD')
  )
from generate_series(1,10000000) as g(n)
join import_history_perf_manifests m
  on m.snapshot_ordinal=((g.n-1)/2000)+1;

create temporary table import_history_perf_wide_target(snapshot_id uuid primary key) on commit drop;
with inserted as (
  insert into import_private.import_history_files(
    dataset,file_id,source_hash,source_version,original_file_name,drop_folder_id,archive_folder_id,
    source_timestamp,report_date,daily_sequence,display_label,expected_rows,staged_rows,columns,status,published_at
  ) values (
    'reserves','import-history-perf-wide',repeat('f',64),'perf-v1','wide-history-2026-10-15.xlsx',
    '1Xiyp6WQGAF-4Tm-KwSwi9RsBqulFcSAG','1u4Vk5L92zmcXXT2qNWzImWTud73Bpole',
    timestamptz '2026-10-15 06:31:31+00',date '2026-10-15',1,'2026-10-15 01',10681,10681,
    array(select 'source_column_'||g.i::text from generate_series(1,171) as g(i)),
    'ready',clock_timestamp()
  ) returning id
)
insert into import_history_perf_wide_target(snapshot_id)
select id from inserted;

insert into import_private.import_history_rows(snapshot_id,row_number,row_values)
select target.snapshot_id,rows.row_number,
  (select jsonb_agg(
    case column_number
      when 1 then to_jsonb('PERF-'||lpad(rows.row_number::text,6,'0'))
      when 2 then to_jsonb('Customer '||((rows.row_number%1000)+1)::text)
      when 3 then to_jsonb('Consignee '||((rows.row_number%300)+1)::text)
      when 4 then to_jsonb('Hydrangea paniculata cultivar '||((rows.row_number%40)+1)::text)
      when 5 then to_jsonb(case when rows.row_number%3=0 then '#1' when rows.row_number%3=1 then '#3' else '5 gallon' end)
      when 6 then to_jsonb(chr(65+(rows.row_number%26))||'.'||lpad((rows.row_number%100)::text,2,'0'))
      when 7 then to_jsonb((rows.row_number%900)::integer)
      when 8 then to_jsonb(date '2026-10-15'-(rows.row_number%365))
      when 9 then 'null'::jsonb
      else to_jsonb('source value '||column_number::text||'-'||rows.row_number::text)
    end order by column_number
  ) from generate_series(1,171) as cols(column_number))
from (select g.n::integer as row_number from generate_series(1,10681) as g(n)) rows
cross join import_history_perf_wide_target target;

analyze import_private.import_history_files;
analyze import_private.import_history_rows;

-- First-touch (cold-ish) file-choice page. A true cold-cache measurement also
-- requires a fresh disposable server or explicit shared/OS cache eviction.
explain (analyze,buffers,format json)
select f.id,f.dataset,f.display_label,f.report_date,f.daily_sequence,f.expected_rows,f.columns
from import_private.import_history_files f
where f.dataset='drive' and f.status='ready'
order by f.report_date desc,f.daily_sequence desc
limit 51;

-- Repeat for warm-cache file-choice latency.
explain (analyze,buffers,format json)
select f.id,f.dataset,f.display_label,f.report_date,f.daily_sequence,f.expected_rows,f.columns
from import_private.import_history_files f
where f.dataset='drive' and f.status='ready'
order by f.report_date desc,f.daily_sequence desc
limit 51;

-- Keyset continuation page for the file-choice index.
explain (analyze,buffers,format json)
select f.id,f.dataset,f.display_label,f.report_date,f.daily_sequence,f.expected_rows,f.columns
from import_private.import_history_files f
where f.dataset='drive' and f.status='ready'
  and (f.report_date,f.daily_sequence)<(date '2026-01-20',25)
order by f.report_date desc,f.daily_sequence desc
limit 51;

-- First-touch and warm 50-row source-data pages for the 10,681 x 171 snapshot.
explain (analyze,buffers,format json)
select r.row_number,r.row_values
from import_private.import_history_rows r
where r.snapshot_id=(select snapshot_id from import_history_perf_wide_target)
  and r.row_number>0
order by r.row_number
limit 51;

explain (analyze,buffers,format json)
select r.row_number,r.row_values
from import_private.import_history_rows r
where r.snapshot_id=(select snapshot_id from import_history_perf_wide_target)
  and r.row_number>0
order by r.row_number
limit 51;

-- Keyset continuation page verifies bounded reads after the first 50 rows.
explain (analyze,buffers,format json)
select r.row_number,r.row_values
from import_private.import_history_rows r
where r.snapshot_id=(select snapshot_id from import_history_perf_wide_target)
  and r.row_number>50
order by r.row_number
limit 51;

-- Exercise the full manager-gated RPCs, including active-session lookup and
-- JSON response aggregation. The fixture creates a registered active session
-- for the same established manager identity used by the focused SQL tests.
do $$
declare manager_id uuid;
begin
  select id into manager_id from public.profiles where lower(username)='dylan_collyge' limit 1;
  if manager_id is null then
    manager_id := 'd6f60000-0000-4000-8000-000000000001';
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      values(manager_id,'history-perf-manager@example.invalid','{}','{}') on conflict(id) do nothing;
    insert into public.profiles(id,username,display_name,role,must_change_password,disabled_at,locked_until)
      values(manager_id,'dylan_collyge','History Performance Manager','ADMIN',false,null,null)
      on conflict(id) do update set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null;
  else
    update public.profiles set role='ADMIN',must_change_password=false,disabled_at=null,locked_until=null
      where id=manager_id;
  end if;
  insert into public.ph_eval_assignment_users(username,display_name,active,source)
    values('dylan_collyge','History Performance Manager',true,'pgtap_import_history_perf')
    on conflict(username) do update set active=true,display_name=excluded.display_name;
  create temporary table import_history_perf_auth(manager_id uuid,session_id uuid) on commit drop;
  insert into import_history_perf_auth values(manager_id,gen_random_uuid());
  insert into auth.sessions(id,user_id)
    select fixture.session_id,fixture.manager_id from import_history_perf_auth fixture;
end;
$$;
select set_config('request.jwt.claims',(
  select jsonb_build_object('sub',manager_id,'role','authenticated','exp',4102444800,'session_id',session_id)::text
  from import_history_perf_auth),true);
select set_config('request.jwt.claim.sub',(select manager_id::text from import_history_perf_auth),true);
select set_config('request.jwt.claim.role','authenticated',true);

-- These plans measure complete RPC execution at the real manager gate, not
-- just the underlying indexed SELECT. First call is first-touch; repeat is warm.
explain (analyze,buffers,format json)
select public.list_import_history_v1('drive',null,null,50);

explain (analyze,buffers,format json)
select public.list_import_history_v1('drive',null,null,50);

explain (analyze,buffers,format json)
select public.list_import_history_v1('drive',date '2026-01-20',25,50);

explain (analyze,buffers,format json)
select public.get_import_history_rows_v1((select snapshot_id from import_history_perf_wide_target),0,50);

explain (analyze,buffers,format json)
select public.get_import_history_rows_v1((select snapshot_id from import_history_perf_wide_target),0,50);

explain (analyze,buffers,format json)
select public.get_import_history_rows_v1((select snapshot_id from import_history_perf_wide_target),50,50);

-- End-to-end representative new import exercise: 10,681 rows x 171 columns,
-- in the driver's 500-row maximum chunks. Notices record each service RPC's
-- wall time; exact replay of the first chunk exercises retry idempotency.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
create temporary table import_history_perf_write(snapshot_id uuid) on commit drop;
insert into import_history_perf_write
select (public.begin_import_history_v1(
  'reserves','import-history-perf-write','perf-v1','wide-history-write-2026-10-15.xlsx',
  '2026-10-15','2026-10-15T06:31:31Z',10681,
  array(select 'source_column_'||g.i::text from generate_series(1,171) g(i)),repeat('a',64)
)->>'snapshotId')::uuid;

create temporary table import_history_perf_timings(operation text,elapsed_ms numeric) on commit drop;
do $$
declare
  first_row integer;
  last_row integer;
  payload jsonb;
  started timestamptz;
  snapshot_id uuid;
begin
  select w.snapshot_id into snapshot_id from import_history_perf_write w;
  for first_row in 1..10681 by 500 loop
    last_row := least(first_row+499,10681);
    select jsonb_agg(jsonb_build_object(
      'row_number',n,
      'values',(select jsonb_agg(case c.i
        when 1 then to_jsonb('PERF-'||lpad(n::text,6,'0'))
        when 2 then to_jsonb('Customer '||((n%1000)+1)::text)
        when 3 then to_jsonb('Consignee '||((n%300)+1)::text)
        when 4 then to_jsonb('Hydrangea paniculata cultivar '||((n%40)+1)::text)
        when 5 then to_jsonb(case when n%3=0 then '#1' when n%3=1 then '#3' else '5 gallon' end)
        when 6 then to_jsonb(chr(65+(n%26))||'.'||lpad((n%100)::text,2,'0'))
        when 7 then to_jsonb((n%900)::integer)
        when 8 then to_jsonb(date '2026-10-15'-(n%365))
        when 9 then 'null'::jsonb
        else to_jsonb('source value '||c.i::text||'-'||n::text)
      end order by c.i) from generate_series(1,171) c(i))
    ) order by n) into payload
    from generate_series(first_row,last_row) n;
    started := clock_timestamp();
    perform public.stage_import_history_rows_v1(snapshot_id,payload);
    insert into import_history_perf_timings values(
      'stage_'||first_row||'_'||last_row,
      extract(epoch from clock_timestamp()-started)*1000);
    if first_row=1 then
      started := clock_timestamp();
      perform public.stage_import_history_rows_v1(snapshot_id,payload);
      insert into import_history_perf_timings values(
        'stage_exact_replay_1_'||last_row,
        extract(epoch from clock_timestamp()-started)*1000);
    end if;
  end loop;
  started := clock_timestamp();
  perform public.publish_import_history_v1(snapshot_id);
  insert into import_history_perf_timings values(
    'publish_10681_rows',extract(epoch from clock_timestamp()-started)*1000);
  raise notice 'import history RPC timings (ms): %',
    (select jsonb_agg(jsonb_build_object('operation',operation,'elapsedMs',round(elapsed_ms,2)) order by operation)
       from import_history_perf_timings);
  raise notice 'maximum individual stage/publish RPC duration: % ms',
    (select round(max(elapsed_ms),2) from import_history_perf_timings);
  if exists (select 1 from import_history_perf_timings where elapsed_ms>=55000) then
    raise exception 'IMPORT_HISTORY_RPC_PERFORMANCE_LIMIT_EXCEEDED';
  end if;
end;
$$;

select operation,round(elapsed_ms,2) as elapsed_ms from import_history_perf_timings order by operation;

rollback;
