alter table public.v2_master_inventory
    add column if not exists flyer_av_note text,
    add column if not exists flyer_match numeric,
    add column if not exists flyer_loc_match_qty numeric,
    add column if not exists flyer_spec text,
    add column if not exists flyer_caliper text,
    add column if not exists flyer_pick text,
    add column if not exists flyer_initial_ptr numeric,
    add column if not exists flyer_photo_link text,
    add column if not exists flyer_photo_name text;

comment on column public.v2_master_inventory.flyer_photo_link is 'Flyer-folder-owned photo URLs. Kept separate from shared AV photos so invalid AV photos do not bleed into flyer folders.';
comment on column public.v2_master_inventory.flyer_photo_name is 'Flyer-folder-owned photo file names aligned with flyer_photo_link.';
