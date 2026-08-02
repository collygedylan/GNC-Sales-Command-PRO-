alter table public.ph_drive_around_report_files
  add column if not exists original_file_name text,
  add column if not exists canonical_file_name text,
  add column if not exists canonical_report_date date,
  add column if not exists canonical_sequence integer,
  add column if not exists canonical_date_source text,
  add column if not exists renamed_at timestamptz,
  add column if not exists first_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ph_drive_around_report_files_canonical_sequence_check'
      and conrelid = 'public.ph_drive_around_report_files'::regclass
  ) then
    alter table public.ph_drive_around_report_files
      add constraint ph_drive_around_report_files_canonical_sequence_check
      check (canonical_sequence is null or canonical_sequence > 0) not valid;
  end if;
end $$;

alter table public.ph_drive_around_report_files
  validate constraint ph_drive_around_report_files_canonical_sequence_check;

create index if not exists ph_drive_around_report_files_canonical_date_idx
  on public.ph_drive_around_report_files (canonical_report_date, canonical_sequence);

create index if not exists ph_drive_around_report_files_canonical_name_idx
  on public.ph_drive_around_report_files (canonical_file_name);

create index if not exists ph_drive_around_report_files_original_name_idx
  on public.ph_drive_around_report_files (original_file_name);
