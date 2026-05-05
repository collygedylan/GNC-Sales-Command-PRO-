create table if not exists public.v2_flyer_folder_rows (
  unique_id text primary key,
  master_unique_id text,
  source_table text default 'v2_master_inventory',
  flyer_title text not null,
  flyer_assigned text,
  flyer_cat text,
  flyer_inst text,
  flyer_notes text,
  flyer_completed timestamptz,
  assignedto text,
  date_completed timestamptz,
  itemcode text,
  commonname text,
  contsize text,
  locationcode text,
  lotcode text,
  priority text,
  ptravailable text,
  s_lts text,
  holdstopcode text,
  plantgroupcode text,
  locationnote text,
  av_note text,
  match numeric,
  loc_match_qty numeric,
  spec text,
  caliper text,
  pick text,
  initial_ptr numeric,
  flyer_av_note text,
  flyer_match numeric,
  flyer_loc_match_qty numeric,
  flyer_spec text,
  flyer_caliper text,
  flyer_pick text,
  flyer_initial_ptr numeric,
  flyer_photo_link text,
  flyer_photo_name text,
  snapshot jsonb not null default '{}'::jsonb,
  created_by_username text,
  created_by_display text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_v2_flyer_folder_rows_folder
  on public.v2_flyer_folder_rows (flyer_title);

create index if not exists idx_v2_flyer_folder_rows_master
  on public.v2_flyer_folder_rows (master_unique_id);

create index if not exists idx_v2_flyer_folder_rows_itemcode
  on public.v2_flyer_folder_rows (itemcode);

create index if not exists idx_v2_flyer_folder_rows_updated
  on public.v2_flyer_folder_rows (updated_at desc);

create or replace function public.v2_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_v2_flyer_folder_rows_updated_at on public.v2_flyer_folder_rows;
create trigger trg_v2_flyer_folder_rows_updated_at
before update on public.v2_flyer_folder_rows
for each row
execute function public.v2_touch_updated_at();

alter table public.v2_flyer_folder_rows enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'v2_flyer_folder_rows'
      and policyname = 'Allow all access to flyer folder rows'
  ) then
    create policy "Allow all access to flyer folder rows"
      on public.v2_flyer_folder_rows
      for all
      using (true)
      with check (true);
  end if;
end;
$$;

alter table public.v2_flyer_folder_rows replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.v2_flyer_folder_rows;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
