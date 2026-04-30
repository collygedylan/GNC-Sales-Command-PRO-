create extension if not exists pgcrypto;

create table if not exists public.v2_chat_conversations (
    id uuid primary key default gen_random_uuid(),
    title text,
    is_group boolean not null default false,
    created_by text not null,
    created_by_display text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_message_at timestamptz,
    last_message_preview text,
    last_message_sender text
);

create table if not exists public.v2_chat_participants (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.v2_chat_conversations(id) on delete cascade,
    username text not null,
    display_name text,
    joined_at timestamptz not null default now(),
    last_read_at timestamptz,
    is_archived boolean not null default false,
    unique (conversation_id, username)
);

create table if not exists public.v2_chat_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid references public.v2_chat_conversations(id) on delete cascade,
    sender_username text,
    sender_display_name text,
    body text,
    created_at timestamptz not null default now(),
    client_id text
);

alter table public.v2_chat_messages add column if not exists conversation_id uuid;
alter table public.v2_chat_messages add column if not exists sender_username text;
alter table public.v2_chat_messages add column if not exists sender_display_name text;
alter table public.v2_chat_messages add column if not exists body text;
alter table public.v2_chat_messages add column if not exists client_id text;
alter table public.v2_chat_messages add column if not exists thread_id uuid;
alter table public.v2_chat_messages add column if not exists sender_name text;
alter table public.v2_chat_messages add column if not exists message_text text;

update public.v2_chat_messages
set
    conversation_id = coalesce(conversation_id, thread_id),
    sender_display_name = coalesce(sender_display_name, sender_name),
    sender_username = coalesce(
        sender_username,
        nullif(trim(both '_' from regexp_replace(lower(coalesce(sender_name, '')), '[^a-z0-9]+', '_', 'g')), '')
    ),
    body = coalesce(body, message_text)
where
    conversation_id is null
    or sender_display_name is null
    or sender_username is null
    or body is null;

with legacy_conversations as (
    select
        conversation_id as id,
        min(created_at) as created_at,
        max(created_at) as last_message_at
    from public.v2_chat_messages
    where conversation_id is not null
    group by conversation_id
),
legacy_latest as (
    select distinct on (conversation_id)
        conversation_id,
        body,
        sender_display_name,
        created_at
    from public.v2_chat_messages
    where conversation_id is not null
    order by conversation_id, created_at desc
)
insert into public.v2_chat_conversations (
    id,
    title,
    is_group,
    created_by,
    created_by_display,
    created_at,
    updated_at,
    last_message_at,
    last_message_preview,
    last_message_sender
)
select
    lc.id,
    'Legacy Chat',
    true,
    'legacy',
    'Legacy Chat',
    lc.created_at,
    lc.last_message_at,
    lc.last_message_at,
    left(coalesce(ll.body, ''), 160),
    coalesce(ll.sender_display_name, '')
from legacy_conversations lc
left join legacy_latest ll on ll.conversation_id = lc.id
on conflict (id) do nothing;

insert into public.v2_chat_participants (conversation_id, username, display_name, joined_at, last_read_at, is_archived)
select distinct
    conversation_id,
    sender_username,
    coalesce(sender_display_name, sender_username),
    min(created_at) over (partition by conversation_id, sender_username),
    now(),
    false
from public.v2_chat_messages
where conversation_id is not null and sender_username is not null
on conflict (conversation_id, username) do nothing;

create index if not exists idx_v2_chat_participants_username on public.v2_chat_participants (lower(username));
create index if not exists idx_v2_chat_participants_conversation on public.v2_chat_participants (conversation_id);
create index if not exists idx_v2_chat_messages_conversation_created on public.v2_chat_messages (conversation_id, created_at desc);
create index if not exists idx_v2_chat_conversations_last_message on public.v2_chat_conversations (last_message_at desc nulls last);

create or replace function public.set_v2_chat_conversations_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_v2_chat_conversations_updated_at on public.v2_chat_conversations;
create trigger trg_v2_chat_conversations_updated_at
before update on public.v2_chat_conversations
for each row
execute function public.set_v2_chat_conversations_updated_at();

alter table public.v2_chat_conversations replica identity full;
alter table public.v2_chat_participants replica identity full;
alter table public.v2_chat_messages replica identity full;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_chat_conversations'
        ) then
            alter publication supabase_realtime add table public.v2_chat_conversations;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_chat_participants'
        ) then
            alter publication supabase_realtime add table public.v2_chat_participants;
        end if;

        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'v2_chat_messages'
        ) then
            alter publication supabase_realtime add table public.v2_chat_messages;
        end if;
    end if;
end $$;
