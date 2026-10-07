begin;
set local lock_timeout = '5s';

create table public.ph_company_directory_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  department text,
  extension text,
  cell_number text,
  home_number text,
  location text not null check (length(btrim(location)) between 1 and 100),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ph_company_directory_contacts_name_idx on public.ph_company_directory_contacts (lower(name));
create index ph_company_directory_contacts_department_idx on public.ph_company_directory_contacts (lower(department));
create index ph_company_directory_contacts_extension_idx on public.ph_company_directory_contacts (extension);
alter table public.ph_company_directory_contacts enable row level security;

create table public.ph_company_directory_blocks (
  letter text primary key check (letter ~ '^[A-L]$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ph_company_directory_blocks enable row level security;

create table public.ph_company_directory_beds (
  id uuid primary key default gen_random_uuid(),
  block_letter text not null references public.ph_company_directory_blocks(letter) on update cascade on delete cascade,
  bed_identifier text not null check (length(btrim(bed_identifier)) between 1 and 32),
  capacity numeric(9, 2) not null check (capacity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_company_directory_beds_identifier_key unique (bed_identifier)
);
create index ph_company_directory_beds_block_idx on public.ph_company_directory_beds (block_letter, bed_identifier);
alter table public.ph_company_directory_beds enable row level security;

create table public.ph_company_directory_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 24),
  description text not null check (length(btrim(description)) between 1 and 240),
  department_reference text,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ph_company_directory_codes_code_key unique (code)
);
create index ph_company_directory_codes_code_idx on public.ph_company_directory_codes (code);
create index ph_company_directory_codes_description_idx on public.ph_company_directory_codes (lower(description));
create index ph_company_directory_contacts_review_idx on public.ph_company_directory_contacts (needs_review) where needs_review;
create index ph_company_directory_codes_review_idx on public.ph_company_directory_codes (needs_review) where needs_review;
alter table public.ph_company_directory_codes enable row level security;

create or replace function private.company_directory_is_dylan_v1()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with active as (select private.current_active_profile() as profile)
  select coalesce(lower(btrim((profile).username)) = 'dylan_collyge' and not coalesce((profile).must_change_password, true), false)
  from active;
$$;
revoke all on function private.company_directory_is_dylan_v1() from public, anon;
grant execute on function private.company_directory_is_dylan_v1() to authenticated;

create policy company_directory_contacts_dylan_all on public.ph_company_directory_contacts
  for all to authenticated using ((select private.company_directory_is_dylan_v1()))
  with check ((select private.company_directory_is_dylan_v1()));
create policy company_directory_blocks_dylan_all on public.ph_company_directory_blocks
  for all to authenticated using ((select private.company_directory_is_dylan_v1()))
  with check ((select private.company_directory_is_dylan_v1()));
create policy company_directory_beds_dylan_all on public.ph_company_directory_beds
  for all to authenticated using ((select private.company_directory_is_dylan_v1()))
  with check ((select private.company_directory_is_dylan_v1()));
create policy company_directory_codes_dylan_all on public.ph_company_directory_codes
  for all to authenticated using ((select private.company_directory_is_dylan_v1()))
  with check ((select private.company_directory_is_dylan_v1()));

grant select, insert, update, delete on public.ph_company_directory_contacts to authenticated;
grant select, insert, update, delete on public.ph_company_directory_blocks to authenticated;
grant select, insert, update, delete on public.ph_company_directory_beds to authenticated;
grant select, insert, update, delete on public.ph_company_directory_codes to authenticated;

-- The initial reference seed was applied privately to production with this migration.
-- Personal contact data is intentionally excluded from the public repository.

create view public.ph_company_directory_block_totals with (security_invoker = true) as
select b.letter, b.name, count(d.id)::integer as bed_count, coalesce(sum(d.capacity), 0)::numeric(12,2) as total_beds
from public.ph_company_directory_blocks b
left join public.ph_company_directory_beds d on d.block_letter = b.letter
group by b.letter, b.name;
grant select on public.ph_company_directory_block_totals to authenticated;

commit;
