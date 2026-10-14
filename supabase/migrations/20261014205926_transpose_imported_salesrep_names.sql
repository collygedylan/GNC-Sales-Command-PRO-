begin;

-- Rewrite only name/address fields in request snapshots and recipient arrays.
-- Free-form note/body fields are deliberately left untouched.
create or replace function pg_temp.rewrite_salesrep_queue_json_v1(
  p_value jsonb,p_old_name text,p_new_name text,p_old_email text,p_new_email text,
  p_salesrepid text,p_customer_id text,p_consignee_id text,p_context boolean default false
) returns jsonb
language plpgsql immutable set search_path=''
as $function$
declare item record; result_value jsonb; replacement jsonb; array_value jsonb; matches_mapping boolean;
begin
  if jsonb_typeof(p_value)='object' then
    matches_mapping:=p_context or
      (btrim(coalesce(p_value->>'request_selected_salesrep_id',p_value->>'salesrepid',p_value->>'salesRepId',p_value->>'selectedRepId',''))=btrim(p_salesrepid)
       and btrim(coalesce(p_value->>'customeridentityid',p_value->>'customerId',''))=btrim(p_customer_id)
       and btrim(coalesce(p_value->>'consigneeidentityid',p_value->>'consigneeid',p_value->>'consigneeId',''))=btrim(p_consignee_id));
    result_value:='{}'::jsonb;
    for item in select key,value from jsonb_each(p_value) loop
      replacement:=item.value;
      if matches_mapping and item.key in ('repName','salesRepName','rep_name','sales_rep_name','requested_by',
          'requestedBy','requested_by','requestSelectedRepDisplay','request_selected_rep_display','salesrepname',
          'displayName','display_name','selectedRepDisplay','selected_rep_display')
          and item.value=to_jsonb(p_old_name) then
        replacement:=to_jsonb(p_new_name);
      elsif matches_mapping and item.key in ('repEmail','salesRepEmail','rep_email','sales_rep_email',
          'requestSelectedRepEmail','request_selected_rep_email','salesrepemail','email','selectedRepEmail','selected_rep_email')
          and item.value=to_jsonb(p_old_email) then
        replacement:=to_jsonb(p_new_email);
      elsif item.key in ('recipients','recipientEmails','emailRecipients','selectedRepRecipients','repRecipientEmails','recipient_emails')
          and jsonb_typeof(item.value)='array' and matches_mapping then
        select coalesce(jsonb_agg(
          case when jsonb_typeof(entry.value)='string'
                    and entry.value=to_jsonb(p_old_email)
            then to_jsonb(p_new_email)
            else pg_temp.rewrite_salesrep_queue_json_v1(entry.value,p_old_name,p_new_name,p_old_email,p_new_email,
              p_salesrepid,p_customer_id,p_consignee_id,true)
          end order by entry.ordinality),'[]'::jsonb)
          into array_value
          from jsonb_array_elements(item.value) with ordinality as entry(value,ordinality);
        replacement:=array_value;
      elsif item.key='requests' and jsonb_typeof(item.value)='array' then
        select coalesce(jsonb_agg(pg_temp.rewrite_salesrep_queue_json_v1(entry.value,p_old_name,p_new_name,
          p_old_email,p_new_email,p_salesrepid,p_customer_id,p_consignee_id,false) order by entry.ordinality),'[]'::jsonb)
          into array_value from jsonb_array_elements(item.value) with ordinality as entry(value,ordinality);
        replacement:=array_value;
      elsif item.key in ('requestCreator','request_creator') and jsonb_typeof(item.value)='object' then
        replacement:=pg_temp.rewrite_salesrep_queue_json_v1(item.value,p_old_name,p_new_name,p_old_email,p_new_email,
          p_salesrepid,p_customer_id,p_consignee_id,matches_mapping);
      end if;
      result_value:=result_value||jsonb_build_object(item.key,replacement);
    end loop;
    return result_value;
  elsif jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(pg_temp.rewrite_salesrep_queue_json_v1(entry.value,p_old_name,p_new_name,p_old_email,p_new_email,
      p_salesrepid,p_customer_id,p_consignee_id,p_context)
      order by entry.ordinality),'[]'::jsonb)
      into result_value from jsonb_array_elements(p_value) with ordinality as entry(value,ordinality);
    return result_value;
  elsif jsonb_typeof(p_value)='string' and p_context and p_value=to_jsonb(p_old_email) then
    return to_jsonb(p_new_email);
  end if;
  return p_value;
end
$function$;

create or replace function pg_temp.transpose_imported_salesrep_names_v1()
returns void language plpgsql set search_path=''
as $function$
declare dataset_state text; changed_count integer; queue_entry record;
begin
  -- Keep the importer > publication > source-row lock order used by the importer.
  perform set_config('lock_timeout','5s',true);
  perform pg_advisory_xact_lock(hashtextextended('customer-rep-map-import',615738));
  if exists(select 1 from sales_private.customer_rep_mapping_import_runs r
    where r.status='active' and r.expires_at>clock_timestamp())
    or exists(select 1 from app_sync_private.import_leases l
      join app_sync_private.import_runs r on r.id=l.run_id
      where l.key='ph_customer_consignee_sales_reps' and r.state='active' and r.expires_at>clock_timestamp()) then
    raise exception using errcode='55000',message='CUSTOMER_REP_IMPORT_IN_PROGRESS';
  end if;

  -- Empty canonical test databases have no imported workbook or revision row.
  -- Production data is never changed unless its registered dataset is ready.
  if not exists(select 1 from public.ph_customer_consignee_sales_reps m
      where m.filename='CONS List 261009.xlsx' and m.source_file_name='CONS List 261009.xlsx') then
    return;
  end if;
  select r.state into dataset_state from public.app_dataset_revisions r
    where r.key='ph_customer_consignee_sales_reps' for update;
  if not found or dataset_state is distinct from 'ready' then
    raise exception using errcode='55000',message='CUSTOMER_REP_DATASET_NOT_READY';
  end if;
  perform 1 from public.ph_customer_consignee_sales_reps m
    where m.filename='CONS List 261009.xlsx' and m.source_file_name='CONS List 261009.xlsx'
    order by m.unique_id for update;

  drop table if exists pg_temp._salesrep_name_fix_map;
  drop table if exists pg_temp._salesrep_fix_rep_identities_before;
  drop table if exists pg_temp._salesrep_fix_history_owners_before;
  drop table if exists pg_temp._salesrep_fix_credit_owners_before;
  drop table if exists pg_temp._salesrep_fix_sales_owners_before;
  drop table if exists pg_temp._salesrep_fix_affected_events;
  drop table if exists pg_temp._salesrep_fix_pending_events;
  create temporary table _salesrep_name_fix_map on commit drop as
  with source_names as (
    select m.unique_id,m.customeridentityid,m.consigneeid,m.salesrepid,
      btrim(m.raw_data->>'SALESREPNAME') as old_name,btrim(m.salesrepname) as current_name,
      case when btrim(m.raw_data->>'SALESREPNAME')='Alldredge, Chance - South TX'
        then 'Chance Alldredge - South TX'
        else btrim(split_part(btrim(m.raw_data->>'SALESREPNAME'),',',2))||' '||
          btrim(split_part(btrim(m.raw_data->>'SALESREPNAME'),',',1)) end as new_name
    from public.ph_customer_consignee_sales_reps m
    where m.filename='CONS List 261009.xlsx'
      and m.source_file_name='CONS List 261009.xlsx'
      and (btrim(m.raw_data->>'SALESREPNAME')='Alldredge, Chance - South TX' or (
        length(m.raw_data->>'SALESREPNAME')-length(replace(m.raw_data->>'SALESREPNAME',',',''))=1
        and btrim(split_part(m.raw_data->>'SALESREPNAME',',',1)) ~ $person$^[[:alpha:]]+([ '’\-][[:alpha:]]+)*$$person$
        and btrim(split_part(m.raw_data->>'SALESREPNAME',',',2)) ~ $person$^[[:alpha:]]+([ '’\-][[:alpha:]]+)*$$person$
        and lower(m.raw_data->>'SALESREPNAME') !~ '(^|[^[:alnum:]])(sales|inhouse|interdivision|division|team|office|department|company|unknown|unassigned|null)([^[:alnum:]]|$)'
      ))
  )
  select unique_id,customeridentityid,consigneeid,salesrepid,old_name,new_name,
    trim(both '_' from regexp_replace(lower(old_name),'[^a-z0-9]+','_','g'))||'@greenleafnursery.com' as old_email,
    case when old_name='Alldredge, Chance - South TX' then 'chance_alldredge@greenleafnursery.com'
      else trim(both '_' from regexp_replace(lower(new_name),'[^a-z0-9]+','_','g'))||'@greenleafnursery.com' end as new_email
  from source_names
  where old_name<>'' and new_name<>'' and current_name in (old_name,new_name)
    and (current_name=new_name or old_name<>new_name);

  create temporary table _salesrep_fix_rep_identities_before on commit drop as
  select jsonb_build_object('kind',i.kind,'identity_key',i.identity_key,'profile_id',i.profile_id) as row_value
    from sales_private.rep_identities i;
  create temporary table _salesrep_fix_history_owners_before on commit drop as
    select jsonb_build_object('id',h.id,'assigned_rep_id',h.assigned_rep_id) as row_value from public.ph_request_history h;
  create temporary table _salesrep_fix_credit_owners_before on commit drop as
    select jsonb_build_object('id',c.id,'assigned_rep_id',c.assigned_rep_id) as row_value from public.ph_credit_sources c;
  create temporary table _salesrep_fix_sales_owners_before on commit drop as
    select jsonb_build_object('unique_id',c.unique_id,'assigned_rep_id',c.assigned_rep_id) as row_value from public.ph_sales_credit_requests c;

  changed_count:=0;
  if exists(select 1 from public.ph_customer_consignee_sales_reps m
      join pg_temp._salesrep_name_fix_map f on f.unique_id=m.unique_id
      where btrim(m.salesrepname)=f.old_name) then
    update public.ph_customer_consignee_sales_reps m set
      salesrepname=f.new_name,
      mapping_revision=m.mapping_revision+1,
      mapping_updated_by='maintenance:salesrep-name-order',
      updated_at=clock_timestamp(),
      row_hash='mapping-edit-pending:'||(m.mapping_revision+1)::text
    from pg_temp._salesrep_name_fix_map f
    where f.unique_id=m.unique_id and btrim(m.salesrepname)=f.old_name;
    get diagnostics changed_count=row_count;
  end if;

  if exists((select row_value from pg_temp._salesrep_fix_rep_identities_before
      except all select jsonb_build_object('kind',i.kind,'identity_key',i.identity_key,'profile_id',i.profile_id) from sales_private.rep_identities i)
    union all (select jsonb_build_object('kind',i.kind,'identity_key',i.identity_key,'profile_id',i.profile_id) from sales_private.rep_identities i
      except all select row_value from pg_temp._salesrep_fix_rep_identities_before))
    or exists((select row_value from pg_temp._salesrep_fix_history_owners_before
        except all select jsonb_build_object('id',h.id,'assigned_rep_id',h.assigned_rep_id) from public.ph_request_history h)
      union all (select jsonb_build_object('id',h.id,'assigned_rep_id',h.assigned_rep_id) from public.ph_request_history h
        except all select row_value from pg_temp._salesrep_fix_history_owners_before))
    or exists((select row_value from pg_temp._salesrep_fix_credit_owners_before
        except all select jsonb_build_object('id',c.id,'assigned_rep_id',c.assigned_rep_id) from public.ph_credit_sources c)
      union all (select jsonb_build_object('id',c.id,'assigned_rep_id',c.assigned_rep_id) from public.ph_credit_sources c
        except all select row_value from pg_temp._salesrep_fix_credit_owners_before))
    or exists((select row_value from pg_temp._salesrep_fix_sales_owners_before
        except all select jsonb_build_object('unique_id',c.unique_id,'assigned_rep_id',c.assigned_rep_id) from public.ph_sales_credit_requests c)
      union all (select jsonb_build_object('unique_id',c.unique_id,'assigned_rep_id',c.assigned_rep_id) from public.ph_sales_credit_requests c
        except all select row_value from pg_temp._salesrep_fix_sales_owners_before)) then
    raise exception using errcode='55000',message='SALESREP_NAME_FIX_CHANGED_ACCOUNT_MAPPING_OR_OWNER';
  end if;

  -- Stop concurrent requests/claims while taking the final queue snapshot. These
  -- locks are acquired in the request -> outbox -> thread write order and bounded.
  lock table public.ph_active_request in share row exclusive mode;
  lock table public.ph_request_delivery_outbox in share row exclusive mode;
  lock table public.ph_request_email_threads in share row exclusive mode;

  create temporary table _salesrep_fix_affected_events on commit drop as
  select distinct o.event_id,o.status,o.request_folder,r.unique_id as active_unique_id,
    f.old_name,f.new_name,f.old_email,f.new_email,f.salesrepid,
    f.customeridentityid,f.consigneeid
  from public.ph_request_delivery_outbox o
  join public.ph_active_request r on (r.unique_id=o.request_id or
    (nullif(btrim(o.request_folder),'') is not null and r.request_folder=o.request_folder))
  join pg_temp._salesrep_name_fix_map f
    on btrim(coalesce(r.request_selected_salesrep_id,''))=btrim(f.salesrepid)
    and btrim(coalesce(r.customeridentityid,''))=btrim(f.customeridentityid)
    and btrim(coalesce(r.consigneeidentityid,''))=btrim(f.consigneeid)
  where o.event_type in ('request_created','request_completed') and o.status in ('pending','processing')
    and (r.requested_by=f.old_name or r.request_selected_rep_display=f.old_name
      or r.request_selected_rep_email=f.old_email
      or o.payload->>'repName'=f.old_name or o.payload->>'salesRepName'=f.old_name
      or o.payload->>'repEmail'=f.old_email or o.payload->>'salesRepEmail'=f.old_email
      or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(o.payload->'requests')='array'
            then o.payload->'requests' else '[]'::jsonb end) req
        where btrim(coalesce(req->>'request_selected_salesrep_id',req->>'salesrepid',req->>'salesRepId',''))=btrim(f.salesrepid)
          and btrim(coalesce(req->>'customeridentityid',''))=btrim(f.customeridentityid)
          and btrim(coalesce(req->>'consigneeidentityid',req->>'consigneeid',''))=btrim(f.consigneeid)
          and (req->>'requested_by'=f.old_name or req->>'request_selected_rep_display'=f.old_name
            or req->>'salesrepname'=f.old_name or req->>'request_selected_rep_email'=f.old_email)))
  union
  select distinct o.event_id,o.status,coalesce(r.request_folder,o.request_folder),
    coalesce(r.unique_id,nullif(req.value->>'unique_id','')),
    f.old_name,f.new_name,f.old_email,f.new_email,f.salesrepid,f.customeridentityid,f.consigneeid
  from public.ph_request_delivery_outbox o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.payload->'requests')='array'
      then o.payload->'requests' else '[]'::jsonb end) req(value)
  join pg_temp._salesrep_name_fix_map f
    on btrim(coalesce(req.value->>'request_selected_salesrep_id',req.value->>'salesrepid',req.value->>'salesRepId',''))=btrim(f.salesrepid)
    and btrim(coalesce(req.value->>'customeridentityid',''))=btrim(f.customeridentityid)
    and btrim(coalesce(req.value->>'consigneeidentityid',req.value->>'consigneeid',''))=btrim(f.consigneeid)
  left join public.ph_active_request r on r.unique_id=req.value->>'unique_id'
  where o.event_type in ('request_created','request_completed') and o.status in ('pending','processing')
    and (req.value->>'requested_by'=f.old_name or req.value->>'request_selected_rep_display'=f.old_name
      or req.value->>'salesrepname'=f.old_name or req.value->>'request_selected_rep_email'=f.old_email);

  if exists(select 1 from pg_temp._salesrep_fix_affected_events e where e.status='processing') then
    raise exception using errcode='55000',message='SALESREP_NAME_ACTIVE_DELIVERY_LEASE';
  end if;

  create temporary table _salesrep_fix_pending_events on commit drop as
  select distinct e.event_id,e.active_unique_id,e.request_folder,e.old_name,e.new_name,e.old_email,e.new_email,
    e.salesrepid,e.customeridentityid,e.consigneeid
  from pg_temp._salesrep_fix_affected_events e
  join public.ph_request_delivery_outbox o on o.event_id=e.event_id
  where e.status='pending'
    and o.lease_token is null and o.lease_owner is null and o.lease_expires_at is null
    and o.first_attempt_at is null and o.last_attempt_at is null
    and o.attempt_count=0 and o.email_delivered_at is null and o.delivered_at is null
    and o.gmail_message_id is null and o.gmail_thread_id is null and o.message_id_header is null
    and o.push_delivered_at is null
    and o.channel_results #>> '{email,status}' is distinct from 'sending'
    and o.channel_results #>> '{email,status}' is distinct from 'sent'
    and o.channel_results #>> '{email,status}' is distinct from 'unknown'
    and o.channel_results #>> '{email,delivered_at}' is null
    and o.channel_results #>> '{email,gmail_message_id}' is null
    and o.channel_results #>> '{push,status}' is distinct from 'sending'
    and o.channel_results #>> '{push,status}' is distinct from 'sent'
    and o.channel_results #>> '{push,status}' is distinct from 'unknown'
    and o.channel_results #>> '{push,delivered_at}' is null;

  update public.ph_active_request r set
    requested_by=case when r.requested_by=e.old_name then e.new_name else r.requested_by end,
    request_selected_rep_display=case when r.request_selected_rep_display=e.old_name then e.new_name else r.request_selected_rep_display end,
    request_selected_rep_email=case when r.request_selected_rep_email=e.old_email then e.new_email else r.request_selected_rep_email end,
    updated_at=clock_timestamp()
  from pg_temp._salesrep_fix_pending_events e
  where r.unique_id=e.active_unique_id and lower(btrim(coalesce(r.req_status,'')))='pending' and not coalesce(r.req_archived,false);

  for queue_entry in select distinct event_id,old_name,new_name,old_email,new_email,
      salesrepid,customeridentityid,consigneeid
    from pg_temp._salesrep_fix_pending_events loop
    update public.ph_request_delivery_outbox o set
      payload=pg_temp.rewrite_salesrep_queue_json_v1(o.payload,queue_entry.old_name,queue_entry.new_name,queue_entry.old_email,queue_entry.new_email,
        queue_entry.salesrepid,queue_entry.customeridentityid,queue_entry.consigneeid,true),
      updated_at=clock_timestamp()
    where o.event_id=queue_entry.event_id
      and o.payload is distinct from pg_temp.rewrite_salesrep_queue_json_v1(o.payload,queue_entry.old_name,queue_entry.new_name,
        queue_entry.old_email,queue_entry.new_email,queue_entry.salesrepid,queue_entry.customeridentityid,queue_entry.consigneeid,true);
  end loop;

  update public.ph_request_email_threads t set
    sales_rep_name=case when t.sales_rep_name=f.old_name then f.new_name else t.sales_rep_name end,
    sales_rep_email=case when t.sales_rep_email=f.old_email then f.new_email else t.sales_rep_email end,
    recipients=pg_temp.rewrite_salesrep_queue_json_v1(t.recipients,f.old_name,f.new_name,f.old_email,f.new_email,
      f.salesrepid,f.customeridentityid,f.consigneeid,true),
    metadata=pg_temp.rewrite_salesrep_queue_json_v1(t.metadata,f.old_name,f.new_name,f.old_email,f.new_email,
      f.salesrepid,f.customeridentityid,f.consigneeid,true)
  from pg_temp._salesrep_name_fix_map f
  join public.ph_active_request r on btrim(coalesce(r.request_selected_salesrep_id,''))=btrim(f.salesrepid)
    and btrim(coalesce(r.customeridentityid,''))=btrim(f.customeridentityid)
    and btrim(coalesce(r.consigneeidentityid,''))=btrim(f.consigneeid)
  where t.request_folder=r.request_folder
    and (t.sales_rep_name=f.old_name or t.sales_rep_email=f.old_email
      or t.recipients::text like '%'||f.old_email||'%' or t.metadata::text like '%'||f.old_name||'%'
      or t.metadata::text like '%'||f.old_email||'%')
    and t.status in ('open','pending')
    and t.initial_email_sent_at is null and t.last_reply_sent_at is null
    and t.initial_thread_id is null and t.initial_message_id is null
    and t.metadata #>> '{email,status}' is distinct from 'sending'
    and t.metadata #>> '{email,status}' is distinct from 'sent'
    and t.metadata #>> '{email,status}' is distinct from 'unknown'
    and t.metadata #>> '{email,delivered_at}' is null
    and t.metadata #>> '{email,gmail_message_id}' is null
    and not exists(select 1 from public.ph_request_delivery_outbox o
      where o.event_type in ('request_created','request_completed')
        and (o.request_folder=t.request_folder or o.request_id=r.unique_id)
        and (o.status<>'pending' or o.lease_token is not null or o.lease_owner is not null or o.lease_expires_at is not null
          or o.first_attempt_at is not null or o.last_attempt_at is not null or o.attempt_count<>0
          or o.email_delivered_at is not null or o.push_delivered_at is not null or o.delivered_at is not null
          or o.gmail_message_id is not null or o.gmail_thread_id is not null or o.message_id_header is not null
          or o.channel_results #>> '{email,status}' in ('sending','sent','unknown')
          or o.channel_results #>> '{email,delivered_at}' is not null
          or o.channel_results #>> '{email,gmail_message_id}' is not null
          or o.channel_results #>> '{push,status}' in ('sending','sent','unknown')
          or o.channel_results #>> '{push,delivered_at}' is not null))
    and (t.sales_rep_name,t.sales_rep_email,t.recipients,t.metadata) is distinct from
      (case when t.sales_rep_name=f.old_name then f.new_name else t.sales_rep_name end,
       case when t.sales_rep_email=f.old_email then f.new_email else t.sales_rep_email end,
       pg_temp.rewrite_salesrep_queue_json_v1(t.recipients,f.old_name,f.new_name,f.old_email,f.new_email,
         f.salesrepid,f.customeridentityid,f.consigneeid,true),
       pg_temp.rewrite_salesrep_queue_json_v1(t.metadata,f.old_name,f.new_name,f.old_email,f.new_email,
         f.salesrepid,f.customeridentityid,f.consigneeid,true));

  raise notice 'Sales rep name cleanup updated % source rows and % pending delivery events',changed_count,
    (select count(distinct event_id) from pg_temp._salesrep_fix_pending_events);
end
$function$;

select pg_temp.transpose_imported_salesrep_names_v1();
commit;
