// Generated from Supabase types. Run npm run types:contracts:generate; do not edit.
import type { Database } from './sandbox.database.types.ts';
import type { RuntimeContracts } from '../../../services/database-contract-runtime.ts';
export const contracts: RuntimeContracts<Database> = {
  "tables": {
    "ph_27f1_hl_po": {
      "row": {
        "object": {
          "common_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "genus": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "id": {
            "schema": "string"
          },
          "item_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "lot": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "lot_pend_rec": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "po_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "po_ordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "po_received": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "po_remain": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "report_date": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "row_index": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "run_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "seas_on_hand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "size": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "source_payload": {
            "schema": "json"
          }
        }
      },
      "insert": {
        "object": {
          "common_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "genus": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string"
          },
          "item_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lot": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lot_pend_rec": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "po_ordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_received": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_remain": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "report_date": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "row_index": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "run_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "seas_on_hand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "size": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "common_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "genus": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "item_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lot": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lot_pend_rec": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "po_ordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_received": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "po_remain": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "report_date": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "row_index": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "run_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "seas_on_hand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "size": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          }
        }
      }
    },
    "ph_active_request": {
      "row": {
        "object": {
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "completed_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "completed_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "completed_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "desired_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "desired_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "est_ship": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "id": {
            "schema": "string"
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "master_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_archived": {
            "schema": "boolean"
          },
          "req_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_customer": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "req_photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_photo_mode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "req_rep_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_reserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "req_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_created_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_created_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_created_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_folder": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_selected_rep_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_selected_rep_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_selected_rep_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "requested_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "source_payload": {
            "schema": "json"
          },
          "unique_id": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desired_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desired_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "est_ship": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string"
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "master_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_archived": {
            "schema": "boolean",
            "optional": true
          },
          "req_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_customer": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_mode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "req_rep_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_reserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_folder": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "requested_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "unique_id": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "completed_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desired_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desired_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "est_ship": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "master_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_archived": {
            "schema": "boolean",
            "optional": true
          },
          "req_caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_comments": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_customer": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_mode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "req_rep_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_reserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "req_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_created_by_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_folder": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_display": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_email": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_selected_rep_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "requested_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "unique_id": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "ph_app_live_pilot_flags": {
      "row": {
        "object": {
          "enabled": {
            "schema": "boolean"
          },
          "feature_key": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "enabled": {
            "schema": "boolean",
            "optional": true
          },
          "feature_key": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "enabled": {
            "schema": "boolean",
            "optional": true
          },
          "feature_key": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "ph_app_user_preferences": {
      "row": {
        "object": {
          "cohort_id": {
            "schema": "string"
          },
          "created_at": {
            "schema": "string"
          },
          "display_mode": {
            "schema": "string"
          },
          "theme_mode": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          },
          "user_key": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "cohort_id": {
            "schema": "string",
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "display_mode": {
            "schema": "string",
            "optional": true
          },
          "theme_mode": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "user_key": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "cohort_id": {
            "schema": "string",
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "display_mode": {
            "schema": "string",
            "optional": true
          },
          "theme_mode": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "user_key": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "ph_cav_import": {
      "row": {
        "object": {
          "available": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "hz": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "order_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "product_description": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "reserved_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "source_payload": {
            "schema": "json"
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "unique_id": {
            "schema": "string"
          },
          "unitprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          }
        }
      },
      "insert": {
        "object": {
          "available": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "hz": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "order_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "product_description": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "reserved_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "unique_id": {
            "schema": "string"
          },
          "unitprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "available": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "hz": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "itemcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "order_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "product_description": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "reserved_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "unique_id": {
            "schema": "string",
            "optional": true
          },
          "unitprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          }
        }
      }
    },
    "ph_dock_team_status": {
      "row": {
        "object": {
          "checker": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "dock_num": {
            "schema": "string"
          },
          "inspector": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "mistake": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "source_payload": {
            "schema": "json"
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "updated_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          }
        }
      },
      "insert": {
        "object": {
          "checker": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock_num": {
            "schema": "string"
          },
          "inspector": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "mistake": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "checker": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock_num": {
            "schema": "string",
            "optional": true
          },
          "inspector": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "mistake": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      }
    },
    "ph_master_inventory": {
      "row": {
        "object": {
          "app_tab_assignment": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "assignedto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "bay": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "blockalpha": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "blocknumber": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "botanicalname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "consigneecity": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "consigneename": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "consigneestate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "customername": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "desigcust": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "desigitem": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "desigloc": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "dock": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "dock_num": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_assigned_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_assigned_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_completed_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_completed_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_hold_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_hold_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_hold_reason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_instructions": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_moved_up_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "eval_task_recount_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "eval_task_result_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "eval_task_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "fieldtagcolor": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "genusname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "grower": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "holdstopcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "isreserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "itemcode": {
            "schema": "string"
          },
          "itemspec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "listprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "loc_match_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "locationnote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "locationnotedate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "picknote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "ptronhand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "ptrreviewed": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "purchaseordernumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "quantityordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "quantityshipped": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "requestdate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "requestdateweek": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "salesrepid": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "salesrepname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "saleyear": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "source": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "source_payload": {
            "schema": "json"
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "stopnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "suspend": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "suspendto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "tagcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "tripnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "unique_id": {
            "schema": "string"
          },
          "varietycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          }
        }
      },
      "insert": {
        "object": {
          "app_tab_assignment": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "assignedto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "bay": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "blockalpha": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "blocknumber": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "botanicalname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneecity": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneename": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneestate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "customername": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigcust": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigitem": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigloc": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock_num": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_assigned_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_assigned_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_completed_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_completed_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_reason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_instructions": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_moved_up_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_recount_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_result_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "fieldtagcolor": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "genusname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "grower": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "isreserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "itemcode": {
            "schema": "string"
          },
          "itemspec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "listprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "loc_match_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationnote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationnotedate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "picknote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "ptronhand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "ptrreviewed": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "purchaseordernumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "quantityordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "quantityshipped": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "requestdate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "requestdateweek": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "salesrepid": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "salesrepname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "saleyear": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "source": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "stopnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "suspend": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "suspendto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "tagcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "tripnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "unique_id": {
            "schema": "string"
          },
          "varietycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "app_tab_assignment": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "assignedto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "av_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "bay": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "blockalpha": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "blocknumber": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "botanicalname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "brand": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "caliper": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "commonname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneecity": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneename": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "consigneestate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "contsize": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "customername": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "date_completed": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigcust": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigitem": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "desigloc": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "dock_num": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_assigned_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_assigned_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_completed_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_completed_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_action": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_code": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_hold_reason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_instructions": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_moved_up_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_recount_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_result_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "eval_task_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "field_tag_color": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "fieldtagcolor": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "genusname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "grower": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "holdstopreason": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "isreserve": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "itemcode": {
            "schema": "string",
            "optional": true
          },
          "itemspec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "last_updated": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "listprice": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "loc_match_qty": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "locationcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationnote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "locationnotedate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "lotcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "match": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "photo_link": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "photo_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "pic_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "picknote": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "plantgroupcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "priority": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "ptravailable": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "ptronhand": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "ptrreviewed": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "purchaseordernumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "qualitycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "quantityordered": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "quantityshipped": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "requestdate": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "requestdateweek": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "sales_note": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "salesrepid": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "salesrepname": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "saleyear": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "season": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "season_supply": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "source": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "source_payload": {
            "schema": "json",
            "optional": true
          },
          "spec": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "stopnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "suspend": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "suspendto": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "tagcode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "tripnumber": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "unique_id": {
            "schema": "string",
            "optional": true
          },
          "varietycode": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      }
    },
    "ph_runtime_feature_flags": {
      "row": {
        "object": {
          "config": {
            "schema": "json"
          },
          "enabled": {
            "schema": "boolean"
          },
          "flag_key": {
            "schema": "string"
          },
          "rollout_percent": {
            "schema": "number"
          },
          "updated_at": {
            "schema": "string"
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          }
        }
      },
      "insert": {
        "object": {
          "config": {
            "schema": "json",
            "optional": true
          },
          "enabled": {
            "schema": "boolean"
          },
          "flag_key": {
            "schema": "string"
          },
          "rollout_percent": {
            "schema": "number",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "config": {
            "schema": "json",
            "optional": true
          },
          "enabled": {
            "schema": "boolean",
            "optional": true
          },
          "flag_key": {
            "schema": "string",
            "optional": true
          },
          "rollout_percent": {
            "schema": "number",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "updated_by": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          }
        }
      }
    },
    "profiles": {
      "row": {
        "object": {
          "created_at": {
            "schema": "string"
          },
          "disabled_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "display_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "division": {
            "schema": "string"
          },
          "id": {
            "schema": "string"
          },
          "language": {
            "schema": "string"
          },
          "legacy_user_id": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "locked_until": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "must_change_password": {
            "schema": "boolean"
          },
          "passkey_pilot": {
            "schema": "boolean"
          },
          "role": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          },
          "username": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "disabled_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "display_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "division": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "string"
          },
          "language": {
            "schema": "string",
            "optional": true
          },
          "legacy_user_id": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "locked_until": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "must_change_password": {
            "schema": "boolean",
            "optional": true
          },
          "passkey_pilot": {
            "schema": "boolean",
            "optional": true
          },
          "role": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "username": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "disabled_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "display_name": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "division": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "language": {
            "schema": "string",
            "optional": true
          },
          "legacy_user_id": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "locked_until": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "must_change_password": {
            "schema": "boolean",
            "optional": true
          },
          "passkey_pilot": {
            "schema": "boolean",
            "optional": true
          },
          "role": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "username": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_event_log": {
      "row": {
        "object": {
          "actor_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "created_at": {
            "schema": "string"
          },
          "entity_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "entity_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "event_type": {
            "schema": "string"
          },
          "id": {
            "schema": "number"
          },
          "payload": {
            "schema": "json"
          }
        }
      },
      "insert": {
        "object": {
          "actor_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "entity_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "entity_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "event_type": {
            "schema": "string"
          },
          "id": {
            "schema": "never",
            "optional": true
          },
          "payload": {
            "schema": "json",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "actor_username": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "entity_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "entity_type": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "event_type": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "never",
            "optional": true
          },
          "payload": {
            "schema": "json",
            "optional": true
          }
        }
      }
    },
    "sandbox_message_threads": {
      "row": {
        "object": {
          "id": {
            "schema": "string"
          },
          "last_message_at": {
            "schema": "string"
          },
          "last_message_preview": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "metadata": {
            "schema": "json"
          },
          "participant_usernames": {
            "schema": {
              "array": "string"
            }
          },
          "status": {
            "schema": "string"
          },
          "subject": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "id": {
            "schema": "string",
            "optional": true
          },
          "last_message_at": {
            "schema": "string",
            "optional": true
          },
          "last_message_preview": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "participant_usernames": {
            "schema": {
              "array": "string"
            },
            "optional": true
          },
          "status": {
            "schema": "string",
            "optional": true
          },
          "subject": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "id": {
            "schema": "string",
            "optional": true
          },
          "last_message_at": {
            "schema": "string",
            "optional": true
          },
          "last_message_preview": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "participant_usernames": {
            "schema": {
              "array": "string"
            },
            "optional": true
          },
          "status": {
            "schema": "string",
            "optional": true
          },
          "subject": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_messages": {
      "row": {
        "object": {
          "body": {
            "schema": "string"
          },
          "created_at": {
            "schema": "string"
          },
          "id": {
            "schema": "string"
          },
          "metadata": {
            "schema": "json"
          },
          "sender_username": {
            "schema": "string"
          },
          "thread_id": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "body": {
            "schema": "string"
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "sender_username": {
            "schema": "string"
          },
          "thread_id": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "body": {
            "schema": "string",
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "sender_username": {
            "schema": "string",
            "optional": true
          },
          "thread_id": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_profiles": {
      "row": {
        "object": {
          "auth_user_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "created_at": {
            "schema": "string"
          },
          "display_mode": {
            "schema": "string"
          },
          "display_name": {
            "schema": "string"
          },
          "id": {
            "schema": "string"
          },
          "preferences": {
            "schema": "json"
          },
          "role": {
            "schema": "string"
          },
          "theme": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          },
          "username": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "auth_user_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "display_mode": {
            "schema": "string",
            "optional": true
          },
          "display_name": {
            "schema": "string"
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "preferences": {
            "schema": "json",
            "optional": true
          },
          "role": {
            "schema": "string",
            "optional": true
          },
          "theme": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "username": {
            "schema": "string"
          }
        }
      },
      "update": {
        "object": {
          "auth_user_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "display_mode": {
            "schema": "string",
            "optional": true
          },
          "display_name": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "preferences": {
            "schema": "json",
            "optional": true
          },
          "role": {
            "schema": "string",
            "optional": true
          },
          "theme": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          },
          "username": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_runtime": {
      "row": {
        "object": {
          "environment": {
            "schema": "string"
          },
          "id": {
            "schema": "boolean"
          },
          "inventory_row_count": {
            "schema": "number"
          },
          "production_project_ref": {
            "schema": "string"
          },
          "seed_version": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "seeded_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "updated_at": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "environment": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "boolean",
            "optional": true
          },
          "inventory_row_count": {
            "schema": "number",
            "optional": true
          },
          "production_project_ref": {
            "schema": "string",
            "optional": true
          },
          "seed_version": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "seeded_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "environment": {
            "schema": "string",
            "optional": true
          },
          "id": {
            "schema": "boolean",
            "optional": true
          },
          "inventory_row_count": {
            "schema": "number",
            "optional": true
          },
          "production_project_ref": {
            "schema": "string",
            "optional": true
          },
          "seed_version": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "seeded_at": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_upload_jobs": {
      "row": {
        "object": {
          "attempt_count": {
            "schema": "number"
          },
          "created_at": {
            "schema": "string"
          },
          "error_message": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "id": {
            "schema": "string"
          },
          "inventory_unique_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "metadata": {
            "schema": "json"
          },
          "object_path": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "request_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "state": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "attempt_count": {
            "schema": "number",
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "error_message": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "inventory_unique_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "object_path": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "state": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "attempt_count": {
            "schema": "number",
            "optional": true
          },
          "created_at": {
            "schema": "string",
            "optional": true
          },
          "error_message": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "inventory_unique_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "metadata": {
            "schema": "json",
            "optional": true
          },
          "object_path": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "request_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "state": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      }
    },
    "sandbox_workflow_records": {
      "row": {
        "object": {
          "assigned_to": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "count_value": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            }
          },
          "id": {
            "schema": "string"
          },
          "module_key": {
            "schema": "string"
          },
          "payload": {
            "schema": "json"
          },
          "source_row_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "subtitle": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            }
          },
          "title": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string"
          }
        }
      },
      "insert": {
        "object": {
          "assigned_to": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "count_value": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "module_key": {
            "schema": "string"
          },
          "payload": {
            "schema": "json",
            "optional": true
          },
          "source_row_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "subtitle": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "title": {
            "schema": "string"
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      },
      "update": {
        "object": {
          "assigned_to": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "count_value": {
            "schema": {
              "oneOf": [
                "number",
                "null"
              ]
            },
            "optional": true
          },
          "id": {
            "schema": "string",
            "optional": true
          },
          "module_key": {
            "schema": "string",
            "optional": true
          },
          "payload": {
            "schema": "json",
            "optional": true
          },
          "source_row_id": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "status": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "subtitle": {
            "schema": {
              "oneOf": [
                "string",
                "null"
              ]
            },
            "optional": true
          },
          "title": {
            "schema": "string",
            "optional": true
          },
          "updated_at": {
            "schema": "string",
            "optional": true
          }
        }
      }
    }
  },
  "functions": {
    "add_codex_ops_message_v1": {
      "oneOf": [
        {
          "object": {
            "p_body": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_idempotency_key": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "apply_codex_ops_repair_result_service_v2": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_payload": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              },
              "optional": true
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "apply_codex_ops_service_event_v1": {
      "oneOf": [
        {
          "object": {
            "p_action": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_payload": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              },
              "optional": true
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "approve_codex_ops_deployment_v1": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_head_sha": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_idempotency_key": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "bloomscapes_demo_api_v1": {
      "oneOf": [
        {
          "object": {
            "p_action": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_actor": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_epoch": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            },
            "p_expected": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            },
            "p_payload": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              },
              "optional": true
            },
            "p_session": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              },
              "optional": true
            },
            "p_token": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "cancel_codex_ops_task_v1": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_idempotency_key": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "create_codex_ops_task_v1": {
      "oneOf": [
        {
          "object": {
            "p_description": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_idempotency_key": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "get_access_control_health_snapshot_v1": {
      "oneOf": [
        {
          "object": {}
        }
      ]
    },
    "get_access_control_matrix_v1": {
      "oneOf": [
        {
          "object": {
            "p_policy_version_id": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "get_app_user_directory": {
      "oneOf": [
        {
          "object": {
            "requested_roles": {
              "schema": {
                "oneOf": [
                  {
                    "array": "string"
                  },
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "get_codex_ops_capabilities_v1": {
      "oneOf": [
        {
          "object": {}
        }
      ]
    },
    "get_codex_ops_health_snapshot_v1": {
      "oneOf": [
        {
          "object": {}
        }
      ]
    },
    "get_codex_ops_runner_context_service_v1": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "get_codex_ops_task_v1": {
      "oneOf": [
        {
          "object": {
            "p_after_event_id": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            },
            "p_event_limit": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "get_limited_access_control_matrix_v1": {
      "oneOf": [
        {
          "object": {
            "p_query": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "get_my_app_permissions_v1": {
      "oneOf": [
        {
          "object": {}
        }
      ]
    },
    "list_codex_ops_tasks_v1": {
      "oneOf": [
        {
          "object": {
            "p_before": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              },
              "optional": true
            },
            "p_limit": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "list_expired_codex_ops_evidence_service_v1": {
      "oneOf": [
        {
          "object": {
            "p_limit": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    },
    "publish_access_control_policy_v1": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_reason": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "request_codex_ops_escalation_v1": {
      "oneOf": [
        {
          "object": {
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_idempotency_key": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_reason": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            },
            "p_task_id": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "save_access_control_draft_v1": {
      "oneOf": [
        {
          "object": {
            "p_changes": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              }
            },
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_reason": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "save_limited_access_override_v1": {
      "oneOf": [
        {
          "object": {
            "p_changes": {
              "schema": {
                "oneOf": [
                  "json",
                  "null"
                ]
              }
            },
            "p_expected_revision": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              }
            },
            "p_reason": {
              "schema": {
                "oneOf": [
                  "string",
                  "null"
                ]
              }
            }
          }
        }
      ]
    },
    "v2_refresh_hold_learning_profiles": {
      "oneOf": [
        {
          "object": {}
        }
      ]
    },
    "v2_refresh_hold_learning_weather_features": {
      "oneOf": [
        {
          "object": {
            "p_limit": {
              "schema": {
                "oneOf": [
                  "number",
                  "null"
                ]
              },
              "optional": true
            }
          }
        }
      ]
    }
  },
  "functionReturns": {
    "add_codex_ops_message_v1": {
      "oneOf": [
        "json"
      ]
    },
    "apply_codex_ops_repair_result_service_v2": {
      "oneOf": [
        "json"
      ]
    },
    "apply_codex_ops_service_event_v1": {
      "oneOf": [
        "json"
      ]
    },
    "approve_codex_ops_deployment_v1": {
      "oneOf": [
        "json"
      ]
    },
    "bloomscapes_demo_api_v1": {
      "oneOf": [
        "json"
      ]
    },
    "cancel_codex_ops_task_v1": {
      "oneOf": [
        "json"
      ]
    },
    "create_codex_ops_task_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_access_control_health_snapshot_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_access_control_matrix_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_app_user_directory": {
      "oneOf": [
        {
          "oneOf": [
            {
              "array": {
                "oneOf": [
                  {
                    "object": {
                      "display_name": {
                        "schema": {
                          "oneOf": [
                            "string",
                            "null"
                          ]
                        }
                      },
                      "division": {
                        "schema": {
                          "oneOf": [
                            "string",
                            "null"
                          ]
                        }
                      },
                      "language": {
                        "schema": {
                          "oneOf": [
                            "string",
                            "null"
                          ]
                        }
                      },
                      "role": {
                        "schema": {
                          "oneOf": [
                            "string",
                            "null"
                          ]
                        }
                      },
                      "username": {
                        "schema": {
                          "oneOf": [
                            "string",
                            "null"
                          ]
                        }
                      }
                    }
                  },
                  "null"
                ]
              }
            },
            "null"
          ]
        }
      ]
    },
    "get_codex_ops_capabilities_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_codex_ops_health_snapshot_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_codex_ops_runner_context_service_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_codex_ops_task_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_limited_access_control_matrix_v1": {
      "oneOf": [
        "json"
      ]
    },
    "get_my_app_permissions_v1": {
      "oneOf": [
        "json"
      ]
    },
    "list_codex_ops_tasks_v1": {
      "oneOf": [
        "json"
      ]
    },
    "list_expired_codex_ops_evidence_service_v1": {
      "oneOf": [
        "json"
      ]
    },
    "publish_access_control_policy_v1": {
      "oneOf": [
        "json"
      ]
    },
    "request_codex_ops_escalation_v1": {
      "oneOf": [
        "json"
      ]
    },
    "save_access_control_draft_v1": {
      "oneOf": [
        "json"
      ]
    },
    "save_limited_access_override_v1": {
      "oneOf": [
        "json"
      ]
    },
    "v2_refresh_hold_learning_profiles": {
      "oneOf": [
        {
          "oneOf": [
            "number",
            "null"
          ]
        }
      ]
    },
    "v2_refresh_hold_learning_weather_features": {
      "oneOf": [
        {
          "oneOf": [
            "number",
            "null"
          ]
        }
      ]
    }
  }
};
