-- V2026.08.16.11: make user-initiated passkey enrollment available to every
-- active, unlocked native Auth profile. Password login remains enabled.

update public.profiles
set passkey_pilot = true,
    updated_at = now()
where disabled_at is null
  and (locked_until is null or locked_until <= now());

insert into public.ph_runtime_feature_flags (
  flag_key,
  enabled,
  rollout_percent,
  config,
  updated_at
)
values (
  'passkey_pilot',
  true,
  100,
  '{"rp_id":"agmetricapp.com","origin":"https://agmetricapp.com","user_gesture_required":true,"password_fallback":true}'::jsonb,
  now()
)
on conflict (flag_key) do update
set enabled = excluded.enabled,
    rollout_percent = excluded.rollout_percent,
    config = excluded.config,
    updated_at = excluded.updated_at;
