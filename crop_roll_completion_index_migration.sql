create table if not exists public.v2_crop_roll_completion_index (
  row_id text primary key references public.v2_crop_roll_rows(row_id) on delete cascade,
  master_unique_id text not null,
  source_view text not null default 'sy27',
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_v2_crop_roll_completion_index_view_uid
  on public.v2_crop_roll_completion_index (source_view, master_unique_id);

create index if not exists idx_v2_crop_roll_completion_index_view_updated
  on public.v2_crop_roll_completion_index (source_view, updated_at desc);

create index if not exists idx_v2_crop_roll_rows_live_completion_identity
  on public.v2_crop_roll_rows (run_id, row_status, master_unique_id)
  where run_id = 'CR-LIVE-COMPLETIONS' and row_status = 'complete';

create or replace function public.v2_crop_roll_completion_source_view(row_metadata jsonb, original_lot text, original_season text)
returns text
language plpgsql
immutable
as $$
declare
  raw_view text;
  raw_salesyear text;
begin
  raw_view := lower(trim(coalesce(
    row_metadata->>'completion_source_view',
    row_metadata->>'crop_roll_source_view',
    ''
  )));

  if raw_view in ('carryover', 'carry-over', 'co', 'caryover') then
    return 'carryover';
  end if;

  if raw_view in ('sy27', 'sy-27', 'sy 27') then
    return 'sy27';
  end if;

  raw_salesyear := trim(coalesce(
    row_metadata->>'original_salesyear',
    row_metadata->>'salesyear',
    row_metadata #>> '{original_values,salesyear}',
    row_metadata #>> '{original_values,SALEYEAR}',
    ''
  ));

  if raw_salesyear like '%27%' then
    return 'sy27';
  end if;

  if upper(trim(coalesce(original_season, ''))) = '27' then
    return 'sy27';
  end if;

  if trim(coalesce(original_lot, '')) like '27.%' then
    return 'sy27';
  end if;

  return 'carryover';
end;
$$;

create or replace function public.v2_crop_roll_completion_index_sync()
returns trigger
language plpgsql
as $$
declare
  row_record public.v2_crop_roll_rows%rowtype;
begin
  if tg_op = 'DELETE' then
    delete from public.v2_crop_roll_completion_index where row_id = old.row_id;
    return old;
  end if;

  row_record := new;

  if row_record.run_id = 'CR-LIVE-COMPLETIONS'
     and row_record.row_status = 'complete'
     and row_record.master_unique_id is not null
     and trim(row_record.master_unique_id) <> '' then
    insert into public.v2_crop_roll_completion_index (
      row_id,
      master_unique_id,
      source_view,
      completed_at,
      updated_at
    )
    values (
      row_record.row_id,
      row_record.master_unique_id,
      public.v2_crop_roll_completion_source_view(row_record.metadata, row_record.original_lotcode, row_record.original_season),
      row_record.completed_at,
      coalesce(row_record.updated_at, row_record.completed_at, now())
    )
    on conflict (row_id) do update set
      master_unique_id = excluded.master_unique_id,
      source_view = excluded.source_view,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at;
  else
    delete from public.v2_crop_roll_completion_index where row_id = row_record.row_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_v2_crop_roll_completion_index_sync on public.v2_crop_roll_rows;

create trigger trg_v2_crop_roll_completion_index_sync
after insert or update or delete on public.v2_crop_roll_rows
for each row execute function public.v2_crop_roll_completion_index_sync();

insert into public.v2_crop_roll_completion_index (
  row_id,
  master_unique_id,
  source_view,
  completed_at,
  updated_at
)
select
  row_id,
  master_unique_id,
  public.v2_crop_roll_completion_source_view(metadata, original_lotcode, original_season),
  completed_at,
  coalesce(updated_at, completed_at, now())
from public.v2_crop_roll_rows
where run_id = 'CR-LIVE-COMPLETIONS'
  and row_status = 'complete'
  and master_unique_id is not null
  and trim(master_unique_id) <> ''
on conflict (row_id) do update set
  master_unique_id = excluded.master_unique_id,
  source_view = excluded.source_view,
  completed_at = excluded.completed_at,
  updated_at = excluded.updated_at;
