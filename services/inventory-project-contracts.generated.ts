// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.
import type { Database } from '../supabase/functions/_shared/database.types.ts';
import type { RuntimeContracts } from './database-contract-runtime.ts';
export const inventoryProjectContracts: Pick<RuntimeContracts<Database>['tables'], "inventory_project_rows" | "inventory_projects"> = {
  "inventory_project_rows": {
    "row": {
      "object": {
        "added_by": {"schema":"string"},
        "commonname": {"schema":"string"},
        "completed_at": {"schema":{"oneOf":["string","null"]}},
        "completed_by": {"schema":{"oneOf":["string","null"]}},
        "completion_meta": {"schema":"json"},
        "contsize": {"schema":"string"},
        "created_at": {"schema":"string"},
        "id": {"schema":"string"},
        "itemcode": {"schema":"string"},
        "locationcode": {"schema":"string"},
        "lotcode": {"schema":"string"},
        "project_id": {"schema":"string"},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]}},
        "row_instructions": {"schema":"string"},
        "snapshot_metrics": {"schema":"json"},
        "status": {"schema":"string"},
        "updated_at": {"schema":"string"}
      }
    },
    "insert": {
      "object": {
        "added_by": {"schema":"string"},
        "commonname": {"schema":"string","optional":true},
        "completed_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completed_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completion_meta": {"schema":"json","optional":true},
        "contsize": {"schema":"string","optional":true},
        "created_at": {"schema":"string","optional":true},
        "id": {"schema":"string","optional":true},
        "itemcode": {"schema":"string"},
        "locationcode": {"schema":"string"},
        "lotcode": {"schema":"string"},
        "project_id": {"schema":"string"},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]},"optional":true},
        "row_instructions": {"schema":"string","optional":true},
        "snapshot_metrics": {"schema":"json","optional":true},
        "status": {"schema":"string","optional":true},
        "updated_at": {"schema":"string","optional":true}
      }
    },
    "update": {
      "object": {
        "added_by": {"schema":"string","optional":true},
        "commonname": {"schema":"string","optional":true},
        "completed_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completed_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completion_meta": {"schema":"json","optional":true},
        "contsize": {"schema":"string","optional":true},
        "created_at": {"schema":"string","optional":true},
        "id": {"schema":"string","optional":true},
        "itemcode": {"schema":"string","optional":true},
        "locationcode": {"schema":"string","optional":true},
        "lotcode": {"schema":"string","optional":true},
        "project_id": {"schema":"string","optional":true},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]},"optional":true},
        "row_instructions": {"schema":"string","optional":true},
        "snapshot_metrics": {"schema":"json","optional":true},
        "status": {"schema":"string","optional":true},
        "updated_at": {"schema":"string","optional":true}
      }
    }
  },
  "inventory_projects": {
    "row": {
      "object": {
        "assigned_users": {"schema":"json"},
        "completed_at": {"schema":{"oneOf":["string","null"]}},
        "completed_by": {"schema":{"oneOf":["string","null"]}},
        "created_at": {"schema":"string"},
        "created_by": {"schema":"string"},
        "created_by_name": {"schema":"string"},
        "custom_variables": {"schema":"json"},
        "finish_by_date": {"schema":{"oneOf":["string","null"]}},
        "id": {"schema":"string"},
        "instructions": {"schema":"string"},
        "project_meta": {"schema":"json"},
        "project_name": {"schema":"string"},
        "qty_discarded": {"schema":{"oneOf":["number","null"]}},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]}},
        "qty_hauled": {"schema":{"oneOf":["number","null"]}},
        "start_date": {"schema":{"oneOf":["string","null"]}},
        "status": {"schema":"string"},
        "updated_at": {"schema":"string"}
      }
    },
    "insert": {
      "object": {
        "assigned_users": {"schema":"json","optional":true},
        "completed_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completed_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "created_at": {"schema":"string","optional":true},
        "created_by": {"schema":"string"},
        "created_by_name": {"schema":"string","optional":true},
        "custom_variables": {"schema":"json","optional":true},
        "finish_by_date": {"schema":{"oneOf":["string","null"]},"optional":true},
        "id": {"schema":"string","optional":true},
        "instructions": {"schema":"string","optional":true},
        "project_meta": {"schema":"json","optional":true},
        "project_name": {"schema":"string"},
        "qty_discarded": {"schema":{"oneOf":["number","null"]},"optional":true},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]},"optional":true},
        "qty_hauled": {"schema":{"oneOf":["number","null"]},"optional":true},
        "start_date": {"schema":{"oneOf":["string","null"]},"optional":true},
        "status": {"schema":"string","optional":true},
        "updated_at": {"schema":"string","optional":true}
      }
    },
    "update": {
      "object": {
        "assigned_users": {"schema":"json","optional":true},
        "completed_at": {"schema":{"oneOf":["string","null"]},"optional":true},
        "completed_by": {"schema":{"oneOf":["string","null"]},"optional":true},
        "created_at": {"schema":"string","optional":true},
        "created_by": {"schema":"string","optional":true},
        "created_by_name": {"schema":"string","optional":true},
        "custom_variables": {"schema":"json","optional":true},
        "finish_by_date": {"schema":{"oneOf":["string","null"]},"optional":true},
        "id": {"schema":"string","optional":true},
        "instructions": {"schema":"string","optional":true},
        "project_meta": {"schema":"json","optional":true},
        "project_name": {"schema":"string","optional":true},
        "qty_discarded": {"schema":{"oneOf":["number","null"]},"optional":true},
        "qty_graded_out": {"schema":{"oneOf":["number","null"]},"optional":true},
        "qty_hauled": {"schema":{"oneOf":["number","null"]},"optional":true},
        "start_date": {"schema":{"oneOf":["string","null"]},"optional":true},
        "status": {"schema":"string","optional":true},
        "updated_at": {"schema":"string","optional":true}
      }
    }
  }
};
