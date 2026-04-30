alter table public.v2_chat_messages
    add column if not exists message_type text not null default 'text',
    add column if not exists audio_url text,
    add column if not exists audio_storage_path text,
    add column if not exists audio_duration_seconds integer,
    add column if not exists audio_mime_type text;

update public.v2_chat_messages
set message_type = case
    when coalesce(audio_url, '') <> '' then 'voice'
    else 'text'
end
where coalesce(message_type, '') = '';

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
    end if;
end $$;
