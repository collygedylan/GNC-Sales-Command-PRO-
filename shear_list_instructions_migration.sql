-- Adds optional row-level instructions for the Production Shear List.
-- Run this after shear_list_migration.sql has already created public.v2_shear_list.

alter table if exists public.v2_shear_list
    add column if not exists instructions text;

comment on column public.v2_shear_list.instructions
    is 'Optional instructions entered by the user when placing a row on the Shear List.';
