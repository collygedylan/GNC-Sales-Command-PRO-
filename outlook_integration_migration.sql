begin;

create table if not exists public.v2_outlook_accounts (
    username text primary key,
    microsoft_user_id text,
    tenant_id text,
    email text,
    display_name text,
    scopes text[] not null default array[]::text[],
    refresh_token_ciphertext text,
    refresh_token_iv text,
    access_token_ciphertext text,
    access_token_iv text,
    access_token_expires_at timestamptz,
    connected_at timestamptz not null default now(),
    last_refresh_at timestamptz,
    disconnected_at timestamptz,
    status text not null default 'connected',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_v2_outlook_accounts_email
    on public.v2_outlook_accounts (lower(email));

create index if not exists idx_v2_outlook_accounts_status
    on public.v2_outlook_accounts (status, updated_at desc);

create or replace function public.touch_v2_outlook_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_touch_v2_outlook_accounts_updated_at on public.v2_outlook_accounts;
create trigger trg_touch_v2_outlook_accounts_updated_at
before update on public.v2_outlook_accounts
for each row
execute function public.touch_v2_outlook_accounts_updated_at();

alter table public.v2_outlook_accounts enable row level security;

drop policy if exists "service role can manage outlook accounts" on public.v2_outlook_accounts;
create policy "service role can manage outlook accounts"
on public.v2_outlook_accounts
for all
to service_role
using (true)
with check (true);

comment on table public.v2_outlook_accounts is
    'Encrypted Microsoft Outlook OAuth tokens are stored here for app-api/outlook-api use only. Tokens are never sent to browser clients.';

commit;
