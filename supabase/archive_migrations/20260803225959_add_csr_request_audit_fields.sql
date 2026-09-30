alter table if exists public.ph_active_request
  add column if not exists request_created_by_username text,
  add column if not exists request_created_by_display text,
  add column if not exists request_created_by_email text,
  add column if not exists request_selected_rep_username text,
  add column if not exists request_selected_rep_display text,
  add column if not exists request_selected_rep_email text;

alter table if exists public.ph_request_history
  add column if not exists request_created_by_username text,
  add column if not exists request_created_by_display text,
  add column if not exists request_created_by_email text,
  add column if not exists request_selected_rep_username text,
  add column if not exists request_selected_rep_display text,
  add column if not exists request_selected_rep_email text;

create index if not exists idx_ph_active_request_created_by_username
  on public.ph_active_request (request_created_by_username);

create index if not exists idx_ph_active_request_selected_rep_username
  on public.ph_active_request (request_selected_rep_username);

create index if not exists idx_ph_request_history_created_by_username
  on public.ph_request_history (request_created_by_username);

create index if not exists idx_ph_request_history_selected_rep_username
  on public.ph_request_history (request_selected_rep_username);
