-- Disposable historical replay only. Restore existing canonical inventory
-- columns before V7; existing column types and data are unchanged.
alter table public.ph_master_inventory
  add column if not exists app_tab_assignment text,
  add column if not exists assignedto text,
  add column if not exists av_note text,
  add column if not exists av_rule_av_note_updated_at timestamp with time zone,
  add column if not exists av_rule_bundle_updated_at timestamp with time zone,
  add column if not exists av_rule_caliper_updated_at timestamp with time zone,
  add column if not exists av_rule_holdstop_snapshot text,
  add column if not exists av_rule_last_clear_reason text,
  add column if not exists av_rule_last_cleared_at timestamp with time zone,
  add column if not exists av_rule_match_updated_at timestamp with time zone,
  add column if not exists av_rule_photo_updated_at timestamp with time zone,
  add column if not exists av_rule_priority_snapshot text,
  add column if not exists av_rule_spec_updated_at timestamp with time zone,
  add column if not exists caliper text,
  add column if not exists concat text,
  add column if not exists date_completed timestamp with time zone,
  add column if not exists desigcust text,
  add column if not exists desigitem text,
  add column if not exists desigloc text,
  add column if not exists genusname text,
  add column if not exists holdstopcode text,
  add column if not exists holdstopreason text,
  add column if not exists initial_ptr text,
  add column if not exists itemcode text,
  add column if not exists last_updated timestamp with time zone,
  add column if not exists loc_match_qty text,
  add column if not exists locationcode text,
  add column if not exists locationnote text,
  add column if not exists locationnotedate text,
  add column if not exists locationptn1 text,
  add column if not exists lotcode text,
  add column if not exists match text,
  add column if not exists oversellpercentage text,
  add column if not exists photo_link text,
  add column if not exists photo_name text,
  add column if not exists pic_note text,
  add column if not exists priority text,
  add column if not exists prisetby text,
  add column if not exists priupdated text,
  add column if not exists ptravailable text,
  add column if not exists ptronhand text,
  add column if not exists pullerresponsibility text,
  add column if not exists sales_note text,
  add column if not exists salesnote text,
  add column if not exists spec text,
  add column if not exists suspend text,
  add column if not exists unique_id text NOT NULL;

-- Disposable historical replay only. V7 declares this canonical row type;
-- the table was captured in the production baseline rather than an archive.
create table if not exists public.ph_item_inquiry_coverage (
  singleton boolean default true not null,
  sharon_away boolean default false not null,
  revision bigint default 1 not null,
  updated_by text,
  updated_at timestamptz default now() not null,
  constraint ph_item_inquiry_coverage_revision_check check (revision>0),
  constraint ph_item_inquiry_coverage_singleton_check check (singleton),
  constraint ph_item_inquiry_coverage_pkey primary key (singleton)
);
alter table public.ph_item_inquiry_coverage enable row level security;
revoke all on public.ph_item_inquiry_coverage from public,anon,authenticated;
grant select on public.ph_item_inquiry_coverage to service_role;

-- Canonical verified-recipient resolver, also captured only in the baseline.
CREATE OR REPLACE FUNCTION private.item_inquiry_verified_email_v1(p_username text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select lower(btrim(u.email)) from public.profiles p join auth.users u on u.id=p.id
  where lower(btrim(p.username))=p_username and p.disabled_at is null
    and (p.locked_until is null or p.locked_until <= now()) and not p.must_change_password
    and u.email_confirmed_at is not null
    and btrim(coalesce(u.email,'')) ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  order by p.id limit 1
$function$;
revoke all on function private.item_inquiry_verified_email_v1(text) from public,anon,authenticated,service_role;
