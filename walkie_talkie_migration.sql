create extension if not exists pgcrypto;

create table if not exists public.v2_walkie_channels (
    id uuid primary key default gen_random_uuid(),
    title text,
    is_group boolean not null default false,
    created_by text not null,
    created_by_display text,
    active_call_id uuid,
    last_activity_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.v2_walkie_channel_members (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    username text not null,
    display_name text,
    joined_at timestamptz not null default now(),
    is_archived boolean not null default false,
    unique (channel_id, username)
);

create table if not exists public.v2_walkie_calls (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    started_by text not null,
    started_by_display text,
    status text not null default 'live',
    listener_cap integer not null default 6,
    active_speaker_username text,
    active_speaker_device_id text,
    active_speaker_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.v2_walkie_call_members (
    id uuid primary key default gen_random_uuid(),
    call_id uuid not null references public.v2_walkie_calls(id) on delete cascade,
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    username text not null,
    display_name text,
    device_id text not null,
    joined_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    left_at timestamptz,
    is_active boolean not null default true,
    unique (call_id, device_id)
);

create table if not exists public.v2_walkie_signal_events (
    id uuid primary key default gen_random_uuid(),
    call_id uuid not null references public.v2_walkie_calls(id) on delete cascade,
    channel_id uuid not null references public.v2_walkie_channels(id) on delete cascade,
    sender_username text not null,
    sender_device_id text not null,
    recipient_username text,
    recipient_device_id text,
    kind text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.v2_walkie_channels
    add column if not exists active_call_id uuid,
    add column if not exists last_activity_at timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists created_by_display text;

alter table public.v2_walkie_channel_members
    add column if not exists is_archived boolean not null default false;

alter table public.v2_walkie_calls
    add column if not exists status text not null default 'live',
    add column if not exists listener_cap integer not null default 6,
    add column if not exists active_speaker_username text,
    add column if not exists active_speaker_device_id text,
    add column if not exists active_speaker_at timestamptz,
    add column if not exists ended_at timestamptz,
    add column if not exists updated_at timestamptz not null default now(),
    add column if not exists started_by_display text;

alter table public.v2_walkie_call_members
    add column if not exists last_seen_at timestamptz not null default now(),
    add column if not exists left_at timestamptz,
    add column if not exists is_active boolean not null default true,
    add column if not exists display_name text;

alter table public.v2_walkie_signal_events
    add column if not exists recipient_username text,
    add column if not exists recipient_device_id text,
    add column if not exists payload jsonb not null default '{}'::jsonb;

create index if not exists idx_v2_walkie_channel_members_username on public.v2_walkie_channel_members (lower(username));
create index if not exists idx_v2_walkie_channel_members_channel on public.v2_walkie_channel_members (channel_id);
create index if not exists idx_v2_walkie_calls_channel_status on public.v2_walkie_calls (channel_id, status, created_at desc);
create index if not exists idx_v2_walkie_call_members_call_active on public.v2_walkie_call_members (call_id, is_active, last_seen_at desc);
create index if not exists idx_v2_walkie_call_members_username on public.v2_walkie_call_members (lower(username), is_active);
create index if not exists idx_v2_walkie_signal_events_call_created on public.v2_walkie_signal_events (call_id, created_at desc);
create index if not exists idx_v2_walkie_signal_events_recipient on public.v2_walkie_signal_events (recipient_device_id, created_at desc);

create or replace function public.set_v2_walkie_channels_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    if new.last_activity_at is null then
        new.last_activity_at = now();
    end if;
    return new;
end;
$$;

create or replace function public.set_v2_walkie_calls_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_walkie_channels_updated_at on public.v2_walkie_channels;
create trigger trg_v2_walkie_channels_updated_at
before update on public.v2_walkie_channels
for each row
execute function public.set_v2_walkie_channels_updated_at();

drop trigger if exists trg_v2_walkie_calls_updated_at on public.v2_walkie_calls;
create trigger trg_v2_walkie_calls_updated_at
before update on public.v2_walkie_calls
for each row
execute function public.set_v2_walkie_calls_updated_at();

alter table public.v2_walkie_channels replica identity full;
alter table public.v2_walkie_channel_members replica identity full;
alter table public.v2_walkie_calls replica identity full;
alter table public.v2_walkie_call_members replica identity full;
alter table public.v2_walkie_signal_events replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_channels'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_channels;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_channel_members'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_channel_members;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_calls'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_calls;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_call_members'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_call_members;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_walkie_signal_events'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_signal_events;
        end if;
    end if;
end $$;
