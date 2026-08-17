-- V2026.08.16.11: remove invisible surrounding whitespace so the temporary
-- dual-auth fallback resolves the same canonical username as native Auth.
-- A duplicate check was completed before this migration was applied.

update public.ph_app_users
set username = trim(username)
where username is distinct from trim(username);
