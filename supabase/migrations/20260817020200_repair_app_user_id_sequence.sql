-- V2026.08.16.11: keep administrative account creation from reusing an
-- occupied legacy user ID after prior data imports supplied explicit IDs.

select setval(
  'public.ph_app_users_id_seq',
  coalesce((select max(id) from public.ph_app_users), 0) + 1,
  false
);
