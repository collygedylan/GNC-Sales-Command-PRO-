// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.
import type { Database } from '../supabase/functions/_shared/database.types.ts';
import type { RuntimeContracts } from './database-contract-runtime.ts';
export const currentSchemaArgs: Pick<RuntimeContracts<Database>['functions'], "append_request_photo_intent_v3079" | "authorize_photo_upload_v3074" | "authorize_reclass_command_v3076" | "authorize_request_photo_intent_v3079" | "begin_pending_erp_stage_v3070" | "can_reclass_y_administrator_v3076" | "can_write_photo_object_v3074" | "complete_request_with_photo_intents_v3079" | "manager_action_discrepancies_v3070" | "read_reviewed_watchdog_events_v3074" | "record_erp_stage_checked_v3070" | "request_completion_dispatch_rows_v3065" | "resolve_runtime_watchdog_events_v23158" | "resume_erp_stage_publication_v3077" | "resume_failed_erp_sync_run_v3077"> = {
  "append_request_photo_intent_v3079": {
    "oneOf": [
      {
        "object": {
          "p_name": {"schema":{"oneOf":["string","null"]}},
          "p_photo_id": {"schema":{"oneOf":["string","null"]}},
          "p_request_id": {"schema":{"oneOf":["string","null"]}},
          "p_url": {"schema":{"oneOf":["string","null"]}}
        }
      }
    ]
  },
  "authorize_photo_upload_v3074": {
    "oneOf": [
      {
        "object": {
          "p_actor_id": {"schema":{"oneOf":["string","null"]}},
          "p_actor_username": {"schema":{"oneOf":["string","null"]}},
          "p_app_issued_at": {"schema":{"oneOf":["number","null"]},"optional":true},
          "p_identity": {"schema":{"oneOf":["json","null"]}},
          "p_prefix": {"schema":{"oneOf":["string","null"]}},
          "p_session_id": {"schema":{"oneOf":["string","null"]},"optional":true}
        }
      }
    ]
  },
  "authorize_reclass_command_v3076": {
    "oneOf": [
      {
        "object": {"p_actor_id":{"schema":{"oneOf":["string","null"]}},"p_command":{"schema":{"oneOf":["json","null"]}}}
      }
    ]
  },
  "authorize_request_photo_intent_v3079": {
    "oneOf": [
      {
        "object": {
          "p_actor_id": {"schema":{"oneOf":["string","null"]}},
          "p_actor_username": {"schema":{"oneOf":["string","null"]}},
          "p_identity": {"schema":{"oneOf":["json","null"]}},
          "p_object_path": {"schema":{"oneOf":["string","null"]}},
          "p_photo_id": {"schema":{"oneOf":["string","null"]}},
          "p_session_id": {"schema":{"oneOf":["string","null"]}}
        }
      }
    ]
  },
  "begin_pending_erp_stage_v3070": {
    "oneOf": [
      {
        "object": {
          "p_dataset_key": {"schema":{"oneOf":["string","null"]}},
          "p_expected_rows": {"schema":{"oneOf":["number","null"]}},
          "p_file_meta": {"schema":{"oneOf":["json","null"]}}
        }
      }
    ]
  },
  "can_reclass_y_administrator_v3076": {
    "oneOf": [
      {
        "object": {"p_actor_id":{"schema":{"oneOf":["string","null"]}},"p_command":{"schema":{"oneOf":["json","null"]}}}
      }
    ]
  },
  "can_write_photo_object_v3074": {
    "oneOf": [
      {
        "object": {"p_bucket":{"schema":{"oneOf":["string","null"]}},"p_name":{"schema":{"oneOf":["string","null"]}}}
      }
    ]
  },
  "complete_request_with_photo_intents_v3079": {
    "oneOf": [
      {
        "object": {
          "p_actor_id": {"schema":{"oneOf":["string","null"]}},
          "p_expected_version": {"schema":{"oneOf":["number","null"]}},
          "p_patch": {"schema":{"oneOf":["json","null"]}},
          "p_photo_ids": {"schema":{"oneOf":[{"array":"string"},"null"]}},
          "p_request_id": {"schema":{"oneOf":["string","null"]}},
          "p_session_id": {"schema":{"oneOf":["string","null"]}}
        }
      }
    ]
  },
  "manager_action_discrepancies_v3070": {
    "oneOf": [
      {
        "object": {
          "p_actor_id": {"schema":{"oneOf":["string","null"]}},
          "p_operation": {"schema":{"oneOf":["string","null"]}},
          "p_payload": {"schema":{"oneOf":["json","null"]},"optional":true}
        }
      }
    ]
  },
  "read_reviewed_watchdog_events_v3074": {
    "oneOf": [
      {
        "object": {
          "p_include_resolved": {"schema":{"oneOf":["boolean","null"]},"optional":true},
          "p_offset": {"schema":{"oneOf":["number","null"]},"optional":true}
        }
      }
    ]
  },
  "record_erp_stage_checked_v3070": {
    "oneOf": [
      {
        "object": {
          "p_run_id": {"schema":{"oneOf":["string","null"]}},
          "p_stage_key": {"schema":{"oneOf":["string","null"]}},
          "p_worker_id": {"schema":{"oneOf":["string","null"]}}
        }
      }
    ]
  },
  "request_completion_dispatch_rows_v3065": {"oneOf":[{"object":{"p_event_id":{"schema":{"oneOf":["string","null"]}}}}]},
  "resolve_runtime_watchdog_events_v23158": {"oneOf":[{"object":{"p_ids":{"schema":{"oneOf":[{"array":"number"},"null"]}}}}]},
  "resume_erp_stage_publication_v3077": {"oneOf":[{"object":{"p_stage_id":{"schema":{"oneOf":["string","null"]}}}}]},
  "resume_failed_erp_sync_run_v3077": {
    "oneOf": [
      {
        "object": {"p_actor":{"schema":{"oneOf":["string","null"]}},"p_run_id":{"schema":{"oneOf":["string","null"]}}}
      }
    ]
  }
};
export const currentSchemaReturns: Pick<RuntimeContracts<Database>['functionReturns'], "append_request_photo_intent_v3079" | "authorize_photo_upload_v3074" | "authorize_reclass_command_v3076" | "authorize_request_photo_intent_v3079" | "begin_pending_erp_stage_v3070" | "can_reclass_y_administrator_v3076" | "can_write_photo_object_v3074" | "complete_request_with_photo_intents_v3079" | "manager_action_discrepancies_v3070" | "read_reviewed_watchdog_events_v3074" | "record_erp_stage_checked_v3070" | "request_completion_dispatch_rows_v3065" | "resolve_runtime_watchdog_events_v23158" | "resume_erp_stage_publication_v3077" | "resume_failed_erp_sync_run_v3077"> = {
  "append_request_photo_intent_v3079": {"oneOf":["json"]},
  "authorize_photo_upload_v3074": {"oneOf":["json"]},
  "authorize_reclass_command_v3076": {"oneOf":[{"oneOf":["boolean","null"]}]},
  "authorize_request_photo_intent_v3079": {"oneOf":["json"]},
  "begin_pending_erp_stage_v3070": {"oneOf":["json"]},
  "can_reclass_y_administrator_v3076": {"oneOf":[{"oneOf":["boolean","null"]}]},
  "can_write_photo_object_v3074": {"oneOf":[{"oneOf":["boolean","null"]}]},
  "complete_request_with_photo_intents_v3079": {"oneOf":["json"]},
  "manager_action_discrepancies_v3070": {"oneOf":["json"]},
  "read_reviewed_watchdog_events_v3074": {"oneOf":["json"]},
  "record_erp_stage_checked_v3070": {"oneOf":["json"]},
  "request_completion_dispatch_rows_v3065": {"oneOf":["json"]},
  "resolve_runtime_watchdog_events_v23158": {"oneOf":["json"]},
  "resume_erp_stage_publication_v3077": {"oneOf":["json"]},
  "resume_failed_erp_sync_run_v3077": {"oneOf":["json"]}
};
