-- S1 is a generated PO read model. Remove privileges inherited from Supabase's
-- default table grants; imports and accounting retain their service access.
begin;
revoke all on table public.ph_27s1_hl_po, public.ph_view_po_27s1_hl
  from public, anon, authenticated;
grant select on table public.ph_27s1_hl_po, public.ph_view_po_27s1_hl
  to authenticated;
notify pgrst, 'reload schema';
commit;
