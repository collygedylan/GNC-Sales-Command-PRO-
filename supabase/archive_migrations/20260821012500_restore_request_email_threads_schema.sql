-- The request email thread table existed in production before the supported
-- migration chain was assembled. Recreate that contract idempotently so a
-- clean database has every relation used by delivery and hosted health.
create table if not exists public.ph_request_email_threads (
  id uuid primary key default gen_random_uuid(),
  request_folder text not null unique,
  request_customer text,
  sales_rep_name text,
  sales_rep_email text,
  recipients jsonb not null default '[]'::jsonb,
  initial_thread_id text,
  initial_message_id text,
  initial_email_sent_at timestamptz,
  last_reply_sent_at timestamptz,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_ph_request_email_threads_folder_status
  on public.ph_request_email_threads (request_folder, status);
create index if not exists idx_ph_request_email_threads_initial_email_sent_at
  on public.ph_request_email_threads (initial_email_sent_at desc);

alter table public.ph_request_email_threads enable row level security;
revoke all on table public.ph_request_email_threads from public, anon, authenticated;
grant select on table public.ph_request_email_threads to anon, authenticated;
grant all on table public.ph_request_email_threads to service_role;

comment on table public.ph_request_email_threads is
  'Service-owned Gmail thread state for idempotent request delivery.';
