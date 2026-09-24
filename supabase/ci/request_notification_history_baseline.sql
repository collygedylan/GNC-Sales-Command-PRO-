-- ISOLATED CI ONLY: production-shaped history that predates folder delivery V2.
-- Loaded immediately before the history backfill, never deployed to production.
begin;
alter table public.ph_active_request disable trigger reconcile_request_folder_from_request_v2;
alter table public.ph_request_delivery_outbox disable trigger reconcile_request_folder_after_created_v2;
insert into public.ph_active_request(unique_id,request_folder,req_customer,req_status,date_completed,client_batch_id)
values('NOTIFY-HISTORICAL-ROW','NOTIFY-HISTORICAL-FOLDER','Historical Customer','Completed','2018-01-15',
  '97300000-0000-4000-8000-000000000001');
select private.upsert_request_history('NOTIFY-HISTORICAL-ROW','completed','delivered',false);
-- No client_batch_id: real legacy completion trigger remains involved.
insert into public.ph_active_request(unique_id,request_folder,req_customer,req_status,date_completed)
values('NOTIFY-LEGACY-ROW','NOTIFY-LEGACY-FOLDER','Legacy Historical Customer','done',null);
select private.upsert_request_history('NOTIFY-LEGACY-ROW','completed','delivered',false);
update public.ph_request_history set snapshot=snapshot||'{"customeridentityid":"HIST-C","consigneeidentityid":"HIST-CN","consigneename":"Historical Destination"}'::jsonb
where unique_id='NOTIFY-HISTORICAL-ROW';
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,email_delivered_at,delivered_at)
values('NOTIFY-HISTORICAL-CREATED','request_created','NOTIFY-HISTORICAL-FOLDER',
  '{"request_ids":["NOTIFY-HISTORICAL-ROW"]}','delivered','2018-01-01','2018-01-01');
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,email_delivered_at,delivered_at)
values('NOTIFY-LEGACY-CREATED','request_created','NOTIFY-LEGACY-FOLDER',
  '{"request_ids":["NOTIFY-LEGACY-ROW"]}','delivered','2018-01-01','2018-01-01');
alter table public.ph_active_request enable trigger reconcile_request_folder_from_request_v2;
alter table public.ph_request_delivery_outbox enable trigger reconcile_request_folder_after_created_v2;
commit;
