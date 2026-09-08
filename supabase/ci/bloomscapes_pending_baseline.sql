-- Disposable CI database only. Never run this baseline on a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
create table public.profiles(id uuid primary key,username text,disabled_at timestamptz,locked_until timestamptz,must_change_password boolean);
create table public.ph_app_settings(key text primary key,value jsonb);
create table public.ph_master_inventory(unique_id text primary key,itemcode text,commonname text,contsize text,locationcode text,lotcode text,season text,saleyear text,listprice text,s_lts text,ptronhand text,ptravailable text,match text,initial_ptr text,spec text,itemspec text,caliper text,photo_link text,photo_name text,av_rule_photo_updated_at timestamptz,date_completed timestamptz,holdstopcode text,holdstopbegindate text,hold_release_approved_at text,desigitem text,app_tab_assignment text);
