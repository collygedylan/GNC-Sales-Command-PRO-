alter table public.v2_dock_issue_status
    add column if not exists issue_photo_link text,
    add column if not exists issue_photo_name text,
    add column if not exists source_photo_link text,
    add column if not exists source_photo_name text,
    add column if not exists source_loc_match_qty text;
