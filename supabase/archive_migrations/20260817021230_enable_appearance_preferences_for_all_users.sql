-- Appearance is available to every active authenticated account. Preferences
-- remain server-owned: browsers use the authenticated app-api action and never
-- receive direct table privileges.
insert into public.ph_app_live_pilot_flags (feature_key, enabled, updated_at)
values
  ('skin', true, now()),
  ('preferences', true, now()),
  ('card_grid', true, now())
on conflict (feature_key) do update
set enabled = excluded.enabled,
    updated_at = excluded.updated_at;

insert into public.ph_app_user_preferences (
  user_key,
  theme_mode,
  display_mode,
  updated_at
)
select
  lower(btrim(p.username)),
  case when lower(btrim(p.username)) = 'dylan_collyge' then 'dark' else 'light' end,
  'cards',
  now()
from public.profiles p
where p.disabled_at is null
  and (p.locked_until is null or p.locked_until <= now())
  and nullif(lower(btrim(p.username)), '') is not null
on conflict (user_key) do nothing;

comment on table public.ph_app_user_preferences is
  'Server-managed Light/Dark and Cards/Grid preferences for authenticated app users. Direct browser access remains revoked.';
