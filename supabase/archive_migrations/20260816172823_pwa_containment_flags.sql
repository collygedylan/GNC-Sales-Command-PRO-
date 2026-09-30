-- Additive rollback switches for the .06/.07 containment rollout.
create table if not exists public.ph_runtime_feature_flags (
  flag_key text primary key,
  enabled boolean not null,
  rollout_percent smallint not null default 100 check (rollout_percent between 0 and 100),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.ph_runtime_feature_flags enable row level security;

drop policy if exists runtime_feature_flags_authenticated_read on public.ph_runtime_feature_flags;
create policy runtime_feature_flags_authenticated_read
on public.ph_runtime_feature_flags
for select
to authenticated
using (true);

insert into public.ph_runtime_feature_flags(flag_key, enabled, rollout_percent, config)
values
  ('realtime_direct_tables', true, 100, '{"fallback_base_ms":5000,"fallback_cap_ms":300000}'::jsonb),
  ('legacy_live_events', false, 0, '{}'::jsonb),
  ('native_auth', false, 0, '{"dual_auth_days":14}'::jsonb),
  ('passkey_pilot', false, 0, '{"rp_id":"agmetricapp.com"}'::jsonb)
on conflict (flag_key) do nothing;

comment on table public.ph_runtime_feature_flags is
  'Server-controlled rollout and rollback switches. No secrets or user identity may be stored in config.';
