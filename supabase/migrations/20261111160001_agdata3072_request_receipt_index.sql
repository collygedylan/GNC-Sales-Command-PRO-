begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

-- The installed planner eliminates the completion predicate before matching
-- this lookup. A complete batch-key index remains usable by the actual RPC.
create index if not exists ph_request_history_batch_v3072
  on public.ph_requests_completed_history(client_batch_id);
drop index if exists public.ph_request_history_batch_completed_v3072;

commit;
