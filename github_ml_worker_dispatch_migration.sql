-- Wake the GitHub Actions ML worker when Supabase receives new ML work.
--
-- What this does:
-- 1. Keeps the scheduled GitHub worker as the backup.
-- 2. Sends a throttled repository_dispatch event to GitHub when new pending work appears.
-- 3. Prevents one GitHub Action run per photo by throttling dispatches to one per minute.
--
-- Before running:
-- - Create a GitHub fine-grained token or classic PAT that can dispatch workflows for this repo.
-- - Store it in Supabase Vault with the name GITHUB_ML_WORKER_PAT.
--   Example, run once and replace the placeholder:
--   select vault.create_secret('github_pat_REPLACE_ME', 'GITHUB_ML_WORKER_PAT');

create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.v2_ml_github_dispatch_state (
    dispatch_key text primary key,
    last_dispatched_at timestamptz not null default now(),
    last_event_type text,
    last_table_name text,
    last_row_id text,
    dispatch_count integer not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.v2_ml_github_dispatch_state enable row level security;

drop policy if exists "v2_ml_github_dispatch_state service only" on public.v2_ml_github_dispatch_state;
create policy "v2_ml_github_dispatch_state service only"
on public.v2_ml_github_dispatch_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.dispatch_github_ml_worker()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
    github_owner text := 'collygedylan';
    github_repo text := 'GNC-Sales-Command-PRO-';
    github_token text;
    event_type text := 'supabase-ml-queue';
    row_id text := coalesce(new.unique_id::text, '');
    should_dispatch boolean := false;
    prior_dispatch_at timestamptz;
    request_id bigint;
begin
    if tg_table_name = 'v2_ml_image_jobs' then
        if coalesce(new.status, '') <> 'pending_ml' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.status, '') is distinct from coalesce(new.status, '') then
            should_dispatch := true;
        end if;
        event_type := 'ml-photo-created';
    elsif tg_table_name = 'v2_disease_training_assets' then
        if coalesce(new.processed_status, '') <> 'pending_ml' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.processed_status, '') is distinct from coalesce(new.processed_status, '') then
            should_dispatch := true;
        end if;
        event_type := 'ml-training-asset-created';
    elsif tg_table_name = 'v2_grower_scout_reports' then
        if coalesce(new.status, '') <> 'pending_ai' then
            return new;
        end if;
        if tg_op = 'INSERT' then
            should_dispatch := true;
        elsif coalesce(old.status, '') is distinct from coalesce(new.status, '') then
            should_dispatch := true;
        end if;
        event_type := 'grower-scout-report-created';
    end if;

    if not should_dispatch then
        return new;
    end if;

    select last_dispatched_at
    into prior_dispatch_at
    from public.v2_ml_github_dispatch_state
    where dispatch_key = 'ml-worker';

    -- GitHub Actions is the worker, not one run per row. One wake-up per minute is enough.
    if prior_dispatch_at is not null and prior_dispatch_at > now() - interval '60 seconds' then
        return new;
    end if;

    select decrypted_secret
    into github_token
    from vault.decrypted_secrets
    where name = 'GITHUB_ML_WORKER_PAT'
    limit 1;

    if github_token is null or length(trim(github_token)) = 0 then
        raise warning 'GITHUB_ML_WORKER_PAT is not set in Supabase Vault. GitHub ML worker dispatch skipped.';
        return new;
    end if;

    insert into public.v2_ml_github_dispatch_state (
        dispatch_key,
        last_dispatched_at,
        last_event_type,
        last_table_name,
        last_row_id,
        dispatch_count,
        updated_at
    )
    values (
        'ml-worker',
        now(),
        event_type,
        tg_table_name,
        row_id,
        1,
        now()
    )
    on conflict (dispatch_key)
    do update set
        last_dispatched_at = excluded.last_dispatched_at,
        last_event_type = excluded.last_event_type,
        last_table_name = excluded.last_table_name,
        last_row_id = excluded.last_row_id,
        dispatch_count = public.v2_ml_github_dispatch_state.dispatch_count + 1,
        updated_at = now();

    select net.http_post(
        url := format('https://api.github.com/repos/%s/%s/dispatches', github_owner, github_repo),
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || github_token,
            'Accept', 'application/vnd.github+json',
            'X-GitHub-Api-Version', '2022-11-28',
            'User-Agent', 'gnc-supabase-ml-dispatch'
        ),
        body := jsonb_build_object(
            'event_type', event_type,
            'client_payload', jsonb_build_object(
                'table', tg_table_name,
                'unique_id', row_id,
                'created_at', now()
            )
        ),
        timeout_milliseconds := 5000
    )
    into request_id;

    return new;
exception
    when others then
        raise warning 'GitHub ML worker dispatch failed: %', sqlerrm;
        return new;
end;
$$;

do $$
begin
    if to_regclass('public.v2_ml_image_jobs') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_jobs on public.v2_ml_image_jobs;
        create trigger trg_dispatch_github_ml_worker_jobs
        after insert or update of status on public.v2_ml_image_jobs
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;

    if to_regclass('public.v2_disease_training_assets') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_disease_assets on public.v2_disease_training_assets;
        create trigger trg_dispatch_github_ml_worker_disease_assets
        after insert or update of processed_status on public.v2_disease_training_assets
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;

    if to_regclass('public.v2_grower_scout_reports') is not null then
        drop trigger if exists trg_dispatch_github_ml_worker_grower_reports on public.v2_grower_scout_reports;
        create trigger trg_dispatch_github_ml_worker_grower_reports
        after insert or update of status on public.v2_grower_scout_reports
        for each row
        execute function public.dispatch_github_ml_worker();
    end if;
end;
$$;
