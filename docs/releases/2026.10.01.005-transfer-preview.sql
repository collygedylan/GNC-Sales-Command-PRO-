-- Read-only preview. Re-run before approval and compare with the audited worker.
-- Each number is a target record count, not a deduplicated employee/task total.
select 'flyer_unfinished' target, count(*) records from public.ph_flyer_folder_rows
 where lower(btrim(assignedto))='kayla_knepp' and flyer_completed is null and date_completed is null
union all select 'flyer_completed_preserved',count(*) from public.ph_flyer_folder_rows
 where lower(btrim(assignedto))='kayla_knepp' and (flyer_completed is not null or date_completed is not null)
union all select 'eval_work_unfinished',count(*) from public.ph_eval_work
 where status in ('open','in_progress') and (lower(assignee_username)='kayla_knepp' or 'kayla_knepp'=any(assignee_usernames))
union all select 'active_assignment_rules',count(*) from public.ph_eval_assignment_rules
 where active and assignedto ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'active_warehouse_assignments',count(*) from public.ph_warehouse_assigned_items
 where present_in_drive and assignedto ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'inventory_edit_unfinished',count(*) from public.ph_inventory_edit_requests
 where lower(coalesce(status,'pending')) not in ('complete','completed','cancelled','canceled','archived','closed')
 and (inventory_edit_completed_at is null or photo_data_completed_at is null)
 and assignedto ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'master_eval_unfinished',count(*) from public.ph_master_inventory
 where date_completed is null and eval_task_completed_at is null
 and assignedto ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'master_flyer_unfinished',count(*) from public.ph_master_inventory
 where flyer_completed is null and flyer_assigned ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'reserve_eval_unfinished',count(*) from public.ph_reserves
 where nullif(btrim(date_completed),'') is null and concat_ws(',',assignedto,assigned_to) ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'reserve_flyer_unfinished',count(*) from public.ph_reserves
 where nullif(btrim(flyer_completed),'') is null and flyer_assigned ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'soc_eval_unfinished',count(*) from public.ph_soc_master
 where date_completed is null and assignedto ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'soc_flyer_unfinished',count(*) from public.ph_soc_master
 where nullif(btrim(flyer_completed),'') is null and flyer_assigned ~* '(^|[^a-z0-9_@.+-])kayla[ _.-]+knepp(?=$|[^a-z0-9_@.+-])'
union all select 'location_work_unfinished',count(*) from public.ph_location_work_jobs j
 where j.status in ('open','in_progress') and ('kayla_knepp'=any(j.assigned_usernames)
 or exists(select 1 from public.ph_location_work_assignments a where a.job_id=j.id and a.profile_id='e2584b32-472c-4888-b592-394235050b5b'))
union all select 'shear_inquiry_unfinished',count(*) from public.ph_shear_location_inquiries
 where status in ('open','in_progress') and 'kayla_knepp'=any(recipient_usernames)
union all select 'inventory_assignment_links',count(*) from public.ph_master_inventory_user_assignments a
 join public.ph_master_inventory m on m.unique_id=a.master_unique_id
 where m.date_completed is null and m.eval_task_completed_at is null and lower(a.assignedto)='kayla_knepp'
union all select 'bunch_note_unfinished',count(*) from bunch_note_private.jobs
 where status='open' and owner_id='e2584b32-472c-4888-b592-394235050b5b'
order by target;
