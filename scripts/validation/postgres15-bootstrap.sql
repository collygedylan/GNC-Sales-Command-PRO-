-- Minimal roles for disposable PostgreSQL 15 SQL experiments. This auxiliary
-- service does not replace the repository's Supabase PostgreSQL 17 path.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
CREATE SCHEMA IF NOT EXISTS auth;
