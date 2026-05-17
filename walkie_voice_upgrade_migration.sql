begin;

create extension if not exists pgcrypto;

create table if not exists public.v2_walkie_voice_messages (
    id uuid primary key default gen_random_uuid(),
    channel_id uuid references public.v2_walkie_channels(id) on delete set null,
    sender_username text not null,
    sender_display text,
    recipient_usernames text[] not null default array[]::text[],
    audio_bucket text not null default 'walkie_voice_notes',
    audio_path text not null,
    audio_url text,
    duration_seconds numeric,
    transcript text,
    status text not null default 'sent',
    heard_by jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_v2_walkie_voice_messages_channel_created
    on public.v2_walkie_voice_messages (channel_id, created_at desc);

create index if not exists idx_v2_walkie_voice_messages_sender_created
    on public.v2_walkie_voice_messages (lower(sender_username), created_at desc);

create index if not exists idx_v2_walkie_voice_messages_recipients
    on public.v2_walkie_voice_messages using gin (recipient_usernames);

alter table public.v2_walkie_voice_messages replica identity full;
alter table public.v2_walkie_voice_messages enable row level security;

drop policy if exists "service role can manage walkie voice messages" on public.v2_walkie_voice_messages;
create policy "service role can manage walkie voice messages"
on public.v2_walkie_voice_messages
for all
to service_role
using (true)
with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'walkie_voice_notes',
    'walkie_voice_notes',
    true,
    26214400,
    array['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav']::text[]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
    channel_title text;
begin
    foreach channel_title in array array['Shipping', 'Quality Control', 'Sales']
    loop
        if to_regclass('public.v2_walkie_channels') is not null
           and not exists (
                select 1
                from public.v2_walkie_channels
                where lower(coalesce(title, '')) = lower(channel_title)
                  and created_by = 'system'
           ) then
            insert into public.v2_walkie_channels (title, is_group, created_by, created_by_display)
            values (channel_title, true, 'system', 'System');
        end if;
    end loop;
end $$;

insert into public.v2_walkie_channel_members (channel_id, username, display_name, is_archived)
select
    channels.id,
    lower(users.username),
    users.username,
    false
from public.v2_walkie_channels channels
cross join public.v2_app_users users
where lower(coalesce(channels.title, '')) in ('shipping', 'quality control', 'sales')
  and coalesce(users.username, '') <> ''
on conflict (channel_id, username) do update set
    is_archived = false,
    display_name = coalesce(excluded.display_name, public.v2_walkie_channel_members.display_name);

create or replace function public.add_default_walkie_channels_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if to_regclass('public.v2_walkie_channels') is null
       or to_regclass('public.v2_walkie_channel_members') is null then
        return new;
    end if;

    insert into public.v2_walkie_channel_members (channel_id, username, display_name, is_archived)
    select
        channels.id,
        lower(new.username),
        coalesce(new.username, lower(new.username)),
        false
    from public.v2_walkie_channels channels
    where lower(coalesce(channels.title, '')) in ('shipping', 'quality control', 'sales')
      and coalesce(new.username, '') <> ''
    on conflict (channel_id, username) do update set
        is_archived = false,
        display_name = coalesce(excluded.display_name, public.v2_walkie_channel_members.display_name);

    return new;
end;
$$;

drop trigger if exists trg_add_default_walkie_channels_for_user on public.v2_app_users;
create trigger trg_add_default_walkie_channels_for_user
after insert on public.v2_app_users
for each row
execute function public.add_default_walkie_channels_for_user();

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = 'v2_walkie_voice_messages'
        ) then
            alter publication supabase_realtime add table public.v2_walkie_voice_messages;
        end if;
    end if;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;

commit;
