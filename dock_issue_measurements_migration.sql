alter table public.v2_dock_issue_status
    add column if not exists source_spec text,
    add column if not exists source_caliper text;
