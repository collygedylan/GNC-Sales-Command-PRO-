-- Disposable PGlite database ONLY. Never execute on a hosted project.
-- Minimal pre-migration dependencies; actual Season lifecycle and evidence
-- functions are loaded unchanged from the checked-in migrations by the runner.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create schema extensions;
create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
create table public.profiles(id uuid primary key, username text, display_name text, role text, disabled_at timestamptz, locked_until timestamptz, must_change_password boolean);
create table public.ph_app_settings(key text primary key, value jsonb);
create table private.app_access_permissions(permission_key text primary key,label text,description text);
create function private.current_active_profile() returns public.profiles language sql as $$select * from public.profiles limit 1$$;
create function private.resolve_app_access_policy_id_v1(boolean) returns uuid language sql as $$select null::uuid$$;
create function private.get_effective_app_permissions_v1(uuid,uuid) returns table(permission_key text,allowed boolean)
language sql as $$select 'module.sales-office.view'::text,true$$;
create function private.eval_work_natural_sort_key_v1(text) returns text language sql immutable as $$select $1$$;
-- PGlite lacks pgcrypto. PostgreSQL's built-in SHA-256 computes the same digest;
-- only the extension wrapper is substituted, never lifecycle implementation.
create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
create table public.ph_master_inventory(
  unique_id text primary key,itemcode text,commonname text,contsize text,
  season text,saleyear text,priority text,ptravailable text,s_lts text,
  app_tab_assignment text,locationcode text,lotcode text,av_note text,sales_note text,
  spec text,caliper text,photo_link text,photo_name text,match text,loc_match_qty text,initial_ptr text,
  end_cap_folder text,holdstopcode text,holdstopreason text,date_completed timestamptz,last_updated timestamptz,
  av_rule_bundle_updated_at timestamptz,av_rule_av_note_updated_at timestamptz,
  av_rule_spec_updated_at timestamptz,av_rule_match_updated_at timestamptz,
  av_rule_caliper_updated_at timestamptz,av_rule_photo_updated_at timestamptz,
  av_rule_last_cleared_at timestamptz,av_rule_last_clear_reason text,
  av_rule_priority_snapshot text,av_rule_holdstop_snapshot text
);
-- Row types referenced by unrelated functions in the exact migration files.
create table public.ph_eval_work(id uuid primary key,source_context jsonb,itemcode text,version integer);
create table public.ph_active_request(unique_id text primary key);
