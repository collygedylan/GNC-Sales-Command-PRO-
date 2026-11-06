set local lock_timeout='15s';
create table if not exists public.ph_inventory_field_audits (
 row_uid text primary key, itemcode text, commonname text, contsize text, blockalpha text, locationcode text, lotcode text, saleyear text, season text,
 on_hand_snapshot numeric, available_snapshot numeric, extended_value_snapshot numeric,
 is_product_there text check (is_product_there in ('YES','NO','UNCHECKED')), verified_count numeric check (verified_count>=0), missing_reason text, audit_notes text,
 custom_answers jsonb not null default '{}'::jsonb check(jsonb_typeof(custom_answers)='object'), verified_by text,
 verified_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ph_inventory_field_audits enable row level security;
create policy field_audits_requested_public_access on public.ph_inventory_field_audits for all to anon,authenticated,service_role using(true) with check(true);
grant all on public.ph_inventory_field_audits to anon,authenticated,service_role;
create index if not exists inventory_field_audits_location on public.ph_inventory_field_audits(blockalpha,locationcode);
notify pgrst,'reload schema';
