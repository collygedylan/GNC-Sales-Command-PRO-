create table if not exists public.ph_app_user_preferences (
  user_key text primary key
    check (user_key = lower(btrim(user_key)) and user_key <> ''),
  theme_mode text not null default 'system'
    check (theme_mode in ('system', 'light', 'dark')),
  display_mode text not null default 'cards'
    check (display_mode in ('cards', 'grid')),
  cohort_id uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ph_app_live_pilot_flags (
  feature_key text primary key
    check (feature_key in ('skin', 'preferences', 'card_grid', 'monitoring')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.ph_app_user_preferences enable row level security;
alter table public.ph_app_live_pilot_flags enable row level security;
alter table public.ph_app_user_preferences force row level security;
alter table public.ph_app_live_pilot_flags force row level security;

revoke all on table public.ph_app_user_preferences from public, anon, authenticated;
revoke all on table public.ph_app_live_pilot_flags from public, anon, authenticated;
grant select, insert, update on table public.ph_app_user_preferences to service_role;
grant select, insert, update on table public.ph_app_live_pilot_flags to service_role;

create policy "Deny direct preference access"
on public.ph_app_user_preferences
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create policy "Deny direct pilot flag access"
on public.ph_app_live_pilot_flags
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

insert into public.ph_app_live_pilot_flags (feature_key, enabled)
values
  ('skin', true),
  ('preferences', true),
  ('card_grid', true),
  ('monitoring', true)
on conflict (feature_key) do nothing;

insert into public.ph_app_user_preferences (user_key, theme_mode, display_mode)
values ('dylan_collyge', 'system', 'cards')
on conflict (user_key) do nothing;
