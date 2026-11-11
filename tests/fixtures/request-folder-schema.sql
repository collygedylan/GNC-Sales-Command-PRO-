create schema private;
create schema auth;
create table public.ph_requests_pending(
 unique_id text primary key,master_id text,commonname text,contsize text,itemcode text,locationcode text,lotcode text,
 request_folder text,requested_by text,req_customer text,req_qty text,req_status text,date_completed text,
 req_spec text,req_caliper text,req_match text,req_pic_note text,req_comments text,av_note text,
 req_photo_link text,req_photo_name text,photos jsonb,req_archived boolean,
 completed_by_username text,completed_by_display text,completed_by_email text,
 request_created_by_username text,request_created_by_display text,request_created_by_email text,
 request_selected_rep_username text,request_selected_rep_display text,request_selected_rep_email text,
 row_version bigint,created_at timestamptz
);
create table public.ph_requests_completed_history(
 unique_id text primary key,master_id text,commonname text,contsize text,itemcode text,locationcode text,lotcode text,
 request_folder text,requested_by text,req_customer text,req_qty text,req_status text,date_completed timestamptz,
 req_spec text,req_caliper text,req_match text,req_pic_note text,req_comments text,av_note text,
 req_photo_link text,req_photo_name text,photos jsonb,snapshot jsonb,last_event text,
 completed_by_username text,completed_by_display text,completed_by_email text,
 request_created_by_username text,request_created_by_display text,request_created_by_email text,
 request_selected_rep_username text,request_selected_rep_display text,request_selected_rep_email text,
 row_version bigint,created_at timestamptz
);
create table public.ph_request_delivery_outbox(
 event_id uuid primary key default gen_random_uuid(),event_key text unique,event_type text,request_id text,
 request_folder text,payload jsonb,status text,next_attempt_at timestamptz,email_delivered_at timestamptz,
 sanitized_error_code text,created_at timestamptz default now(),updated_at timestamptz default now()
);
create table private.ph_request_folder_delivery_state(
 request_folder text primary key,membership_version bigint,membership_signature text,active_request_ids text[],
 completion_event_key text,last_delivered_version bigint default 0,last_delivered_signature text,updated_at timestamptz
);
create table public.ph_master_inventory(
 unique_id text primary key,itemcode text,locationcode text,lotcode text,photo_link text
);
create table public.ph_location_sales_notes(
 unique_id text primary key,itemcode text,locationcode text,lotcode text,photo_link text
);
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
create function private.upsert_request_history(text,text,text,boolean) returns void language sql as $$
 insert into public.ph_requests_completed_history select
 (jsonb_populate_record(null::public.ph_requests_completed_history,to_jsonb(p)||jsonb_build_object('last_event','completed','date_completed',now()))).*
 from public.ph_requests_pending p where p.unique_id=$1 on conflict(unique_id) do update set last_event='completed',date_completed=now();
$$;
create function private.enqueue_completed_request_email_trg() returns trigger language plpgsql as $$
begin
 if pg_trigger_depth()>1 then return coalesce(new,old); end if;
 if tg_table_name='ph_requests_completed_history' then
  if lower(coalesce(new.last_event,'')) in ('completed','request_completed') then
   perform private.enqueue_completed_request_email_v316(new.unique_id);
  end if;
  return new;
 end if;
 if tg_op='DELETE' then
  if lower(coalesce(old.req_status,'')) in ('complete','completed','done')
   or exists(select 1 from public.ph_requests_completed_history h where h.unique_id=old.unique_id
    and lower(coalesce(h.last_event,'')) in ('completed','request_completed')) then
   perform private.enqueue_completed_request_email_v316(old.unique_id,to_jsonb(old));
  end if;
  return old;
 end if;
 if lower(coalesce(new.req_status,'')) in ('complete','completed','done')
  or nullif(btrim(coalesce(new.date_completed,'')),'') is not null then
  perform private.enqueue_completed_request_email_v316(new.unique_id);
 end if;
 return new;
end$$;
