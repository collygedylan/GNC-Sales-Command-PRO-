begin;

-- Completion delivery reuses the existing immutable preview + outbox and the
-- existing signed Apps Script sender. This trigger only observes a transition
-- to complete; it never writes inventory or accepts recipient/PDF data from a
-- field-worker command.
create function bunch_note_private.queue_completed_work_delivery()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  source_preview bunch_note_private.previews;
  report_preview bunch_note_private.previews;
  batch_value bunch_note_private.batches;
  report_value jsonb;
  report_cards jsonb;
  event_id_value uuid;
  completion_revision bigint;
begin
  if old.status is not distinct from new.status or new.status <> 'complete' then
    return new;
  end if;

  -- The legacy whole-job command writes status and increments revision in two
  -- statements. Its wrapper marks that narrow call so this trigger freezes
  -- against the revision the command returns. Card-based completion updates
  -- status and revision together and therefore uses NEW.revision directly.
  completion_revision := new.revision + case
    when coalesce(current_setting('bunch_note.legacy_completion_revision_pending',true),'')='on' then 1
    else 0
  end;

  -- Use the recipient snapshot from the published instruction revision. It
  -- already includes the mandatory Dylan recipient and stays stable if the
  -- directory changes while field work is underway.
  select preview.* into source_preview
  from bunch_note_private.versions version
  join bunch_note_private.previews preview on preview.id=version.preview_id
  where version.job_id=new.id
    and preview.published
    and preview.report_kind='instructions'
  order by version.instruction_revision desc
  limit 1;
  if source_preview.id is null then
    -- A job without a published instruction snapshot is malformed/legacy
    -- data. Do not make completing the work depend on a recipient lookup.
    return new;
  end if;

  select * into batch_value from bunch_note_private.batches where id=new.batch_id;
  if batch_value.id is null then
    raise exception 'BUNCH_NOTE_BATCH_NOT_FOUND';
  end if;

  -- The unique partial index on (job_id, job_revision) is a second guard in
  -- addition to the transition predicate and deterministic event key.
  if exists (
    select 1 from bunch_note_private.previews prior
    where prior.job_id=new.id and prior.job_revision=completion_revision
      and prior.report_kind='completed_work' and prior.published
  ) then
    return new;
  end if;

  select coalesce(job_json->'cards','[]'::jsonb) into report_cards
  from (select bunch_note_private.card_safe_job(new,new.created_by) as job_json) safe_job;

  report_value := new.body || jsonb_build_object(
    'job_id',new.id,
    'report_kind','completed_work',
    'work_revision',completion_revision,
    'instruction_revision',new.instruction_revision,
    'note_number',new.note_number,
    'block',new.block,
    'location',new.location,
    'actions',bunch_note_private.actions(new),
    'cards',report_cards,
    'source',bunch_note_private.work_source(new),
    'actuals',bunch_note_private.actual_history(new.id),
    'progress',new.progress,
    'owner_id',new.owner_id,
    'owner_name',(select profile.display_name from public.profiles profile where profile.id=new.owner_id),
    'recorded_at',statement_timestamp()
  );
  report_value := bunch_note_private.structured_note(report_value);

  insert into bunch_note_private.previews(
    id,batch_id,created_by,batch_revision,reports,recipients,
    report_kind,job_id,job_revision,expires_at,published,delivery_status
  ) values (
    gen_random_uuid(),new.batch_id,new.created_by,batch_value.revision,
    jsonb_build_array(report_value),source_preview.recipients,
    'completed_work',new.id,completion_revision,'infinity'::timestamptz,true,'queued'
  ) returning * into report_preview;

  insert into public.ph_request_delivery_outbox(event_key,event_type,payload,delivery_mode)
  values (
    'bunch-note-auto-completion:'||new.id::text||':'||completion_revision::text,
    'bunch_note_submission',
    jsonb_build_object('preview_id',report_preview.id,'report_kind','completed_work','automatic_completion',true),
    'email'
  ) returning event_id into event_id_value;

  update bunch_note_private.previews
  set event_id=event_id_value
  where id=report_preview.id;

  return new;
end $$;

revoke all on function bunch_note_private.queue_completed_work_delivery() from public,anon,authenticated,service_role;

create trigger bunch_note_auto_completion_delivery
after update of status on bunch_note_private.jobs
for each row execute function bunch_note_private.queue_completed_work_delivery();

-- The Apps Script worker renders and freezes the PDF after claiming the event.
-- Permit that one service-side freeze for a published automatic completion
-- report; every other published or expired preview remains immutable.
create or replace function public.bunch_note_freeze_pdfs_v1(p_preview_id uuid,p_pdfs jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare p bunch_note_private.previews; f jsonb; total bigint:=0; automatic_pending boolean;
begin
 if not private.is_service_role_request() then raise exception 'BUNCH_NOTE_FORBIDDEN' using errcode='42501'; end if;
 select * into p from bunch_note_private.previews where id=p_preview_id for update;
 if not found then raise exception 'BUNCH_NOTE_PREVIEW_EXPIRED'; end if;
 select exists(
   select 1 from public.ph_request_delivery_outbox event
   where event.event_id=p.event_id
     and event.event_type='bunch_note_submission'
     and event.status in ('pending','processing')
     and event.payload->>'preview_id'=p.id::text
     and event.payload->>'automatic_completion'='true'
     and p.published and p.report_kind='completed_work'
 ) into automatic_pending;
 if p.pdfs is not null then
  if p.published and not automatic_pending then raise exception 'BUNCH_NOTE_PREVIEW_EXPIRED'; end if;
  return jsonb_build_object('pdfs',p.pdfs);
 end if;
 if p.expires_at<=now() or (p.published and not automatic_pending) then
  raise exception 'BUNCH_NOTE_PREVIEW_EXPIRED';
 end if;
 if jsonb_typeof(p_pdfs) is distinct from 'array' or jsonb_array_length(p_pdfs)<>jsonb_array_length(p.reports) then raise exception 'BUNCH_NOTE_PDF_INVALID'; end if;
 for f in select value from jsonb_array_elements(p_pdfs) loop
  if not exists(select 1 from jsonb_array_elements(p.reports) r where r->>'job_id'=f->>'job_id')
   or left(f->>'base64',7)<>'JVBERi0' or length(f->>'base64')<100 then raise exception 'BUNCH_NOTE_PDF_INVALID'; end if;
  total:=total+octet_length(decode(f->>'base64','base64'));
 end loop;
 if (select count(distinct pdf_value->>'job_id') from jsonb_array_elements(p_pdfs) pdf_value)<>jsonb_array_length(p.reports) then raise exception 'BUNCH_NOTE_PDF_INVALID'; end if;
 if total>15000000 then raise exception 'BUNCH_NOTE_BATCH_TOO_LARGE_SELECT_FEWER_LOCATIONS'; end if;
 update bunch_note_private.previews set pdfs=p_pdfs where id=p.id;
 return jsonb_build_object('pdfs',p_pdfs);
end $$;

-- Include the preview key in the service-only delivery lookup so the Apps
-- Script worker can freeze a PDF generated for an automatic completion.
create or replace function public.bunch_note_delivery_lookup_v1(p_event_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare e public.ph_request_delivery_outbox; p bunch_note_private.previews;
begin
 if not private.is_service_role_request() then raise exception 'BUNCH_NOTE_FORBIDDEN' using errcode='42501'; end if;
 select * into e from public.ph_request_delivery_outbox where event_id=p_event_id and event_type='bunch_note_submission';
 select * into p from bunch_note_private.previews where event_id=p_event_id and published;
 if e.event_id is null or p.id is null or e.payload->>'preview_id'<>p.id::text then raise exception 'BUNCH_NOTE_DELIVERY_INVALID'; end if;
 perform bunch_note_private.actor(p.created_by);
 return jsonb_build_object('event_id',e.event_id,'event_key',e.event_key,'event_type',e.event_type,
  'preview_id',p.id,'created_by',p.created_by,'reports',p.reports,'pdfs',p.pdfs,'recipients',p.recipients,
  'receipt',e.channel_results->'email','delivery_status',coalesce(e.channel_results->'email'->>'status','pending'));
end $$;

-- Once an automatic report is published for a completed revision, an author
-- may still make a manual preview, but publishing that same revision reuses
-- the automatic event instead of creating a duplicate email/version.
create or replace function public.bunch_note_command_v1(
 p_actor_id uuid,p_operation text,p_payload jsonb default '{}'::jsonb,
 p_command_id uuid default null,p_expected_revision bigint default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 actor public.profiles;
 job bunch_note_private.jobs;
 requested bunch_note_private.previews;
 automatic bunch_note_private.previews;
 old_mode text;
 result jsonb;
begin
 if p_operation in ('list','get','pdf','destinations','destination_detail','destination_lookup','work_pdf','cancel',
  'assign_card','claim_card','release_card','complete_card') then
  return bunch_note_private.invoke_card_command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
 end if;
 if p_operation in ('progress','actual','add_action','option_add','assign','claim','release','complete')
  and nullif(p_payload->>'job_id','') is not null then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if found and coalesce((job.body->>'format_version')::integer,0)>=5 then
   if p_operation in ('progress','actual','add_action','option_add') then
    if nullif(p_payload->>'card_id','') is null then raise exception 'BUNCH_NOTE_CARD_ID_REQUIRED'; end if;
    return bunch_note_private.invoke_card_command(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
   end if;
   raise exception 'BUNCH_NOTE_CARD_OPERATION_REQUIRED';
  end if;
 end if;
 if p_operation='work_publish' then
  actor:=bunch_note_private.actor(p_actor_id);
  if actor.username='dylan_collyge' then
   select * into requested from bunch_note_private.previews
    where id=(p_payload->>'preview_id')::uuid for update;
   if found and requested.report_kind='completed_work' and requested.job_id is not null
      and requested.created_by=actor.id and not requested.published and requested.pdfs is not null
      and requested.expires_at>now() then
    select * into job from bunch_note_private.jobs where id=requested.job_id for update;
    if not found or job.status<>'complete' or job.revision is distinct from p_expected_revision
       or job.revision<>requested.job_revision then raise exception 'BUNCH_NOTE_REVISION_CONFLICT'; end if;
    if requested.recipients is distinct from bunch_note_private.recipients(
      (select coalesce(jsonb_agg(recipient->'profile_id'),'[]'::jsonb)
       from jsonb_array_elements(requested.recipients) recipient)
    ) then raise exception 'BUNCH_NOTE_RECIPIENT_CHANGED'; end if;
    select preview.* into automatic
    from bunch_note_private.previews preview
    join public.ph_request_delivery_outbox event on event.event_id=preview.event_id
    where preview.job_id=job.id and preview.job_revision=job.revision
      and preview.report_kind='completed_work' and preview.published
      and event.event_type='bunch_note_submission'
      and event.event_key='bunch-note-auto-completion:'||job.id::text||':'||job.revision::text
      and event.payload->>'preview_id'=preview.id::text;
    if automatic.id is not null then
      return jsonb_build_object('published',true,'preview_id',automatic.id,'event_id',automatic.event_id,'already_published',true);
    end if;
   end if;
  end if;
 end if;
 if p_operation in ('save','preview','publish','revise') then
  actor:=bunch_note_private.actor(p_actor_id);
  if actor.username='dylan_collyge' then
   old_mode:=coalesce(current_setting('bunch_note.card_command',true),'');
   perform set_config('bunch_note.card_command','on',true);
   result:=bunch_note_private.bunch_note_command_legacy(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
   perform set_config('bunch_note.card_command',old_mode,true);
   return result;
  end if;
 end if;
 if p_operation='complete' and nullif(p_payload->>'job_id','') is not null then
  select * into job from bunch_note_private.jobs where id=(p_payload->>'job_id')::uuid;
  if found and coalesce((job.body->>'format_version')::integer,0)<5 then
   old_mode:=coalesce(current_setting('bunch_note.legacy_completion_revision_pending',true),'');
   perform set_config('bunch_note.legacy_completion_revision_pending','on',true);
   result:=bunch_note_private.bunch_note_command_legacy(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
   perform set_config('bunch_note.legacy_completion_revision_pending',old_mode,true);
   return result;
  end if;
 end if;
 return bunch_note_private.bunch_note_command_legacy(p_actor_id,p_operation,p_payload,p_command_id,p_expected_revision);
end $$;

revoke all on function public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint),
 public.bunch_note_delivery_lookup_v1(uuid),public.bunch_note_freeze_pdfs_v1(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.bunch_note_command_v1(uuid,text,jsonb,uuid,bigint),
 public.bunch_note_delivery_lookup_v1(uuid),public.bunch_note_freeze_pdfs_v1(uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;
