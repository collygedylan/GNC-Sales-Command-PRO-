-- Disposable CI database only. Production already has this extension.
create extension if not exists pg_trgm with schema extensions;
