-- Return application-level optimistic conflicts as HTTP 409 without using
-- PostgreSQL's serialization-failure SQLSTATE, which can invite transaction retries.
-- Rewrite only the five known error-code/message pairs in the live definitions;
-- CREATE OR REPLACE preserves each function's signature, attributes, owner, and grants.
do $migration$
declare
  definition text;
  updated_definition text;
  request_conflict_pattern constant text := '(errcode[[:space:]]*=[[:space:]]*)''40001''([[:space:]]*,[[:space:]]*message[[:space:]]*=[[:space:]]*''REQUEST_VERSION_CONFLICT'')';
  not_ready_pattern constant text := '(errcode[[:space:]]*=[[:space:]]*)''40001''([[:space:]]*,[[:space:]]*message[[:space:]]*=[[:space:]]*''LOC_ON_HAND_SOURCE_NOT_READY'')';
  revision_pattern constant text := '(errcode[[:space:]]*=[[:space:]]*)''40001''([[:space:]]*,[[:space:]]*message[[:space:]]*=[[:space:]]*''LOC_ON_HAND_REVISION_CHANGED'')';
begin
  definition := pg_get_functiondef('public.save_request_work(text,bigint,jsonb,boolean)'::regprocedure);
  if regexp_count(definition, request_conflict_pattern) <> 1 then
    raise exception 'APPLICATION_CONFLICT_MIGRATION_EXPECTED_ONE_REQUEST_CONFLICT_WRAPPER';
  end if;
  updated_definition := regexp_replace(definition, request_conflict_pattern, '\1''PT409''\2', 'g');
  execute updated_definition;

  definition := pg_get_functiondef('public.save_request_work_v1(text,bigint,jsonb,boolean)'::regprocedure);
  if regexp_count(definition, request_conflict_pattern) <> 2 then
    raise exception 'APPLICATION_CONFLICT_MIGRATION_EXPECTED_TWO_REQUEST_CONFLICT_V1';
  end if;
  updated_definition := regexp_replace(definition, request_conflict_pattern, '\1''PT409''\2', 'g');
  execute updated_definition;

  definition := pg_get_functiondef('public.inventory_location_on_hand_read_v1(uuid,jsonb,text)'::regprocedure);
  if regexp_count(definition, not_ready_pattern) <> 1
    or regexp_count(definition, revision_pattern) <> 1 then
    raise exception 'APPLICATION_CONFLICT_MIGRATION_EXPECTED_TWO_LOCATION_ON_HAND_CONFLICTS';
  end if;
  updated_definition := regexp_replace(definition, not_ready_pattern, '\1''PT409''\2', 'g');
  updated_definition := regexp_replace(updated_definition, revision_pattern, '\1''PT409''\2', 'g');
  execute updated_definition;
end
$migration$;
