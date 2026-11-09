-- @test-runtime: canonical
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select plan(5);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
insert into public.ph_itemcode_default_owners(itemcode_normalized,assignedto)
values ('989593.030.1','megan_kelly');
insert into public.ph_soc_master(unique_id,itemcode,suspend,suspend_to,assignedto,dock,stopnumber,locationcode,lotcode)
values ('suspend-owner-593','989593.030.','SUSPEND','dc','raw_erp','38','2','C.09.000','27.F1'),
  ('suspend-other-593','989593.050.1','SUSPEND','ms','raw_erp','38','2','B.04.000','27.F1');

select is((select assignedto from public.ph_active_suspend where unique_id='suspend-owner-593'),
  'megan_kelly','the exact canonical item owns the trailing-dot tag');
select is((select eval_user from public.ph_active_suspend where unique_id='suspend-owner-593'),
  'megan_kelly','Eval and AssignedTo read the same assignment');
select is((select eval_user from public.ph_active_suspend where unique_id='suspend-other-593'),
  'Unassigned','another container and the ERP route cannot supply an owner');
update public.ph_itemcode_default_owners set assignedto='dylan_collyge' where itemcode_normalized='989593.030.1';
select is((select assignedto from public.ph_active_suspend where unique_id='suspend-owner-593'),
  'dylan_collyge','an Assigned Items change is visible in the same transaction');
update public.ph_itemcode_default_owners set assignedto=null where itemcode_normalized='989593.030.1';
select ok((select assignedto is null and eval_user='Unassigned' from public.ph_active_suspend where unique_id='suspend-owner-593'),
  'an explicit clear does not expose the old ERP owner');
select * from finish();
rollback;
