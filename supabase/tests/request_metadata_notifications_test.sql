begin;
create temporary table request_metadata_notification_checks(description text);
create function pg_temp.notification_check(ok boolean,description text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Request notification guard: %',description; end if;
  insert into request_metadata_notification_checks values(description);
end $$;
select pg_temp.notification_check(exists(select 1 from public.ph_active_request where unique_id='NOTIFY-HISTORICAL-ROW'),
  'historical fixture was present before the complete history migration');
select pg_temp.notification_check(not exists(select 1 from public.ph_request_delivery_outbox
  where request_folder='NOTIFY-HISTORICAL-FOLDER' and event_type='request_completed'),
  'complete history migration must not enqueue old completion emails');
select pg_temp.notification_check(not exists(select 1 from private.ph_request_folder_delivery_state
  where request_folder='NOTIFY-HISTORICAL-FOLDER'),'metadata backfill does not create old folder-delivery state');
select pg_temp.notification_check((select customeridentityid='HIST-C' and consigneeidentityid='HIST-CN'
  and consigneename='Historical Destination' from public.ph_active_request where unique_id='NOTIFY-HISTORICAL-ROW'),
  'silent migration still preserves exact customer and consignee context');

update public.ph_active_request set customername='Corrected Customer',consigneename='Corrected Destination',
  req_photo_link='https://example.invalid/synthetic-photo.jpg',request_note='Historical note',row_version=row_version+1
where unique_id='NOTIFY-HISTORICAL-ROW';
update public.ph_active_request set req_status='complete',date_completed='2018-01-16',req_archived=null,
  request_folder=' NOTIFY-HISTORICAL-FOLDER ' where unique_id='NOTIFY-HISTORICAL-ROW';
update public.ph_active_request set customername=customername where unique_id='NOTIFY-HISTORICAL-ROW';
select pg_temp.notification_check(not exists(select 1 from public.ph_request_delivery_outbox
  where btrim(request_folder)='NOTIFY-HISTORICAL-FOLDER' and event_type='request_completed'),
  'metadata/photo/version/no-op and semantically unchanged completion edits stay silent');
select pg_temp.notification_check((select customername='Corrected Customer'
  and req_photo_link='https://example.invalid/synthetic-photo.jpg' from public.ph_active_request where unique_id='NOTIFY-HISTORICAL-ROW'),
  'historical metadata and photo edits are not discarded');

-- New business transitions still reconcile; fixtures never invoke an email worker.
update public.ph_active_request set req_status=' Completed ' where unique_id='NOTIFY-LEGACY-ROW';
update public.ph_active_request set req_status='completed',date_completed='2018-01-15',customername='Legacy Correction'
where unique_id='NOTIFY-LEGACY-ROW';
select pg_temp.notification_check((select client_batch_id is null from public.ph_active_request where unique_id='NOTIFY-LEGACY-ROW')
  and not exists(select 1 from public.ph_request_delivery_outbox
    where request_folder='NOTIFY-LEGACY-FOLDER' and event_type='request_completed'),
  'legacy null-batch done/whitespace/date corrections cannot bypass the metadata guard');

insert into public.ph_active_request(unique_id,request_folder,req_status,client_batch_id)
values('NOTIFY-NEW-ROW','NOTIFY-NEW-FOLDER','Pending','97300000-0000-4000-8000-000000000002');
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,delivered_at)
values('NOTIFY-NEW-CREATED','request_created','NOTIFY-NEW-FOLDER','{"request_ids":["NOTIFY-NEW-ROW"]}','delivered',now());
update public.ph_active_request set req_status='Completed',date_completed='2026-09-24' where unique_id='NOTIFY-NEW-ROW';
select pg_temp.notification_check((select count(*)=1 from public.ph_request_delivery_outbox
  where request_folder='NOTIFY-NEW-FOLDER' and event_type='request_completed' and status='pending'),
  'genuine new completion enqueues exactly one notification');
update public.ph_request_delivery_outbox set status='delivered',email_delivered_at=now(),delivered_at=now()
where request_folder='NOTIFY-NEW-FOLDER' and event_type='request_completed';
update public.ph_active_request set customername='New Metadata',req_status='completed',date_completed='2026-09-25'
where unique_id='NOTIFY-NEW-ROW';
select pg_temp.notification_check((select count(*)=1 and bool_and(status='delivered') from public.ph_request_delivery_outbox
  where request_folder='NOTIFY-NEW-FOLDER' and event_type='request_completed'),
  'delivered completion receipt remains terminal after metadata/status spelling/date correction');

insert into public.ph_active_request(unique_id,request_folder,req_status,client_batch_id)
values('NOTIFY-APPEND-ROW','NOTIFY-APPEND-FOLDER','Completed','97300000-0000-4000-8000-000000000003');
insert into public.ph_request_delivery_outbox(event_key,event_type,request_folder,payload,status,delivered_at)
values('NOTIFY-APPEND-COVERAGE','request_options_appended','NOTIFY-APPEND-FOLDER',
  '{"request_ids":["NOTIFY-APPEND-ROW"]}','delivered',now());
select pg_temp.notification_check((select count(*)=1 from public.ph_request_delivery_outbox
  where request_folder='NOTIFY-APPEND-FOLDER' and event_type='request_completed' and status='pending'),
  'late appended membership coverage still enqueues completion');

insert into public.ph_active_request(unique_id,request_folder,req_status,client_batch_id)
values('NOTIFY-PENDING-MEMBER','NOTIFY-NEW-FOLDER','Pending','97300000-0000-4000-8000-000000000004');
update public.ph_active_request set request_folder='NOTIFY-MOVED-FOLDER' where unique_id='NOTIFY-PENDING-MEMBER';
select pg_temp.notification_check((select active_request_ids=array['NOTIFY-NEW-ROW'] from private.ph_request_folder_delivery_state
  where request_folder='NOTIFY-NEW-FOLDER') and (select active_request_ids=array['NOTIFY-PENDING-MEMBER']
  from private.ph_request_folder_delivery_state where request_folder='NOTIFY-MOVED-FOLDER'),
  'real folder move reconciles old and new memberships');
update public.ph_active_request set req_archived=true where unique_id='NOTIFY-PENDING-MEMBER';
select pg_temp.notification_check((select cardinality(active_request_ids)=0 from private.ph_request_folder_delivery_state
  where request_folder='NOTIFY-MOVED-FOLDER'),'archive removes actual membership');
update public.ph_active_request set req_archived=false where unique_id='NOTIFY-PENDING-MEMBER';
delete from public.ph_active_request where unique_id='NOTIFY-PENDING-MEMBER';
select pg_temp.notification_check((select cardinality(active_request_ids)=0 from private.ph_request_folder_delivery_state
  where request_folder='NOTIFY-MOVED-FOLDER'),'delete still reconciles membership after unarchive');
select pg_temp.notification_check(has_function_privilege('service_role','public.claim_request_delivery_events(integer,text)','execute')
  and not has_function_privilege('authenticated','public.claim_request_delivery_events(integer,text)','execute')
  and not has_function_privilege('anon','public.claim_request_delivery_events(integer,text)','execute'),
  'reviewed restoration restores only the original service-worker claim privilege');
select pg_temp.notification_check((select count(*)=2 and bool_and(tgenabled='O') from pg_trigger
  where tgrelid='public.ph_request_delivery_outbox'::regclass
  and tgname in ('ph_request_delivery_outbox_wake','ph_request_delivery_outbox_requeue_wake')),
  'reviewed restoration restores both original notification wake paths');
select count(*) as request_metadata_notification_checks from request_metadata_notification_checks;
rollback;
