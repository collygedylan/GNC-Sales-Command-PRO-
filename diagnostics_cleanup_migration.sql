begin;

alter table if exists public.v2_ml_image_jobs
    add column if not exists hidden_from_action_queue boolean not null default false,
    add column if not exists duplicate_of_unique_id text,
    add column if not exists diagnostic_group_key text;

with normalized as (
    select
        unique_id,
        md5(concat_ws('|',
            coalesce(itemcode, ''),
            coalesce(common_name, ''),
            coalesce(contsize, ''),
            coalesce(locationcode, ''),
            coalesce(lotcode, ''),
            coalesce(source_table, ''),
            coalesce(source_unique_id, '')
        )) as group_key
    from public.v2_ml_image_jobs
)
update public.v2_ml_image_jobs job
set diagnostic_group_key = normalized.group_key
from normalized
where job.unique_id = normalized.unique_id
  and coalesce(job.diagnostic_group_key, '') is distinct from normalized.group_key;

with ranked as (
    select
        unique_id,
        image_bucket,
        image_path,
        first_value(unique_id) over (
            partition by image_bucket, image_path
            order by created_at asc nulls last, unique_id asc
        ) as keeper_unique_id,
        row_number() over (
            partition by image_bucket, image_path
            order by created_at asc nulls last, unique_id asc
        ) as duplicate_rank
    from public.v2_ml_image_jobs
    where coalesce(image_bucket, '') <> ''
      and coalesce(image_path, '') <> ''
)
update public.v2_ml_image_jobs job
set
    hidden_from_action_queue = true,
    duplicate_of_unique_id = ranked.keeper_unique_id,
    last_error = coalesce(nullif(job.last_error, ''), 'Duplicate exact image job hidden from Diagnostics queue.')
from ranked
where job.unique_id = ranked.unique_id
  and ranked.duplicate_rank > 1;

update public.v2_ml_image_jobs
set
    hidden_from_action_queue = true,
    last_error = coalesce(nullif(last_error, ''), 'Required after diagnostics model training.')
where status in ('pending_ml', 'pending_approval')
  and (
      lower(coalesce(last_error, '')) like '%required after diagnostics model training%'
      or lower(coalesce(last_error, '')) like '%no diagnostics model%'
      or lower(coalesce(recommended_treatment, '')) like '%no diagnostics model%'
  );

drop index if exists public.idx_v2_ml_image_jobs_unique_image_active;

create unique index if not exists idx_v2_ml_image_jobs_unique_image_active
    on public.v2_ml_image_jobs (image_bucket, image_path)
    where coalesce(image_bucket, '') <> ''
      and coalesce(image_path, '') <> ''
      and duplicate_of_unique_id is null;

create index if not exists idx_v2_ml_image_jobs_diag_group_status
    on public.v2_ml_image_jobs (diagnostic_group_key, status, updated_at desc);

create index if not exists idx_v2_ml_image_jobs_hidden_status
    on public.v2_ml_image_jobs (hidden_from_action_queue, status, updated_at desc);

commit;
