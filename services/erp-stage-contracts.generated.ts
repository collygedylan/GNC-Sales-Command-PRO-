// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.
import type { Database } from '../supabase/functions/_shared/database.types.ts';
import type { RuntimeContracts } from './database-contract-runtime.ts';
export const erpStageArgs: Pick<RuntimeContracts<Database>['functions'], "fast_abort_erp_stage_v1" | "fast_append_erp_stage_batch_v1" | "fast_begin_erp_stage_v1" | "fast_commit_erp_stage_swap_v1" | "fast_erp_import_columns_v1" | "fast_seal_erp_stage_v1"> = {
  "fast_abort_erp_stage_v1": {"oneOf":[{"object":{"p_stage_id":{"schema":{"oneOf":["string","null"]}}}}]},
  "fast_append_erp_stage_batch_v1": {
    "oneOf": [
      {
        "object": {
          "p_rows": {"schema":{"oneOf":["json","null"]}},
          "p_stage_id": {"schema":{"oneOf":["string","null"]}},
          "p_start_row": {"schema":{"oneOf":["number","null"]}}
        }
      }
    ]
  },
  "fast_begin_erp_stage_v1": {
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
  "fast_commit_erp_stage_swap_v1": {
    "oneOf": [
      {"object":{"p_stage_id":{"schema":{"oneOf":["string","null"]}}}},
      {
        "object": {"p_async":{"schema":{"oneOf":["boolean","null"]}},"p_stage_id":{"schema":{"oneOf":["string","null"]}}}
      }
    ]
  },
  "fast_erp_import_columns_v1": {"oneOf":[{"object":{"p_dataset_key":{"schema":{"oneOf":["string","null"]}}}}]},
  "fast_seal_erp_stage_v1": {
    "oneOf": [
      {
        "object": {
          "p_expected_rows": {"schema":{"oneOf":["number","null"]}},
          "p_stage_id": {"schema":{"oneOf":["string","null"]}}
        }
      }
    ]
  }
};
export const erpStageReturns: Pick<RuntimeContracts<Database>['functionReturns'], "fast_abort_erp_stage_v1" | "fast_append_erp_stage_batch_v1" | "fast_begin_erp_stage_v1" | "fast_commit_erp_stage_swap_v1" | "fast_erp_import_columns_v1" | "fast_seal_erp_stage_v1"> = {
  "fast_abort_erp_stage_v1": {"oneOf":["json"]},
  "fast_append_erp_stage_batch_v1": {"oneOf":["json"]},
  "fast_begin_erp_stage_v1": {"oneOf":["json"]},
  "fast_commit_erp_stage_swap_v1": {"oneOf":["json","json"]},
  "fast_erp_import_columns_v1": {"oneOf":["json"]},
  "fast_seal_erp_stage_v1": {"oneOf":["json"]}
};
