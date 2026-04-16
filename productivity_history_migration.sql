create extension if not exists pgcrypto;

create table if not exists public.v2_productivity_history (
    id uuid primary key default gen_random_uuid(),
    event_key text not null unique,
    completed_by_username text not null,
    completed_by_display text not null,
    completed_at timestamptz not null,
    source_table text not null,
    source_kind text not null,
    source_unique_id text not null,
    source_assignment text null,
    itemcode text null,
    commonname text null,
    contsize text null,
    locationcode text null,
    lotcode text null,
    customer_name text null,
    request_folder text null,
    snapshot jsonb not null
);

create index if not exists idx_v2_productivity_history_user_completed_at
    on public.v2_productivity_history (completed_by_username, completed_at desc);

create index if not exists idx_v2_productivity_history_completed_at
    on public.v2_productivity_history (completed_at desc);
