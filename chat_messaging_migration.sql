-- Safe, repeatable chat schema migration for Supabase.
-- This file is intentionally idempotent: it can be run after a clean install,
-- after an older chat schema, or after a partial failed run.

create extension if not exists pgcrypto;

create table if not exists public.v2_chat_conversations (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_conversations add column if not exists id uuid;
alter table public.v2_chat_conversations add column if not exists title text;
alter table public.v2_chat_conversations add column if not exists is_group boolean;
alter table public.v2_chat_conversations add column if not exists created_by text;
alter table public.v2_chat_conversations add column if not exists created_by_display text;
alter table public.v2_chat_conversations add column if not exists created_at timestamptz;
alter table public.v2_chat_conversations add column if not exists updated_at timestamptz;
alter table public.v2_chat_conversations add column if not exists last_message_at timestamptz;
alter table public.v2_chat_conversations add column if not exists last_message_preview text;
alter table public.v2_chat_conversations add column if not exists last_message_sender text;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_conversations'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_conversations alter column id set default gen_random_uuid();
        update public.v2_chat_conversations set id = gen_random_uuid() where id is null;
    end if;
end $$;

update public.v2_chat_conversations
set
    is_group = coalesce(is_group, false),
    created_by = coalesce(nullif(created_by, ''), 'legacy'),
    created_by_display = coalesce(created_by_display, created_by, 'Legacy Chat'),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, created_at, now()),
    last_message_preview = coalesce(last_message_preview, ''),
    last_message_sender = coalesce(last_message_sender, '');

alter table public.v2_chat_conversations alter column is_group set default false;
alter table public.v2_chat_conversations alter column is_group set not null;
alter table public.v2_chat_conversations alter column created_by set default 'legacy';
alter table public.v2_chat_conversations alter column created_by set not null;
alter table public.v2_chat_conversations alter column created_at set default now();
alter table public.v2_chat_conversations alter column created_at set not null;
alter table public.v2_chat_conversations alter column updated_at set default now();
alter table public.v2_chat_conversations alter column updated_at set not null;

create unique index if not exists uq_v2_chat_conversations_id
    on public.v2_chat_conversations (id);

create table if not exists public.v2_chat_participants (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_participants add column if not exists id uuid;
alter table public.v2_chat_participants add column if not exists conversation_id uuid;
alter table public.v2_chat_participants add column if not exists username text;
alter table public.v2_chat_participants add column if not exists display_name text;
alter table public.v2_chat_participants add column if not exists joined_at timestamptz;
alter table public.v2_chat_participants add column if not exists last_read_at timestamptz;
alter table public.v2_chat_participants add column if not exists is_archived boolean;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_participants'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_participants alter column id set default gen_random_uuid();
        update public.v2_chat_participants set id = gen_random_uuid() where id is null;
    end if;
end $$;

update public.v2_chat_participants
set
    username = nullif(username, ''),
    display_name = coalesce(display_name, username),
    joined_at = coalesce(joined_at, now()),
    is_archived = coalesce(is_archived, false);

alter table public.v2_chat_participants alter column joined_at set default now();
alter table public.v2_chat_participants alter column joined_at set not null;
alter table public.v2_chat_participants alter column is_archived set default false;
alter table public.v2_chat_participants alter column is_archived set not null;

delete from public.v2_chat_participants a
using public.v2_chat_participants b
where a.conversation_id is not null
  and b.conversation_id is not null
  and a.username is not null
  and b.username is not null
  and a.conversation_id = b.conversation_id
  and a.username = b.username
  and (
    a.joined_at > b.joined_at
    or (a.joined_at = b.joined_at and a.id > b.id)
  );

create unique index if not exists uq_v2_chat_participants_conversation_username
    on public.v2_chat_participants (conversation_id, username);

create table if not exists public.v2_chat_messages (
    id uuid primary key default gen_random_uuid()
);

alter table public.v2_chat_messages add column if not exists id uuid;
alter table public.v2_chat_messages add column if not exists conversation_id uuid;
alter table public.v2_chat_messages add column if not exists sender_username text;
alter table public.v2_chat_messages add column if not exists sender_display_name text;
alter table public.v2_chat_messages add column if not exists body text;
alter table public.v2_chat_messages add column if not exists created_at timestamptz;
alter table public.v2_chat_messages add column if not exists client_id text;
alter table public.v2_chat_messages add column if not exists thread_id uuid;
alter table public.v2_chat_messages add column if not exists sender_name text;
alter table public.v2_chat_messages add column if not exists message_text text;
alter table public.v2_chat_messages add column if not exists message_type text;
alter table public.v2_chat_messages add column if not exists audio_url text;
alter table public.v2_chat_messages add column if not exists audio_storage_path text;
alter table public.v2_chat_messages add column if not exists audio_duration_seconds integer;
alter table public.v2_chat_messages add column if not exists audio_mime_type text;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v2_chat_messages'
          and column_name = 'id'
          and data_type = 'uuid'
    ) then
        alter table public.v2_chat_messages alter column id set default gen_random_uuid();
        update public.v2_chat_messages set id = gen_random_uuid() where id is null;
    end if;
end $$;

do $$
declare
    conversation_id_type text;
    thread_id_type text;
begin
    select data_type
    into conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into thread_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'thread_id';

    if conversation_id_type = 'uuid' and thread_id_type = 'uuid' then
        update public.v2_chat_messages
        set conversation_id = thread_id
        where conversation_id is null and thread_id is not null;
    elsif conversation_id_type = 'uuid' and thread_id_type is not null then
        update public.v2_chat_messages
        set conversation_id = thread_id::text::uuid
        where conversation_id is null
          and thread_id is not null
          and thread_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    elsif conversation_id_type in ('text', 'character varying') and thread_id_type is not null then
        update public.v2_chat_messages
        set conversation_id = thread_id::text
        where conversation_id is null and thread_id is not null;
    end if;
end $$;

update public.v2_chat_messages
set
    sender_display_name = coalesce(sender_display_name, sender_name),
    sender_username = coalesce(
        sender_username,
        nullif(trim(both '_' from regexp_replace(lower(coalesce(sender_name, '')), '[^a-z0-9]+', '_', 'g')), '')
    ),
    body = coalesce(body, message_text),
    created_at = coalesce(created_at, now()),
    message_type = case
        when coalesce(message_type, '') <> '' then message_type
        when coalesce(audio_url, '') <> '' then 'voice'
        else 'text'
    end
where
    sender_display_name is null
    or sender_username is null
    or body is null
    or created_at is null
    or coalesce(message_type, '') = '';

alter table public.v2_chat_messages alter column created_at set default now();
alter table public.v2_chat_messages alter column created_at set not null;
alter table public.v2_chat_messages alter column message_type set default 'text';
alter table public.v2_chat_messages alter column message_type set not null;

create unique index if not exists uq_v2_chat_messages_id
    on public.v2_chat_messages (id);

drop trigger if exists trigger_new_chat on public.v2_chat_messages;
drop trigger if exists chat_push_trigger on public.v2_chat_messages;
drop function if exists public.notify_new_chat() cascade;

do $$
declare
    conversation_id_type text;
    conversation_row_id_type text;
    legacy_id_expr text;
    legacy_guard text := '';
begin
    select data_type
    into conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into conversation_row_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_conversations'
      and column_name = 'id';

    if conversation_row_id_type = 'uuid' and conversation_id_type = 'uuid' then
        legacy_id_expr := 'conversation_id';
    elsif conversation_row_id_type = 'uuid' and conversation_id_type in ('text', 'character varying') then
        legacy_id_expr := 'conversation_id::uuid';
        legacy_guard := ' and conversation_id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
    elsif conversation_row_id_type in ('text', 'character varying') and conversation_id_type is not null then
        legacy_id_expr := 'conversation_id::text';
    end if;

    if legacy_id_expr is not null then
        execute format($legacy$
            with legacy_conversations as (
                select
                    %1$s as id,
                    min(created_at) as created_at,
                    max(created_at) as last_message_at
                from public.v2_chat_messages
                where conversation_id is not null %2$s
                group by %1$s
            ),
            legacy_latest as (
                select distinct on (%1$s)
                    %1$s as id,
                    body,
                    sender_display_name,
                    created_at
                from public.v2_chat_messages
                where conversation_id is not null %2$s
                order by %1$s, created_at desc
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
            left join legacy_latest ll on ll.id = lc.id
            on conflict (id) do nothing
        $legacy$, legacy_id_expr, legacy_guard);
    end if;
end $$;

do $$
declare
    message_conversation_id_type text;
    participant_conversation_id_type text;
    participant_conversation_expr text;
    participant_guard text := '';
begin
    select data_type
    into message_conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_messages'
      and column_name = 'conversation_id';

    select data_type
    into participant_conversation_id_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v2_chat_participants'
      and column_name = 'conversation_id';

    if participant_conversation_id_type = 'uuid' and message_conversation_id_type = 'uuid' then
        participant_conversation_expr := 'conversation_id';
    elsif participant_conversation_id_type = 'uuid' and message_conversation_id_type in ('text', 'character varying') then
        participant_conversation_expr := 'conversation_id::uuid';
        participant_guard := ' and conversation_id::text ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''';
    elsif participant_conversation_id_type in ('text', 'character varying') and message_conversation_id_type is not null then
        participant_conversation_expr := 'conversation_id::text';
    end if;

    if participant_conversation_expr is not null then
        execute format($participants$
            insert into public.v2_chat_participants (conversation_id, username, display_name, joined_at, last_read_at, is_archived)
            select distinct
                %1$s,
                sender_username,
                coalesce(sender_display_name, sender_username),
                min(created_at) over (partition by %1$s, sender_username),
                now(),
                false
            from public.v2_chat_messages
            where conversation_id is not null
              and sender_username is not null
              %2$s
            on conflict (conversation_id, username) do nothing
        $participants$, participant_conversation_expr, participant_guard);
    end if;
end $$;

create index if not exists idx_v2_chat_participants_username
    on public.v2_chat_participants (lower(username));
create index if not exists idx_v2_chat_participants_conversation
    on public.v2_chat_participants (conversation_id);
create index if not exists idx_v2_chat_messages_conversation_created
    on public.v2_chat_messages (conversation_id, created_at desc);
create index if not exists idx_v2_chat_conversations_last_message
    on public.v2_chat_conversations (last_message_at desc nulls last);

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

alter table public.v2_chat_conversations enable row level security;
alter table public.v2_chat_participants enable row level security;
alter table public.v2_chat_messages enable row level security;

drop policy if exists "Allow app chat conversations" on public.v2_chat_conversations;
create policy "Allow app chat conversations"
    on public.v2_chat_conversations
    for all
    using (true)
    with check (true);

drop policy if exists "Allow app chat participants" on public.v2_chat_participants;
create policy "Allow app chat participants"
    on public.v2_chat_participants
    for all
    using (true)
    with check (true);

drop policy if exists "Allow app chat messages" on public.v2_chat_messages;
create policy "Allow app chat messages"
    on public.v2_chat_messages
    for all
    using (true)
    with check (true);

do $$
declare
    realtime_table_name text;
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        foreach realtime_table_name in array array['v2_chat_conversations', 'v2_chat_participants', 'v2_chat_messages']
        loop
            if not exists (
                select 1
                from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and schemaname = 'public'
                  and tablename = realtime_table_name
            ) then
                begin
                    execute format('alter publication supabase_realtime add table public.%I', realtime_table_name);
                exception
                    when duplicate_object then null;
                    when invalid_parameter_value then null;
                    when object_not_in_prerequisite_state then null;
                end;
            end if;
        end loop;
    end if;
end $$;

do $$
begin
    if not exists (select 1 from storage.buckets where id = 'chat_voice_notes') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values (
            'chat_voice_notes',
            'chat_voice_notes',
            true,
            10485760,
            array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
        );
    else
        update storage.buckets
        set
            public = true,
            file_size_limit = coalesce(file_size_limit, 10485760),
            allowed_mime_types = coalesce(
                allowed_mime_types,
                array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']
            )
        where id = 'chat_voice_notes';
    end if;
end $$;

drop policy if exists "Allow chat voice note reads" on storage.objects;
create policy "Allow chat voice note reads"
    on storage.objects
    for select
    using (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note uploads" on storage.objects;
create policy "Allow chat voice note uploads"
    on storage.objects
    for insert
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note updates" on storage.objects;
create policy "Allow chat voice note updates"
    on storage.objects
    for update
    using (bucket_id = 'chat_voice_notes')
    with check (bucket_id = 'chat_voice_notes');

drop policy if exists "Allow chat voice note deletes" on storage.objects;
create policy "Allow chat voice note deletes"
    on storage.objects
    for delete
    using (bucket_id = 'chat_voice_notes');
