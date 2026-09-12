-- Match both protected PO membership predicates without changing eligibility.
create index ph_27f1_hl_po_membership_idx on public.ph_27f1_hl_po
  ((coalesce(nullif(run_id,''),source_file_id)), (nullif(upper(btrim(item_code)),'')));
