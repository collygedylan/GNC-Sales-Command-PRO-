begin;

-- Re-arm approved, fully cleared rows in case an older importer falsely
-- acknowledged a shield by suppressing the incoming hold before writing it.
-- This changes only private metadata and the importer hash sentinel.
create or replace function private.rearm_approved_hold_clear_shields_v1()
returns void
language plpgsql security definer set search_path = ''
as $function$
begin
  if private.ph_master_inventory_import_run_v1() is not null then
    raise exception using errcode = '55000', message = 'MASTER_PRIORITY_HOLD_RESEED_DURING_IMPORT';
  end if;
  lock table public.ph_master_inventory in share row exclusive mode;

  insert into app_sync_private.ph_master_inventory_source_baselines(
    canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason
  )
  select m.unique_id, private.ph_master_inventory_lineage_key_v1(to_jsonb(m)),
    m.priority, m.holdstopcode, m.holdstopreason
  from public.ph_master_inventory m
  where m.hold_release_approved_at is not null
    and nullif(btrim(coalesce(m.holdstopcode,'')),'') is null
    and nullif(btrim(coalesce(m.holdstopreason,'')),'') is null
  on conflict (canonical_unique_id) do nothing;

  insert into app_sync_private.ph_master_inventory_app_edits(
    canonical_unique_id, lineage_key, legacy_priority, legacy_holdstopcode,
    legacy_holdstopreason, pending_legacy_sync
  )
  select m.unique_id, b.lineage_key, b.priority, b.holdstopcode, b.holdstopreason, true
  from public.ph_master_inventory m
  join app_sync_private.ph_master_inventory_source_baselines b
    on b.canonical_unique_id = m.unique_id
  where m.hold_release_approved_at is not null
    and nullif(btrim(coalesce(m.holdstopcode,'')),'') is null
    and nullif(btrim(coalesce(m.holdstopreason,'')),'') is null
  on conflict (canonical_unique_id) do update set
    pending_legacy_sync = true,
    revision = app_sync_private.ph_master_inventory_app_edits.revision + 1,
    updated_at = clock_timestamp();

  update public.ph_master_inventory m set
    concat = 'smart-shield-pending:' || encode(extensions.digest(
      convert_to(m.unique_id || ':raw-policy-cutover:' || clock_timestamp()::text,'UTF8'),'sha256'),'hex')
  where m.hold_release_approved_at is not null
    and nullif(btrim(coalesce(m.holdstopcode,'')),'') is null
    and nullif(btrim(coalesce(m.holdstopreason,'')),'') is null
    and exists (
      select 1 from app_sync_private.ph_master_inventory_app_edits s
      where s.canonical_unique_id = m.unique_id
    );
end
$function$;
revoke all on function private.rearm_approved_hold_clear_shields_v1() from public, anon, authenticated, service_role;
select private.rearm_approved_hold_clear_shields_v1();
create or replace function private.guard_ph_master_inventory_priority_hold_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  import_run_id uuid;
  headers jsonb;
  raw_master_tuple boolean := false;
  lineage text;
  current_lineage text;
  state_row app_sync_private.ph_master_inventory_app_edits;
  live_rows integer;
  pending_marker text;
  canonical_master_run boolean := false;
  alias_import boolean := false;
  seen_row app_sync_private.ph_master_inventory_import_lineage_seen;
  baseline_row app_sync_private.ph_master_inventory_source_baselines;
begin
  import_run_id := private.ph_master_inventory_import_run_v1();
  if import_run_id is not null then
    select 'ph_master_inventory' = any(r.canonical_keys) into canonical_master_run
    from app_sync_private.import_runs r where r.id = import_run_id;
    -- The existing helper has already validated service role, active run,
    -- master source membership, and lease before this protocol flag is read.
    if canonical_master_run then
      headers := nullif(current_setting('request.headers', true), '')::jsonb;
      raw_master_tuple := coalesce(headers->>'x-gnc-master-tuple-policy' = 'raw-priority-hold-v1', false);
    end if;
  end if;
  if tg_op = 'DELETE' then
    if canonical_master_run then
      select * into seen_row
      from app_sync_private.ph_master_inventory_import_lineage_seen s
      where s.run_id = import_run_id and s.canonical_unique_id = old.unique_id;
      if seen_row.run_id is not null then
        -- Keep the run-scoped alias marker through retries and later delete
        -- chunks. Prune only expired markers when a new fenced insert arrives.
        return null;
      end if;
    end if;
    delete from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id;
    delete from app_sync_private.ph_master_inventory_source_baselines b
    where b.canonical_unique_id = old.unique_id;
    return old;
  end if;

  lineage := private.ph_master_inventory_lineage_key_v1(to_jsonb(new));
  if tg_op = 'INSERT' then
    if canonical_master_run then
      delete from app_sync_private.ph_master_inventory_import_lineage_seen s
      where s.seen_at < clock_timestamp() - interval '3 days';

      -- Exact IDs are ordinary importer upserts. Only a new ID may resolve to
      -- an existing canonical row by lineage, and that lookup must be unique.
      if not exists(select 1 from public.ph_master_inventory m where m.unique_id = new.unique_id) then
        select count(*) into live_rows
        from app_sync_private.ph_master_inventory_source_baselines b
        join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
        where b.lineage_key = lineage;
        if live_rows > 1 then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        elsif live_rows = 1 then
          select b.canonical_unique_id into current_lineage
          from app_sync_private.ph_master_inventory_source_baselines b
          join public.ph_master_inventory m on m.unique_id = b.canonical_unique_id
          where b.lineage_key = lineage
          limit 1 for update of m;
          select * into seen_row
          from app_sync_private.ph_master_inventory_import_lineage_seen s
          where s.run_id = import_run_id and s.canonical_unique_id = current_lineage;
          if seen_row.run_id is not null and seen_row.imported_unique_id <> new.unique_id then
            raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
          end if;
          insert into app_sync_private.ph_master_inventory_import_lineage_seen(
            run_id, canonical_unique_id, imported_unique_id, lineage_key
          ) values (import_run_id, current_lineage, new.unique_id, lineage)
          on conflict (run_id, canonical_unique_id) do update set
            imported_unique_id = case
              when app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id
                then excluded.imported_unique_id
              else app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id
            end,
            seen_at = clock_timestamp()
          where app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id;
          if not found then
            raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
          end if;
          new.unique_id := current_lineage;
        end if;
      else
        -- An exact-UID import is not an alias, but recording it prevents a
        -- later changed UID with the same lineage from being silently merged.
        select * into seen_row
        from app_sync_private.ph_master_inventory_import_lineage_seen s
        where s.run_id = import_run_id and s.canonical_unique_id = new.unique_id;
        if seen_row.run_id is not null and seen_row.imported_unique_id <> new.unique_id then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        end if;
        insert into app_sync_private.ph_master_inventory_import_lineage_seen(
          run_id, canonical_unique_id, imported_unique_id, lineage_key
        ) values (import_run_id, new.unique_id, new.unique_id, lineage)
        on conflict (run_id, canonical_unique_id) do update set seen_at = clock_timestamp()
        where app_sync_private.ph_master_inventory_import_lineage_seen.imported_unique_id = excluded.imported_unique_id;
        if not found then
          raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
        end if;
      end if;
      insert into app_sync_private.ph_master_inventory_source_baselines(
        canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason, import_run_id
      ) values (
        new.unique_id, lineage, new.priority, new.holdstopcode, new.holdstopreason, import_run_id
      ) on conflict (canonical_unique_id) do update set
        lineage_key = excluded.lineage_key,
        priority = excluded.priority,
        holdstopcode = excluded.holdstopcode,
        holdstopreason = excluded.holdstopreason,
        imported_at = clock_timestamp(),
        import_run_id = excluded.import_run_id;
    elsif import_run_id is not null then
      -- Fenced auxiliary reconciliation may update master rows as a dependent
      -- source, but it neither acknowledges the DriveAround tuple nor creates
      -- an app-edit shield. Preserve these fields exactly on existing rows.
      return new;
    end if;
    return new;
  end if;

  current_lineage := private.ph_master_inventory_lineage_key_v1(to_jsonb(old));
  if import_run_id is not null then
    if not canonical_master_run then
      new.priority := old.priority;
      new.holdstopcode := old.holdstopcode;
      new.holdstopreason := old.holdstopreason;
      return new;
    end if;
    select coalesce(s.imported_unique_id <> old.unique_id, false) into alias_import
    from app_sync_private.ph_master_inventory_import_lineage_seen s
    where s.run_id = import_run_id and s.canonical_unique_id = old.unique_id;
    insert into app_sync_private.ph_master_inventory_source_baselines(
      canonical_unique_id, lineage_key, priority, holdstopcode, holdstopreason, import_run_id
    ) values (
      old.unique_id, lineage, new.priority, new.holdstopcode, new.holdstopreason, import_run_id
    ) on conflict (canonical_unique_id) do update set
      lineage_key = excluded.lineage_key,
      priority = excluded.priority,
      holdstopcode = excluded.holdstopcode,
      holdstopreason = excluded.holdstopreason,
      imported_at = clock_timestamp(),
      import_run_id = excluded.import_run_id;
    select * into state_row
    from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id
    for update;
    if state_row.canonical_unique_id is not null then
      if state_row.lineage_key <> current_lineage then
        raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_CHANGED';
      end if;
      update app_sync_private.ph_master_inventory_app_edits s set
        legacy_priority = new.priority,
        legacy_holdstopcode = new.holdstopcode,
        legacy_holdstopreason = new.holdstopreason,
        pending_legacy_sync = case when s.pending_legacy_sync
          then not (
            raw_master_tuple
            and new.priority is not distinct from old.priority
            and new.holdstopcode is not distinct from old.holdstopcode
            and new.holdstopreason is not distinct from old.holdstopreason
          )
          else false end,
        revision = s.revision + 1,
        updated_at = clock_timestamp()
      where s.canonical_unique_id = state_row.canonical_unique_id
      returning * into state_row;
      if state_row.pending_legacy_sync then
        new.priority := old.priority;
        new.holdstopcode := old.holdstopcode;
        new.holdstopreason := old.holdstopreason;
        new.concat := 'smart-shield-pending:' || encode(extensions.digest(convert_to(
          old.unique_id || ':' || current_lineage || ':' || clock_timestamp()::text, 'UTF8'), 'sha256'), 'hex');
        -- Code.gs clears these app-owned evidence fields before writing a
        -- newly introduced blocking hold. If that hold is blocked by the
        -- shield, the clear must be rolled back with the hold transition.
        new.date_completed := old.date_completed;
        new.av_note := old.av_note;
        new.sales_note := old.sales_note;
        new.match := old.match;
        new.spec := old.spec;
        new.caliper := old.caliper;
        new.pic_note := old.pic_note;
        new.loc_match_qty := old.loc_match_qty;
        new.initial_ptr := old.initial_ptr;
        new.photo_link := old.photo_link;
        new.photo_name := old.photo_name;
      end if;
    end if;
    if alias_import then
      -- Code.gs cannot find an old row after priority changes the source UID.
      -- Mirror its app-owned merge against the canonical row, while preserving
      -- its existing new-blocking-hold clear policy.
      if not (
        coalesce(old.holdstopcode, '') !~* '[HS]'
        and coalesce(new.holdstopcode, '') ~* '[HS]'
      ) then
        if nullif(nullif(btrim(old.date_completed::text), ''), 'NULL') is not null then new.date_completed := old.date_completed; end if;
        if nullif(nullif(btrim(old.app_tab_assignment::text), ''), 'NULL') is not null then new.app_tab_assignment := old.app_tab_assignment; end if;
        if nullif(nullif(btrim(old.av_note::text), ''), 'NULL') is not null then new.av_note := old.av_note; end if;
        if nullif(nullif(btrim(old.sales_note::text), ''), 'NULL') is not null then new.sales_note := old.sales_note; end if;
        if nullif(nullif(btrim(old.match::text), ''), 'NULL') is not null then new.match := old.match; end if;
        if nullif(nullif(btrim(old.spec::text), ''), 'NULL') is not null then new.spec := old.spec; end if;
        if nullif(nullif(btrim(old.caliper::text), ''), 'NULL') is not null then new.caliper := old.caliper; end if;
        if nullif(nullif(btrim(old.pic_note::text), ''), 'NULL') is not null then new.pic_note := old.pic_note; end if;
        if nullif(nullif(btrim(old.loc_match_qty::text), ''), 'NULL') is not null then new.loc_match_qty := old.loc_match_qty; end if;
        if nullif(nullif(btrim(old.initial_ptr::text), ''), 'NULL') is not null then new.initial_ptr := old.initial_ptr; end if;
        if nullif(nullif(btrim(old.photo_link::text), ''), 'NULL') is not null then new.photo_link := old.photo_link; end if;
        if nullif(nullif(btrim(old.photo_name::text), ''), 'NULL') is not null then new.photo_name := old.photo_name; end if;
        if nullif(nullif(btrim(old.hold_release_approved_at::text), ''), 'NULL') is not null then new.hold_release_approved_at := old.hold_release_approved_at; end if;
        if nullif(nullif(btrim(old.hold_release_approved_by::text), ''), 'NULL') is not null then new.hold_release_approved_by := old.hold_release_approved_by; end if;
        if nullif(nullif(btrim(old.hold_release_approved_by_display::text), ''), 'NULL') is not null then new.hold_release_approved_by_display := old.hold_release_approved_by_display; end if;
        if nullif(nullif(btrim(old.hold_release_approved_holdstopbegindate::text), ''), 'NULL') is not null then new.hold_release_approved_holdstopbegindate := old.hold_release_approved_holdstopbegindate; end if;
      else
        new.date_completed := null;
        new.av_note := null;
        new.sales_note := null;
        new.match := null;
        new.spec := null;
        new.caliper := null;
        new.pic_note := null;
        new.loc_match_qty := null;
        new.initial_ptr := null;
        new.photo_link := null;
        new.photo_name := null;
      end if;
      -- The import builder keeps an existing assignment when the source omits it.
      if nullif(nullif(btrim(new.assignedto::text), ''), 'NULL') is null
         and nullif(nullif(btrim(old.assignedto::text), ''), 'NULL') is not null then
        new.assignedto := old.assignedto;
      end if;
    end if;
    return new;
  end if;

  if new.unique_id is distinct from old.unique_id then
    raise exception using errcode = '42501', message = 'MASTER_PRIORITY_HOLD_IDENTITY_IMMUTABLE';
  end if;
  if new.priority is distinct from old.priority
     or new.holdstopcode is distinct from old.holdstopcode
     or new.holdstopreason is distinct from old.holdstopreason then
    select * into state_row
    from app_sync_private.ph_master_inventory_app_edits s
    where s.canonical_unique_id = old.unique_id
    for update;
    if state_row.canonical_unique_id is null then
      select * into baseline_row
      from app_sync_private.ph_master_inventory_source_baselines b
      where b.canonical_unique_id = old.unique_id;
      insert into app_sync_private.ph_master_inventory_source_baselines(
        canonical_unique_id,lineage_key,priority,holdstopcode,holdstopreason
      ) values (
        old.unique_id,current_lineage,old.priority,old.holdstopcode,old.holdstopreason
      ) on conflict (canonical_unique_id) do nothing;
      insert into app_sync_private.ph_master_inventory_app_edits(
        canonical_unique_id, lineage_key, legacy_priority, legacy_holdstopcode, legacy_holdstopreason,
        pending_legacy_sync
      ) values (
        old.unique_id, current_lineage,
        coalesce(baseline_row.priority, old.priority),
        coalesce(baseline_row.holdstopcode, old.holdstopcode),
        coalesce(baseline_row.holdstopreason, old.holdstopreason), true
      ) returning * into state_row;
    else
      if state_row.lineage_key is distinct from current_lineage then
        raise exception using errcode = '40001', message = 'MASTER_PRIORITY_HOLD_LINEAGE_AMBIGUOUS';
      end if;
        update app_sync_private.ph_master_inventory_app_edits s set
        pending_legacy_sync = true,
        revision = s.revision + 1,
        updated_at = clock_timestamp()
      where s.canonical_unique_id = old.unique_id
      returning * into state_row;
    end if;
    pending_marker := 'smart-shield-pending:' || encode(extensions.digest(convert_to(
      new.unique_id || ':' || lineage || ':' || clock_timestamp()::text, 'UTF8'), 'sha256'), 'hex');
    new.concat := pending_marker;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_ph_master_inventory_priority_hold_v1() from public, anon, authenticated, service_role;
drop trigger if exists aaa_ph_master_inventory_priority_hold_shield on public.ph_master_inventory;
create trigger aaa_ph_master_inventory_priority_hold_shield
before insert or update or delete on public.ph_master_inventory
for each row execute function private.guard_ph_master_inventory_priority_hold_v1();

commit;
