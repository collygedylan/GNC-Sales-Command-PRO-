begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function(
  'public', 'reconcile_request_folder_completion_window_v2',
  array['timestamp with time zone','timestamp with time zone','boolean'],
  'bounded completion recovery exists'
);
select has_function(
  'public', 'get_request_drive_evidence_health_snapshot_v1', array[]::text[],
  'request versus Drive evidence health exists'
);
select has_function(
  'public', 'repair_request_drive_evidence_v1', array['text[]','boolean'],
  'guarded Drive evidence repair exists'
);
select ok(
  pg_get_functiondef('private.reconcile_request_folder_completion_v2(text)'::regprocedure)
    ~ E'\\? active_request\\.request_id',
  'folder completion checks each explicitly aliased active request ID'
);
select ok(
  pg_get_functiondef('private.reconcile_request_folder_completion_v2(text)'::regprocedure)
    ~ 'pg_advisory_xact_lock',
  'folder reconciliation serializes concurrent attempts'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.reconcile_request_folder_completion_window_v2(timestamp with time zone,timestamp with time zone,boolean)',
    'execute'
  ),
  'authenticated clients cannot run completion recovery'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.reconcile_request_folder_completion_window_v2(timestamp with time zone,timestamp with time zone,boolean)',
    'execute'
  ),
  'service role can run bounded completion recovery'
);
select ok(
  pg_get_functiondef('public.reconcile_request_folder_completion_window_v2(timestamp with time zone,timestamp with time zone,boolean)'::regprocedure)
    ~ 'p_dry_run',
  'completion recovery supports a dry run'
);
select ok(
  pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure)
    ~ 'requestRows',
  'Drive save returns canonical linked Request rows'
);
select ok(
  pg_get_functiondef('private.save_drive_evidence_core_v2(text,text,text,text,text,jsonb,jsonb,boolean,text,text,boolean,text)'::regprocedure)
    ~ 'av_rule_bundle_updated_at',
  'Drive save stamps canonical evidence provenance'
);
select ok(
  pg_get_functiondef('public.get_eval_request_delivery_health_snapshot_v2()'::regprocedure)
    ~ 'missing_completion_event_count',
  'hosted delivery health detects missing completion events'
);

select * from finish();
rollback;
