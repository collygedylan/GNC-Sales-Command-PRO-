-- Request completion user tracking
-- Adds the completing user to each active request row so the final folder reply
-- can show who completed each row and include those users on the email thread.

alter table public.v2_active_request
    add column if not exists completed_by_username text,
    add column if not exists completed_by_display text,
    add column if not exists completed_by_email text;

create index if not exists idx_v2_active_request_completed_by_username
on public.v2_active_request (completed_by_username);

create index if not exists idx_v2_active_request_completed_at_user
on public.v2_active_request (date_completed desc, completed_by_username);

do $$
begin
    if to_regclass('public.v2_request_history') is not null then
        execute 'alter table public.v2_request_history add column if not exists completed_by_username text';
        execute 'alter table public.v2_request_history add column if not exists completed_by_display text';
        execute 'alter table public.v2_request_history add column if not exists completed_by_email text';

        execute 'create index if not exists idx_v2_request_history_completed_by_username on public.v2_request_history (completed_by_username)';
    end if;
end $$;
