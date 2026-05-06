create table if not exists public.v2_push_subscriptions (
    id bigint generated always as identity primary key,
    username text not null,
    display_name text,
    role text,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    device_label text,
    user_agent text,
    app_build text,
    notifications_enabled boolean not null default true,
    wants_new_request boolean not null default true,
    wants_request_complete boolean not null default true,
    subscription_json jsonb not null default '{}'::jsonb,
    last_seen timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_push_subscriptions_username on public.v2_push_subscriptions (lower(username));
create index if not exists idx_v2_push_subscriptions_enabled on public.v2_push_subscriptions (notifications_enabled);

alter table public.v2_push_subscriptions
    add column if not exists wants_new_request boolean not null default true,
    add column if not exists wants_request_complete boolean not null default true,
    add column if not exists notifications_enabled boolean not null default true,
    add column if not exists subscription_json jsonb not null default '{}'::jsonb,
    add column if not exists last_seen timestamptz not null default now(),
    add column if not exists updated_at timestamptz not null default now();

alter table public.v2_push_subscriptions
    alter column wants_new_request set default true,
    alter column wants_request_complete set default true;

update public.v2_push_subscriptions
set wants_new_request = true,
    wants_request_complete = true,
    notifications_enabled = true
where notifications_enabled = true
   or notifications_enabled is null;

create or replace function public.set_v2_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_push_subscriptions_updated_at on public.v2_push_subscriptions;
create trigger trg_v2_push_subscriptions_updated_at
before update on public.v2_push_subscriptions
for each row
execute function public.set_v2_push_subscriptions_updated_at();
