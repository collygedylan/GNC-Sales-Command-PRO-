-- Safe, repeatable voice-note add-on for chat.
-- The main chat_messaging_migration.sql also includes these columns; this file
-- remains useful if only the voice-note portion needs to be repaired.

alter table public.v2_chat_messages add column if not exists message_type text;
alter table public.v2_chat_messages add column if not exists audio_url text;
alter table public.v2_chat_messages add column if not exists audio_storage_path text;
alter table public.v2_chat_messages add column if not exists audio_duration_seconds integer;
alter table public.v2_chat_messages add column if not exists audio_mime_type text;

update public.v2_chat_messages
set message_type = case
    when coalesce(message_type, '') <> '' then message_type
    when coalesce(audio_url, '') <> '' then 'voice'
    else 'text'
end
where coalesce(message_type, '') = '';

alter table public.v2_chat_messages alter column message_type set default 'text';
alter table public.v2_chat_messages alter column message_type set not null;

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
