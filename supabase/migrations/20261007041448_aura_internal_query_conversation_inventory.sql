begin;
set local lock_timeout = '5s';

-- Private, durable memory for Aura. Rows are only reachable through the
-- actor-checking RPC below and are physically removed by the delete operation.
create schema if not exists aura_private;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
revoke all on schema aura_private from public, anon, authenticated;

create or replace function public.aura_query_number_v1(v text) returns numeric
language sql immutable parallel safe set search_path=pg_catalog
as $$ select case when replace(btrim(coalesce(v,'')),',','') ~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
  then replace(btrim(v),',','')::numeric else null::numeric end $$;
create or replace function public.aura_query_salesyear_v1(v text) returns integer
language sql immutable parallel safe set search_path=pg_catalog
as $$ select case when public.aura_query_number_v1(v) is null or public.aura_query_number_v1(v)<>trunc(public.aura_query_number_v1(v))
  or public.aura_query_number_v1(v)<1 or public.aura_query_number_v1(v)>9999 then null::integer
  when public.aura_query_number_v1(v)>=2000 then mod(public.aura_query_number_v1(v)::integer,100)
  when public.aura_query_number_v1(v)<=99 then public.aura_query_number_v1(v)::integer else null::integer end $$;
create or replace function public.aura_query_size_v1(v text) returns text
language sql immutable parallel safe set search_path=pg_catalog
as $$ select regexp_replace(regexp_replace(lower(regexp_replace(btrim(coalesce(v,'')),'^#\s*','','i')),'\s+',' ','g'),'\.$','') $$;
revoke all on function public.aura_query_number_v1(text),public.aura_query_salesyear_v1(text),public.aura_query_size_v1(text) from public,anon,authenticated;

-- Trigram indexes back the deterministic fuzzy predicates below; common names
-- reuse the index created by aura_inventory_match_010.
create index if not exists idx_ph_master_inventory_aura_botanical_trgm
  on public.ph_master_inventory using gin (public.aura_inventory_v2_name_v1(botanicalname) extensions.gin_trgm_ops);
create index if not exists idx_ph_master_inventory_aura_genus_trgm
  on public.ph_master_inventory using gin (public.aura_inventory_v2_name_v1(genusname) extensions.gin_trgm_ops);
create index if not exists idx_ph_master_inventory_aura_itemcode_trgm
  on public.ph_master_inventory using gin (public.aura_inventory_v2_name_v1(itemcode) extensions.gin_trgm_ops);

create table aura_private.aura_query_conversations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context)='object'),
  revision integer not null default 0 check (revision >= 0),
  active_turn_id uuid,
  lease_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(actor_id,id)
);
create index aura_query_conversations_actor_updated_idx
  on aura_private.aura_query_conversations(actor_id,updated_at desc,id desc);

create table aura_private.aura_query_turns (
  actor_id uuid not null,
  conversation_id uuid not null,
  id uuid not null,
  revision integer not null,
  text text not null,
  source text not null check (source in ('typed','voice')),
  status text not null check (status in ('pending','complete','cancelled','expired')),
  response jsonb,
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context)='object'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources)='array'),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key(actor_id,conversation_id,id),
  foreign key(actor_id,conversation_id) references aura_private.aura_query_conversations(actor_id,id) on delete cascade
);
create index aura_query_turns_page_idx on aura_private.aura_query_turns(actor_id,conversation_id,created_at desc,id desc);
create unique index aura_query_turns_actor_turn_id_idx on aura_private.aura_query_turns(actor_id,id);
revoke all on aura_private.aura_query_conversations,aura_private.aura_query_turns from public,anon,authenticated,service_role;
alter table aura_private.aura_query_conversations enable row level security;
alter table aura_private.aura_query_turns enable row level security;

create or replace function public.aura_query_conversation_v1(
  p_actor_id uuid,
  p_operation text,
  p_conversation_id uuid default null,
  p_turn_id uuid default null,
  p_expected_revision integer default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,aura_private set statement_timeout='5s'
as $$
declare
  op text := lower(btrim(coalesce(p_operation,'')));
  c aura_private.aura_query_conversations%rowtype;
  t aura_private.aura_query_turns%rowtype;
  txt text; src text; lim integer; cursor_time timestamptz; cursor_id uuid;
  arr jsonb; cur jsonb; response_value jsonb; context_value jsonb; sources_value jsonb; page_more boolean; turn_found boolean:=false;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id
    and p.username='dylan_collyge' and p.disabled_at is null and p.must_change_password=false
    and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN';
  end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception using errcode='22023',message='AURA_PAYLOAD_INVALID';
  end if;
  if op='create' then
    insert into aura_private.aura_query_conversations(actor_id,title,context)
    values(p_actor_id,left(coalesce(p_payload->>'title',''),160),coalesce(p_payload->'context','{}'::jsonb)) returning * into c;
    return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'context',c.context,'turns','[]'::jsonb);
  elsif op='list' then
    lim:=greatest(1,least(100,coalesce((p_payload->>'limit')::integer,30)));
    if p_payload ? 'cursor' and jsonb_typeof(p_payload->'cursor')='object' then
      cursor_time:=nullif(p_payload->'cursor'->>'updatedAt','')::timestamptz;
      cursor_id:=nullif(p_payload->'cursor'->>'id','')::uuid;
    end if;
    select coalesce(jsonb_agg(x.row_data order by x.updated_at desc,x.id desc),'[]'::jsonb)
      into arr from (select id,updated_at,jsonb_build_object('id',id,'title',title,'revision',revision,'updatedAt',updated_at) row_data
        from aura_private.aura_query_conversations where actor_id=p_actor_id
          and (cursor_time is null or (updated_at,id)<(cursor_time,cursor_id))
        order by updated_at desc,id desc limit lim+1) x;
    page_more:=jsonb_array_length(arr)>lim;
    if page_more then
      cur:=jsonb_build_object('updatedAt',arr->(lim-1)->'updatedAt','id',arr->(lim-1)->'id');
      select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into arr
        from jsonb_array_elements(arr) with ordinality a(value,ord) where ord<=lim;
    end if;
    return jsonb_build_object('ok',true,'conversations',arr,'hasMore',page_more,
      'nextCursor',case when page_more then cur else null end);
  elsif op='read' then
    select * into c from aura_private.aura_query_conversations where actor_id=p_actor_id and id=p_conversation_id;
    if not found then raise exception using errcode='P0002',message='AURA_CONVERSATION_NOT_FOUND'; end if;
    lim:=greatest(1,least(100,coalesce((p_payload->>'limit')::integer,30)));
    if p_payload ? 'cursor' and jsonb_typeof(p_payload->'cursor')='object' then
      cursor_time:=nullif(p_payload->'cursor'->>'createdAt','')::timestamptz;
      cursor_id:=nullif(p_payload->'cursor'->>'id','')::uuid;
    end if;
    select coalesce(jsonb_agg(x.row_data order by x.created_at desc,x.id desc),'[]'::jsonb) into arr from (
      select id,created_at,jsonb_build_object('id',id,'text',text,'response',response,'status',status,'sources',sources,'createdAt',created_at) row_data
      from (select * from aura_private.aura_query_turns where actor_id=p_actor_id and conversation_id=c.id
        and (cursor_time is null or (created_at,id)<(cursor_time,cursor_id)) order by created_at desc,id desc limit lim+1) q
    ) x;
    page_more:=jsonb_array_length(arr)>lim;
    if page_more then cur:=jsonb_build_object('createdAt',arr->(lim-1)->'createdAt','id',arr->(lim-1)->'id'); end if;
    select coalesce(jsonb_agg(value order by ord desc),'[]'::jsonb) into arr from jsonb_array_elements(
      case when page_more then (select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from jsonb_array_elements(arr) with ordinality a(value,ord) where ord<=lim) else arr end
    ) with ordinality a(value,ord);
    return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'context',c.context,
      'turns',arr,'hasMore',page_more,
      'nextCursor',case when page_more then cur else null end);
  elsif op='delete' then
    delete from aura_private.aura_query_conversations where actor_id=p_actor_id and id=p_conversation_id;
    if not found then raise exception using errcode='P0002',message='AURA_CONVERSATION_NOT_FOUND'; end if;
    return jsonb_build_object('ok',true,'deleted',true,'conversationId',p_conversation_id);
  elsif op='begin' then
    txt:=btrim(coalesce(p_payload->>'text','')); src:=lower(coalesce(p_payload->>'source','text'));
    if txt='' or length(txt)>12000 or src not in ('typed','voice') then
      raise exception using errcode='22023',message='AURA_TURN_INPUT_INVALID'; end if;
    if p_turn_id is null then raise exception using errcode='22023',message='AURA_TURN_ID_REQUIRED'; end if;
    perform pg_advisory_xact_lock(hashtextextended('aura-query-turn:'||p_actor_id::text||':'||p_turn_id::text,0));
    select * into t from aura_private.aura_query_turns where actor_id=p_actor_id and id=p_turn_id;
    turn_found:=found;
    if turn_found then
      if p_conversation_id is not null and p_conversation_id is distinct from t.conversation_id then
        raise exception using errcode='22023',message='AURA_TURN_ID_REUSED'; end if;
      select * into c from aura_private.aura_query_conversations where actor_id=p_actor_id and id=t.conversation_id for update;
      if not found then raise exception using errcode='P0002',message='AURA_CONVERSATION_NOT_FOUND'; end if;
      if t.status='cancelled' then raise exception using errcode='22023',message='AURA_TURN_CANCELLED'; end if;
      if t.text<>txt or t.source<>src then raise exception using errcode='22023',message='AURA_TURN_ID_REUSED'; end if;
      if t.status='complete' then return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'context',t.context,'replayed',true,'response',t.response,'sources',t.sources); end if;
    else
      if p_conversation_id is null then
        insert into aura_private.aura_query_conversations(actor_id,title) values(p_actor_id,left(txt,160)) returning * into c;
      else
        select * into c from aura_private.aura_query_conversations where actor_id=p_actor_id and id=p_conversation_id for update;
        if not found then raise exception using errcode='P0002',message='AURA_CONVERSATION_NOT_FOUND'; end if;
        if btrim(c.title)='' then
          update aura_private.aura_query_conversations set title=left(txt,160) where actor_id=p_actor_id and id=c.id returning * into c;
        end if;
      end if;
    end if;
    if p_expected_revision is not null and p_expected_revision<>c.revision then
      raise exception using errcode='40001',message='AURA_REVISION_CONFLICT'; end if;
    if turn_found then
      if t.status='pending' and c.active_turn_id=t.id and c.lease_until>clock_timestamp() then
        raise exception using errcode='55P03',message='AURA_TURN_IN_PROGRESS'; end if;
    end if;
    if c.active_turn_id is not null and c.lease_until>clock_timestamp() then
      raise exception using errcode='55P03',message='AURA_TURN_IN_PROGRESS'; end if;
    if c.active_turn_id is not null then
      update aura_private.aura_query_turns set status='expired',completed_at=clock_timestamp()
        where actor_id=p_actor_id and conversation_id=c.id and id=c.active_turn_id and status='pending';
    end if;
    c.revision:=c.revision+1;
    update aura_private.aura_query_conversations set revision=c.revision,active_turn_id=p_turn_id,
      lease_until=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() where actor_id=p_actor_id and id=c.id returning * into c;
    insert into aura_private.aura_query_turns(actor_id,conversation_id,id,revision,text,source,status,context)
    values(p_actor_id,c.id,p_turn_id,c.revision,txt,src,'pending',c.context)
    on conflict(actor_id,conversation_id,id) do update set revision=excluded.revision,text=excluded.text,source=excluded.source,status='pending',completed_at=null;
    return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'context',c.context,'turnId',p_turn_id,'leaseUntil',c.lease_until);
  elsif op in ('complete','cancel','fail') then
    select * into c from aura_private.aura_query_conversations where actor_id=p_actor_id and id=p_conversation_id for update;
    if not found then raise exception using errcode='P0002',message='AURA_CONVERSATION_NOT_FOUND'; end if;
    if p_turn_id is null then raise exception using errcode='22023',message='AURA_TURN_ID_REQUIRED'; end if;
    select * into t from aura_private.aura_query_turns where actor_id=p_actor_id and conversation_id=c.id and id=p_turn_id for update;
    if op='cancel' then
      if not found then
        insert into aura_private.aura_query_turns(actor_id,conversation_id,id,revision,text,source,status,context,completed_at)
        values(p_actor_id,c.id,p_turn_id,c.revision,'','typed','cancelled',c.context,clock_timestamp());
        return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'cancelled',true,'tombstone',true);
      end if;
      if t.status='cancelled' then return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'cancelled',true); end if;
      if t.status='complete' then return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'cancelled',false); end if;
      if t.status<>'pending' or c.active_turn_id is distinct from p_turn_id
        or (p_expected_revision is not null and p_expected_revision<>c.revision) then
        raise exception using errcode='40001',message='AURA_REVISION_CONFLICT'; end if;
      update aura_private.aura_query_turns set status='cancelled',completed_at=clock_timestamp() where actor_id=p_actor_id and conversation_id=c.id and id=p_turn_id;
      update aura_private.aura_query_conversations set revision=revision+1,active_turn_id=null,lease_until=null,updated_at=clock_timestamp()
        where actor_id=p_actor_id and id=c.id returning * into c;
      return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'cancelled',true);
    end if;
    if op='fail' then
      if not found or t.status<>'pending' or p_expected_revision is null
        or c.revision<>p_expected_revision or c.active_turn_id is distinct from p_turn_id then
        raise exception using errcode='40001',message='AURA_REVISION_CONFLICT'; end if;
      if c.lease_until is null or c.lease_until<=clock_timestamp() then
        raise exception using errcode='40001',message='AURA_LEASE_EXPIRED'; end if;
      update aura_private.aura_query_turns set status='expired',completed_at=clock_timestamp()
        where actor_id=p_actor_id and conversation_id=c.id and id=p_turn_id;
      update aura_private.aura_query_conversations set revision=revision+1,active_turn_id=null,lease_until=null,updated_at=clock_timestamp()
        where actor_id=p_actor_id and id=c.id returning * into c;
      return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'failed',true);
    end if;
    if p_expected_revision is null or c.revision<>p_expected_revision or c.active_turn_id is distinct from p_turn_id then
      raise exception using errcode='40001',message='AURA_REVISION_CONFLICT'; end if;
    if c.lease_until is null or c.lease_until<=clock_timestamp() then raise exception using errcode='40001',message='AURA_LEASE_EXPIRED'; end if;
    if not found or t.status<>'pending' then raise exception using errcode='40001',message='AURA_TURN_NOT_PENDING'; end if;
    response_value:=coalesce(p_payload->'response','{}'::jsonb); context_value:=coalesce(p_payload->'context',c.context);
    sources_value:=coalesce(p_payload->'sources','[]'::jsonb);
    if jsonb_typeof(response_value)<>'object' or jsonb_typeof(context_value)<>'object' or jsonb_typeof(sources_value)<>'array'
      or length(coalesce(response_value->>'reply',''))>16000 then raise exception using errcode='22023',message='AURA_RESULT_INVALID'; end if;
    update aura_private.aura_query_turns set status='complete',response=response_value,context=context_value,sources=sources_value,completed_at=clock_timestamp()
      where actor_id=p_actor_id and conversation_id=c.id and id=p_turn_id;
    update aura_private.aura_query_conversations set revision=revision+1,context=context_value,active_turn_id=null,lease_until=null,updated_at=clock_timestamp()
      where actor_id=p_actor_id and id=c.id returning * into c;
    return jsonb_build_object('ok',true,'conversationId',c.id,'revision',c.revision,'context',c.context,'response',response_value,'sources',sources_value);
  else
    raise exception using errcode='22023',message='AURA_OPERATION_INVALID';
  end if;
end $$;

revoke all on function public.aura_query_conversation_v1(uuid,text,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.aura_query_conversation_v1(uuid,text,uuid,uuid,integer,jsonb) to service_role;

-- Typed read-only inventory query router. No caller-provided SQL is evaluated.
create or replace function public.aura_query_inventory_v1(
  p_actor_id uuid,p_operation text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,aura_private,extensions set statement_timeout='5s' set pg_trgm.word_similarity_threshold='0.3'
as $$
declare
  op text:=lower(btrim(coalesce(p_operation,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  season_code text; query_season text; sales_year integer; query_sales_year integer; metric text; count_mode text; lim integer; open_only boolean;
  needle text; ic text; gn text; size_filter text; loc text; zone_filter text; asg text; asg_text text; lot text; selection_filter text;
  assignee_matches integer; person_choices jsonb;
  loc_mode text; row_assignment_active boolean:=false; total_value numeric; row_total bigint; unique_total bigint; physical_total bigint; page_offset integer:=0; complete_value boolean:=true; identity_complete boolean:=true; scope_complete boolean:=true; rows_value jsonb; choices_value jsonb; more_value boolean; exact_match_value boolean;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and p.must_change_password=false and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if public.navigation_module_allowed_v1(p_actor_id,'drive') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN'; end if;
  perform 1 from public.app_dataset_revisions r where r.key='ph_master_inventory' for share;
  if not found or (select r.state from public.app_dataset_revisions r where r.key='ph_master_inventory') is distinct from 'ready'
    or exists(select 1 from app_sync_private.import_leases l where l.key='ph_master_inventory') then
    return jsonb_build_object('ok',true,'complete',false,'code','AURA_INVENTORY_IMPORT_INCOMPLETE',
      'rows','[]'::jsonb,'total',null,'metric',metric,'season',null,'hasMore',false,'nextCursor',null); end if;
  row_assignment_active:=coalesce(private.inventory_row_assignment_policy_active_v1(),false);
  if jsonb_typeof(f)<>'object' or op not in ('match','stock','locations','ownership','unassigned','lot','maximum') then
    raise exception using errcode='22023',message='AURA_FILTER_INVALID'; end if;
  if exists(select 1 from jsonb_object_keys(f) k where k not in ('productText','itemcode','genus','contSize','locationCode','locationMode','zone','assignee','assigneeText','selectionId','metric','season','salesYear','lotcode','openStockOnly','countMode')) then
    raise exception using errcode='22023',message='AURA_FILTER_KEY_INVALID'; end if;
  metric:=lower(coalesce(f->>'metric','ptravailable')); if metric not in ('ptravailable','ptronhand') then raise exception using errcode='22023',message='AURA_METRIC_INVALID'; end if;
  count_mode:=lower(coalesce(f->>'countMode','quantity')); if count_mode not in ('quantity','physical_rows','unique_items') then raise exception using errcode='22023',message='AURA_COUNT_MODE_INVALID'; end if;
  if f ? 'openStockOnly' and lower(f->>'openStockOnly') not in ('true','false') then raise exception using errcode='22023',message='AURA_OPEN_STOCK_FILTER_INVALID'; end if;
  open_only:=coalesce((f->>'openStockOnly')::boolean,false);
  lim:=greatest(1,least(200,coalesce(p_limit,50)));
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,9}$' then raise exception using errcode='22023',message='AURA_CURSOR_INVALID'; end if;
    page_offset:=least(1000000,(p_cursor->>'offset')::integer);
  end if;
  needle:=nullif(btrim(f->>'productText'),''); ic:=nullif(upper(btrim(f->>'itemcode')),''); gn:=nullif(lower(btrim(f->>'genus')),'');
  size_filter:=nullif(public.aura_query_size_v1(f->>'contSize'),''); loc:=nullif(upper(btrim(f->>'locationCode')),'');
  zone_filter:=nullif(upper(btrim(f->>'zone')),''); asg:=nullif(lower(btrim(f->>'assignee')),'');
  asg_text:=nullif(lower(btrim(f->>'assigneeText')),''); selection_filter:=nullif(btrim(f->>'selectionId'),''); lot:=nullif(upper(btrim(f->>'lotcode')),'');
  if selection_filter is not null and position('|' in selection_filter)=0 then asg:=lower(selection_filter); selection_filter:=null; end if;
  loc_mode:=lower(coalesce(f->>'locationMode','exact'));
  if loc_mode not in ('exact','prefix','contains') or length(coalesce(needle,''))>160 or length(coalesce(ic,''))>100 or length(coalesce(loc,''))>80
      or length(coalesce(asg,''))>120 or length(coalesce(asg_text,''))>120 or length(coalesce(selection_filter,''))>180
      or length(coalesce(lot,''))>100 then raise exception using errcode='22023',message='AURA_FILTER_INVALID'; end if;
  if zone_filter not in ('PERENNIAL','INSIDE','OUTSIDE') and zone_filter is not null then raise exception using errcode='22023',message='AURA_ZONE_INVALID'; end if;
  select upper(coalesce(s.value->>'seasonCode',s.value->>'season_code',s.value->>'season',s.value->>'currentSeason',s.value->>'current_season')),
    public.aura_query_salesyear_v1(coalesce(s.value->>'salesYear',s.value->>'sales_year',s.value->>'currentSalesYear',s.value->>'current_sales_year',s.value->>'salesyear'))
    into season_code,sales_year from public.ph_app_settings s where s.key='current_season_salesyear';
  if season_code is null or season_code not in ('S1','F1','U1','U2','U3','X','Y','Z') or sales_year is null then
    return jsonb_build_object('ok',false,'code','AURA_CURRENT_SETTINGS_UNKNOWN','complete',false,'rows','[]'::jsonb,'total',null,'metric',metric,'season',null,'hasMore',false,'nextCursor',null); end if;
  query_sales_year:=case when f ? 'salesYear' then public.aura_query_salesyear_v1(f->>'salesYear') else sales_year end;
  if query_sales_year is null or query_sales_year>sales_year then raise exception using errcode='22023',message='AURA_SALESYEAR_INVALID'; end if;
  if asg_text is not null then
    select count(*) into assignee_matches from public.ph_eval_assignment_users u where u.active is true
      and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
        or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g')));
    if assignee_matches=1 then
      select u.username into asg from public.ph_eval_assignment_users u where u.active is true
        and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
          or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))) limit 1;
      asg:=lower(asg); asg_text:=null;
    else
      select coalesce(jsonb_agg(jsonb_build_object('selectionId',username,'username',username,'label',display_name)
        order by score desc,username),'[]'::jsonb) into person_choices from (
          select u.username,u.display_name,greatest(
            extensions.word_similarity(public.aura_inventory_v2_name_v1(asg_text),public.aura_inventory_v2_name_v1(u.username)),
            extensions.word_similarity(public.aura_inventory_v2_name_v1(asg_text),public.aura_inventory_v2_name_v1(u.display_name))) score
          from public.ph_eval_assignment_users u where u.active is true and
            ((assignee_matches>1 and (lower(regexp_replace(btrim(u.username),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))
              or lower(regexp_replace(btrim(u.display_name),'\s+',' ','g'))=lower(regexp_replace(asg_text,'\s+',' ','g'))))
             or (assignee_matches<=1 and (public.aura_inventory_v2_name_v1(u.username) %> public.aura_inventory_v2_name_v1(asg_text)
              or public.aura_inventory_v2_name_v1(u.display_name) %> public.aura_inventory_v2_name_v1(asg_text))))
          order by score desc,u.username limit 5
        ) choices;
      if jsonb_array_length(person_choices)>0 then
        return jsonb_build_object('ok',true,'complete',false,'rows','[]'::jsonb,'total',null,'metric',metric,
          'season',query_season,'salesYear',query_sales_year,'exactMatch',false,'choiceKind','assignee','candidateChoices',person_choices,
          'hasMore',false,'nextCursor',null);
      end if;
      return jsonb_build_object('ok',false,'code','AURA_ASSIGNEE_NOT_FOUND','complete',false,'rows','[]'::jsonb,'total',null,
        'metric',metric,'season',query_season,'hasMore',false,'nextCursor',null);
    end if;
  end if;
  query_season:=coalesce(upper(nullif(btrim(f->>'season'),'')),season_code);
  if query_season not in ('S1','F1','U1','U2','U3','X','Y','Z') then raise exception using errcode='22023',message='AURA_SEASON_INVALID'; end if;
  if op='match' and needle is null and ic is null and gn is null then raise exception using errcode='22023',message='AURA_PRODUCT_REQUIRED'; end if;
  if op='lot' and needle is null and ic is null and gn is null and lot is null then raise exception using errcode='22023',message='AURA_PRODUCT_REQUIRED'; end if;

  -- Result aggregation is bounded only for returned rows; the total is computed
  -- independently. Null or malformed relevant quantities make totals unknown.
  with inv as (
    select m.*, public.aura_query_salesyear_v1(m.saleyear) sy,
      public.aura_query_number_v1(case when metric='ptronhand' then m.ptronhand else m.ptravailable end) qty,
      coalesce(nullif(upper(btrim(m.itemcode)),''),'') ic_norm,
      lower(regexp_replace(btrim(coalesce(m.genusname,'')),'\s+',' ','g')) gn_norm,
      public.aura_query_size_v1(m.contsize) size_norm,
      (needle is not null and (public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(needle)
        or public.aura_inventory_v2_name_v1(m.botanicalname)=public.aura_inventory_v2_name_v1(needle)
        or upper(coalesce(m.itemcode,''))=upper(needle))) product_exact,
      case when needle is null then 1::real else greatest(
        case when public.aura_inventory_v2_name_v1(m.commonname)=public.aura_inventory_v2_name_v1(needle)
          or public.aura_inventory_v2_name_v1(m.botanicalname)=public.aura_inventory_v2_name_v1(needle)
          or upper(coalesce(m.itemcode,''))=upper(needle) then 1::real else 0::real end,
        extensions.word_similarity(public.aura_inventory_v2_name_v1(needle),public.aura_inventory_v2_name_v1(m.commonname)),
        extensions.word_similarity(lower(needle),lower(coalesce(m.botanicalname,''))),
        extensions.word_similarity(lower(needle),lower(coalesce(m.genusname,'')))) end match_score
    from public.ph_master_inventory m
    where (nullif(btrim(coalesce(m.app_tab_assignment,'')),'') is null or lower(m.app_tab_assignment) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied'))
      and upper(coalesce(m.desigitem,'')) not like '%SHFT%'
      and public.aura_query_salesyear_v1(m.saleyear)<=query_sales_year
      and upper(coalesce(m.season,''))=query_season
      and (not open_only or public.aura_query_number_v1(m.s_lts)>0 or public.aura_query_number_v1(m.s_lts) is null)
      and (ic is null or upper(btrim(coalesce(m.itemcode,'')))=ic)
      and (gn is null or lower(regexp_replace(btrim(coalesce(m.genusname,'')),'\s+',' ','g'))=gn)
      and (size_filter is null or public.aura_query_size_v1(m.contsize)=size_filter)
      and (loc is null or case loc_mode when 'prefix' then upper(coalesce(m.locationcode,'')) like loc||'%' when 'contains' then upper(coalesce(m.locationcode,'')) like '%'||loc||'%' else upper(coalesce(m.locationcode,''))=loc end)
      and (lot is null or upper(coalesce(m.lotcode,''))=lot)
      and (needle is null or public.aura_inventory_v2_name_v1(m.commonname) %> public.aura_inventory_v2_name_v1(needle)
        or public.aura_inventory_v2_name_v1(m.botanicalname) %> public.aura_inventory_v2_name_v1(needle)
        or public.aura_inventory_v2_name_v1(m.genusname) %> public.aura_inventory_v2_name_v1(needle)
        or public.aura_inventory_v2_name_v1(m.itemcode) %> public.aura_inventory_v2_name_v1(needle))
  ), relevant as (
    select * from inv where sy is not null and sy<=query_sales_year
  ), filtered as (
    select r.*,private.eval_location_zone(r.locationcode) zone_calc
    from relevant r
  ), candidates_raw as (
    select x.*,a.assignedto,a.assigned_display_name,a.assignee_values,a.warehousei,a.assignment_reason,a.zone_override_active,a.assignment_ambiguous,a.assignment_present,a.assignment_review_required,
      concat_ws('|',x.ic_norm,x.gn_norm,x.size_norm) selection_id,x.ic_norm||'|'||x.gn_norm owner_key
    from filtered x left join lateral (
      select case when count(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))=1
          then min(coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),'')))) else null end assignedto,
        min(u.display_name) assigned_display_name,min(a.warehousei) warehousei,min(a.assignment_reason) assignment_reason,
        bool_or(a.zone_override_active) zone_override_active,bool_or(a.review_required) assignment_review_required,
        array_agg(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),'')))
          order by coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))
          filter(where nullif(btrim(a.assignedto),'') is not null) assignee_values,
        count(distinct coalesce(lower(u.username),lower(nullif(btrim(a.assignedto),''))))>1 assignment_ambiguous,count(*)>0 assignment_present
      from (
        select private.inventory_effective_owner_v1(r.master_unique_id) assignedto,r.warehousei,r.assignment_reason,
          r.zone_override_active,r.review_required
        from public.ph_inventory_row_assignments r
        where row_assignment_active and r.master_unique_id=x.unique_id and r.present_in_drive
        union all
        select legacy.assignedto,legacy.warehousei,legacy.assignment_reason,legacy.zone_override_active,false review_required
        from public.ph_warehouse_assigned_items legacy
        where not row_assignment_active
          and coalesce(legacy.assignment_key,upper(btrim(coalesce(legacy.itemcode_normalized,legacy.itemcode,'')))||'|'||lower(regexp_replace(btrim(coalesce(legacy.genusname_normalized,legacy.genusname,'')),'\s+',' ','g')))
             = x.ic_norm||'|'||x.gn_norm
          and legacy.present_in_drive is true
      ) a left join public.ph_eval_assignment_users u on u.active is true
        and (lower(btrim(a.assignedto))=lower(btrim(u.username)) or lower(btrim(a.assignedto))=lower(btrim(u.display_name)))
    ) a on true
    where (zone_filter is null or (zone_filter in ('INSIDE','PERENNIAL') and x.zone_calc='inside') or (zone_filter='OUTSIDE' and x.zone_calc='outside'))
      and (asg is null or lower(coalesce(a.assignedto,''))=asg or asg=any(coalesce(a.assignee_values,array[]::text[])))
      and (selection_filter is null or concat_ws('|',x.ic_norm,x.gn_norm,x.size_norm)=selection_filter or x.ic_norm||'|'||x.gn_norm=selection_filter)
      and (op<>'unassigned' or case when row_assignment_active then
        (not coalesce(a.assignment_present,false) or coalesce(a.assignment_ambiguous,false) or nullif(btrim(coalesce(a.assignedto,'')),'') is null)
        else coalesce(a.assignment_ambiguous,false) or not coalesce(a.assignment_present,false)
          or nullif(btrim(coalesce(a.assignedto,'')),'') is null or lower(btrim(coalesce(a.assignedto,'')))='unassigned' end)
      and (op<>'ownership' or coalesce(a.assignment_present,false))
  ), candidates as (
    select c.* from candidates_raw c where needle is null or c.product_exact
      or not exists(select 1 from candidates_raw e where e.product_exact)
  ), ranked as (
    select c.*,row_number() over(partition by case when op='ownership' and row_assignment_active then unique_id
      when op='ownership' then owner_key else selection_id end
      order by match_score desc,itemcode,genusname,contsize,locationcode,unique_id) identity_rn from candidates c
  ), numbered as (
    select r.*,row_number() over(order by case when op='maximum' then qty end desc nulls last,match_score desc,itemcode,genusname,contsize,locationcode,unique_id) rn from ranked r
    where op not in ('ownership','match') or identity_rn=1
  )
  select (select count(*) from candidates),(select count(*) from numbered),
    (select count(distinct owner_key) from candidates),
    case when op='maximum' then (select max(qty) from candidates) else coalesce((select sum(qty) from candidates),0) end,
    coalesce((select bool_and(qty is not null and (not open_only or public.aura_query_number_v1(s_lts) is not null)) from candidates),true),
    coalesce((select bool_and(ic_norm<>'' and gn_norm<>'') from candidates),true),
    coalesce((select bool_and(not open_only or public.aura_query_number_v1(s_lts) is not null) from candidates),true),
    coalesce((select count(distinct selection_id) filter(where product_exact)=1 from candidates),false),
    coalesce(jsonb_agg(jsonb_build_object('selectionId',case when op='ownership' then owner_key else selection_id end,'uniqueId',unique_id,'itemcode',itemcode,'genus',genusname,
      'commonName',commonname,'contSize',contsize,'locationCode',locationcode,'lotCode',lotcode,'ptravailable',public.aura_query_number_v1(ptravailable),
      'ptronhand',public.aura_query_number_v1(ptronhand),'assignedTo',assignedto,'assignedDisplayName',assigned_display_name,'warehousei',warehousei,'assignmentReason',assignment_reason,
      'zoneOverrideActive',coalesce(zone_override_active,false),'assignmentAmbiguous',coalesce(assignment_ambiguous,false),'zone',zone_calc,
      'ownerStatus',case when coalesce(assignment_ambiguous,false) then 'ambiguous'
        when not coalesce(assignment_present,false) then 'missing'
        when nullif(btrim(coalesce(assignedto,'')),'') is null or lower(btrim(coalesce(assignedto,'')))='unassigned' then 'unassigned'
        else 'assigned' end,
      'ownershipSource',case when row_assignment_active then 'inventory_row' else 'eval_group' end,
      'rowOwnerStatus',case when not row_assignment_active then null
        when coalesce(assignment_review_required,false) then 'review'
        when not coalesce(assignment_present,false) then 'missing'
        when nullif(btrim(coalesce(assignedto,'')),'') is null then 'unassigned' else 'assigned' end,
      'matchKind',case when needle is null or product_exact then 'exact' else 'fuzzy' end,
      'assigneeChoices',to_jsonb(coalesce(assignee_values,array[]::text[])),
      'currentLocationCount',case when op='ownership' then (select count(distinct z.locationcode) from candidates z where z.owner_key=numbered.owner_key
        and (not row_assignment_active or z.assignedto is not distinct from numbered.assignedto)) else null end,
      'currentLocations',case when op='ownership' then (select coalesce(jsonb_agg(distinct z.locationcode) filter(where z.locationcode is not null),'[]'::jsonb) from candidates z where z.owner_key=numbered.owner_key
        and (not row_assignment_active or z.assignedto is not distinct from numbered.assignedto)) else null end
      ) order by case when op='maximum' then qty end desc nulls last,match_score desc,itemcode,genusname,contsize,locationcode,unique_id)
      filter(where rn>page_offset and rn<=page_offset+lim),'[]'::jsonb),
    coalesce((select jsonb_agg(choice order by score desc,selection_id) from (
      select jsonb_build_object('selectionId',selection_id,
        'itemcode',itemcode,'genus',genusname,'commonName',commonname,'contSize',contsize,'locationCode',locationcode,
        'matchKind',case when product_exact then 'exact' else 'fuzzy' end) choice,match_score score,selection_id
      from (select distinct on(selection_id) * from ranked
        order by selection_id,match_score desc,itemcode,genusname,contsize,locationcode,unique_id) chosen
      order by match_score desc,itemcode,genusname,contsize,locationcode,unique_id limit 5
    ) choice_rows),'[]'::jsonb)
  into physical_total,row_total,unique_total,total_value,complete_value,identity_complete,scope_complete,exact_match_value,rows_value,choices_value from numbered;
  if count_mode='physical_rows' then total_value:=physical_total; complete_value:=scope_complete;
  elsif count_mode='unique_items' then total_value:=unique_total; complete_value:=identity_complete and scope_complete;
  end if;
  if not coalesce(complete_value,false) then total_value:=null; end if;
  more_value:=row_total>page_offset+lim;
  return jsonb_build_object('ok',true,'complete',coalesce(complete_value,false),'rows',rows_value,'total',total_value,
    'rowCount',row_total,'physicalRowCount',physical_total,'metric',case when count_mode='quantity' then metric else count_mode end,
    'season',query_season,'activeSeason',season_code,'salesYear',query_sales_year,'activeSalesYear',sales_year,
    'hasMore',more_value,'nextCursor',case when more_value then jsonb_build_object('offset',page_offset+lim) else null end,
    'exactMatch',case when needle is null and (ic is not null or selection_filter is not null) then true
      when needle is null then null else coalesce(exact_match_value,false) end,'candidateChoices',choices_value);
end $$;

revoke all on function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.aura_query_inventory_v1(uuid,text,jsonb,jsonb,integer) to service_role;

-- Read-only access to the existing HL order workflow. In particular, this
-- never calls public.hl_order_state(), whose reconciliation path locks/writes.
create or replace function public.aura_query_hl_order_v1(
  p_actor_id uuid,p_operation text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,hl_order_private,private set statement_timeout='5s'
as $$
declare
  op text:=lower(btrim(coalesce(p_operation,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  lim integer:=greatest(1,least(100,coalesce(p_limit,50))); off integer:=0;
  needle text; order_num text; status_filter text; item text; lot_filter text; size_value text;
  rows_value jsonb; total_value bigint; more_value boolean; cursor_value jsonb;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and p.must_change_password=false and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if public.navigation_module_allowed_v1(p_actor_id,'hl-order') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN'; end if;
  if op not in ('orders','receipts','balances') or jsonb_typeof(f)<>'object'
    or exists(select 1 from jsonb_object_keys(f) k where k not in ('productText','orderNumber','status','itemcode','lot','size')) then
    raise exception using errcode='22023',message='AURA_HL_FILTER_INVALID'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,9}$' then
      raise exception using errcode='22023',message='AURA_HL_CURSOR_INVALID'; end if;
    off:=least(1000000,(p_cursor->>'offset')::integer);
  end if;
  needle:=nullif(btrim(f->>'productText'),''); order_num:=nullif(btrim(f->>'orderNumber'),'');
  status_filter:=nullif(lower(btrim(f->>'status')),''); item:=nullif(upper(btrim(f->>'itemcode')),'');
  lot_filter:=nullif(upper(btrim(f->>'lot')),''); size_value:=nullif(upper(btrim(f->>'size')),'');
  if length(coalesce(needle,''))>160 or length(coalesce(order_num,''))>80 or length(coalesce(status_filter,''))>40
    or length(coalesce(item,''))>100 or length(coalesce(lot_filter,''))>40 or length(coalesce(size_value,''))>48 then
    raise exception using errcode='22023',message='AURA_HL_FILTER_INVALID'; end if;
  if op='orders' then
    with matched as materialized (
      select o.*,hl_order_private.order_json(o.id) detail from hl_order_private.orders o
      where (order_num is null or o.order_number ilike '%'||order_num||'%')
        and (status_filter is null or lower(o.status)=status_filter)
        and (needle is null or o.order_number ilike '%'||needle||'%' or o.status ilike '%'||needle||'%'
          or exists(select 1 from hl_order_private.order_lines l where l.order_id=o.id and
            concat_ws(' ',l.source->>'itemcode',l.source->>'commonname',l.source->>'contsize',l.source->>'lotcode') ilike '%'||needle||'%'))
        and (item is null or exists(select 1 from hl_order_private.order_lines l where l.order_id=o.id and upper(l.source->>'itemcode')=item))
        and (lot_filter is null or exists(select 1 from hl_order_private.order_lines l where l.order_id=o.id and upper(l.source->>'lotcode')=lot_filter))
        and (size_value is null or exists(select 1 from hl_order_private.order_lines l where l.order_id=o.id and upper(l.source->>'contsize')=size_value))
    ), numbered as (
      select m.*,row_number() over(order by m.created_at desc,m.id desc) rn from matched m
    )
    select (select count(*) from matched),
      coalesce(jsonb_agg(detail||jsonb_build_object('orderId',id,'orderNumber',order_number,'createdAt',created_at,
        'sentAt',sent_at,'kind','order') order by rn) filter(where rn>off and rn<=off+lim),'[]'::jsonb)
      into total_value,rows_value from numbered;
  elsif op='receipts' then
    with matched as materialized (
      select r.*,o.order_number,l.source_id,l.source from hl_order_private.receipts r
      join hl_order_private.orders o on o.id=r.order_id join hl_order_private.order_lines l on l.id=r.line_id
      where (order_num is null or o.order_number ilike '%'||order_num||'%')
        and (status_filter is null or lower(o.status)=status_filter)
        and (needle is null or o.order_number ilike '%'||needle||'%' or concat_ws(' ',l.source->>'itemcode',l.source->>'commonname',l.source->>'contsize',l.source->>'lotcode') ilike '%'||needle||'%')
        and (item is null or upper(l.source->>'itemcode')=item)
        and (lot_filter is null or upper(l.source->>'lotcode')=lot_filter)
        and (size_value is null or upper(l.source->>'contsize')=size_value)
    ), numbered as (select m.*,row_number() over(order by m.created_at desc,m.id desc) rn from matched m)
    select (select count(*) from matched),coalesce(jsonb_agg(jsonb_build_object('receiptId',id,'orderId',order_id,
      'orderNumber',order_number,'lineId',line_id,'sourceId',source_id,'itemcode',source->>'itemcode',
      'commonName',source->>'commonname','contSize',source->>'contsize','lotCode',source->>'lotcode',
      'receivedQuantity',received_quantity,'previousQuantity',previous_quantity,'quantityDelta',quantity_delta,
      'reason',reason,'createdBy',created_by,'createdAt',created_at,'kind','receipt') order by rn)
      filter(where rn>off and rn<=off+lim),'[]'::jsonb) into total_value,rows_value from numbered;
  else
    with matched as materialized (
      select b.* from hl_order_private.po_balances_v2() b
      where (item is null or upper(b.itemcode)=item) and (lot_filter is null or upper(b.lot)=lot_filter)
        and (size_value is null or upper(b.size)=size_value) and (status_filter is null or lower(b.status)=status_filter)
        and (needle is null or concat_ws(' ',b.itemcode,b.commonname,b.size,b.lot) ilike '%'||needle||'%')
    ), numbered as (select m.*,row_number() over(order by m.lot,m.itemcode,m.size) rn from matched m)
    select (select count(*) from matched),coalesce(jsonb_agg(to_jsonb(numbered)||jsonb_build_object(
      'poId',concat_ws('|',lot,itemcode,size),'itemcode',itemcode,'contSize',size,'lotCode',lot,
      'commonName',commonname,'receiptAdjustment',receipt_adjustment,'poOrdered',po_ordered,'kind','balance') order by rn)
      filter(where rn>off and rn<=off+lim),'[]'::jsonb) into total_value,rows_value from numbered;
  end if;
  more_value:=total_value>off+lim;
  if more_value then cursor_value:=jsonb_build_object('offset',off+lim); end if;
  return jsonb_build_object('ok',true,'rows',rows_value,'total',total_value,'complete',true,
    'hasMore',more_value,'nextCursor',cursor_value,'kind',op);
end $$;
revoke all on function public.aura_query_hl_order_v1(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.aura_query_hl_order_v1(uuid,text,jsonb,jsonb,integer) to service_role;

-- Narrow read-only Aura adapter for Bunch Notes. It uses the workflow's own
-- actor and can_read rules and never dispatches through the write-capable
-- bunch_note_command_v1 router.
create or replace function public.aura_query_bunch_v1(
  p_actor_id uuid,p_operation text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,bunch_note_private,private set statement_timeout='5s'
as $$
declare
  actor public.profiles; op text:=lower(btrim(coalesce(p_operation,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  lim integer:=greatest(1,least(100,coalesce(p_limit,50))); off integer:=0;
  record_id uuid; status_filter text; location_filter text; location_mode text; product_needle text;
  date_from timestamptz; date_to timestamptz; rows_value jsonb; total_value bigint; more_value boolean; next_cursor jsonb;
begin
  if p_actor_id is null or not exists(select 1 from public.profiles p where p.id=p_actor_id and p.username='dylan_collyge'
    and p.disabled_at is null and p.must_change_password=false and (p.locked_until is null or p.locked_until<=clock_timestamp()))
    or not private.app_account_active_at_v1(p_actor_id,'dylan_collyge',clock_timestamp()) then
    raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if public.navigation_module_allowed_v1(p_actor_id,'bunch-note') is distinct from true then
    raise exception using errcode='42501',message='AURA_MODULE_FORBIDDEN'; end if;
  actor:=bunch_note_private.actor(p_actor_id);
  if actor.username is distinct from 'dylan_collyge' then raise exception using errcode='42501',message='AURA_ACTOR_FORBIDDEN'; end if;
  if op not in ('list','get') or jsonb_typeof(f)<>'object'
    or exists(select 1 from jsonb_object_keys(f) k where k not in ('recordId','status','locationCode','locationMode','productText','dateFrom','dateTo')) then
    raise exception using errcode='22023',message='AURA_BUNCH_FILTER_INVALID'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor)<>'object' or p_cursor-'offset'<>'{}'::jsonb or coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,9}$' then
      raise exception using errcode='22023',message='AURA_BUNCH_CURSOR_INVALID'; end if;
    off:=least(1000000,(p_cursor->>'offset')::integer);
  end if;
  record_id:=nullif(btrim(f->>'recordId'),'')::uuid;
  status_filter:=nullif(lower(btrim(f->>'status')),'');
  location_filter:=nullif(upper(btrim(f->>'locationCode')),'');
  location_mode:=lower(coalesce(f->>'locationMode','exact'));
  product_needle:=nullif(btrim(f->>'productText'),'');
  date_from:=nullif(btrim(f->>'dateFrom'),'')::timestamptz;
  date_to:=nullif(btrim(f->>'dateTo'),'')::timestamptz;
  if (op='get' and record_id is null) or location_mode not in ('exact','prefix')
    or (status_filter is not null and status_filter not in ('open','complete','cancelled'))
    or length(coalesce(location_filter,''))>80 or length(coalesce(product_needle,''))>160
    or length(coalesce(f->>'dateFrom',''))>48 or length(coalesce(f->>'dateTo',''))>48
    or (date_from is not null and date_to is not null and date_from>date_to) then
    raise exception using errcode='22023',message='AURA_BUNCH_FILTER_INVALID'; end if;
  with matched as materialized (
    select j.id,j.updated_at,bunch_note_private.job_json(j) detail from bunch_note_private.jobs j
    where bunch_note_private.can_read(actor,j)
      and (record_id is null or j.id=record_id)
      and (status_filter is null or lower(j.status)=status_filter)
      and (location_filter is null or case location_mode when 'prefix' then upper(btrim(j.location)) like location_filter||'%' else upper(btrim(j.location))=location_filter end)
      and (date_from is null or j.created_at>=date_from)
      and (date_to is null or j.created_at<date_to)
      and (product_needle is null or position(lower(product_needle) in lower(j.block))>0
        or position(lower(product_needle) in lower(j.location))>0
        or exists(select 1 from jsonb_array_elements(coalesce((bunch_note_private.job_json(j)->'body'->'source'),'[]'::jsonb)) s
          where position(lower(product_needle) in lower(concat_ws(' ',s->>'itemcode',s->>'commonname',s->>'lotcode')))>0))
  ), numbered as (
    select m.*,row_number() over(order by m.updated_at desc,m.id desc) rn from matched m
  )
  select (select count(*) from matched),coalesce(jsonb_agg(detail||jsonb_build_object('recordId',id) order by rn)
    filter(where rn>off and rn<=off+lim),'[]'::jsonb)
    into total_value,rows_value from numbered;
  more_value:=total_value>off+lim;
  if more_value then next_cursor:=jsonb_build_object('offset',off+lim); end if;
  return jsonb_build_object('ok',true,'complete',true,'rows',rows_value,'total',total_value,
    'hasMore',more_value,'nextCursor',next_cursor);
end $$;
revoke all on function public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.aura_query_bunch_v1(uuid,text,jsonb,jsonb,integer) to service_role;
commit;
