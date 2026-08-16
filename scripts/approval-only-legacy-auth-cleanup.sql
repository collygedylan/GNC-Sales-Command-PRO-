-- DO NOT RUN without a separate explicit destructive-action approval after the
-- 14-day dual-auth validation window and an independently verified backup.
begin;

alter table public.ph_app_users
  drop column password,
  drop column password_hash,
  drop column password_salt;

-- Legacy session tables/functions are intentionally not named here until the
-- final dependency report identifies the exact production objects.
rollback;
