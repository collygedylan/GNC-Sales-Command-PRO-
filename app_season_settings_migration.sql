begin;

create table if not exists public.v2_app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

create or replace function public.set_v2_app_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_app_settings_updated_at on public.v2_app_settings;
create trigger trg_v2_app_settings_updated_at
before update on public.v2_app_settings
for each row execute function public.set_v2_app_settings_updated_at();

alter table public.v2_app_settings enable row level security;

drop policy if exists "v2_app_settings_select_all" on public.v2_app_settings;
create policy "v2_app_settings_select_all" on public.v2_app_settings for select using (true);
drop policy if exists "v2_app_settings_insert_all" on public.v2_app_settings;
create policy "v2_app_settings_insert_all" on public.v2_app_settings for insert with check (true);
drop policy if exists "v2_app_settings_update_all" on public.v2_app_settings;
create policy "v2_app_settings_update_all" on public.v2_app_settings for update using (true) with check (true);

insert into public.v2_app_settings (key, value, updated_by, updated_at)
values (
  'current_season_salesyear',
  jsonb_build_object(
    'seasonCode', 'S1',
    'salesYear', 26,
    'updatedAt', now(),
    'updatedBy', 'migration_default'
  ),
  'migration_default',
  now()
)
on conflict (key) do nothing;

commit;
