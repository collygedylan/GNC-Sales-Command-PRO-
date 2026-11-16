// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.
import type { Database } from '../supabase/functions/_shared/database.types.ts';
import type { RuntimeContracts } from './database-contract-runtime.ts';
export const currentSchemaTables: Pick<RuntimeContracts<Database>['tables'], "app_dataset_revisions" | "app_row_actions" | "ph_action_discrepancies" | "ph_action_learning_rules"> = {
  "app_dataset_revisions": {
    "row": {
      "object": {
        "changed_at": {"schema":"string"},
        "key": {"schema":"string"},
        "last_checked_at": {"schema":{"oneOf":["string","null"]}},
        "revision": {"schema":"number"},
        "source_content_hash": {"schema":{"oneOf":["string","null"]}},
        "source_file_id": {"schema":{"oneOf":["string","null"]}},
        "source_file_name": {"schema":{"oneOf":["string","null"]}},
        "source_import_run_id": {"schema":{"oneOf":["string","null"]}},
        "source_imported_at": {"schema":{"oneOf":["string","null"]}},
        "source_modified_at": {"schema":{"oneOf":["string","null"]}},
        "state": {"schema":"string"}
      }
    },
    "insert": {
      "object": {
        "changed_at": {"schema":"string","optional":true},
        "key": {"schema":"string"},
        "last_checked_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "revision": {"schema":"number","optional":true},
        "source_content_hash": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_file_id": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_file_name": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_import_run_id": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_imported_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_modified_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "state": {"schema":"string","optional":true}
      }
    },
    "update": {
      "object": {
        "changed_at": {"schema":"string","optional":true},
        "key": {"schema":"string","optional":true},
        "last_checked_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "revision": {"schema":"number","optional":true},
        "source_content_hash": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_file_id": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_file_name": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_import_run_id": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_imported_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "source_modified_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "state": {"schema":"string","optional":true}
      }
    }
  },
  "app_row_actions": {
    "row": {
      "object": {
        "absorbed_by_erp": {"schema":"boolean"},
        "app_update_action": {"schema":"json"},
        "app_update_row": {"schema":"json"},
        "baseline_erp_row": {"schema":{"oneOf":["json","null"]}},
        "canonical_unique_id": {"schema":"string"},
        "changed_fields": {"schema":{"array":"string"}},
        "created_at": {"schema":"string"},
        "id": {"schema":"number"},
        "reconciliation_status": {"schema":"string"},
        "rule_scope": {"schema":"json"},
        "sync_run_id": {"schema":{"oneOf":["string","null"]}}
      }
    },
    "insert": {
      "object": {
        "absorbed_by_erp": {"schema":"boolean","optional":true},
        "app_update_action": {"schema":"json"},
        "app_update_row": {"schema":"json"},
        "baseline_erp_row": {"schema":{"oneOf":["json","null"]},"optional":true},
        "canonical_unique_id": {"schema":"string"},
        "changed_fields": {"schema":{"array":"string"}},
        "created_at": {"schema":"string","optional":true},
        "id": {"schema":"never","optional":true},
        "reconciliation_status": {"schema":"string","optional":true},
        "rule_scope": {"schema":"json"},
        "sync_run_id": {"schema":{"oneOf":["string","null"]},"optional":true}
      }
    },
    "update": {
      "object": {
        "absorbed_by_erp": {"schema":"boolean","optional":true},
        "app_update_action": {"schema":"json","optional":true},
        "app_update_row": {"schema":"json","optional":true},
        "baseline_erp_row": {"schema":{"oneOf":["json","null"]},"optional":true},
        "canonical_unique_id": {"schema":"string","optional":true},
        "changed_fields": {"schema":{"array":"string"},"optional":true},
        "created_at": {"schema":"string","optional":true},
        "id": {"schema":"never","optional":true},
        "reconciliation_status": {"schema":"string","optional":true},
        "rule_scope": {"schema":"json","optional":true},
        "sync_run_id": {"schema":{"oneOf":["string","null"]},"optional":true}
      }
    }
  },
  "ph_action_discrepancies": {
    "row": {
      "object": {
        "action_id": {"schema":"number"},
        "action_type": {"schema":"string"},
        "app_update_action": {"schema":"json"},
        "app_update_row": {"schema":"json"},
        "commonname": {"schema":{"oneOf":["string","null"]}},
        "contsize": {"schema":{"oneOf":["string","null"]}},
        "created_at": {"schema":"string"},
        "discrepancy_diff": {"schema":"json"},
        "id": {"schema":"number"},
        "import_run_id": {"schema":"string"},
        "itemcode": {"schema":{"oneOf":["string","null"]}},
        "locationcode": {"schema":{"oneOf":["string","null"]}},
        "lotcode": {"schema":{"oneOf":["string","null"]}},
        "report_update_row": {"schema":"json"},
        "rule_id": {"schema":{"oneOf":["number","null"]}},
        "source_file_name": {"schema":"string"},
        "status": {"schema":"string"},
        "sync_run_id": {"schema":"string"},
        "target_locationcode": {"schema":{"oneOf":["string","null"]}},
        "target_lotcode": {"schema":{"oneOf":["string","null"]}}
      }
    },
    "insert": {
      "object": {
        "action_id": {"schema":"number"},
        "action_type": {"schema":"string"},
        "app_update_action": {"schema":"json"},
        "app_update_row": {"schema":"json"},
        "commonname": {"schema":{"oneOf":["string","null"]},"optional":true},
        "contsize": {"schema":{"oneOf":["string","null"]},"optional":true},
        "created_at": {"schema":"string","optional":true},
        "discrepancy_diff": {"schema":"json"},
        "id": {"schema":"never","optional":true},
        "import_run_id": {"schema":"string"},
        "itemcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "locationcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "lotcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "report_update_row": {"schema":"json"},
        "rule_id": {"schema":{"oneOf":["number","null"]},"optional":true},
        "source_file_name": {"schema":"string"},
        "status": {"schema":"string","optional":true},
        "sync_run_id": {"schema":"string"},
        "target_locationcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "target_lotcode": {"schema":{"oneOf":["string","null"]},"optional":true}
      }
    },
    "update": {
      "object": {
        "action_id": {"schema":"number","optional":true},
        "action_type": {"schema":"string","optional":true},
        "app_update_action": {"schema":"json","optional":true},
        "app_update_row": {"schema":"json","optional":true},
        "commonname": {"schema":{"oneOf":["string","null"]},"optional":true},
        "contsize": {"schema":{"oneOf":["string","null"]},"optional":true},
        "created_at": {"schema":"string","optional":true},
        "discrepancy_diff": {"schema":"json","optional":true},
        "id": {"schema":"never","optional":true},
        "import_run_id": {"schema":"string","optional":true},
        "itemcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "locationcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "lotcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "report_update_row": {"schema":"json","optional":true},
        "rule_id": {"schema":{"oneOf":["number","null"]},"optional":true},
        "source_file_name": {"schema":"string","optional":true},
        "status": {"schema":"string","optional":true},
        "sync_run_id": {"schema":"string","optional":true},
        "target_locationcode": {"schema":{"oneOf":["string","null"]},"optional":true},
        "target_lotcode": {"schema":{"oneOf":["string","null"]},"optional":true}
      }
    }
  },
  "ph_action_learning_rules": {
    "row": {
      "object": {
        "action_type": {"schema":"string"},
        "auto_apply_enabled": {"schema":"boolean"},
        "field_transition_formula": {"schema":"json"},
        "formula_digest": {"schema":{"oneOf":["string","null"]}},
        "id": {"schema":"number"},
        "rule_scope": {"schema":"json"},
        "sample_count": {"schema":"number"},
        "taught_at": {"schema":{"oneOf":["string","null"]}},
        "taught_by": {"schema":{"oneOf":["string","null"]}},
        "teachable": {"schema":"boolean"}
      }
    },
    "insert": {
      "object": {
        "action_type": {"schema":"string"},
        "auto_apply_enabled": {"schema":"boolean","optional":true},
        "field_transition_formula": {"schema":"json"},
        "formula_digest": {"schema":{"oneOf":["string","null"]},"optional":true},
        "id": {"schema":"never","optional":true},
        "rule_scope": {"schema":"json"},
        "sample_count": {"schema":"number","optional":true},
        "taught_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "taught_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "teachable": {"schema":"boolean"}
      }
    },
    "update": {
      "object": {
        "action_type": {"schema":"string","optional":true},
        "auto_apply_enabled": {"schema":"boolean","optional":true},
        "field_transition_formula": {"schema":"json","optional":true},
        "formula_digest": {"schema":{"oneOf":["string","null"]},"optional":true},
        "id": {"schema":"never","optional":true},
        "rule_scope": {"schema":"json","optional":true},
        "sample_count": {"schema":"number","optional":true},
        "taught_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "taught_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "teachable": {"schema":"boolean","optional":true}
      }
    }
  }
};
