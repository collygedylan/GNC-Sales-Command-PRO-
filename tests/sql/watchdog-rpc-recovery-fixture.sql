create schema auth;
create schema private;
create schema app_sync_private;
create table public.profiles(id uuid primary key,username text,role text,disabled_at timestamptz,
  must_change_password boolean default false,locked_until timestamptz);
create table public.ph_master_inventory(unique_id text primary key,itemcode text,locationcode text,
  lotcode text,assignedto text,date_completed timestamptz,last_updated timestamptz,photo_link text,spec text);
create table app_sync_private.inventory_location_evidence_v1(source_unique_id text primary key,date_completed timestamptz);
create table public.ph_location_sales_notes(unique_id text primary key,completed_at timestamptz);
create table public.ph_requests_completed_history(client_batch_id uuid,date_completed timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function private.wait_item_detail_lock_v308(bigint) returns boolean language plpgsql as
  $$begin perform pg_advisory_xact_lock($1); return true; end$$;
create function private.normalize_inventory_live_change_username_v2392(text) returns text language sql as $$select lower($1)$$;
create function private.inventory_unrestricted_actor_v23155(public.profiles) returns boolean language sql as $$select false$$;
create function private.inventory_row_assigned_to_actor_v2392(text,text,text) returns boolean language sql as
  $$select exists(select from public.ph_master_inventory where unique_id=$2 and itemcode=$3 and assignedto=$1)$$;
create function private.require_drive_live_change_profile_v2392(text,text,text,text) returns public.profiles language plpgsql as
  $$declare actor public.profiles;
    begin select p.* into actor from public.profiles p join public.ph_master_inventory m on m.assignedto=p.username
      where p.id=auth.uid() and p.disabled_at is null and not p.must_change_password
      and (p.locked_until is null or p.locked_until<=statement_timestamp()) and m.unique_id=$1
      and m.itemcode=$2 and m.locationcode=$3 and m.lotcode=$4;
      if actor.id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if; return actor; end$$;
create function public.save_drive_evidence_v3(text,text,text,text,text,jsonb,jsonb,boolean,text,text)
  returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.save_request_work(text,bigint,jsonb,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.request_work_command_v1(uuid,uuid,text,text,bigint,jsonb,boolean)
  returns jsonb language sql as $$select '{}'::jsonb$$;
insert into public.profiles(id,username,role) values
  ('11111111-1111-1111-1111-111111111111','admin_user','ADMIN'),
  ('22222222-2222-2222-2222-222222222222','assigned_user','EVAL'),
  ('33333333-3333-3333-3333-333333333333','foreign_user','EVAL');
insert into public.ph_master_inventory values('exact-row','000450.030.1','0.00.111','27.F1',
  'assigned_user',now(),now(),'retained-photo','retained-spec');
insert into app_sync_private.inventory_location_evidence_v1 values('exact-row',now());
insert into public.ph_location_sales_notes values('exact-row',now());
