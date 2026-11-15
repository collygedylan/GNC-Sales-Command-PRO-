create schema private;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create table public.ph_requests_pending(unique_id text primary key,request_folder text,req_status text,date_completed text,req_archived boolean);
create table public.ph_requests_completed_history(unique_id text primary key,request_folder text,req_status text,date_completed timestamptz,last_event text);
create table public.ph_request_delivery_outbox(event_id uuid primary key,event_key text,request_folder text,payload jsonb,
  status text,lease_token uuid,lease_owner text,lease_expires_at timestamptz,sanitized_error_code text,next_attempt_at timestamptz,updated_at timestamptz);
create table private.ph_request_folder_delivery_state(request_folder text primary key,membership_version bigint);
create function private.is_service_role_request() returns boolean language sql as $$
  select coalesce(current_setting('test.request_service',true),'')='true'
$$;
create function private.reconcile_request_folder_completion_v2(text) returns jsonb language sql as $$
  select '{"queued":false}'::jsonb
$$;
