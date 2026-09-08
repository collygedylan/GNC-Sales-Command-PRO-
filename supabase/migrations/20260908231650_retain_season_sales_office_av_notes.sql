begin;

-- The Season Sales Office note belongs to its staged winner, not to the
-- replaceable inventory/CAV evidence. NULL is an intentional saved blank.
alter table public.ph_season_sales_office_state
  add column retained_av_note text,
  add column retained_av_note_at timestamptz;

with snapshots as (
  select state.id, case
      when state.status = 'open' and sales.unique_id is not null
        then sales.av_note
      else master.av_note
    end as av_note
  from public.ph_season_sales_office_state state
  left join public.ph_master_inventory master on master.unique_id = state.winner_unique_id
  left join public.ph_sales_office sales
    on sales.unique_id = state.winner_unique_id
    and lower(btrim(coalesce(sales.so_source, 'season'))) = 'season'
)
update public.ph_season_sales_office_state state
set retained_av_note = snapshots.av_note, retained_av_note_at = now()
from snapshots
where snapshots.id = state.id;

alter table public.ph_season_sales_office_state
  alter column retained_av_note_at set not null;

create or replace function private.capture_season_sales_av_note_v1()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.winner_unique_id is distinct from old.winner_unique_id then
    select master.av_note into new.retained_av_note
    from public.ph_master_inventory master
    where master.unique_id = new.winner_unique_id;
    new.retained_av_note_at := now();
  end if;
  return new;
end
$function$;

create trigger capture_season_sales_av_note
before insert or update of winner_unique_id
on public.ph_season_sales_office_state
for each row execute function private.capture_season_sales_av_note_v1();

revoke all on function private.capture_season_sales_av_note_v1()
  from public, anon, authenticated;

-- Preserve the deployed reconciliation, arrival-time, completion and security
-- contracts. Fail atomically if a target has drifted instead of partially
-- installing note retention over an unfamiliar function body.
do $repair$
declare
  definition text;
  before_text text;
  after_text text;
begin
  definition := pg_get_functiondef(
    'private.season_sales_mirror_winner_v1(public.ph_master_inventory,public.ph_season_sales_office_state)'::regprocedure
  );
  before_text := 'p_winner.av_note, p_winner.sales_note';
  after_text := 'p_state.retained_av_note, p_winner.sales_note';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_MIRROR_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);

  definition := pg_get_functiondef(
    'public.reconcile_season_sales_office_v1(text[],boolean,text,text)'::regprocedure
  );
  before_text := 'private.season_sales_evidence_v1(to_jsonb(m))';
  after_text := 'private.season_sales_evidence_v1(to_jsonb(m) || jsonb_build_object(''av_note'', state.retained_av_note))';
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_DRY_RUN_PATCH_FAILED';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := 'evidence := private.season_sales_evidence_v1(to_jsonb(winner));';
  after_text := $body$if state_row.id is not null and state_row.winner_unique_id = winner.unique_id then
      winner.av_note := state_row.retained_av_note;
    end if;
    evidence := private.season_sales_evidence_v1(to_jsonb(winner));$body$;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_RECONCILE_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);

  definition := pg_get_functiondef(
    'public.save_season_sales_office_av_note_v1(text,text,integer,text,text)'::regprocedure
  );
  before_text := 'where state.winner_unique_id = btrim(p_master_id) and state.status = ''open''';
  after_text := $body$where state.winner_unique_id = btrim(p_master_id) and state.status = 'open'
    and state.season_code = upper(btrim(coalesce(private.season_sales_settings_v1()->>'seasonCode', '')))
    and state.sales_year = private.season_sales_year_v1(private.season_sales_settings_v1()->>'salesYear')$body$;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_SCOPE_PATCH_FAILED';
  end if;
  definition := replace(definition, before_text, after_text);
  before_text := 'revision = state.revision + 1, readiness_status = evidence->>''status'',';
  after_text := $body$retained_av_note = winner.av_note, retained_av_note_at = now(),
    revision = state.revision + 1, readiness_status = evidence->>'status',$body$;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_SAVE_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);

  definition := pg_get_functiondef(
    'public.complete_season_sales_office_v1(text,text,integer,text)'::regprocedure
  );
  before_text := 'evidence := private.season_sales_evidence_v1(to_jsonb(winner));';
  after_text := $body$winner.av_note := state_row.retained_av_note;
      evidence := private.season_sales_evidence_v1(to_jsonb(winner));$body$;
  if (length(definition) - length(replace(definition, before_text, ''))) / length(before_text) <> 1 then
    raise exception 'SEASON_SALES_NOTE_COMPLETE_PATCH_FAILED';
  end if;
  execute replace(definition, before_text, after_text);
end
$repair$;

commit;
