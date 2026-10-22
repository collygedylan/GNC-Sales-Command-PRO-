create extension if not exists pgcrypto;

create table if not exists public.inventory_projects (
  id uuid primary key default gen_random_uuid(),
  project_name text not null,
  instructions text not null default '',
  assigned_users jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','completed')),
  created_by text not null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_project_rows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.inventory_projects(id) on delete cascade,
  itemcode text not null,
  locationcode text not null,
  lotcode text not null,
  commonname text not null default '',
  contsize text not null default '',
  row_instructions text not null default '',
  status text not null default 'pending' check (status in ('pending','done')),
  completed_by text,
  completed_at timestamptz,
  snapshot_metrics jsonb not null default '{}'::jsonb,
  added_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id,itemcode,locationcode,lotcode)
);

create index if not exists inventory_project_rows_project_location_idx
  on public.inventory_project_rows(project_id,locationcode,lotcode);
alter table public.inventory_projects enable row level security;
alter table public.inventory_project_rows enable row level security;

update public.app_dataset_revisions
set state='ready', error_message=null, updated_at=now()
where dataset in ('ph_active_request','ph_master_inventory','ph_request_delivery_outbox')
  and state='interrupted';
