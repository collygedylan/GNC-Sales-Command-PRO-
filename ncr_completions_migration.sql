create table if not exists public.v2_ncr_completions (
    source_unique_id text primary key,
    itemcode text,
    locationcode text,
    completed_by text,
    completed_at timestamptz not null default now(),
    emailed_jd boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists idx_v2_ncr_completions_itemcode on public.v2_ncr_completions (itemcode);
create index if not exists idx_v2_ncr_completions_completed_at on public.v2_ncr_completions (completed_at desc);
