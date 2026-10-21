create table if not exists public.app_runtime_watchdog_events (
  id bigint generated always as identity primary key,
  fingerprint text not null check (char_length(fingerprint) between 1 and 400),
  app_version text not null check (char_length(app_version) between 1 and 80),
  event_type text not null check (char_length(event_type) between 1 and 64),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  username text not null check (char_length(username) between 1 and 120),
  normalized_role text not null check (char_length(normalized_role) between 1 and 80),
  view_id text not null check (char_length(view_id) between 1 and 100),
  sub_module text not null default '',
  duration_ms integer not null default 0 check (duration_ms >= 0),
  error_message text not null default '',
  dataset_revisions_snapshot jsonb not null default '{}'::jsonb,
  cluster_id text not null check (cluster_id in ('Cluster 1','Cluster 2','Cluster 3','Cluster 4','Cluster 5','Cluster 6','Cluster 7','Cluster 8','Cluster 9','Cluster 10')),
  owning_skill text not null,
  suspected_functions jsonb not null default '[]'::jsonb,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved')),
  sample_payload jsonb not null default '{}'::jsonb,
  alert_last_sent_at timestamptz,
  unique (fingerprint, app_version)
);

alter table public.app_runtime_watchdog_events enable row level security;
revoke all on public.app_runtime_watchdog_events from anon, authenticated;
grant select, insert, update on public.app_runtime_watchdog_events to service_role;
grant usage, select on sequence public.app_runtime_watchdog_events_id_seq to service_role;
create index if not exists app_runtime_watchdog_events_open_idx
  on public.app_runtime_watchdog_events (last_seen_at desc) where status = 'open';

create or replace function public.bump_runtime_watchdog_event_v1()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'alert_last_sent_at' - 'occurrence_count' - 'last_seen_at' - 'status')
      = (to_jsonb(old) - 'alert_last_sent_at' - 'occurrence_count' - 'last_seen_at' - 'status') then
    new.occurrence_count := old.occurrence_count;
    new.first_seen_at := old.first_seen_at;
    new.last_seen_at := old.last_seen_at;
    return new;
  end if;
  new.occurrence_count := old.occurrence_count + 1;
  new.first_seen_at := old.first_seen_at;
  new.last_seen_at := now();
  new.alert_last_sent_at := old.alert_last_sent_at;
  return new;
end;
$$;
create trigger app_runtime_watchdog_events_bump
before update on public.app_runtime_watchdog_events
for each row execute function public.bump_runtime_watchdog_event_v1();
revoke all on function public.bump_runtime_watchdog_event_v1() from public, anon, authenticated;
