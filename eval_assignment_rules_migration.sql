-- Eval assignment rules imported from the Google Sheet "ALL IN ONE".
-- Browser clients read only active rules; imports should use the service role.

create table if not exists public.v2_eval_assignment_rules (
  id bigserial primary key,
  sheet_id text not null default '',
  sheet_name text not null default '',
  sheet_row_number integer not null,
  assigned_to_raw text,
  assignedto text not null,
  warehousei text,
  itemcode text,
  contsize text,
  commonname text,
  locationcode text,
  source text,
  genusname text,
  normalized jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint v2_eval_assignment_rules_sheet_row_unique unique (sheet_id, sheet_name, sheet_row_number)
);

create index if not exists idx_v2_eval_assignment_rules_active_row
  on public.v2_eval_assignment_rules (active, sheet_row_number);

create index if not exists idx_v2_eval_assignment_rules_itemcode
  on public.v2_eval_assignment_rules (itemcode)
  where active and itemcode is not null and btrim(itemcode) <> '';

create index if not exists idx_v2_eval_assignment_rules_contsize
  on public.v2_eval_assignment_rules (contsize)
  where active and contsize is not null and btrim(contsize) <> '';

create index if not exists idx_v2_eval_assignment_rules_commonname
  on public.v2_eval_assignment_rules (commonname)
  where active and commonname is not null and btrim(commonname) <> '';

create index if not exists idx_v2_eval_assignment_rules_locationcode
  on public.v2_eval_assignment_rules (locationcode)
  where active and locationcode is not null and btrim(locationcode) <> '';

create index if not exists idx_v2_eval_assignment_rules_source
  on public.v2_eval_assignment_rules (source)
  where active and source is not null and btrim(source) <> '';

create index if not exists idx_v2_eval_assignment_rules_genusname
  on public.v2_eval_assignment_rules (genusname)
  where active and genusname is not null and btrim(genusname) <> '';

create index if not exists idx_v2_eval_assignment_rules_warehousei
  on public.v2_eval_assignment_rules (warehousei)
  where active and warehousei is not null and btrim(warehousei) <> '';

alter table public.v2_eval_assignment_rules enable row level security;

drop policy if exists "v2_eval_assignment_rules_read_active" on public.v2_eval_assignment_rules;
create policy "v2_eval_assignment_rules_read_active"
  on public.v2_eval_assignment_rules
  for select
  to anon, authenticated
  using (active = true);

grant select on public.v2_eval_assignment_rules to anon, authenticated;
grant all on public.v2_eval_assignment_rules to service_role;
do $$
begin
  if to_regclass('public.v2_eval_assignment_rules_id_seq') is not null then
    execute 'grant usage, select on sequence public.v2_eval_assignment_rules_id_seq to service_role';
  end if;
end
$$;
