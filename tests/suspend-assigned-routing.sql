-- Disposable PostgreSQL fixture only. No hosted database execution.
select 'create role '||value from unnest(array['anon','authenticated','service_role'])value
where not exists(select 1 from pg_roles where rolname=value) \gexec
create schema private;
create schema suspend_tag_private;
create table public.profiles(id uuid primary key,username text,role text);
create table public.user_access(profile_id uuid,view_all_requests text,view_all_suspend text);
create table public.ph_itemcode_default_owners(itemcode_normalized text primary key,assignedto text);
create table public.ph_inventory_row_assignments(itemcode_normalized text,locationcode text,lotcode text,assignedto text,present_in_drive boolean);
create table public.ph_soc_master(unique_id text primary key,itemcode text,locationcode text,lotcode text,
  suspend text,suspend_to text,dock text,suspend_completed boolean default false,spec text);
create table public.fixture_receipts(source_uid text,itemcode text,locationcode text,lotcode text,spec text);
create table public.ph_master_inventory(unique_id text,itemcode text,locationcode text,lotcode text);
create function private.current_active_profile() returns public.profiles language sql stable as $$
  select p from public.profiles p where p.id=nullif(current_setting('fixture.actor',true),'')::uuid
$$;
create function private.access_username_v23119(text) returns text language sql immutable as $$select lower(btrim($1))$$;
create function private.eval_location_zone(p_location text) returns text language plpgsql immutable set search_path='' as $$
declare value text:=upper(regexp_replace(btrim(coalesce(p_location,'')),'[[:space:]]+','','g')); parts text[];
begin
  if value !~ '^[A-Z]\.[0-9]{2}(\.[0-9]{3})?$' then return null; end if;
  parts:=string_to_array(value,'.');
  if parts[1]='C' and parts[2] in ('06','07') then return 'inside'; end if;
  if parts[1]='D' and parts[2] between '04' and '09' then return 'inside'; end if;
  if parts[1]='D' and parts[2]='10' and cardinality(parts)<>3 then return null; end if;
  if parts[1]='D' and parts[2]='10' and cardinality(parts)=3 and parts[3]::integer<=21 then return 'inside'; end if;
  return 'outside';
end $$;
create function private.inventory_assignment_actor_active_v3047(text,text[]) returns boolean language sql stable as $$
  select exists(select 1 from public.profiles where username=$1)
$$;
create function private.queue_scope_actor_v23159(p_queue text) returns text language sql stable security definer as $$
  select case when (case p_queue when 'request' then a.view_all_requests else a.view_all_suspend end)='Y'
    then '*' else private.access_username_v23119(p.username) end
  from private.current_active_profile() p left join public.user_access a on a.profile_id=p.id where p.id is not null
$$;
create function suspend_tag_private.actor(uuid) returns public.profiles language sql stable as $$select p from public.profiles p where id=$1$$;
create function suspend_tag_private.eligible(text,text) returns boolean language sql immutable as $$select $1='SUSPEND'$$;
create function suspend_tag_private.row_json(text) returns jsonb language sql stable as $$select to_jsonb(r) from public.ph_soc_master r where unique_id=$1$$;
create function suspend_tag_private.order_key(public.ph_soc_master) returns text language sql immutable as $$select $1.unique_id$$;

create view public.ph_active_suspend with(security_invoker=true) as
select workbook_suspend.unique_id,workbook_suspend.itemcode,workbook_suspend.locationcode,
  workbook_suspend.lotcode,workbook_suspend.suspend_eval_owner as assignedto,
  workbook_suspend.suspend_eval_owner,workbook_suspend.spec
from (
  select tag_1.*,nullif(lower(btrim(exact.assignedto)), '') as suspend_eval_owner
  from (select * from public.ph_soc_master) tag_1
  left join public.ph_itemcode_default_owners exact on exact.itemcode_normalized=upper(
    case when btrim(tag_1.itemcode) ~ '^[0-9]{6}[.][0-9]{3}[.]$' then btrim(tag_1.itemcode)||'1' else btrim(tag_1.itemcode) end)
  where current_user in ('postgres','service_role') or private.queue_scope_actor_v23159('suspend')='*'
    or nullif(lower(btrim(exact.assignedto)), '')=private.queue_scope_actor_v23159('suspend')
) workbook_suspend
where workbook_suspend.suspend='SUSPEND' and not workbook_suspend.suspend_completed;

create function suspend_tag_private.command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer as $$
declare actor public.profiles; s public.ph_soc_master; uid text:=p_payload->>'sourceUid';
begin
  actor:=suspend_tag_private.actor(p_actor_id);
  if p_operation<>'decide' and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') and regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in ('ADMIN','ADMINISTRATOR','MANAGER','EVAL','EVALUATOR','INVENTORY','INVENTORYMANAGER') then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
  if p_operation='rows' then
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(suspend_tag_private.row_json(r.unique_id) order by r.unique_id),'[]') from public.ph_soc_master r
      where r.unique_id in (select jsonb_array_elements_text(p_payload->'ids')) and suspend_tag_private.eligible(r.suspend,r.suspend_to)));
  end if;
  select * into s from public.ph_soc_master where unique_id=uid for update;
  if not found or not suspend_tag_private.eligible(s.suspend,s.suspend_to) then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
  update public.ph_soc_master set spec=p_payload->>'spec' where unique_id=uid;
  insert into public.fixture_receipts values(uid,s.itemcode,s.locationcode,s.lotcode,p_payload->>'spec');
  return jsonb_build_object('ok',true,'sourceUid',uid);
end $$;

create function suspend_tag_private.group_command(p_actor_id uuid,p_operation text,p_payload jsonb,p_command_id uuid,p_expected_version bigint)
returns jsonb language plpgsql security definer as $$
declare actor public.profiles; s public.ph_soc_master; group_key text;
begin
 actor:=suspend_tag_private.actor(p_actor_id);
 if p_operation='dock_review' then
   if actor.role<>'QC' then raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
   elsif regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g') not in
      ('ADMIN','ADMINISTRATOR','MANAGER','EVALUATOR','INVENTORY','INVENTORYMANAGER','SALESREP')
      and actor.username not in ('dylan_collyge','megan_kelly','jd_jones','dan_mccuistion') then
      raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501'; end if;
 select * into s from public.ph_soc_master where unique_id=p_payload->>'sourceUid';
 if s.unique_id is null then raise exception 'SUSPEND_TAG_SOURCE_MISSING' using errcode='P0002'; end if;
 if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z]','','g')='SALESREP'
    and s.suspend_to is distinct from actor.username then
   raise exception 'SUSPEND_TAG_FORBIDDEN' using errcode='42501';
 end if;
 group_key:=suspend_tag_private.order_key(s);
 return jsonb_build_object('ok',true,'sourceUid',group_key);
end $$;

grant usage on schema private,suspend_tag_private to authenticated;
grant select on public.ph_active_suspend,public.ph_soc_master,public.ph_itemcode_default_owners,public.ph_inventory_row_assignments to authenticated;
insert into public.profiles values
('00000000-0000-0000-0000-000000000001','worker_a','EVAL'),
('00000000-0000-0000-0000-000000000002','worker_b','CSR'),
('00000000-0000-0000-0000-000000000003','zoe_green','EVAL'),
('00000000-0000-0000-0000-000000000004','any_admin','admin'),
('00000000-0000-0000-0000-000000000005','any_super_admin','super-admin'),
('00000000-0000-0000-0000-000000000006','dylan_collyge','EVAL');
insert into public.user_access select id,'Y','Y' from public.profiles;
insert into public.ph_itemcode_default_owners values ('111111.030.1','worker_a'),('222222.030.1','worker_b');
insert into public.ph_master_inventory values ('master-a','111111.030.1','G.12.001','27.F1'),('master-b','222222.030.1','G.12.001','27.F1');
insert into public.ph_soc_master
select 'tag-'||i,case when i<=45 then '111111.030.' else '222222.030.1' end,
  case when i=1 then 'C.06.001' else 'G.12.001' end,'27.F1','SUSPEND',
  case when i%2=0 then 'dc' else 'ms' end,'38',false,null from generate_series(1,90)i;
