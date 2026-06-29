create table if not exists public.v2_crop_roll_runs (
  run_id text primary key,
  run_key text not null,
  run_name text,
  status text not null default 'active',
  created_by text,
  created_at timestamptz not null default now(),
  archived_by text,
  archived_at timestamptz,
  snapshot_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_v2_crop_roll_runs_status_created
  on public.v2_crop_roll_runs (status, created_at desc);

create table if not exists public.v2_crop_roll_rows (
  row_id text primary key,
  run_id text not null references public.v2_crop_roll_runs(run_id) on delete cascade,
  master_unique_id text not null,
  group_key text not null,
  item_location_key text not null,
  itemcode text,
  commonname text,
  contsize text,
  genus text,
  blockalpha text,
  locationcode text,
  original_lotcode text,
  original_season text,
  original_priority text,
  original_locationnotedate text,
  original_locationnote text,
  original_locationptn1 text,
  original_holdstopcode text,
  original_holdstopreason text,
  assignedto text,
  row_status text not null default 'open',
  completed_by text,
  completed_at timestamptz,
  target_lotcode text,
  target_season text,
  priority text,
  locationnotedate text,
  locationnote text,
  locationptn1 text,
  holdstopcode text,
  holdstopreason text,
  saved_by text,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (run_id, master_unique_id)
);

create index if not exists idx_v2_crop_roll_rows_run_status
  on public.v2_crop_roll_rows (run_id, row_status);

create index if not exists idx_v2_crop_roll_rows_run_assigned
  on public.v2_crop_roll_rows (run_id, assignedto);

create index if not exists idx_v2_crop_roll_rows_run_block_loc
  on public.v2_crop_roll_rows (run_id, blockalpha, locationcode);

create index if not exists idx_v2_crop_roll_rows_group
  on public.v2_crop_roll_rows (run_id, group_key);
