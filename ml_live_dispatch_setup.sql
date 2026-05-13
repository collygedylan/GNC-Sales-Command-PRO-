-- Optional near-live ML dispatch trigger.
-- Replace the two placeholders below before running this file:
--   1. REPLACE_WITH_PROJECT_REF, for example kzrnyjsosryejjejliii
--   2. REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET, the same value set as ML_DISPATCH_SECRET on the ml-dispatch Edge Function.
--
-- This trigger wakes the GitHub Actions ML worker when a pending ML photo job
-- or pending disease training asset is inserted. The scheduled worker remains
-- as a backup if GitHub is temporarily slow.

create extension if not exists pg_net with schema extensions;

create or replace function public.v2_dispatch_ml_worker_for_image_job()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dispatch_url text := 'https://REPLACE_WITH_PROJECT_REF.supabase.co/functions/v1/ml-dispatch';
  dispatch_secret text := 'REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET';
  request_id bigint;
begin
  if coalesce(new.status, '') <> 'pending_ml' then
    return new;
  end if;

  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := jsonb_build_object(
      'source', 'v2_ml_image_jobs',
      'event_type', 'ml-photo-created',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  )
  into request_id;

  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists trg_v2_dispatch_ml_worker_for_image_job on public.v2_ml_image_jobs;
create trigger trg_v2_dispatch_ml_worker_for_image_job
after insert or update of status on public.v2_ml_image_jobs
for each row
execute function public.v2_dispatch_ml_worker_for_image_job();

create or replace function public.v2_dispatch_ml_worker_for_disease_asset()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  dispatch_url text := 'https://REPLACE_WITH_PROJECT_REF.supabase.co/functions/v1/ml-dispatch';
  dispatch_secret text := 'REPLACE_WITH_LONG_RANDOM_DISPATCH_SECRET';
  request_id bigint;
begin
  if coalesce(new.processed_status, '') <> 'pending_ml' then
    return new;
  end if;

  select net.http_post(
    url := dispatch_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    body := jsonb_build_object(
      'source', 'v2_disease_training_assets',
      'event_type', 'ml-training-asset-created',
      'record', to_jsonb(new)
    ),
    timeout_milliseconds := 5000
  )
  into request_id;

  return new;
exception
  when undefined_table then
    return new;
  when others then
    return new;
end;
$$;

drop trigger if exists trg_v2_dispatch_ml_worker_for_disease_asset on public.v2_disease_training_assets;
create trigger trg_v2_dispatch_ml_worker_for_disease_asset
after insert or update of processed_status on public.v2_disease_training_assets
for each row
execute function public.v2_dispatch_ml_worker_for_disease_asset();
