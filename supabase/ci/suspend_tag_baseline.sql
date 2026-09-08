-- Disposable CI database ONLY. Never execute this baseline on a hosted project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
create table public.profiles(id uuid primary key,username text,role text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean);
create table public.ph_soc_master(
  unique_id text primary key,last_updated timestamptz,date_completed timestamptz,
  suspend text,suspend_to text,itemcode text,locationcode text,lotcode text,
  ptronhand text,ptravailable text,s_lts text,quantityordered text,quantityshipped text,dock_note text
);
alter table public.ph_soc_master enable row level security;
grant select on public.ph_soc_master to anon,authenticated;
create policy "Allow All Access" on public.ph_soc_master for all using(true) with check(true);
create table public.fixture_live_events(id bigint generated always as identity,source_uid text);
create function public.fixture_emit_event() returns trigger language plpgsql as $$begin
  insert into public.fixture_live_events(source_uid) values(new.unique_id); return new;
end$$;
create trigger fixture_emit_event after update on public.ph_soc_master for each row execute function public.fixture_emit_event();
