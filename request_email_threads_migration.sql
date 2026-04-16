create extension if not exists pgcrypto;

create table if not exists public.v2_request_email_threads (
    id uuid primary key default gen_random_uuid(),
    request_folder text not null unique,
    request_customer text null,
    sales_rep_name text null,
    sales_rep_email text null,
    recipients jsonb not null default '[]'::jsonb,
    initial_thread_id text null,
    initial_message_id text null,
    initial_email_sent_at timestamptz null,
    last_reply_sent_at timestamptz null,
    status text not null default 'open',
    metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_v2_request_email_threads_folder_status
    on public.v2_request_email_threads (request_folder, status);

create index if not exists idx_v2_request_email_threads_initial_email_sent_at
    on public.v2_request_email_threads (initial_email_sent_at desc);
