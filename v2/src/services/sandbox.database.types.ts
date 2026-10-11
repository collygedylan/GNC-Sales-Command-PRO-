export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ph_27f1_hl_po: {
        Row: {
          common_name: string | null
          created_at: string | null
          genus: string | null
          id: string
          item_code: string | null
          lot: string | null
          lot_pend_rec: number | null
          po_comments: string | null
          po_ordered: number | null
          po_received: number | null
          po_remain: number | null
          report_date: string | null
          row_index: number | null
          run_id: string | null
          seas_on_hand: number | null
          size: string | null
          source_payload: Json
        }
        Insert: {
          common_name?: string | null
          created_at?: string | null
          genus?: string | null
          id: string
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index?: number | null
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_payload?: Json
        }
        Update: {
          common_name?: string | null
          created_at?: string | null
          genus?: string | null
          id?: string
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index?: number | null
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_payload?: Json
        }
        Relationships: []
      }
      ph_active_request: {
        Row: {
          av_note: string | null
          commonname: string | null
          completed_by_display: string | null
          completed_by_email: string | null
          completed_by_username: string | null
          contsize: string | null
          created_at: string | null
          date_completed: string | null
          desired_caliper: string | null
          desired_spec: string | null
          est_ship: string | null
          field_tag_color: string | null
          id: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_id: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: number | null
          qualitycode: string | null
          req_archived: boolean
          req_caliper: string | null
          req_comments: string | null
          req_customer: string | null
          req_match: number | null
          req_photo_link: string | null
          req_photo_mode: string | null
          req_photo_name: string | null
          req_pic_note: string | null
          req_qty: number | null
          req_rep_action: string | null
          req_reserve: string | null
          req_sales_note: string | null
          req_spec: string | null
          req_status: string | null
          request_created_by_display: string | null
          request_created_by_email: string | null
          request_created_by_username: string | null
          request_folder: string | null
          request_note: string | null
          request_selected_rep_display: string | null
          request_selected_rep_email: string | null
          request_selected_rep_username: string | null
          requested_by: string | null
          season_supply: number | null
          source_payload: Json
          unique_id: string
        }
        Insert: {
          av_note?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string | null
          date_completed?: string | null
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          id: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: number | null
          qualitycode?: string | null
          req_archived?: boolean
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: number | null
          req_photo_link?: string | null
          req_photo_mode?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: number | null
          req_rep_action?: string | null
          req_reserve?: string | null
          req_sales_note?: string | null
          req_spec?: string | null
          req_status?: string | null
          request_created_by_display?: string | null
          request_created_by_email?: string | null
          request_created_by_username?: string | null
          request_folder?: string | null
          request_note?: string | null
          request_selected_rep_display?: string | null
          request_selected_rep_email?: string | null
          request_selected_rep_username?: string | null
          requested_by?: string | null
          season_supply?: number | null
          source_payload?: Json
          unique_id: string
        }
        Update: {
          av_note?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string | null
          date_completed?: string | null
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          id?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: number | null
          qualitycode?: string | null
          req_archived?: boolean
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: number | null
          req_photo_link?: string | null
          req_photo_mode?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: number | null
          req_rep_action?: string | null
          req_reserve?: string | null
          req_sales_note?: string | null
          req_spec?: string | null
          req_status?: string | null
          request_created_by_display?: string | null
          request_created_by_email?: string | null
          request_created_by_username?: string | null
          request_folder?: string | null
          request_note?: string | null
          request_selected_rep_display?: string | null
          request_selected_rep_email?: string | null
          request_selected_rep_username?: string | null
          requested_by?: string | null
          season_supply?: number | null
          source_payload?: Json
          unique_id?: string
        }
        Relationships: []
      }
      ph_app_live_pilot_flags: {
        Row: {
          enabled: boolean
          feature_key: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_app_user_preferences: {
        Row: {
          cohort_id: string
          created_at: string
          display_mode: string
          theme_mode: string
          updated_at: string
          user_key: string
        }
        Insert: {
          cohort_id?: string
          created_at?: string
          display_mode?: string
          theme_mode?: string
          updated_at?: string
          user_key: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          display_mode?: string
          theme_mode?: string
          updated_at?: string
          user_key?: string
        }
        Relationships: []
      }
      ph_cav_import: {
        Row: {
          available: number | null
          brand: string | null
          commonname: string | null
          contsize: string | null
          created_at: string | null
          holdstopreason: string | null
          hz: string | null
          itemcode: string | null
          last_updated: string | null
          order_qty: number | null
          product_description: string | null
          ptravailable: number | null
          reserved_qty: number | null
          season: string | null
          source_payload: Json
          spec: string | null
          unique_id: string
          unitprice: number | null
        }
        Insert: {
          available?: number | null
          brand?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string | null
          holdstopreason?: string | null
          hz?: string | null
          itemcode?: string | null
          last_updated?: string | null
          order_qty?: number | null
          product_description?: string | null
          ptravailable?: number | null
          reserved_qty?: number | null
          season?: string | null
          source_payload?: Json
          spec?: string | null
          unique_id: string
          unitprice?: number | null
        }
        Update: {
          available?: number | null
          brand?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string | null
          holdstopreason?: string | null
          hz?: string | null
          itemcode?: string | null
          last_updated?: string | null
          order_qty?: number | null
          product_description?: string | null
          ptravailable?: number | null
          reserved_qty?: number | null
          season?: string | null
          source_payload?: Json
          spec?: string | null
          unique_id?: string
          unitprice?: number | null
        }
        Relationships: []
      }
      ph_dock_team_status: {
        Row: {
          checker: string | null
          dock_num: string
          inspector: string | null
          mistake: string | null
          source_payload: Json
          status: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          checker?: string | null
          dock_num: string
          inspector?: string | null
          mistake?: string | null
          source_payload?: Json
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          checker?: string | null
          dock_num?: string
          inspector?: string | null
          mistake?: string | null
          source_payload?: Json
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_master_inventory: {
        Row: {
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: number | null
          botanicalname: string | null
          brand: string | null
          caliper: string | null
          commonname: string | null
          consigneecity: string | null
          consigneename: string | null
          consigneestate: string | null
          contsize: string | null
          customername: string | null
          date_completed: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_num: string | null
          eval_task_assigned_at: string | null
          eval_task_assigned_by: string | null
          eval_task_completed_at: string | null
          eval_task_completed_by: string | null
          eval_task_hold_action: string | null
          eval_task_hold_code: string | null
          eval_task_hold_reason: string | null
          eval_task_instructions: string | null
          eval_task_moved_up_qty: number | null
          eval_task_recount_qty: number | null
          eval_task_result_note: string | null
          eval_task_status: string | null
          eval_task_type: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          genusname: string | null
          grower: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          isreserve: string | null
          itemcode: string
          itemspec: string | null
          last_updated: string | null
          listprice: number | null
          loc_match_qty: number | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          lotcode: string | null
          match: number | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: number | null
          ptronhand: number | null
          ptrreviewed: number | null
          purchaseordernumber: string | null
          qualitycode: string | null
          quantityordered: number | null
          quantityshipped: number | null
          requestdate: string | null
          requestdateweek: string | null
          sales_note: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: number | null
          season: string | null
          season_supply: number | null
          source: string | null
          source_payload: Json
          spec: string | null
          stopnumber: string | null
          suspend: string | null
          suspendto: string | null
          tagcode: string | null
          tripnumber: string | null
          unique_id: string
          varietycode: string | null
        }
        Insert: {
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: number | null
          botanicalname?: string | null
          brand?: string | null
          caliper?: string | null
          commonname?: string | null
          consigneecity?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          contsize?: string | null
          customername?: string | null
          date_completed?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_num?: string | null
          eval_task_assigned_at?: string | null
          eval_task_assigned_by?: string | null
          eval_task_completed_at?: string | null
          eval_task_completed_by?: string | null
          eval_task_hold_action?: string | null
          eval_task_hold_code?: string | null
          eval_task_hold_reason?: string | null
          eval_task_instructions?: string | null
          eval_task_moved_up_qty?: number | null
          eval_task_recount_qty?: number | null
          eval_task_result_note?: string | null
          eval_task_status?: string | null
          eval_task_type?: string | null
          field_tag_color?: string | null
          fieldtagcolor?: string | null
          genusname?: string | null
          grower?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          isreserve?: string | null
          itemcode: string
          itemspec?: string | null
          last_updated?: string | null
          listprice?: number | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          lotcode?: string | null
          match?: number | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: number | null
          ptronhand?: number | null
          ptrreviewed?: number | null
          purchaseordernumber?: string | null
          qualitycode?: string | null
          quantityordered?: number | null
          quantityshipped?: number | null
          requestdate?: string | null
          requestdateweek?: string | null
          sales_note?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          saleyear?: number | null
          season?: string | null
          season_supply?: number | null
          source?: string | null
          source_payload?: Json
          spec?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspendto?: string | null
          tagcode?: string | null
          tripnumber?: string | null
          unique_id: string
          varietycode?: string | null
        }
        Update: {
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: number | null
          botanicalname?: string | null
          brand?: string | null
          caliper?: string | null
          commonname?: string | null
          consigneecity?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          contsize?: string | null
          customername?: string | null
          date_completed?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_num?: string | null
          eval_task_assigned_at?: string | null
          eval_task_assigned_by?: string | null
          eval_task_completed_at?: string | null
          eval_task_completed_by?: string | null
          eval_task_hold_action?: string | null
          eval_task_hold_code?: string | null
          eval_task_hold_reason?: string | null
          eval_task_instructions?: string | null
          eval_task_moved_up_qty?: number | null
          eval_task_recount_qty?: number | null
          eval_task_result_note?: string | null
          eval_task_status?: string | null
          eval_task_type?: string | null
          field_tag_color?: string | null
          fieldtagcolor?: string | null
          genusname?: string | null
          grower?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          isreserve?: string | null
          itemcode?: string
          itemspec?: string | null
          last_updated?: string | null
          listprice?: number | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          lotcode?: string | null
          match?: number | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: number | null
          ptronhand?: number | null
          ptrreviewed?: number | null
          purchaseordernumber?: string | null
          qualitycode?: string | null
          quantityordered?: number | null
          quantityshipped?: number | null
          requestdate?: string | null
          requestdateweek?: string | null
          sales_note?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          saleyear?: number | null
          season?: string | null
          season_supply?: number | null
          source?: string | null
          source_payload?: Json
          spec?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspendto?: string | null
          tagcode?: string | null
          tripnumber?: string | null
          unique_id?: string
          varietycode?: string | null
        }
        Relationships: []
      }
      ph_runtime_feature_flags: {
        Row: {
          config: Json
          enabled: boolean
          flag_key: string
          rollout_percent: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          enabled: boolean
          flag_key: string
          rollout_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          enabled?: boolean
          flag_key?: string
          rollout_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          disabled_at: string | null
          display_name: string | null
          division: string
          id: string
          language: string
          legacy_user_id: number | null
          locked_until: string | null
          must_change_password: boolean
          passkey_pilot: boolean
          role: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          display_name?: string | null
          division?: string
          id: string
          language?: string
          legacy_user_id?: number | null
          locked_until?: string | null
          must_change_password?: boolean
          passkey_pilot?: boolean
          role?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          display_name?: string | null
          division?: string
          id?: string
          language?: string
          legacy_user_id?: number | null
          locked_until?: string | null
          must_change_password?: boolean
          passkey_pilot?: boolean
          role?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      sandbox_event_log: {
        Row: {
          actor_username: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: number
          payload: Json
        }
        Insert: {
          actor_username?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: never
          payload?: Json
        }
        Update: {
          actor_username?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: never
          payload?: Json
        }
        Relationships: []
      }
      sandbox_message_threads: {
        Row: {
          id: string
          last_message_at: string
          last_message_preview: string | null
          metadata: Json
          participant_usernames: string[]
          status: string
          subject: string
        }
        Insert: {
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          metadata?: Json
          participant_usernames?: string[]
          status?: string
          subject: string
        }
        Update: {
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          metadata?: Json
          participant_usernames?: string[]
          status?: string
          subject?: string
        }
        Relationships: []
      }
      sandbox_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          metadata: Json
          sender_username: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          metadata?: Json
          sender_username: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          metadata?: Json
          sender_username?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sandbox_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "sandbox_message_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      sandbox_profiles: {
        Row: {
          auth_user_id: string | null
          created_at: string
          display_mode: string
          display_name: string
          id: string
          preferences: Json
          role: string
          theme: string
          updated_at: string
          username: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          display_mode?: string
          display_name: string
          id?: string
          preferences?: Json
          role?: string
          theme?: string
          updated_at?: string
          username: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          display_mode?: string
          display_name?: string
          id?: string
          preferences?: Json
          role?: string
          theme?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      sandbox_runtime: {
        Row: {
          environment: string
          id: boolean
          inventory_row_count: number
          production_project_ref: string
          seed_version: string | null
          seeded_at: string | null
          updated_at: string
        }
        Insert: {
          environment?: string
          id?: boolean
          inventory_row_count?: number
          production_project_ref?: string
          seed_version?: string | null
          seeded_at?: string | null
          updated_at?: string
        }
        Update: {
          environment?: string
          id?: boolean
          inventory_row_count?: number
          production_project_ref?: string
          seed_version?: string | null
          seeded_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sandbox_upload_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          error_message: string | null
          id: string
          inventory_unique_id: string | null
          metadata: Json
          object_path: string | null
          request_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          id?: string
          inventory_unique_id?: string | null
          metadata?: Json
          object_path?: string | null
          request_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_message?: string | null
          id?: string
          inventory_unique_id?: string | null
          metadata?: Json
          object_path?: string | null
          request_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      sandbox_workflow_records: {
        Row: {
          assigned_to: string | null
          count_value: number | null
          id: string
          module_key: string
          payload: Json
          source_row_id: string | null
          status: string | null
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          count_value?: number | null
          id?: string
          module_key: string
          payload?: Json
          source_row_id?: string | null
          status?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          count_value?: number | null
          id?: string
          module_key?: string
          payload?: Json
          source_row_id?: string | null
          status?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_codex_ops_message_v1: {
        Args: {
          p_body: string
          p_expected_revision: number
          p_idempotency_key: string
          p_task_id: string
        }
        Returns: Json
      }
      apply_codex_ops_repair_result_service_v2: {
        Args: {
          p_expected_revision: number
          p_payload?: Json
          p_task_id: string
        }
        Returns: Json
      }
      apply_codex_ops_service_event_v1: {
        Args: {
          p_action: string
          p_expected_revision: number
          p_payload?: Json
          p_task_id: string
        }
        Returns: Json
      }
      approve_codex_ops_deployment_v1: {
        Args: {
          p_expected_revision: number
          p_head_sha: string
          p_idempotency_key: string
          p_task_id: string
        }
        Returns: Json
      }
      bloomscapes_demo_api_v1: {
        Args: {
          p_action: string
          p_actor: string
          p_epoch?: number
          p_expected?: number
          p_payload?: Json
          p_session?: string
          p_token?: string
        }
        Returns: Json
      }
      cancel_codex_ops_task_v1: {
        Args: {
          p_expected_revision: number
          p_idempotency_key: string
          p_task_id: string
        }
        Returns: Json
      }
      create_codex_ops_task_v1: {
        Args: { p_description: string; p_idempotency_key: string }
        Returns: Json
      }
      get_access_control_health_snapshot_v1: { Args: never; Returns: Json }
      get_access_control_matrix_v1: {
        Args: { p_policy_version_id?: number }
        Returns: Json
      }
      get_app_user_directory: {
        Args: { requested_roles?: string[] }
        Returns: {
          display_name: string
          division: string
          language: string
          role: string
          username: string
        }[]
      }
      get_codex_ops_capabilities_v1: { Args: never; Returns: Json }
      get_codex_ops_health_snapshot_v1: { Args: never; Returns: Json }
      get_codex_ops_runner_context_service_v1: {
        Args: { p_expected_revision: number; p_task_id: string }
        Returns: Json
      }
      get_codex_ops_task_v1: {
        Args: {
          p_after_event_id?: number
          p_event_limit?: number
          p_task_id: string
        }
        Returns: Json
      }
      get_limited_access_control_matrix_v1: {
        Args: { p_query?: Json }
        Returns: Json
      }
      get_my_app_permissions_v1: { Args: never; Returns: Json }
      list_codex_ops_tasks_v1: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      list_expired_codex_ops_evidence_service_v1: {
        Args: { p_limit?: number }
        Returns: Json
      }
      publish_access_control_policy_v1: {
        Args: { p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      request_codex_ops_escalation_v1: {
        Args: {
          p_expected_revision: number
          p_idempotency_key: string
          p_reason: string
          p_task_id: string
        }
        Returns: Json
      }
      save_access_control_draft_v1: {
        Args: { p_changes: Json; p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      save_limited_access_override_v1: {
        Args: { p_changes: Json; p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      v2_refresh_hold_learning_profiles: { Args: never; Returns: number }
      v2_refresh_hold_learning_weather_features: {
        Args: { p_limit?: number }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

