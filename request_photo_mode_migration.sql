alter table if exists public.v2_active_request
    add column if not exists req_photo_mode text null;
