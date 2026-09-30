alter table public.ph_active_request
  add column if not exists request_note text;
