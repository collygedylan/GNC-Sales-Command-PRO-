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
      app_dataset_revisions: {
        Row: {
          changed_at: string
          key: string
          revision: number
          state: string
        }
        Insert: {
          changed_at?: string
          key: string
          revision?: number
          state?: string
        }
        Update: {
          changed_at?: string
          key?: string
          revision?: number
          state?: string
        }
        Relationships: []
      }
      core_employees: {
        Row: {
          active: boolean
          created_at: string
          department: string
          emp_number: string
          hired_date: string | null
          id: string
          name: string
          profile_id: string | null
          role: string
          updated_at: string
          vacation_balance: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          department: string
          emp_number: string
          hired_date?: string | null
          id?: string
          name: string
          profile_id?: string | null
          role?: string
          updated_at?: string
          vacation_balance?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string
          emp_number?: string
          hired_date?: string | null
          id?: string
          name?: string
          profile_id?: string | null
          role?: string
          updated_at?: string
          vacation_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "core_employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_calendar_reminder_outbox: {
        Row: {
          attempt_count: number
          calendar_event_id: string
          created_at: string
          event_key: string
          event_type: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          payload: Json
          recipient_username: string
          sent_at: string | null
          status: string
        }
        Insert: {
          attempt_count?: number
          calendar_event_id: string
          created_at?: string
          event_key: string
          event_type: string
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          payload?: Json
          recipient_username?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          calendar_event_id?: string
          created_at?: string
          event_key?: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          payload?: Json
          recipient_username?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      hr_events: {
        Row: {
          created_at: string
          created_by_profile_id: string
          details: Json
          effective_at: string
          emp_number: string
          event_type: string
          id: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          details?: Json
          effective_at?: string
          emp_number: string
          event_type: string
          id?: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          details?: Json
          effective_at?: string
          emp_number?: string
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_events_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_events_emp_number_fkey"
            columns: ["emp_number"]
            isOneToOne: false
            referencedRelation: "core_employees"
            referencedColumns: ["emp_number"]
          },
        ]
      }
      hr_job_codes: {
        Row: {
          created_at: string
          department: string | null
          description: string
          enabled: boolean
          job_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          description?: string
          enabled?: boolean
          job_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string | null
          description?: string
          enabled?: boolean
          job_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      labor_timesheets: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_timesheets_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "core_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_timesheets_job_code_fkey"
            columns: ["job_code"]
            isOneToOne: false
            referencedRelation: "hr_job_codes"
            referencedColumns: ["job_code"]
          },
        ]
      }
      labor_timesheets_202501: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202502: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202503: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202504: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202505: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202506: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202507: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202508: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202509: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202510: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202511: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202512: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202601: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202602: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202603: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202604: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202605: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202606: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202607: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202608: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202609: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202610: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202611: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202612: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202701: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202702: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202703: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202704: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202705: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202706: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202707: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202708: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202709: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202710: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202711: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202712: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202801: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202802: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202803: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202804: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202805: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202806: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202807: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202808: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202809: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202810: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202811: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202812: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202901: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202902: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202903: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202904: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202905: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202906: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202907: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202908: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202909: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202910: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202911: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_202912: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203001: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203002: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203003: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203004: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203005: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203006: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203007: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203008: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203009: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203010: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203011: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203012: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203101: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203102: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203103: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203104: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203105: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203106: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203107: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203108: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203109: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203110: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203111: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203112: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203201: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203202: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203203: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203204: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203205: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203206: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203207: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203208: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203209: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203210: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203211: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203212: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203301: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203302: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203303: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203304: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203305: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203306: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203307: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203308: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203309: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203310: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203311: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203312: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203401: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203402: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203403: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203404: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203405: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203406: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203407: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203408: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203409: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203410: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203411: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203412: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203501: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203502: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203503: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203504: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203505: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203506: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203507: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203508: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203509: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203510: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203511: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_203512: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      labor_timesheets_default: {
        Row: {
          created_at: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id: string
          job_code: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          employee_id: string
          hours: number
          id?: string
          job_code: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          employee_id?: string
          hours?: number
          id?: string
          job_code?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: []
      }
      marketing_materials: {
        Row: {
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          design_json: Json
          format: string
          image_path: string | null
          image_url: string | null
          title: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          design_json?: Json
          format?: string
          image_path?: string | null
          image_url?: string | null
          title?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          design_json?: Json
          format?: string
          image_path?: string | null
          image_url?: string | null
          title?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_27f1_hl_po: {
        Row: {
          common_name: string | null
          created_at: string
          genus: string | null
          id: number
          imported_at: string
          imported_po_remain: number | null
          item_code: string | null
          lot: string | null
          lot_pend_rec: number | null
          po_comments: string | null
          po_ordered: number | null
          po_received: number | null
          po_remain: number | null
          report_date: string | null
          row_index: number
          run_id: string | null
          seas_on_hand: number | null
          size: string | null
          source_file_id: string
          source_file_name: string | null
          source_sheet_name: string | null
        }
        Insert: {
          common_name?: string | null
          created_at?: string
          genus?: string | null
          id?: number
          imported_at?: string
          imported_po_remain?: number | null
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index: number
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_file_id: string
          source_file_name?: string | null
          source_sheet_name?: string | null
        }
        Update: {
          common_name?: string | null
          created_at?: string
          genus?: string | null
          id?: number
          imported_at?: string
          imported_po_remain?: number | null
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index?: number
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_file_id?: string
          source_file_name?: string | null
          source_sheet_name?: string | null
        }
        Relationships: []
      }
      ph_27s1_hl_po: {
        Row: {
          common_name: string | null
          created_at: string
          genus: string | null
          id: number
          imported_at: string
          imported_po_remain: number | null
          item_code: string | null
          lot: string | null
          lot_pend_rec: number | null
          po_comments: string | null
          po_ordered: number | null
          po_received: number | null
          po_remain: number | null
          report_date: string | null
          row_index: number
          run_id: string | null
          seas_on_hand: number | null
          size: string | null
          source_file_id: string
          source_file_name: string | null
          source_sheet_name: string | null
        }
        Insert: {
          common_name?: string | null
          created_at?: string
          genus?: string | null
          id?: number
          imported_at?: string
          imported_po_remain?: number | null
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index: number
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_file_id: string
          source_file_name?: string | null
          source_sheet_name?: string | null
        }
        Update: {
          common_name?: string | null
          created_at?: string
          genus?: string | null
          id?: number
          imported_at?: string
          imported_po_remain?: number | null
          item_code?: string | null
          lot?: string | null
          lot_pend_rec?: number | null
          po_comments?: string | null
          po_ordered?: number | null
          po_received?: number | null
          po_remain?: number | null
          report_date?: string | null
          row_index?: number
          run_id?: string | null
          seas_on_hand?: number | null
          size?: string | null
          source_file_id?: string
          source_file_name?: string | null
          source_sheet_name?: string | null
        }
        Relationships: []
      }
      ph_active_request: {
        Row: {
          app_tab_assignment: string | null
          av_note: string | null
          client_batch_id: string | null
          commonname: string | null
          completed_by_display: string | null
          completed_by_email: string | null
          completed_by_username: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          contsize: string | null
          created_at: string | null
          customeridentityid: string | null
          customername: string | null
          date_completed: string | null
          desired_caliper: string | null
          desired_spec: string | null
          est_ship: string | null
          field_tag_color: string | null
          id: number
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_app_tab_assignment: string | null
          master_id: string | null
          move_actual_qty: number | null
          move_approval_stage: string | null
          move_batch_id: string | null
          move_completed_at: string | null
          move_completed_by: string | null
          move_destination_needs_row: boolean | null
          move_dylan_approved_at: string | null
          move_from_locationcode: string | null
          move_group_key: string | null
          move_jd_approved_at: string | null
          move_planned_qty: number | null
          move_status: string | null
          move_to_locationcode: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          req_archived: boolean | null
          req_caliper: string | null
          req_comments: string | null
          req_customer: string | null
          req_match: number | null
          req_photo_link: string | null
          req_photo_mode: string | null
          req_photo_name: string | null
          req_pic_note: string | null
          req_qty: string | null
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
          request_source: string
          requested_by: string | null
          row_version: number
          season_supply: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          app_tab_assignment?: string | null
          av_note?: string | null
          client_batch_id?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string | null
          customeridentityid?: string | null
          customername?: string | null
          date_completed?: string | null
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          id?: number
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_app_tab_assignment?: string | null
          master_id?: string | null
          move_actual_qty?: number | null
          move_approval_stage?: string | null
          move_batch_id?: string | null
          move_completed_at?: string | null
          move_completed_by?: string | null
          move_destination_needs_row?: boolean | null
          move_dylan_approved_at?: string | null
          move_from_locationcode?: string | null
          move_group_key?: string | null
          move_jd_approved_at?: string | null
          move_planned_qty?: number | null
          move_status?: string | null
          move_to_locationcode?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          req_archived?: boolean | null
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: number | null
          req_photo_link?: string | null
          req_photo_mode?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: string | null
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
          request_source?: string
          requested_by?: string | null
          row_version?: number
          season_supply?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          app_tab_assignment?: string | null
          av_note?: string | null
          client_batch_id?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string | null
          customeridentityid?: string | null
          customername?: string | null
          date_completed?: string | null
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          id?: number
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_app_tab_assignment?: string | null
          master_id?: string | null
          move_actual_qty?: number | null
          move_approval_stage?: string | null
          move_batch_id?: string | null
          move_completed_at?: string | null
          move_completed_by?: string | null
          move_destination_needs_row?: boolean | null
          move_dylan_approved_at?: string | null
          move_from_locationcode?: string | null
          move_group_key?: string | null
          move_jd_approved_at?: string | null
          move_planned_qty?: number | null
          move_status?: string | null
          move_to_locationcode?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          req_archived?: boolean | null
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: number | null
          req_photo_link?: string | null
          req_photo_mode?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: string | null
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
          request_source?: string
          requested_by?: string | null
          row_version?: number
          season_supply?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_app_health_events: {
        Row: {
          app_build: string | null
          area: string
          duration_ms: number | null
          event_name: string
          id: number
          metadata: Json
          occurred_at: string
          profile_id: string | null
          sample_rate: number
          sanitized_code: string | null
          severity: string
          username: string | null
        }
        Insert: {
          app_build?: string | null
          area?: string
          duration_ms?: number | null
          event_name: string
          id?: never
          metadata?: Json
          occurred_at?: string
          profile_id?: string | null
          sample_rate?: number
          sanitized_code?: string | null
          severity?: string
          username?: string | null
        }
        Update: {
          app_build?: string | null
          area?: string
          duration_ms?: number | null
          event_name?: string
          id?: never
          metadata?: Json
          occurred_at?: string
          profile_id?: string | null
          sample_rate?: number
          sanitized_code?: string | null
          severity?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ph_app_health_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_app_live_events: {
        Row: {
          actor_display: string | null
          actor_username: string | null
          area: string
          client_id: string | null
          created_at: string
          event_key: string
          event_type: string
          id: string
          payload: Json
          row_ids: string[]
          source_table: string
        }
        Insert: {
          actor_display?: string | null
          actor_username?: string | null
          area: string
          client_id?: string | null
          created_at?: string
          event_key: string
          event_type: string
          id?: string
          payload?: Json
          row_ids?: string[]
          source_table: string
        }
        Update: {
          actor_display?: string | null
          actor_username?: string | null
          area?: string
          client_id?: string | null
          created_at?: string
          event_key?: string
          event_type?: string
          id?: string
          payload?: Json
          row_ids?: string[]
          source_table?: string
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
      ph_app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      ph_app_user_preferences: {
        Row: {
          cohort_id: string
          created_at: string
          display_mode: string
          footer_revision: number
          footer_shortcuts: string[] | null
          footer_updated_at: string | null
          theme_mode: string
          updated_at: string
          user_key: string
        }
        Insert: {
          cohort_id?: string
          created_at?: string
          display_mode?: string
          footer_revision?: number
          footer_shortcuts?: string[] | null
          footer_updated_at?: string | null
          theme_mode?: string
          updated_at?: string
          user_key: string
        }
        Update: {
          cohort_id?: string
          created_at?: string
          display_mode?: string
          footer_revision?: number
          footer_shortcuts?: string[] | null
          footer_updated_at?: string | null
          theme_mode?: string
          updated_at?: string
          user_key?: string
        }
        Relationships: []
      }
      ph_app_users: {
        Row: {
          disabled_at: string | null
          division: string
          failed_login_count: number
          id: number
          language: string
          last_login_at: string | null
          locked_until: string | null
          must_change_password: boolean
          password: string
          password_changed_at: string | null
          password_expires_at: string | null
          password_hash: string | null
          password_salt: string | null
          role: string
          username: string
        }
        Insert: {
          disabled_at?: string | null
          division?: string
          failed_login_count?: number
          id?: number
          language?: string
          last_login_at?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          password: string
          password_changed_at?: string | null
          password_expires_at?: string | null
          password_hash?: string | null
          password_salt?: string | null
          role?: string
          username: string
        }
        Update: {
          disabled_at?: string | null
          division?: string
          failed_login_count?: number
          id?: number
          language?: string
          last_login_at?: string | null
          locked_until?: string | null
          must_change_password?: boolean
          password?: string
          password_changed_at?: string | null
          password_expires_at?: string | null
          password_hash?: string | null
          password_salt?: string | null
          role?: string
          username?: string
        }
        Relationships: []
      }
      ph_av_notes: {
        Row: {
          commonname: string | null
          salesnote: string | null
          unique_id: string
        }
        Insert: {
          commonname?: string | null
          salesnote?: string | null
          unique_id: string
        }
        Update: {
          commonname?: string | null
          salesnote?: string | null
          unique_id?: string
        }
        Relationships: []
      }
      ph_av_option_eval_requests: {
        Row: {
          assignedto: string
          commonname: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_display: string | null
          contsize: string | null
          created_at: string
          created_by: string | null
          created_by_display: string | null
          id: string
          instructions: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          original_av_note: string | null
          original_caliper: string | null
          original_commonname: string | null
          original_contsize: string | null
          original_itemcode: string | null
          original_locationcode: string | null
          original_lotcode: string | null
          original_photo_link: string | null
          original_photo_name: string | null
          original_priority: string | null
          original_ptravailable: number | null
          original_ptronhand: number | null
          original_row_snapshot: Json
          original_s_lts: number | null
          original_source: string | null
          original_spec: string | null
          priority: string | null
          ptravailable: number | null
          ptronhand: number | null
          result_av_note: string | null
          result_caliper: string | null
          result_comments: string | null
          result_loc_match_percent: number | null
          result_photo_link: string | null
          result_photo_name: string | null
          result_pick_note: string | null
          result_spec: string | null
          s_lts: number | null
          selected_av_note: string | null
          selected_caliper: string | null
          selected_photo_link: string | null
          selected_photo_name: string | null
          selected_row_snapshot: Json
          selected_spec: string | null
          source: string | null
          status: string
          unique_id: string | null
          updated_at: string
          updated_by: string | null
          updated_by_display: string | null
        }
        Insert: {
          assignedto: string
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_display?: string | null
          contsize?: string | null
          created_at?: string
          created_by?: string | null
          created_by_display?: string | null
          id?: string
          instructions: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          original_av_note?: string | null
          original_caliper?: string | null
          original_commonname?: string | null
          original_contsize?: string | null
          original_itemcode?: string | null
          original_locationcode?: string | null
          original_lotcode?: string | null
          original_photo_link?: string | null
          original_photo_name?: string | null
          original_priority?: string | null
          original_ptravailable?: number | null
          original_ptronhand?: number | null
          original_row_snapshot?: Json
          original_s_lts?: number | null
          original_source?: string | null
          original_spec?: string | null
          priority?: string | null
          ptravailable?: number | null
          ptronhand?: number | null
          result_av_note?: string | null
          result_caliper?: string | null
          result_comments?: string | null
          result_loc_match_percent?: number | null
          result_photo_link?: string | null
          result_photo_name?: string | null
          result_pick_note?: string | null
          result_spec?: string | null
          s_lts?: number | null
          selected_av_note?: string | null
          selected_caliper?: string | null
          selected_photo_link?: string | null
          selected_photo_name?: string | null
          selected_row_snapshot?: Json
          selected_spec?: string | null
          source?: string | null
          status?: string
          unique_id?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_display?: string | null
        }
        Update: {
          assignedto?: string
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_display?: string | null
          contsize?: string | null
          created_at?: string
          created_by?: string | null
          created_by_display?: string | null
          id?: string
          instructions?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          original_av_note?: string | null
          original_caliper?: string | null
          original_commonname?: string | null
          original_contsize?: string | null
          original_itemcode?: string | null
          original_locationcode?: string | null
          original_lotcode?: string | null
          original_photo_link?: string | null
          original_photo_name?: string | null
          original_priority?: string | null
          original_ptravailable?: number | null
          original_ptronhand?: number | null
          original_row_snapshot?: Json
          original_s_lts?: number | null
          original_source?: string | null
          original_spec?: string | null
          priority?: string | null
          ptravailable?: number | null
          ptronhand?: number | null
          result_av_note?: string | null
          result_caliper?: string | null
          result_comments?: string | null
          result_loc_match_percent?: number | null
          result_photo_link?: string | null
          result_photo_name?: string | null
          result_pick_note?: string | null
          result_spec?: string | null
          s_lts?: number | null
          selected_av_note?: string | null
          selected_caliper?: string | null
          selected_photo_link?: string | null
          selected_photo_name?: string | null
          selected_row_snapshot?: Json
          selected_spec?: string | null
          source?: string | null
          status?: string
          unique_id?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_display?: string | null
        }
        Relationships: []
      }
      ph_bunch_counts: {
        Row: {
          blockalpha: string | null
          commonname: string | null
          contsize: string | null
          counted_at: string | null
          counted_by_display: string | null
          counted_by_username: string | null
          counted_qty: number | null
          created_at: string
          direction: string
          genus: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          row_order: number
          season: string | null
          snapshot: Json
          source_unique_id: string
          unique_id: string
          updated_at: string
          updated_by_display: string | null
          updated_by_username: string | null
        }
        Insert: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          counted_at?: string | null
          counted_by_display?: string | null
          counted_by_username?: string | null
          counted_qty?: number | null
          created_at?: string
          direction?: string
          genus?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          row_order?: number
          season?: string | null
          snapshot?: Json
          source_unique_id: string
          unique_id: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Update: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          counted_at?: string | null
          counted_by_display?: string | null
          counted_by_username?: string | null
          counted_qty?: number | null
          created_at?: string
          direction?: string
          genus?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          row_order?: number
          season?: string | null
          snapshot?: Json
          source_unique_id?: string
          unique_id?: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Relationships: []
      }
      ph_cav_import: {
        Row: {
          available: string | null
          brand: string | null
          brand_code: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          ext_item_total: string | null
          filename: string | null
          h: string | null
          hold_reason: string | null
          holdstopreason: string | null
          hot_price: string | null
          hz: string | null
          itemcode: string | null
          last_updated: string | null
          n_star: string | null
          order_qty: string | null
          ordertotal: string | null
          product_description: string | null
          ptravailable: string | null
          reserved_qty: string | null
          season: string | null
          spec: string | null
          unique_id: string
          unit_price: string | null
          unitprice: string | null
        }
        Insert: {
          available?: string | null
          brand?: string | null
          brand_code?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          ext_item_total?: string | null
          filename?: string | null
          h?: string | null
          hold_reason?: string | null
          holdstopreason?: string | null
          hot_price?: string | null
          hz?: string | null
          itemcode?: string | null
          last_updated?: string | null
          n_star?: string | null
          order_qty?: string | null
          ordertotal?: string | null
          product_description?: string | null
          ptravailable?: string | null
          reserved_qty?: string | null
          season?: string | null
          spec?: string | null
          unique_id: string
          unit_price?: string | null
          unitprice?: string | null
        }
        Update: {
          available?: string | null
          brand?: string | null
          brand_code?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          ext_item_total?: string | null
          filename?: string | null
          h?: string | null
          hold_reason?: string | null
          holdstopreason?: string | null
          hot_price?: string | null
          hz?: string | null
          itemcode?: string | null
          last_updated?: string | null
          n_star?: string | null
          order_qty?: string | null
          ordertotal?: string | null
          product_description?: string | null
          ptravailable?: string | null
          reserved_qty?: string | null
          season?: string | null
          spec?: string | null
          unique_id?: string
          unit_price?: string | null
          unitprice?: string | null
        }
        Relationships: []
      }
      ph_chat_conversations: {
        Row: {
          created_at: string
          created_by: string
          created_by_display: string | null
          id: string
          is_group: boolean
          last_message_at: string | null
          last_message_preview: string | null
          last_message_sender: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          created_by_display?: string | null
          id?: string
          is_group?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          created_by_display?: string | null
          id?: string
          is_group?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          last_message_sender?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ph_chat_members: {
        Row: {
          id: string
          last_read_at: string | null
          thread_id: string | null
          username: string
        }
        Insert: {
          id?: string
          last_read_at?: string | null
          thread_id?: string | null
          username: string
        }
        Update: {
          id?: string
          last_read_at?: string | null
          thread_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_chat_members_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ph_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_chat_messages: {
        Row: {
          audio_duration_seconds: number | null
          audio_mime_type: string | null
          audio_storage_path: string | null
          audio_url: string | null
          body: string | null
          client_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          message_text: string
          message_type: string
          sender_display_name: string | null
          sender_name: string
          sender_username: string | null
          thread_id: string | null
        }
        Insert: {
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          audio_url?: string | null
          body?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_text: string
          message_type?: string
          sender_display_name?: string | null
          sender_name: string
          sender_username?: string | null
          thread_id?: string | null
        }
        Update: {
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_storage_path?: string | null
          audio_url?: string | null
          body?: string | null
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message_text?: string
          message_type?: string
          sender_display_name?: string | null
          sender_name?: string
          sender_username?: string | null
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "v2_chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ph_chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_chat_participants: {
        Row: {
          conversation_id: string
          display_name: string | null
          id: string
          is_archived: boolean
          joined_at: string
          last_read_at: string | null
          username: string
        }
        Insert: {
          conversation_id: string
          display_name?: string | null
          id?: string
          is_archived?: boolean
          joined_at?: string
          last_read_at?: string | null
          username: string
        }
        Update: {
          conversation_id?: string
          display_name?: string | null
          id?: string
          is_archived?: boolean
          joined_at?: string
          last_read_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_chat_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ph_chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_chat_threads: {
        Row: {
          created_at: string | null
          id: string
          is_group: boolean | null
          last_message_at: string | null
          thread_name: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_group?: boolean | null
          last_message_at?: string | null
          thread_name?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_group?: boolean | null
          last_message_at?: string | null
          thread_name?: string | null
        }
        Relationships: []
      }
      ph_company_directory_beds: {
        Row: {
          bed_identifier: string
          block_letter: string
          capacity: number
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          bed_identifier: string
          block_letter: string
          capacity: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          bed_identifier?: string
          block_letter?: string
          capacity?: number
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_company_directory_beds_block_letter_fkey"
            columns: ["block_letter"]
            isOneToOne: false
            referencedRelation: "ph_company_directory_block_totals"
            referencedColumns: ["letter"]
          },
          {
            foreignKeyName: "ph_company_directory_beds_block_letter_fkey"
            columns: ["block_letter"]
            isOneToOne: false
            referencedRelation: "ph_company_directory_blocks"
            referencedColumns: ["letter"]
          },
        ]
      }
      ph_company_directory_blocks: {
        Row: {
          created_at: string
          letter: string
          name: string
          needs_review: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          letter: string
          name: string
          needs_review?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          letter?: string
          name?: string
          needs_review?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ph_company_directory_codes: {
        Row: {
          code: string
          created_at: string
          department_reference: string | null
          description: string
          id: string
          needs_review: boolean
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          department_reference?: string | null
          description: string
          id?: string
          needs_review?: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          department_reference?: string | null
          description?: string
          id?: string
          needs_review?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ph_company_directory_contacts: {
        Row: {
          cell_number: string | null
          created_at: string
          department: string | null
          extension: string | null
          home_number: string | null
          id: string
          location: string
          name: string
          needs_review: boolean
          updated_at: string
        }
        Insert: {
          cell_number?: string | null
          created_at?: string
          department?: string | null
          extension?: string | null
          home_number?: string | null
          id?: string
          location: string
          name: string
          needs_review?: boolean
          updated_at?: string
        }
        Update: {
          cell_number?: string | null
          created_at?: string
          department?: string | null
          extension?: string | null
          home_number?: string | null
          id?: string
          location?: string
          name?: string
          needs_review?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ph_credit_attachments: {
        Row: {
          actor_id: string
          byte_count: number
          created_at: string
          id: string
          mime: string
          object_path: string
          sha256: string
          source_id: string
          state: string
        }
        Insert: {
          actor_id: string
          byte_count: number
          created_at?: string
          id: string
          mime: string
          object_path: string
          sha256: string
          source_id: string
          state: string
        }
        Update: {
          actor_id?: string
          byte_count?: number
          created_at?: string
          id?: string
          mime?: string
          object_path?: string
          sha256?: string
          source_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_credit_attachments_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_credit_attachments_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ph_credit_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_credit_sources: {
        Row: {
          assigned_rep_id: string | null
          canonical_source_id: string | null
          created_at: string
          customer_key: string
          id: string
          needs_review: boolean
          possible_replacements: string[]
          revision: number
          snapshot: Json
          source_id: string
          source_kind: string
          updated_at: string
        }
        Insert: {
          assigned_rep_id?: string | null
          canonical_source_id?: string | null
          created_at?: string
          customer_key: string
          id?: string
          needs_review?: boolean
          possible_replacements?: string[]
          revision?: number
          snapshot: Json
          source_id: string
          source_kind: string
          updated_at?: string
        }
        Update: {
          assigned_rep_id?: string | null
          canonical_source_id?: string | null
          created_at?: string
          customer_key?: string
          id?: string
          needs_review?: boolean
          possible_replacements?: string[]
          revision?: number
          snapshot?: Json
          source_id?: string
          source_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_credit_sources_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_credit_sources_canonical_source_id_fkey"
            columns: ["canonical_source_id"]
            isOneToOne: false
            referencedRelation: "ph_credit_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_credit_submissions: {
        Row: {
          actor_id: string
          created_at: string
          customer_key: string
          draft_lines: Json
          id: string
          revision: number
          state: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          customer_key: string
          draft_lines?: Json
          id: string
          revision?: number
          state: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          customer_key?: string
          draft_lines?: Json
          id?: string
          revision?: number
          state?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_credit_submissions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_crop_roll_completed_drive_keys: {
        Row: {
          completion_row_id: string
          contsize: string | null
          itemcode: string | null
          key_type: string
          locationcode: string | null
          lotcode: string | null
          master_unique_id: string | null
          match_key: string
          updated_at: string
        }
        Insert: {
          completion_row_id: string
          contsize?: string | null
          itemcode?: string | null
          key_type: string
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match_key: string
          updated_at?: string
        }
        Update: {
          completion_row_id?: string
          contsize?: string | null
          itemcode?: string | null
          key_type?: string
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_crop_roll_drive_rows: {
        Row: {
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          caliper: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          crop_roll_view: string
          date_completed: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          fieldtagcolor: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_completed: string | null
          flyer_initial_ptr: string | null
          flyer_loc_match_qty: string | null
          flyer_match: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          genus: string | null
          genusname: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          initial_ptr: string | null
          itemcode: string | null
          itemspec: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          lotcode: string | null
          master_unique_id: string
          master_updated_at: string | null
          match: string | null
          photo_link: string | null
          photo_name: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          qualitycode: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          saleyear: string | null
          search_text: string | null
          season: string | null
          season_supply: string | null
          source: string | null
          source_table: string
          spec: string | null
          unique_id: string
          updated_at: string
          warehouseid: string | null
        }
        Insert: {
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          crop_roll_view?: string
          date_completed?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          fieldtagcolor?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: string | null
          flyer_loc_match_qty?: string | null
          flyer_match?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          genus?: string | null
          genusname?: string | null
          holdstopbegindate?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          itemspec?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          lotcode?: string | null
          master_unique_id: string
          master_updated_at?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          saleyear?: string | null
          search_text?: string | null
          season?: string | null
          season_supply?: string | null
          source?: string | null
          source_table?: string
          spec?: string | null
          unique_id: string
          updated_at?: string
          warehouseid?: string | null
        }
        Update: {
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          crop_roll_view?: string
          date_completed?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          fieldtagcolor?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: string | null
          flyer_loc_match_qty?: string | null
          flyer_match?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          genus?: string | null
          genusname?: string | null
          holdstopbegindate?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          itemspec?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          lotcode?: string | null
          master_unique_id?: string
          master_updated_at?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          saleyear?: string | null
          search_text?: string | null
          season?: string | null
          season_supply?: string | null
          source?: string | null
          source_table?: string
          spec?: string | null
          unique_id?: string
          updated_at?: string
          warehouseid?: string | null
        }
        Relationships: []
      }
      ph_crop_roll_rows: {
        Row: {
          assignedto: string | null
          blockalpha: string | null
          commonname: string | null
          completed_at: string | null
          completed_by: string | null
          contsize: string | null
          created_at: string
          genus: string | null
          group_key: string
          holdstopcode: string | null
          holdstopreason: string | null
          item_location_key: string
          itemcode: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          master_unique_id: string
          metadata: Json
          original_holdstopcode: string | null
          original_holdstopreason: string | null
          original_locationnote: string | null
          original_locationnotedate: string | null
          original_locationptn1: string | null
          original_lotcode: string | null
          original_priority: string | null
          original_season: string | null
          priority: string | null
          row_id: string
          row_status: string
          run_id: string
          saved_at: string | null
          saved_by: string | null
          target_lotcode: string | null
          target_season: string | null
          updated_at: string
        }
        Insert: {
          assignedto?: string | null
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contsize?: string | null
          created_at?: string
          genus?: string | null
          group_key: string
          holdstopcode?: string | null
          holdstopreason?: string | null
          item_location_key: string
          itemcode?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          master_unique_id: string
          metadata?: Json
          original_holdstopcode?: string | null
          original_holdstopreason?: string | null
          original_locationnote?: string | null
          original_locationnotedate?: string | null
          original_locationptn1?: string | null
          original_lotcode?: string | null
          original_priority?: string | null
          original_season?: string | null
          priority?: string | null
          row_id: string
          row_status?: string
          run_id: string
          saved_at?: string | null
          saved_by?: string | null
          target_lotcode?: string | null
          target_season?: string | null
          updated_at?: string
        }
        Update: {
          assignedto?: string | null
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contsize?: string | null
          created_at?: string
          genus?: string | null
          group_key?: string
          holdstopcode?: string | null
          holdstopreason?: string | null
          item_location_key?: string
          itemcode?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          master_unique_id?: string
          metadata?: Json
          original_holdstopcode?: string | null
          original_holdstopreason?: string | null
          original_locationnote?: string | null
          original_locationnotedate?: string | null
          original_locationptn1?: string | null
          original_lotcode?: string | null
          original_priority?: string | null
          original_season?: string | null
          priority?: string | null
          row_id?: string
          row_status?: string
          run_id?: string
          saved_at?: string | null
          saved_by?: string | null
          target_lotcode?: string | null
          target_season?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_crop_roll_rows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ph_crop_roll_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      ph_crop_roll_runs: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          created_at: string
          created_by: string | null
          metadata: Json
          run_id: string
          run_key: string
          run_name: string | null
          snapshot_count: number
          status: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          metadata?: Json
          run_id: string
          run_key: string
          run_name?: string | null
          snapshot_count?: number
          status?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          metadata?: Json
          run_id?: string
          run_key?: string
          run_name?: string | null
          snapshot_count?: number
          status?: string
        }
        Relationships: []
      }
      ph_customer_consignee_sales_reps: {
        Row: {
          ackversion: string | null
          autoemail_inv: string | null
          autoemailack: string | null
          billingcontactcell: string | null
          billingcontactemail: string | null
          billingcontactfax: string | null
          billingcontactid: string | null
          billingcontactname: string | null
          billingcontactphone: string | null
          cadisc_percent: string | null
          combine_for_vip: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneecountry: string | null
          consigneecounty: string | null
          consigneedeliverynote: string | null
          consigneegroup: string | null
          consigneegroupname: string | null
          consigneeid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneestatus: string | null
          consigneetype: string | null
          consigneezip: string | null
          created_at: string
          creditlimit: string | null
          creditmanagerid: string | null
          creditmanagername: string | null
          creditrating: string | null
          creditstatus: string | null
          cust_notes: string | null
          custmajoracct: string | null
          customeraddress_1: string | null
          customeraddress_2: string | null
          customercity: string | null
          customercountry: string | null
          customercounty: string | null
          customergroup: string | null
          customergroupname: string | null
          customeridentityid: string | null
          customername: string | null
          customerpurchasediscount: string | null
          customerstate: string | null
          customerstatus: string | null
          customerzip: string | null
          delayed_due_1: string | null
          delayed_due_2: string | null
          delversion: string | null
          discount_applies: string | null
          discounttype: string | null
          driverdirections: string | null
          edicustomer: string | null
          edirollup: string | null
          ediworequired: string | null
          emailstatements: string | null
          filename: string | null
          generalloadinstr: string | null
          groupapprovalrequired: string | null
          imported_at: string | null
          invversion: string | null
          mailings: string | null
          majoracct: string | null
          majorcommtype: string | null
          ncfreightzone: string | null
          ncloadinst: string | null
          ncpriceschedule: string | null
          nsy_lic_exp: string | null
          nsy_lic_no: string | null
          okloadinst: string | null
          phfreightzone: string | null
          phpriceschedule: string | null
          primarycontactcell: string | null
          primarycontactemail: string | null
          primarycontactfax: string | null
          primarycontactid: string | null
          primarycontactname: string | null
          primarycontactphone: string | null
          principalcontactcell: string | null
          principalcontactemail: string | null
          principalcontactfax: string | null
          principalcontactid: string | null
          principalcontactname: string | null
          principalcontactphone: string | null
          qacode: string | null
          requirepo: string | null
          row_hash: string | null
          salesrepid: string | null
          salesrepname: string | null
          secondarycontactcell: string | null
          secondarycontactemail: string | null
          secondarycontactfax: string | null
          secondarycontactid: string | null
          secondarycontactname: string | null
          secondarycontactphone: string | null
          sendstatements: string | null
          shipcontactcommentstring: string | null
          shippingcontactcell: string | null
          shippingcontactemail: string | null
          shippingcontactfax: string | null
          shippingcontactid: string | null
          shippingcontactname: string | null
          shippingcontactphone: string | null
          sortname: string | null
          source_file_name: string | null
          source_row_number: number | null
          statementsent: string | null
          storenumber: string | null
          synemailack: string | null
          syninvoiceemail: string | null
          tagcode: string | null
          tax_exempt_date: string | null
          tax_exempt_number: string | null
          taxcode: string | null
          termscode: string | null
          termsdescription: string | null
          territorycode: string | null
          territorydesc: string | null
          top10: string | null
          txfreightzone: string | null
          txloadinst: string | null
          txpriceschedule: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          ackversion?: string | null
          autoemail_inv?: string | null
          autoemailack?: string | null
          billingcontactcell?: string | null
          billingcontactemail?: string | null
          billingcontactfax?: string | null
          billingcontactid?: string | null
          billingcontactname?: string | null
          billingcontactphone?: string | null
          cadisc_percent?: string | null
          combine_for_vip?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneecountry?: string | null
          consigneecounty?: string | null
          consigneedeliverynote?: string | null
          consigneegroup?: string | null
          consigneegroupname?: string | null
          consigneeid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneestatus?: string | null
          consigneetype?: string | null
          consigneezip?: string | null
          created_at?: string
          creditlimit?: string | null
          creditmanagerid?: string | null
          creditmanagername?: string | null
          creditrating?: string | null
          creditstatus?: string | null
          cust_notes?: string | null
          custmajoracct?: string | null
          customeraddress_1?: string | null
          customeraddress_2?: string | null
          customercity?: string | null
          customercountry?: string | null
          customercounty?: string | null
          customergroup?: string | null
          customergroupname?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customerpurchasediscount?: string | null
          customerstate?: string | null
          customerstatus?: string | null
          customerzip?: string | null
          delayed_due_1?: string | null
          delayed_due_2?: string | null
          delversion?: string | null
          discount_applies?: string | null
          discounttype?: string | null
          driverdirections?: string | null
          edicustomer?: string | null
          edirollup?: string | null
          ediworequired?: string | null
          emailstatements?: string | null
          filename?: string | null
          generalloadinstr?: string | null
          groupapprovalrequired?: string | null
          imported_at?: string | null
          invversion?: string | null
          mailings?: string | null
          majoracct?: string | null
          majorcommtype?: string | null
          ncfreightzone?: string | null
          ncloadinst?: string | null
          ncpriceschedule?: string | null
          nsy_lic_exp?: string | null
          nsy_lic_no?: string | null
          okloadinst?: string | null
          phfreightzone?: string | null
          phpriceschedule?: string | null
          primarycontactcell?: string | null
          primarycontactemail?: string | null
          primarycontactfax?: string | null
          primarycontactid?: string | null
          primarycontactname?: string | null
          primarycontactphone?: string | null
          principalcontactcell?: string | null
          principalcontactemail?: string | null
          principalcontactfax?: string | null
          principalcontactid?: string | null
          principalcontactname?: string | null
          principalcontactphone?: string | null
          qacode?: string | null
          requirepo?: string | null
          row_hash?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          secondarycontactcell?: string | null
          secondarycontactemail?: string | null
          secondarycontactfax?: string | null
          secondarycontactid?: string | null
          secondarycontactname?: string | null
          secondarycontactphone?: string | null
          sendstatements?: string | null
          shipcontactcommentstring?: string | null
          shippingcontactcell?: string | null
          shippingcontactemail?: string | null
          shippingcontactfax?: string | null
          shippingcontactid?: string | null
          shippingcontactname?: string | null
          shippingcontactphone?: string | null
          sortname?: string | null
          source_file_name?: string | null
          source_row_number?: number | null
          statementsent?: string | null
          storenumber?: string | null
          synemailack?: string | null
          syninvoiceemail?: string | null
          tagcode?: string | null
          tax_exempt_date?: string | null
          tax_exempt_number?: string | null
          taxcode?: string | null
          termscode?: string | null
          termsdescription?: string | null
          territorycode?: string | null
          territorydesc?: string | null
          top10?: string | null
          txfreightzone?: string | null
          txloadinst?: string | null
          txpriceschedule?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          ackversion?: string | null
          autoemail_inv?: string | null
          autoemailack?: string | null
          billingcontactcell?: string | null
          billingcontactemail?: string | null
          billingcontactfax?: string | null
          billingcontactid?: string | null
          billingcontactname?: string | null
          billingcontactphone?: string | null
          cadisc_percent?: string | null
          combine_for_vip?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneecountry?: string | null
          consigneecounty?: string | null
          consigneedeliverynote?: string | null
          consigneegroup?: string | null
          consigneegroupname?: string | null
          consigneeid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneestatus?: string | null
          consigneetype?: string | null
          consigneezip?: string | null
          created_at?: string
          creditlimit?: string | null
          creditmanagerid?: string | null
          creditmanagername?: string | null
          creditrating?: string | null
          creditstatus?: string | null
          cust_notes?: string | null
          custmajoracct?: string | null
          customeraddress_1?: string | null
          customeraddress_2?: string | null
          customercity?: string | null
          customercountry?: string | null
          customercounty?: string | null
          customergroup?: string | null
          customergroupname?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customerpurchasediscount?: string | null
          customerstate?: string | null
          customerstatus?: string | null
          customerzip?: string | null
          delayed_due_1?: string | null
          delayed_due_2?: string | null
          delversion?: string | null
          discount_applies?: string | null
          discounttype?: string | null
          driverdirections?: string | null
          edicustomer?: string | null
          edirollup?: string | null
          ediworequired?: string | null
          emailstatements?: string | null
          filename?: string | null
          generalloadinstr?: string | null
          groupapprovalrequired?: string | null
          imported_at?: string | null
          invversion?: string | null
          mailings?: string | null
          majoracct?: string | null
          majorcommtype?: string | null
          ncfreightzone?: string | null
          ncloadinst?: string | null
          ncpriceschedule?: string | null
          nsy_lic_exp?: string | null
          nsy_lic_no?: string | null
          okloadinst?: string | null
          phfreightzone?: string | null
          phpriceschedule?: string | null
          primarycontactcell?: string | null
          primarycontactemail?: string | null
          primarycontactfax?: string | null
          primarycontactid?: string | null
          primarycontactname?: string | null
          primarycontactphone?: string | null
          principalcontactcell?: string | null
          principalcontactemail?: string | null
          principalcontactfax?: string | null
          principalcontactid?: string | null
          principalcontactname?: string | null
          principalcontactphone?: string | null
          qacode?: string | null
          requirepo?: string | null
          row_hash?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          secondarycontactcell?: string | null
          secondarycontactemail?: string | null
          secondarycontactfax?: string | null
          secondarycontactid?: string | null
          secondarycontactname?: string | null
          secondarycontactphone?: string | null
          sendstatements?: string | null
          shipcontactcommentstring?: string | null
          shippingcontactcell?: string | null
          shippingcontactemail?: string | null
          shippingcontactfax?: string | null
          shippingcontactid?: string | null
          shippingcontactname?: string | null
          shippingcontactphone?: string | null
          sortname?: string | null
          source_file_name?: string | null
          source_row_number?: number | null
          statementsent?: string | null
          storenumber?: string | null
          synemailack?: string | null
          syninvoiceemail?: string | null
          tagcode?: string | null
          tax_exempt_date?: string | null
          tax_exempt_number?: string | null
          taxcode?: string | null
          termscode?: string | null
          termsdescription?: string | null
          territorycode?: string | null
          territorydesc?: string | null
          top10?: string | null
          txfreightzone?: string | null
          txloadinst?: string | null
          txpriceschedule?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_department_calendar_events: {
        Row: {
          all_day: boolean
          approved_at: string | null
          approved_by_display: string | null
          approved_by_username: string | null
          assigned_displays: Json
          assigned_to_display: string | null
          assigned_to_username: string | null
          assigned_usernames: Json
          created_at: string
          department: string
          description: string | null
          end_at: string
          event_type: string
          hr_source_event_id: string | null
          recurrence_interval: number
          recurrence_type: string
          recurrence_until: string | null
          requested_by_display: string | null
          requested_by_username: string | null
          start_at: string
          status: string
          title: string
          unique_id: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          approved_at?: string | null
          approved_by_display?: string | null
          approved_by_username?: string | null
          assigned_displays?: Json
          assigned_to_display?: string | null
          assigned_to_username?: string | null
          assigned_usernames?: Json
          created_at?: string
          department?: string
          description?: string | null
          end_at?: string
          event_type?: string
          hr_source_event_id?: string | null
          recurrence_interval?: number
          recurrence_type?: string
          recurrence_until?: string | null
          requested_by_display?: string | null
          requested_by_username?: string | null
          start_at?: string
          status?: string
          title?: string
          unique_id: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          approved_at?: string | null
          approved_by_display?: string | null
          approved_by_username?: string | null
          assigned_displays?: Json
          assigned_to_display?: string | null
          assigned_to_username?: string | null
          assigned_usernames?: Json
          created_at?: string
          department?: string
          description?: string | null
          end_at?: string
          event_type?: string
          hr_source_event_id?: string | null
          recurrence_interval?: number
          recurrence_type?: string
          recurrence_until?: string | null
          requested_by_display?: string | null
          requested_by_username?: string | null
          start_at?: string
          status?: string
          title?: string
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_dock_issue_allocations: {
        Row: {
          allocated_qty: number
          allocation_unique_id: string
          alt_commonname: string | null
          alt_contsize: string | null
          alt_itemcode: string | null
          alt_locationcode: string | null
          alt_lotcode: string | null
          alt_master_id: string | null
          alt_master_unique_id: string
          alt_ptravailable: number | null
          issue_source_unique_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          allocated_qty?: number
          allocation_unique_id: string
          alt_commonname?: string | null
          alt_contsize?: string | null
          alt_itemcode?: string | null
          alt_locationcode?: string | null
          alt_lotcode?: string | null
          alt_master_id?: string | null
          alt_master_unique_id: string
          alt_ptravailable?: number | null
          issue_source_unique_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          allocated_qty?: number
          allocation_unique_id?: string
          alt_commonname?: string | null
          alt_contsize?: string | null
          alt_itemcode?: string | null
          alt_locationcode?: string | null
          alt_lotcode?: string | null
          alt_master_id?: string | null
          alt_master_unique_id?: string
          alt_ptravailable?: number | null
          issue_source_unique_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "v2_dock_issue_allocations_issue_source_unique_id_fkey"
            columns: ["issue_source_unique_id"]
            isOneToOne: false
            referencedRelation: "ph_dock_issue_status"
            referencedColumns: ["issue_source_unique_id"]
          },
        ]
      }
      ph_dock_issue_status: {
        Row: {
          dock_num: string | null
          flagged_at: string | null
          flagged_by: string | null
          issue_note: string | null
          issue_photo_link: string | null
          issue_photo_name: string | null
          issue_source_unique_id: string
          issue_state: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_caliper: string | null
          source_commonname: string | null
          source_consigneename: string | null
          source_contsize: string | null
          source_customername: string | null
          source_itemcode: string | null
          source_loc_match_qty: string | null
          source_locationcode: string | null
          source_lotcode: string | null
          source_master_id: string | null
          source_master_unique_id: string | null
          source_match_key: string | null
          source_photo_link: string | null
          source_photo_name: string | null
          source_qty: number | null
          source_salesrep: string | null
          source_spec: string | null
          stop_number: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          dock_num?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          issue_note?: string | null
          issue_photo_link?: string | null
          issue_photo_name?: string | null
          issue_source_unique_id: string
          issue_state?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_caliper?: string | null
          source_commonname?: string | null
          source_consigneename?: string | null
          source_contsize?: string | null
          source_customername?: string | null
          source_itemcode?: string | null
          source_loc_match_qty?: string | null
          source_locationcode?: string | null
          source_lotcode?: string | null
          source_master_id?: string | null
          source_master_unique_id?: string | null
          source_match_key?: string | null
          source_photo_link?: string | null
          source_photo_name?: string | null
          source_qty?: number | null
          source_salesrep?: string | null
          source_spec?: string | null
          stop_number?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          dock_num?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          issue_note?: string | null
          issue_photo_link?: string | null
          issue_photo_name?: string | null
          issue_source_unique_id?: string
          issue_state?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_caliper?: string | null
          source_commonname?: string | null
          source_consigneename?: string | null
          source_contsize?: string | null
          source_customername?: string | null
          source_itemcode?: string | null
          source_loc_match_qty?: string | null
          source_locationcode?: string | null
          source_lotcode?: string | null
          source_master_id?: string | null
          source_master_unique_id?: string | null
          source_match_key?: string | null
          source_photo_link?: string | null
          source_photo_name?: string | null
          source_qty?: number | null
          source_salesrep?: string | null
          source_spec?: string | null
          stop_number?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_dock_item_status: {
        Row: {
          checker_completed_by: string | null
          checker_done: boolean | null
          inspector_completed_by: string | null
          inspector_done: boolean | null
          unique_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          checker_completed_by?: string | null
          checker_done?: boolean | null
          inspector_completed_by?: string | null
          inspector_done?: boolean | null
          unique_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          checker_completed_by?: string | null
          checker_done?: boolean | null
          inspector_completed_by?: string | null
          inspector_done?: boolean | null
          unique_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_dock_team_status: {
        Row: {
          checker: string | null
          dock_num: string
          inspector: string | null
          mistake: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          checker?: string | null
          dock_num: string
          inspector?: string | null
          mistake?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          checker?: string | null
          dock_num?: string
          inspector?: string | null
          mistake?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_dock_trip_status: {
        Row: {
          checker: string | null
          created_at: string
          dock_num: string | null
          inspector: string | null
          mistake: string | null
          revision: number
          status: string
          tripnumber: string
          updated_at: string
          updated_by_username: string
        }
        Insert: {
          checker?: string | null
          created_at?: string
          dock_num?: string | null
          inspector?: string | null
          mistake?: string | null
          revision?: number
          status?: string
          tripnumber: string
          updated_at?: string
          updated_by_username: string
        }
        Update: {
          checker?: string | null
          created_at?: string
          dock_num?: string | null
          inspector?: string | null
          mistake?: string | null
          revision?: number
          status?: string
          tripnumber?: string
          updated_at?: string
          updated_by_username?: string
        }
        Relationships: []
      }
      ph_dock_trip_status_audit: {
        Row: {
          actor_username: string
          created_at: string
          id: number
          next_value: Json
          prior_value: Json | null
          tripnumber: string
        }
        Insert: {
          actor_username: string
          created_at?: string
          id?: never
          next_value: Json
          prior_value?: Json | null
          tripnumber: string
        }
        Update: {
          actor_username?: string
          created_at?: string
          id?: never
          next_value?: Json
          prior_value?: Json | null
          tripnumber?: string
        }
        Relationships: []
      }
      ph_drive_around_compaction_runs: {
        Row: {
          approved_at: string | null
          created_at: string
          cutoff_date: string
          id: string
          manifest: Json
          phase: string
          shadow_hash: string | null
          shadow_rows: number | null
          source_hash: string | null
          source_rows: number | null
          verified_at: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          cutoff_date: string
          id?: string
          manifest?: Json
          phase: string
          shadow_hash?: string | null
          shadow_rows?: number | null
          source_hash?: string | null
          source_rows?: number | null
          verified_at?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          cutoff_date?: string
          id?: string
          manifest?: Json
          phase?: string
          shadow_hash?: string | null
          shadow_rows?: number | null
          source_hash?: string | null
          source_rows?: number | null
          verified_at?: string | null
        }
        Relationships: []
      }
      ph_drive_around_report_files: {
        Row: {
          canonical_date_source: string | null
          canonical_file_name: string | null
          canonical_report_date: string | null
          canonical_sequence: number | null
          created_at: string
          drive_modified_time: string | null
          error_message: string | null
          file_id: string
          file_name: string
          first_seen_at: string | null
          hold_row_count: number
          mime_type: string | null
          original_file_name: string | null
          processed_at: string
          raw: Json
          renamed_at: string | null
          report_date: string | null
          row_count: number
          status: string
          updated_at: string
          web_view_link: string | null
        }
        Insert: {
          canonical_date_source?: string | null
          canonical_file_name?: string | null
          canonical_report_date?: string | null
          canonical_sequence?: number | null
          created_at?: string
          drive_modified_time?: string | null
          error_message?: string | null
          file_id: string
          file_name: string
          first_seen_at?: string | null
          hold_row_count?: number
          mime_type?: string | null
          original_file_name?: string | null
          processed_at?: string
          raw?: Json
          renamed_at?: string | null
          report_date?: string | null
          row_count?: number
          status?: string
          updated_at?: string
          web_view_link?: string | null
        }
        Update: {
          canonical_date_source?: string | null
          canonical_file_name?: string | null
          canonical_report_date?: string | null
          canonical_sequence?: number | null
          created_at?: string
          drive_modified_time?: string | null
          error_message?: string | null
          file_id?: string
          file_name?: string
          first_seen_at?: string | null
          hold_row_count?: number
          mime_type?: string | null
          original_file_name?: string | null
          processed_at?: string
          raw?: Json
          renamed_at?: string | null
          report_date?: string | null
          row_count?: number
          status?: string
          updated_at?: string
          web_view_link?: string | null
        }
        Relationships: []
      }
      ph_drive_around_report_rows: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          commonname: string | null
          containersort: string | null
          contsize: string | null
          created_at: string
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          equiv_unit: string | null
          ext_equiv_unit: string | null
          ext_ptronhand: string | null
          fieldtagcolor: string | null
          file_id: string
          file_name: string
          fnsalesnote: string | null
          genus: string | null
          genusname: string | null
          grower: string | null
          hold_reason_category: string | null
          holdstopbegindate: string | null
          holdstopbegindate_raw: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hsreasonbegin: string | null
          hz: string | null
          insurancegroup: string | null
          intercopo: string | null
          inventorynote: string | null
          item_key: string | null
          itemcode: string | null
          itemspec: string | null
          largeptrqty: string | null
          listprice: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          oversellpercentage: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: number | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          qualitycode: string | null
          report_date: string | null
          reversecommon: string | null
          row_hash: string | null
          row_number: number
          s_lts: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesyear: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          source_schema_version: number | null
          specialpuller: string | null
          suspend: string | null
          suspendto: string | null
          unique_id: string
          updated_at: string
          varietycode: string | null
          warehousei: string | null
          warehousename: string | null
        }
        Insert: {
          a_lts?: string | null
          ai_lts?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          brand?: string | null
          bypassloc?: string | null
          commonname?: string | null
          containersort?: string | null
          contsize?: string | null
          created_at?: string
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          equiv_unit?: string | null
          ext_equiv_unit?: string | null
          ext_ptronhand?: string | null
          fieldtagcolor?: string | null
          file_id: string
          file_name: string
          fnsalesnote?: string | null
          genus?: string | null
          genusname?: string | null
          grower?: string | null
          hold_reason_category?: string | null
          holdstopbegindate?: string | null
          holdstopbegindate_raw?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hsreasonbegin?: string | null
          hz?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          inventorynote?: string | null
          item_key?: string | null
          itemcode?: string | null
          itemspec?: string | null
          largeptrqty?: string | null
          listprice?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          locationptn2?: string | null
          lochold?: string | null
          lotcode?: string | null
          maxorderquantity?: string | null
          mcstatus?: string | null
          oversellpercentage?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          prisetby?: string | null
          priupdated?: string | null
          ptravailable?: number | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          pullerresponsibility?: string | null
          pulltagnote1?: string | null
          pulltagnote2?: string | null
          qualitycode?: string | null
          report_date?: string | null
          reversecommon?: string | null
          row_hash?: string | null
          row_number: number
          s_lts?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesnotebegindate?: string | null
          salesyear?: string | null
          saleyear?: string | null
          season?: string | null
          season_available?: string | null
          season_demand?: string | null
          season_oh?: string | null
          season_supply?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          source_schema_version?: number | null
          specialpuller?: string | null
          suspend?: string | null
          suspendto?: string | null
          unique_id: string
          updated_at?: string
          varietycode?: string | null
          warehousei?: string | null
          warehousename?: string | null
        }
        Update: {
          a_lts?: string | null
          ai_lts?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          brand?: string | null
          bypassloc?: string | null
          commonname?: string | null
          containersort?: string | null
          contsize?: string | null
          created_at?: string
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          equiv_unit?: string | null
          ext_equiv_unit?: string | null
          ext_ptronhand?: string | null
          fieldtagcolor?: string | null
          file_id?: string
          file_name?: string
          fnsalesnote?: string | null
          genus?: string | null
          genusname?: string | null
          grower?: string | null
          hold_reason_category?: string | null
          holdstopbegindate?: string | null
          holdstopbegindate_raw?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hsreasonbegin?: string | null
          hz?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          inventorynote?: string | null
          item_key?: string | null
          itemcode?: string | null
          itemspec?: string | null
          largeptrqty?: string | null
          listprice?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          locationptn2?: string | null
          lochold?: string | null
          lotcode?: string | null
          maxorderquantity?: string | null
          mcstatus?: string | null
          oversellpercentage?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          prisetby?: string | null
          priupdated?: string | null
          ptravailable?: number | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          pullerresponsibility?: string | null
          pulltagnote1?: string | null
          pulltagnote2?: string | null
          qualitycode?: string | null
          report_date?: string | null
          reversecommon?: string | null
          row_hash?: string | null
          row_number?: number
          s_lts?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesnotebegindate?: string | null
          salesyear?: string | null
          saleyear?: string | null
          season?: string | null
          season_available?: string | null
          season_demand?: string | null
          season_oh?: string | null
          season_supply?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          source_schema_version?: number | null
          specialpuller?: string | null
          suspend?: string | null
          suspendto?: string | null
          unique_id?: string
          updated_at?: string
          varietycode?: string | null
          warehousei?: string | null
          warehousename?: string | null
        }
        Relationships: []
      }
      ph_drive_around_report_rows_archive_manifest: {
        Row: {
          archived_at: string
          archived_policy: string
          drive_modified_time: string | null
          file_id: string
          file_name: string | null
          hold_row_count: number | null
          report_date: string | null
          row_count: number | null
          web_view_link: string | null
        }
        Insert: {
          archived_at?: string
          archived_policy?: string
          drive_modified_time?: string | null
          file_id: string
          file_name?: string | null
          hold_row_count?: number | null
          report_date?: string | null
          row_count?: number | null
          web_view_link?: string | null
        }
        Update: {
          archived_at?: string
          archived_policy?: string
          drive_modified_time?: string | null
          file_id?: string
          file_name?: string | null
          hold_row_count?: number | null
          report_date?: string | null
          row_count?: number | null
          web_view_link?: string | null
        }
        Relationships: []
      }
      ph_eval_assignment_rules: {
        Row: {
          active: boolean
          assigned_to_raw: string | null
          assignedto: string
          commonname: string | null
          contsize: string | null
          created_at: string
          genusname: string | null
          id: number
          imported_at: string
          itemcode: string | null
          locationcode: string | null
          normalized: Json
          sheet_id: string
          sheet_name: string
          sheet_row_number: number
          source: string | null
          updated_at: string
          warehousei: string | null
        }
        Insert: {
          active?: boolean
          assigned_to_raw?: string | null
          assignedto: string
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          genusname?: string | null
          id?: number
          imported_at?: string
          itemcode?: string | null
          locationcode?: string | null
          normalized?: Json
          sheet_id?: string
          sheet_name?: string
          sheet_row_number: number
          source?: string | null
          updated_at?: string
          warehousei?: string | null
        }
        Update: {
          active?: boolean
          assigned_to_raw?: string | null
          assignedto?: string
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          genusname?: string | null
          id?: number
          imported_at?: string
          itemcode?: string | null
          locationcode?: string | null
          normalized?: Json
          sheet_id?: string
          sheet_name?: string
          sheet_row_number?: number
          source?: string | null
          updated_at?: string
          warehousei?: string | null
        }
        Relationships: []
      }
      ph_eval_assignment_users: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          source: string
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          source?: string
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          source?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      ph_eval_report_settings: {
        Row: {
          created_at: string
          hold_age_days: number
          location_note_age_days: number
          low_stock_max_slts: number
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          hold_age_days?: number
          location_note_age_days?: number
          low_stock_max_slts?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          hold_age_days?: number
          location_note_age_days?: number
          low_stock_max_slts?: number
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_eval_work: {
        Row: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        Insert: {
          assigned_to_users?: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles?: Json
          assignee_username: string
          assignee_usernames?: string[]
          assignment_event_id?: string | null
          batch_token?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commonname?: string
          completion_event_id?: string | null
          completion_recipients: string[]
          context_rows?: Json
          contract_version?: string
          contsize?: string
          create_token: string
          created_at?: string
          creator_display: string
          creator_username: string
          evidence_draft?: Json
          id?: string
          inquiry_draft?: Json
          instructions?: string
          inventory_signature: string
          itemcode: string
          origin_count?: number
          origin_locationcode?: string
          origin_lotcode?: string
          origin_snapshot?: Json
          origin_source?: string
          origin_unique_id: string
          resolved_import_at?: string | null
          resolved_import_report_id?: string | null
          resolved_import_revision?: string | null
          settings_signature: string
          source_context?: Json
          started_at?: string | null
          status?: string
          submission_request_fingerprint?: string | null
          submission_token?: string | null
          submitted_at?: string | null
          submitted_by_username?: string | null
          submitted_evidence?: Json | null
          submitted_inquiry?: Json | null
          updated_at?: string
          version?: number
        }
        Update: {
          assigned_to_users?: string[]
          assignee_display?: string
          assignee_email?: string
          assignee_profiles?: Json
          assignee_username?: string
          assignee_usernames?: string[]
          assignment_event_id?: string | null
          batch_token?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          commonname?: string
          completion_event_id?: string | null
          completion_recipients?: string[]
          context_rows?: Json
          contract_version?: string
          contsize?: string
          create_token?: string
          created_at?: string
          creator_display?: string
          creator_username?: string
          evidence_draft?: Json
          id?: string
          inquiry_draft?: Json
          instructions?: string
          inventory_signature?: string
          itemcode?: string
          origin_count?: number
          origin_locationcode?: string
          origin_lotcode?: string
          origin_snapshot?: Json
          origin_source?: string
          origin_unique_id?: string
          resolved_import_at?: string | null
          resolved_import_report_id?: string | null
          resolved_import_revision?: string | null
          settings_signature?: string
          source_context?: Json
          started_at?: string | null
          status?: string
          submission_request_fingerprint?: string | null
          submission_token?: string | null
          submitted_at?: string | null
          submitted_by_username?: string | null
          submitted_evidence?: Json | null
          submitted_inquiry?: Json | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ph_eval_work_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_eval_work_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_eval_work_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
          {
            foreignKeyName: "ph_eval_work_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_eval_work_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_eval_work_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
        ]
      }
      ph_eval_work_events: {
        Row: {
          actor_username: string
          created_at: string
          eval_work_id: string
          event_type: string
          id: number
          metadata: Json
          version: number
        }
        Insert: {
          actor_username: string
          created_at?: string
          eval_work_id: string
          event_type: string
          id?: never
          metadata?: Json
          version: number
        }
        Update: {
          actor_username?: string
          created_at?: string
          eval_work_id?: string
          event_type?: string
          id?: never
          metadata?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ph_eval_work_events_eval_work_id_fkey"
            columns: ["eval_work_id"]
            isOneToOne: false
            referencedRelation: "ph_eval_work"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_eval_work_origin_rows: {
        Row: {
          block_alpha: string
          block_number: string
          created_at: string
          eval_work_id: string
          evidence_draft: Json
          itemcode: string
          locationcode: string
          lotcode: string
          ordinal: number
          origin_snapshot: Json
          origin_unique_id: string
          source: string
          submitted_evidence: Json | null
          updated_at: string
        }
        Insert: {
          block_alpha?: string
          block_number?: string
          created_at?: string
          eval_work_id: string
          evidence_draft?: Json
          itemcode: string
          locationcode?: string
          lotcode?: string
          ordinal: number
          origin_snapshot: Json
          origin_unique_id: string
          source?: string
          submitted_evidence?: Json | null
          updated_at?: string
        }
        Update: {
          block_alpha?: string
          block_number?: string
          created_at?: string
          eval_work_id?: string
          evidence_draft?: Json
          itemcode?: string
          locationcode?: string
          lotcode?: string
          ordinal?: number
          origin_snapshot?: Json
          origin_unique_id?: string
          source?: string
          submitted_evidence?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_eval_work_origin_rows_eval_work_id_fkey"
            columns: ["eval_work_id"]
            isOneToOne: false
            referencedRelation: "ph_eval_work"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_flyer_folder_history: {
        Row: {
          assignedto: string | null
          av_note: string | null
          caliper: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          date_completed: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string
          folder_name: string | null
          folder_tab: string
          history_state: string
          holdstopcode: string | null
          initial_ptr: number | null
          itemcode: string | null
          last_event: string | null
          loc_match_qty: number | null
          locationcode: string | null
          locationnote: string | null
          lotcode: string | null
          master_unique_id: string | null
          match: number | null
          pick: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          s_lts: string | null
          snapshot: Json
          source_table: string | null
          spec: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          date_completed?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string
          folder_name?: string | null
          folder_tab?: string
          history_state?: string
          holdstopcode?: string | null
          initial_ptr?: number | null
          itemcode?: string | null
          last_event?: string | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match?: number | null
          pick?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string | null
          spec?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          date_completed?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string
          folder_name?: string | null
          folder_tab?: string
          history_state?: string
          holdstopcode?: string | null
          initial_ptr?: number | null
          itemcode?: string | null
          last_event?: string | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match?: number | null
          pick?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string | null
          spec?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_flyer_folder_rows: {
        Row: {
          assignedto: string | null
          av_note: string | null
          caliper: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          date_completed: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string
          holdstopcode: string | null
          initial_ptr: number | null
          itemcode: string | null
          loc_match_qty: number | null
          locationcode: string | null
          locationnote: string | null
          lotcode: string | null
          master_unique_id: string | null
          match: number | null
          pick: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          s_lts: string | null
          snapshot: Json
          source_table: string | null
          spec: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          date_completed?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string
          holdstopcode?: string | null
          initial_ptr?: number | null
          itemcode?: string | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match?: number | null
          pick?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string | null
          spec?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          date_completed?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string
          holdstopcode?: string | null
          initial_ptr?: number | null
          itemcode?: string | null
          loc_match_qty?: number | null
          locationcode?: string | null
          locationnote?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          match?: number | null
          pick?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string | null
          spec?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_grower_scout_assets: {
        Row: {
          asset_kind: string
          bucket: string
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          file_name: string | null
          file_size_bytes: number | null
          mime_type: string | null
          public_url: string | null
          report_id: string
          storage_path: string
          unique_id: string
          updated_at: string
        }
        Insert: {
          asset_kind?: string
          bucket: string
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          mime_type?: string | null
          public_url?: string | null
          report_id: string
          storage_path: string
          unique_id: string
          updated_at?: string
        }
        Update: {
          asset_kind?: string
          bucket?: string
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          mime_type?: string | null
          public_url?: string | null
          report_id?: string
          storage_path?: string
          unique_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_grower_scout_assets_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "ph_grower_scout_reports"
            referencedColumns: ["unique_id"]
          },
        ]
      }
      ph_grower_scout_reports: {
        Row: {
          ai_completed_at: string | null
          ai_summary: string | null
          attempts: number
          audio_bucket: string | null
          audio_duration_seconds: number | null
          audio_mime_type: string | null
          audio_path: string | null
          audio_url: string | null
          block: string | null
          blockalpha: string | null
          common_name: string | null
          contsize: string | null
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          diagnosis: string | null
          disease_issue: boolean
          follow_up_date: string | null
          genus: string | null
          issue_type: string | null
          itemcode: string | null
          last_error: string | null
          locationcode: string | null
          lotcode: string | null
          manual_note: string | null
          manual_review: boolean
          nutrient_issue: boolean
          pest_code: string | null
          pest_issue: boolean
          processing_started_at: string | null
          recommended_treatment: string | null
          report_language: string
          review_status: string
          reviewed_at: string | null
          reviewed_by_display: string | null
          reviewed_by_username: string | null
          reviewer_note: string | null
          salesyear: number | null
          season: string | null
          sev_score: number | null
          severity: string
          source_inventory_uid: string | null
          status: string
          summary_json: Json
          transcript: string | null
          unique_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          ai_completed_at?: string | null
          ai_summary?: string | null
          attempts?: number
          audio_bucket?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_path?: string | null
          audio_url?: string | null
          block?: string | null
          blockalpha?: string | null
          common_name?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          diagnosis?: string | null
          disease_issue?: boolean
          follow_up_date?: string | null
          genus?: string | null
          issue_type?: string | null
          itemcode?: string | null
          last_error?: string | null
          locationcode?: string | null
          lotcode?: string | null
          manual_note?: string | null
          manual_review?: boolean
          nutrient_issue?: boolean
          pest_code?: string | null
          pest_issue?: boolean
          processing_started_at?: string | null
          recommended_treatment?: string | null
          report_language?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_display?: string | null
          reviewed_by_username?: string | null
          reviewer_note?: string | null
          salesyear?: number | null
          season?: string | null
          sev_score?: number | null
          severity?: string
          source_inventory_uid?: string | null
          status?: string
          summary_json?: Json
          transcript?: string | null
          unique_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          ai_completed_at?: string | null
          ai_summary?: string | null
          attempts?: number
          audio_bucket?: string | null
          audio_duration_seconds?: number | null
          audio_mime_type?: string | null
          audio_path?: string | null
          audio_url?: string | null
          block?: string | null
          blockalpha?: string | null
          common_name?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          diagnosis?: string | null
          disease_issue?: boolean
          follow_up_date?: string | null
          genus?: string | null
          issue_type?: string | null
          itemcode?: string | null
          last_error?: string | null
          locationcode?: string | null
          lotcode?: string | null
          manual_note?: string | null
          manual_review?: boolean
          nutrient_issue?: boolean
          pest_code?: string | null
          pest_issue?: boolean
          processing_started_at?: string | null
          recommended_treatment?: string | null
          report_language?: string
          review_status?: string
          reviewed_at?: string | null
          reviewed_by_display?: string | null
          reviewed_by_username?: string | null
          reviewer_note?: string | null
          salesyear?: number | null
          season?: string | null
          sev_score?: number | null
          severity?: string
          source_inventory_uid?: string | null
          status?: string
          summary_json?: Json
          transcript?: string | null
          unique_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
      ph_historical_inventory_dimensions: {
        Row: {
          commonname: string
          commonname_key: string
          contsize: string
          contsize_key: string
          created_at: string
          first_report_date: string | null
          historical_row_count: number
          itemcode: string
          itemcode_key: string
          last_report_date: string | null
          updated_at: string
        }
        Insert: {
          commonname: string
          commonname_key: string
          contsize: string
          contsize_key: string
          created_at?: string
          first_report_date?: string | null
          historical_row_count?: number
          itemcode: string
          itemcode_key: string
          last_report_date?: string | null
          updated_at?: string
        }
        Update: {
          commonname?: string
          commonname_key?: string
          contsize?: string
          contsize_key?: string
          created_at?: string
          first_report_date?: string | null
          historical_row_count?: number
          itemcode?: string
          itemcode_key?: string
          last_report_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ph_hl_order_previews: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          id: string
          report: Json
          source_fingerprint: string
          state_revision: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at: string
          id: string
          report: Json
          source_fingerprint: string
          state_revision: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          report?: Json
          source_fingerprint?: string
          state_revision?: number
        }
        Relationships: []
      }
      ph_hl_po: {
        Row: {
          commonname: string | null
          contsize: string | null
          created_at: string
          id: number
          itemcode: string
          locationcode: string | null
          lotcode: string | null
          priority: string | null
          ptronhand: number | null
          report_date: string
          row_index: number
          run_id: string | null
          source_file_name: string | null
          source_pdf_file_id: string | null
          source_spreadsheet_id: string | null
          total_quantity_ordered: number | null
          unique_id: string
        }
        Insert: {
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          id?: number
          itemcode: string
          locationcode?: string | null
          lotcode?: string | null
          priority?: string | null
          ptronhand?: number | null
          report_date: string
          row_index: number
          run_id?: string | null
          source_file_name?: string | null
          source_pdf_file_id?: string | null
          source_spreadsheet_id?: string | null
          total_quantity_ordered?: number | null
          unique_id: string
        }
        Update: {
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          id?: number
          itemcode?: string
          locationcode?: string | null
          lotcode?: string | null
          priority?: string | null
          ptronhand?: number | null
          report_date?: string
          row_index?: number
          run_id?: string | null
          source_file_name?: string | null
          source_pdf_file_id?: string | null
          source_spreadsheet_id?: string | null
          total_quantity_ordered?: number | null
          unique_id?: string
        }
        Relationships: []
      }
      ph_hold_learning_cursors: {
        Row: {
          last_report_date: string | null
          last_row_hash: string | null
          last_unique_id: string | null
          processed_rows: number
          source_key: string
          updated_at: string
        }
        Insert: {
          last_report_date?: string | null
          last_row_hash?: string | null
          last_unique_id?: string | null
          processed_rows?: number
          source_key: string
          updated_at?: string
        }
        Update: {
          last_report_date?: string | null
          last_row_hash?: string | null
          last_unique_id?: string | null
          processed_rows?: number
          source_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_learning_events: {
        Row: {
          avg_temperature_f_14d: number | null
          avg_temperature_f_30d: number | null
          avg_temperature_f_7d: number | null
          blockalpha: string | null
          chill_hours_14d: number | null
          chill_hours_30d: number | null
          chill_hours_7d: number | null
          chill_hours_season: number | null
          commonname: string | null
          contsize: string | null
          created_at: string
          gdd_base_50_14d: number | null
          gdd_base_50_30d: number | null
          gdd_base_50_7d: number | null
          gdd_base_50_season: number | null
          gdd_base_50_to_release: number | null
          genus: string | null
          hold_days: number | null
          hold_detected_at: string
          hold_reason_category: string | null
          hold_started_on: string
          holdstopbegindate_raw: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          import_file_name: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          precipitation_in_14d: number | null
          precipitation_in_30d: number | null
          precipitation_in_7d: number | null
          released_on: string | null
          salesyear: string | null
          season: string | null
          source_table: string
          source_unique_id: string
          unique_id: string
          updated_at: string
          weather_features_refreshed_at: string | null
          weather_station_key: string
        }
        Insert: {
          avg_temperature_f_14d?: number | null
          avg_temperature_f_30d?: number | null
          avg_temperature_f_7d?: number | null
          blockalpha?: string | null
          chill_hours_14d?: number | null
          chill_hours_30d?: number | null
          chill_hours_7d?: number | null
          chill_hours_season?: number | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          gdd_base_50_14d?: number | null
          gdd_base_50_30d?: number | null
          gdd_base_50_7d?: number | null
          gdd_base_50_season?: number | null
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_days?: number | null
          hold_detected_at?: string
          hold_reason_category?: string | null
          hold_started_on: string
          holdstopbegindate_raw?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          import_file_name?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          precipitation_in_14d?: number | null
          precipitation_in_30d?: number | null
          precipitation_in_7d?: number | null
          released_on?: string | null
          salesyear?: string | null
          season?: string | null
          source_table?: string
          source_unique_id: string
          unique_id: string
          updated_at?: string
          weather_features_refreshed_at?: string | null
          weather_station_key?: string
        }
        Update: {
          avg_temperature_f_14d?: number | null
          avg_temperature_f_30d?: number | null
          avg_temperature_f_7d?: number | null
          blockalpha?: string | null
          chill_hours_14d?: number | null
          chill_hours_30d?: number | null
          chill_hours_7d?: number | null
          chill_hours_season?: number | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          gdd_base_50_14d?: number | null
          gdd_base_50_30d?: number | null
          gdd_base_50_7d?: number | null
          gdd_base_50_season?: number | null
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_days?: number | null
          hold_detected_at?: string
          hold_reason_category?: string | null
          hold_started_on?: string
          holdstopbegindate_raw?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          import_file_name?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          precipitation_in_14d?: number | null
          precipitation_in_30d?: number | null
          precipitation_in_7d?: number | null
          released_on?: string | null
          salesyear?: string | null
          season?: string | null
          source_table?: string
          source_unique_id?: string
          unique_id?: string
          updated_at?: string
          weather_features_refreshed_at?: string | null
          weather_station_key?: string
        }
        Relationships: []
      }
      ph_hold_learning_profiles: {
        Row: {
          avg_chill_hours_30d: number | null
          avg_chill_hours_season: number | null
          avg_days_to_release: number | null
          avg_gdd_base_50_14d: number | null
          avg_gdd_base_50_30d: number | null
          avg_gdd_base_50_7d: number | null
          avg_gdd_base_50_season: number | null
          avg_gdd_base_50_to_release: number | null
          avg_precipitation_in_30d: number | null
          avg_temperature_f_30d: number | null
          commonname: string
          contsize: string | null
          first_hold_on: string | null
          genus: string | null
          hold_reason_category: string
          itemcode: string | null
          last_hold_on: string | null
          median_gdd_base_50_30d: number | null
          median_gdd_base_50_to_release: number | null
          release_sample_count: number
          sample_count: number
          unique_id: string
          updated_at: string
        }
        Insert: {
          avg_chill_hours_30d?: number | null
          avg_chill_hours_season?: number | null
          avg_days_to_release?: number | null
          avg_gdd_base_50_14d?: number | null
          avg_gdd_base_50_30d?: number | null
          avg_gdd_base_50_7d?: number | null
          avg_gdd_base_50_season?: number | null
          avg_gdd_base_50_to_release?: number | null
          avg_precipitation_in_30d?: number | null
          avg_temperature_f_30d?: number | null
          commonname: string
          contsize?: string | null
          first_hold_on?: string | null
          genus?: string | null
          hold_reason_category: string
          itemcode?: string | null
          last_hold_on?: string | null
          median_gdd_base_50_30d?: number | null
          median_gdd_base_50_to_release?: number | null
          release_sample_count?: number
          sample_count?: number
          unique_id: string
          updated_at?: string
        }
        Update: {
          avg_chill_hours_30d?: number | null
          avg_chill_hours_season?: number | null
          avg_days_to_release?: number | null
          avg_gdd_base_50_14d?: number | null
          avg_gdd_base_50_30d?: number | null
          avg_gdd_base_50_7d?: number | null
          avg_gdd_base_50_season?: number | null
          avg_gdd_base_50_to_release?: number | null
          avg_precipitation_in_30d?: number | null
          avg_temperature_f_30d?: number | null
          commonname?: string
          contsize?: string | null
          first_hold_on?: string | null
          genus?: string | null
          hold_reason_category?: string
          itemcode?: string | null
          last_hold_on?: string | null
          median_gdd_base_50_30d?: number | null
          median_gdd_base_50_to_release?: number | null
          release_sample_count?: number
          sample_count?: number
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_learning_refresh_itemcodes: {
        Row: {
          cycle_rows: number | null
          error_message: string | null
          itemcode: string
          job_name: string
          processed_at: string | null
          snapshot_rows: number | null
          summary_processed_at: string | null
        }
        Insert: {
          cycle_rows?: number | null
          error_message?: string | null
          itemcode: string
          job_name: string
          processed_at?: string | null
          snapshot_rows?: number | null
          summary_processed_at?: string | null
        }
        Update: {
          cycle_rows?: number | null
          error_message?: string | null
          itemcode?: string
          job_name?: string
          processed_at?: string | null
          snapshot_rows?: number | null
          summary_processed_at?: string | null
        }
        Relationships: []
      }
      ph_hold_learning_refresh_jobs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          hold_events_upserted: number | null
          job_name: string
          release_cycles_upserted: number | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          hold_events_upserted?: number | null
          job_name: string
          release_cycles_upserted?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          hold_events_upserted?: number | null
          job_name?: string
          release_cycles_upserted?: number | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_release_cycles: {
        Row: {
          blockalpha: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          cycle_source: string | null
          episode_number: number | null
          gdd_base_50_to_release: number | null
          genus: string | null
          hold_days: number | null
          hold_reason_category: string | null
          hold_released_on: string | null
          hold_started_on: string
          holdstopcode: string | null
          holdstopreason: string | null
          item_key: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          release_file_id: string | null
          release_file_name: string | null
          salesyear: string | null
          season: string | null
          snapshot: Json
          source_file_ids: string[]
          source_file_names: string[]
          start_file_id: string | null
          start_file_name: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          cycle_source?: string | null
          episode_number?: number | null
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_days?: number | null
          hold_reason_category?: string | null
          hold_released_on?: string | null
          hold_started_on: string
          holdstopcode?: string | null
          holdstopreason?: string | null
          item_key: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          release_file_id?: string | null
          release_file_name?: string | null
          salesyear?: string | null
          season?: string | null
          snapshot?: Json
          source_file_ids?: string[]
          source_file_names?: string[]
          start_file_id?: string | null
          start_file_name?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          cycle_source?: string | null
          episode_number?: number | null
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_days?: number | null
          hold_reason_category?: string | null
          hold_released_on?: string | null
          hold_started_on?: string
          holdstopcode?: string | null
          holdstopreason?: string | null
          item_key?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          release_file_id?: string | null
          release_file_name?: string | null
          salesyear?: string | null
          season?: string | null
          snapshot?: Json
          source_file_ids?: string[]
          source_file_names?: string[]
          start_file_id?: string | null
          start_file_name?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_stop_itemcode_cycles: {
        Row: {
          blocked_code: string
          blocked_codes: string[]
          commonname: string | null
          contsize: string | null
          created_at: string
          days_blocked: number | null
          episode_number: number
          episode_release_date: string | null
          episode_start_date: string
          gdd_base_50_to_release: number | null
          genus: string | null
          hold_reason_categories: string[]
          hold_reason_category: string | null
          holdstopreason: string | null
          holdstopreasons: string[]
          itemcode: string
          release_canonical_sequence: number | null
          release_file_id: string | null
          release_file_name: string | null
          release_file_rank: number | null
          snapshot: Json
          snapshot_count: number
          source_file_ids: string[]
          source_file_names: string[]
          source_snapshot_ids: string[]
          start_canonical_sequence: number | null
          start_file_id: string | null
          start_file_name: string | null
          start_file_rank: number
          unique_id: string
          updated_at: string
        }
        Insert: {
          blocked_code: string
          blocked_codes?: string[]
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          days_blocked?: number | null
          episode_number: number
          episode_release_date?: string | null
          episode_start_date: string
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_reason_categories?: string[]
          hold_reason_category?: string | null
          holdstopreason?: string | null
          holdstopreasons?: string[]
          itemcode: string
          release_canonical_sequence?: number | null
          release_file_id?: string | null
          release_file_name?: string | null
          release_file_rank?: number | null
          snapshot?: Json
          snapshot_count?: number
          source_file_ids?: string[]
          source_file_names?: string[]
          source_snapshot_ids?: string[]
          start_canonical_sequence?: number | null
          start_file_id?: string | null
          start_file_name?: string | null
          start_file_rank: number
          unique_id: string
          updated_at?: string
        }
        Update: {
          blocked_code?: string
          blocked_codes?: string[]
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          days_blocked?: number | null
          episode_number?: number
          episode_release_date?: string | null
          episode_start_date?: string
          gdd_base_50_to_release?: number | null
          genus?: string | null
          hold_reason_categories?: string[]
          hold_reason_category?: string | null
          holdstopreason?: string | null
          holdstopreasons?: string[]
          itemcode?: string
          release_canonical_sequence?: number | null
          release_file_id?: string | null
          release_file_name?: string | null
          release_file_rank?: number | null
          snapshot?: Json
          snapshot_count?: number
          source_file_ids?: string[]
          source_file_names?: string[]
          source_snapshot_ids?: string[]
          start_canonical_sequence?: number | null
          start_file_id?: string | null
          start_file_name?: string | null
          start_file_rank?: number
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_stop_itemcode_snapshots: {
        Row: {
          blank_row_count: number
          blocked_codes: string[]
          blocked_row_count: number
          canonical_sequence: number | null
          commonname: string | null
          contsize: string | null
          created_at: string
          file_date: string
          file_id: string
          file_name: string
          file_rank: number
          first_blocked_code: string | null
          genus: string | null
          h_row_count: number
          hold_reason_categories: string[]
          hold_reason_category: string | null
          holdstopreason: string | null
          holdstopreasons: string[]
          is_blocked: boolean
          itemcode: string
          observed_holdstopcodes: string[]
          s_row_count: number
          snapshot: Json
          source_row_ids: string[]
          total_row_count: number
          unique_id: string
          updated_at: string
        }
        Insert: {
          blank_row_count?: number
          blocked_codes?: string[]
          blocked_row_count?: number
          canonical_sequence?: number | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          file_date: string
          file_id: string
          file_name: string
          file_rank: number
          first_blocked_code?: string | null
          genus?: string | null
          h_row_count?: number
          hold_reason_categories?: string[]
          hold_reason_category?: string | null
          holdstopreason?: string | null
          holdstopreasons?: string[]
          is_blocked?: boolean
          itemcode: string
          observed_holdstopcodes?: string[]
          s_row_count?: number
          snapshot?: Json
          source_row_ids?: string[]
          total_row_count?: number
          unique_id: string
          updated_at?: string
        }
        Update: {
          blank_row_count?: number
          blocked_codes?: string[]
          blocked_row_count?: number
          canonical_sequence?: number | null
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          file_date?: string
          file_id?: string
          file_name?: string
          file_rank?: number
          first_blocked_code?: string | null
          genus?: string | null
          h_row_count?: number
          hold_reason_categories?: string[]
          hold_reason_category?: string | null
          holdstopreason?: string | null
          holdstopreasons?: string[]
          is_blocked?: boolean
          itemcode?: string
          observed_holdstopcodes?: string[]
          s_row_count?: number
          snapshot?: Json
          source_row_ids?: string[]
          total_row_count?: number
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_hold_stop_itemcode_summaries: {
        Row: {
          avg_days_to_release: number | null
          avg_gdd_base_50_to_release: number | null
          commonname: string | null
          contsize: string | null
          current_blocked_code: string | null
          current_blocked_rows: number
          current_h_rows: number
          current_holdstopreason: string | null
          current_holdstopreasons: string[]
          current_is_blocked: boolean
          current_reason_category: string | null
          current_rows: number
          current_s_rows: number
          first_episode_start_date: string | null
          genus: string | null
          history_file_count: number
          history_first_file_date: string | null
          history_last_file_date: string | null
          hold_sample_count: number
          itemcode: string
          last_episode_start_date: string | null
          last_release_date: string | null
          median_days_to_release: number | null
          median_gdd_base_50_to_release: number | null
          open_cycle_count: number
          open_episode_file_name: string | null
          open_episode_reason: string | null
          open_episode_start_date: string | null
          parsed_history_file_count: number
          parsed_history_first_file_date: string | null
          parsed_history_last_file_date: string | null
          primary_reason_category: string | null
          profile_count: number
          released_cycle_count: number
          row_history_first_file_date: string | null
          row_history_last_file_date: string | null
          rows_file_count: number
          snapshot: Json
          total_cycle_count: number
          unique_id: string
          updated_at: string
        }
        Insert: {
          avg_days_to_release?: number | null
          avg_gdd_base_50_to_release?: number | null
          commonname?: string | null
          contsize?: string | null
          current_blocked_code?: string | null
          current_blocked_rows?: number
          current_h_rows?: number
          current_holdstopreason?: string | null
          current_holdstopreasons?: string[]
          current_is_blocked?: boolean
          current_reason_category?: string | null
          current_rows?: number
          current_s_rows?: number
          first_episode_start_date?: string | null
          genus?: string | null
          history_file_count?: number
          history_first_file_date?: string | null
          history_last_file_date?: string | null
          hold_sample_count?: number
          itemcode: string
          last_episode_start_date?: string | null
          last_release_date?: string | null
          median_days_to_release?: number | null
          median_gdd_base_50_to_release?: number | null
          open_cycle_count?: number
          open_episode_file_name?: string | null
          open_episode_reason?: string | null
          open_episode_start_date?: string | null
          parsed_history_file_count?: number
          parsed_history_first_file_date?: string | null
          parsed_history_last_file_date?: string | null
          primary_reason_category?: string | null
          profile_count?: number
          released_cycle_count?: number
          row_history_first_file_date?: string | null
          row_history_last_file_date?: string | null
          rows_file_count?: number
          snapshot?: Json
          total_cycle_count?: number
          unique_id: string
          updated_at?: string
        }
        Update: {
          avg_days_to_release?: number | null
          avg_gdd_base_50_to_release?: number | null
          commonname?: string | null
          contsize?: string | null
          current_blocked_code?: string | null
          current_blocked_rows?: number
          current_h_rows?: number
          current_holdstopreason?: string | null
          current_holdstopreasons?: string[]
          current_is_blocked?: boolean
          current_reason_category?: string | null
          current_rows?: number
          current_s_rows?: number
          first_episode_start_date?: string | null
          genus?: string | null
          history_file_count?: number
          history_first_file_date?: string | null
          history_last_file_date?: string | null
          hold_sample_count?: number
          itemcode?: string
          last_episode_start_date?: string | null
          last_release_date?: string | null
          median_days_to_release?: number | null
          median_gdd_base_50_to_release?: number | null
          open_cycle_count?: number
          open_episode_file_name?: string | null
          open_episode_reason?: string | null
          open_episode_start_date?: string | null
          parsed_history_file_count?: number
          parsed_history_first_file_date?: string | null
          parsed_history_last_file_date?: string | null
          primary_reason_category?: string | null
          profile_count?: number
          released_cycle_count?: number
          row_history_first_file_date?: string | null
          row_history_last_file_date?: string | null
          rows_file_count?: number
          snapshot?: Json
          total_cycle_count?: number
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_inventory_edit_request_events: {
        Row: {
          actor_display: string | null
          actor_username: string | null
          created_at: string
          event_note: string | null
          event_stage: string | null
          event_type: string
          id: string
          payload: Json
          request_id: string
        }
        Insert: {
          actor_display?: string | null
          actor_username?: string | null
          created_at?: string
          event_note?: string | null
          event_stage?: string | null
          event_type: string
          id?: string
          payload?: Json
          request_id: string
        }
        Update: {
          actor_display?: string | null
          actor_username?: string | null
          created_at?: string
          event_note?: string | null
          event_stage?: string | null
          event_type?: string
          id?: string
          payload?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_inventory_edit_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "ph_inventory_edit_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_inventory_edit_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_display: string | null
          approved_qty: string | null
          assignedto: string | null
          changes: Json
          commonname: string | null
          contsize: string | null
          created_at: string
          current_holdreason: string | null
          current_holdstopcode: string | null
          current_locationnote: string | null
          current_priority: string | null
          current_pulltagnotes: string | null
          edited_at: string | null
          edited_by: string | null
          edited_by_display: string | null
          handled_at: string | null
          handled_by: string | null
          handled_by_display: string | null
          handler_note: string | null
          holdreason: string | null
          id: string
          inventory_edit_completed_at: string | null
          inventory_edit_completed_by: string | null
          inventory_edit_completed_by_display: string | null
          inventory_edit_done: boolean
          inventory_edit_live: boolean
          itemcode: string | null
          jd_approved_qty: string | null
          locationcode: string | null
          lotcode: string | null
          master_unique_id: string | null
          notification_sent_at: string | null
          notification_stage: string | null
          photo_data_completed_at: string | null
          photo_data_completed_by: string | null
          photo_data_completed_by_display: string | null
          photo_data_done: boolean
          previous_stage: string | null
          priority_flag: boolean
          ptravailable: string | null
          reason: string | null
          request_type: string
          requested: Json
          s_lts: string | null
          sent_at: string
          sent_by: string | null
          sent_by_display: string | null
          snapshot: Json
          source: string | null
          source_unique_id: string | null
          source_view: string | null
          stage: string | null
          stage_before_terminal: string | null
          stage_updated_at: string
          stage_updated_by: string | null
          stage_updated_by_display: string | null
          status: string
          supervisor_note: string | null
          updated_at: string
          workflow_stage: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_display?: string | null
          approved_qty?: string | null
          assignedto?: string | null
          changes?: Json
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          current_holdreason?: string | null
          current_holdstopcode?: string | null
          current_locationnote?: string | null
          current_priority?: string | null
          current_pulltagnotes?: string | null
          edited_at?: string | null
          edited_by?: string | null
          edited_by_display?: string | null
          handled_at?: string | null
          handled_by?: string | null
          handled_by_display?: string | null
          handler_note?: string | null
          holdreason?: string | null
          id: string
          inventory_edit_completed_at?: string | null
          inventory_edit_completed_by?: string | null
          inventory_edit_completed_by_display?: string | null
          inventory_edit_done?: boolean
          inventory_edit_live?: boolean
          itemcode?: string | null
          jd_approved_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          notification_sent_at?: string | null
          notification_stage?: string | null
          photo_data_completed_at?: string | null
          photo_data_completed_by?: string | null
          photo_data_completed_by_display?: string | null
          photo_data_done?: boolean
          previous_stage?: string | null
          priority_flag?: boolean
          ptravailable?: string | null
          reason?: string | null
          request_type?: string
          requested?: Json
          s_lts?: string | null
          sent_at?: string
          sent_by?: string | null
          sent_by_display?: string | null
          snapshot?: Json
          source?: string | null
          source_unique_id?: string | null
          source_view?: string | null
          stage?: string | null
          stage_before_terminal?: string | null
          stage_updated_at?: string
          stage_updated_by?: string | null
          stage_updated_by_display?: string | null
          status?: string
          supervisor_note?: string | null
          updated_at?: string
          workflow_stage?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_display?: string | null
          approved_qty?: string | null
          assignedto?: string | null
          changes?: Json
          commonname?: string | null
          contsize?: string | null
          created_at?: string
          current_holdreason?: string | null
          current_holdstopcode?: string | null
          current_locationnote?: string | null
          current_priority?: string | null
          current_pulltagnotes?: string | null
          edited_at?: string | null
          edited_by?: string | null
          edited_by_display?: string | null
          handled_at?: string | null
          handled_by?: string | null
          handled_by_display?: string | null
          handler_note?: string | null
          holdreason?: string | null
          id?: string
          inventory_edit_completed_at?: string | null
          inventory_edit_completed_by?: string | null
          inventory_edit_completed_by_display?: string | null
          inventory_edit_done?: boolean
          inventory_edit_live?: boolean
          itemcode?: string | null
          jd_approved_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string | null
          notification_sent_at?: string | null
          notification_stage?: string | null
          photo_data_completed_at?: string | null
          photo_data_completed_by?: string | null
          photo_data_completed_by_display?: string | null
          photo_data_done?: boolean
          previous_stage?: string | null
          priority_flag?: boolean
          ptravailable?: string | null
          reason?: string | null
          request_type?: string
          requested?: Json
          s_lts?: string | null
          sent_at?: string
          sent_by?: string | null
          sent_by_display?: string | null
          snapshot?: Json
          source?: string | null
          source_unique_id?: string | null
          source_view?: string | null
          stage?: string | null
          stage_before_terminal?: string | null
          stage_updated_at?: string
          stage_updated_by?: string | null
          stage_updated_by_display?: string | null
          status?: string
          supervisor_note?: string | null
          updated_at?: string
          workflow_stage?: string
        }
        Relationships: []
      }
      ph_inventory_row_assignments: {
        Row: {
          assigned_at: string | null
          assignedto: string | null
          assignment_reason: string
          commonname: string | null
          contsize: string | null
          default_assignedto: string | null
          default_revision: number
          genusname: string | null
          itemcode: string | null
          itemcode_normalized: string | null
          locationcode: string | null
          lotcode: string | null
          master_unique_id: string
          policy_revision: number
          present_in_drive: boolean
          review_required: boolean
          revision: number
          source: string | null
          source_revision: number
          unique_id: string
          updated_at: string
          warehousei: string | null
          zone_override_active: boolean
        }
        Insert: {
          assigned_at?: string | null
          assignedto?: string | null
          assignment_reason: string
          commonname?: string | null
          contsize?: string | null
          default_assignedto?: string | null
          default_revision?: number
          genusname?: string | null
          itemcode?: string | null
          itemcode_normalized?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id: string
          policy_revision?: number
          present_in_drive?: boolean
          review_required?: boolean
          revision?: number
          source?: string | null
          source_revision?: number
          unique_id: string
          updated_at?: string
          warehousei?: string | null
          zone_override_active?: boolean
        }
        Update: {
          assigned_at?: string | null
          assignedto?: string | null
          assignment_reason?: string
          commonname?: string | null
          contsize?: string | null
          default_assignedto?: string | null
          default_revision?: number
          genusname?: string | null
          itemcode?: string | null
          itemcode_normalized?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string
          policy_revision?: number
          present_in_drive?: boolean
          review_required?: boolean
          revision?: number
          source?: string | null
          source_revision?: number
          unique_id?: string
          updated_at?: string
          warehousei?: string | null
          zone_override_active?: boolean
        }
        Relationships: []
      }
      ph_inventory_transactions: {
        Row: {
          action: string
          actor_display: string | null
          actor_email: string | null
          actor_id: string | null
          actor_username: string | null
          created_at: string
          delivery_event_id: string | null
          destination_after: Json | null
          destination_before: Json | null
          destination_itemcode: string | null
          destination_locationcode: string | null
          destination_lotcode: string | null
          destination_table: string | null
          destination_unique_id: string | null
          event_type: string
          quantity: number | null
          raw_payload: Json
          search_text: string
          source_after: Json | null
          source_before: Json | null
          source_itemcode: string | null
          source_locationcode: string | null
          source_lotcode: string | null
          source_table: string | null
          source_unique_id: string | null
          status: string
          unique_id: string
        }
        Insert: {
          action: string
          actor_display?: string | null
          actor_email?: string | null
          actor_id?: string | null
          actor_username?: string | null
          created_at?: string
          delivery_event_id?: string | null
          destination_after?: Json | null
          destination_before?: Json | null
          destination_itemcode?: string | null
          destination_locationcode?: string | null
          destination_lotcode?: string | null
          destination_table?: string | null
          destination_unique_id?: string | null
          event_type?: string
          quantity?: number | null
          raw_payload?: Json
          search_text?: string
          source_after?: Json | null
          source_before?: Json | null
          source_itemcode?: string | null
          source_locationcode?: string | null
          source_lotcode?: string | null
          source_table?: string | null
          source_unique_id?: string | null
          status: string
          unique_id: string
        }
        Update: {
          action?: string
          actor_display?: string | null
          actor_email?: string | null
          actor_id?: string | null
          actor_username?: string | null
          created_at?: string
          delivery_event_id?: string | null
          destination_after?: Json | null
          destination_before?: Json | null
          destination_itemcode?: string | null
          destination_locationcode?: string | null
          destination_lotcode?: string | null
          destination_table?: string | null
          destination_unique_id?: string | null
          event_type?: string
          quantity?: number | null
          raw_payload?: Json
          search_text?: string
          source_after?: Json | null
          source_before?: Json | null
          source_itemcode?: string | null
          source_locationcode?: string | null
          source_lotcode?: string | null
          source_table?: string | null
          source_unique_id?: string | null
          status?: string
          unique_id?: string
        }
        Relationships: []
      }
      ph_item_inquiry_coverage: {
        Row: {
          revision: number
          sharon_away: boolean
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          revision?: number
          sharon_away?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          revision?: number
          sharon_away?: boolean
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_itemcode_default_owners: {
        Row: {
          assigned_at: string | null
          assignedto: string | null
          itemcode_normalized: string
          review_required: boolean
          revision: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string | null
          assignedto?: string | null
          itemcode_normalized: string
          review_required?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string | null
          assignedto?: string | null
          itemcode_normalized?: string
          review_required?: boolean
          revision?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ph_labor_hours: {
        Row: {
          date_reported: string
          department: string
          id: string
          man_hours: number
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          date_reported: string
          department: string
          id?: string
          man_hours: number
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          date_reported?: string
          department?: string
          id?: string
          man_hours?: number
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: []
      }
      ph_location_work_assignments: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
          job_id: string
          profile_id: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          id?: string
          job_id: string
          profile_id: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          job_id?: string
          profile_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_location_work_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ph_location_work_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_location_work_assignments_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_location_work_audit: {
        Row: {
          actor_username: string
          created_at: string
          event_type: string
          id: number
          job_id: string
          job_revision: number
          line_id: string | null
          metadata: Json
        }
        Insert: {
          actor_username: string
          created_at?: string
          event_type: string
          id?: never
          job_id: string
          job_revision: number
          line_id?: string | null
          metadata?: Json
        }
        Update: {
          actor_username?: string
          created_at?: string
          event_type?: string
          id?: never
          job_id?: string
          job_revision?: number
          line_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ph_location_work_audit_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ph_location_work_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_location_work_audit_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "ph_location_work_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_location_work_delivery_events: {
        Row: {
          created_at: string
          delivery_kind: string
          id: number
          job_id: string
          job_revision: number
          outbox_event_id: string
        }
        Insert: {
          created_at?: string
          delivery_kind: string
          id?: never
          job_id: string
          job_revision: number
          outbox_event_id: string
        }
        Update: {
          created_at?: string
          delivery_kind?: string
          id?: never
          job_id?: string
          job_revision?: number
          outbox_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_location_work_delivery_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ph_location_work_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_location_work_delivery_events_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: true
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_delivery_events_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: true
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_delivery_events_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: true
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
        ]
      }
      ph_location_work_jobs: {
        Row: {
          assigned_usernames: string[]
          assignment_event_id: string | null
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          completion_event_id: string | null
          completion_recipient: Json
          created_at: string
          created_by_display: string
          created_by_profile_id: string
          created_by_username: string
          general_instructions: string
          id: string
          idempotency_key: string
          line_count: number
          resolved_line_count: number
          revision: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_usernames?: string[]
          assignment_event_id?: string | null
          cancelled_at?: string | null
          cancelled_by_username?: string | null
          completed_at?: string | null
          completed_by_username?: string | null
          completion_event_id?: string | null
          completion_recipient: Json
          created_at?: string
          created_by_display: string
          created_by_profile_id: string
          created_by_username: string
          general_instructions: string
          id?: string
          idempotency_key: string
          line_count?: number
          resolved_line_count?: number
          revision?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_usernames?: string[]
          assignment_event_id?: string | null
          cancelled_at?: string | null
          cancelled_by_username?: string | null
          completed_at?: string | null
          completed_by_username?: string | null
          completion_event_id?: string | null
          completion_recipient?: Json
          created_at?: string
          created_by_display?: string
          created_by_profile_id?: string
          created_by_username?: string
          general_instructions?: string
          id?: string
          idempotency_key?: string
          line_count?: number
          resolved_line_count?: number
          revision?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_location_work_jobs_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_assignment_event_id_fkey"
            columns: ["assignment_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_completion_event_id_fkey"
            columns: ["completion_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
          {
            foreignKeyName: "ph_location_work_jobs_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_location_work_lines: {
        Row: {
          action_type: string
          actual_qty: number | null
          commonname: string
          contsize: string
          created_at: string
          destination_locationcode: string | null
          destination_matching_rows: number
          destination_on_hand: number
          id: string
          instructions: string
          itemcode: string
          job_id: string
          not_completed_reason: string | null
          ordinal: number
          planned_qty: number
          resolution_status: string
          resolved_at: string | null
          resolved_by_username: string | null
          salesyear: string
          snapshotted_on_hand: number
          source_locationcode: string
          source_unique_id: string
          updated_at: string
          variance_confirmed: boolean
        }
        Insert: {
          action_type: string
          actual_qty?: number | null
          commonname?: string
          contsize?: string
          created_at?: string
          destination_locationcode?: string | null
          destination_matching_rows?: number
          destination_on_hand?: number
          id?: string
          instructions?: string
          itemcode: string
          job_id: string
          not_completed_reason?: string | null
          ordinal: number
          planned_qty: number
          resolution_status?: string
          resolved_at?: string | null
          resolved_by_username?: string | null
          salesyear: string
          snapshotted_on_hand: number
          source_locationcode: string
          source_unique_id: string
          updated_at?: string
          variance_confirmed?: boolean
        }
        Update: {
          action_type?: string
          actual_qty?: number | null
          commonname?: string
          contsize?: string
          created_at?: string
          destination_locationcode?: string | null
          destination_matching_rows?: number
          destination_on_hand?: number
          id?: string
          instructions?: string
          itemcode?: string
          job_id?: string
          not_completed_reason?: string | null
          ordinal?: number
          planned_qty?: number
          resolution_status?: string
          resolved_at?: string | null
          resolved_by_username?: string | null
          salesyear?: string
          snapshotted_on_hand?: number
          source_locationcode?: string
          source_unique_id?: string
          updated_at?: string
          variance_confirmed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ph_location_work_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ph_location_work_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_master_inventory: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          av_rule_av_note_updated_at: string | null
          av_rule_bundle_updated_at: string | null
          av_rule_caliper_updated_at: string | null
          av_rule_holdstop_snapshot: string | null
          av_rule_last_clear_reason: string | null
          av_rule_last_cleared_at: string | null
          av_rule_match_updated_at: string | null
          av_rule_photo_updated_at: string | null
          av_rule_priority_snapshot: string | null
          av_rule_spec_updated_at: string | null
          avg_price_eunit_shipped: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
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
          ext_eunit_shipped: string | null
          ext_ptronhand: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          genusname: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          hold_release_approved_at: string | null
          hold_release_approved_by: string | null
          hold_release_approved_by_display: string | null
          hold_release_approved_holdstopbegindate: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hsreasonbegin: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          inventorynote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          largeptrqty: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          match: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          ncr_approval_message: string | null
          ncr_approval_type: string | null
          ncr_requested_at: string | null
          ncr_requested_by_display: string | null
          ncr_requested_by_email: string | null
          ncr_requested_by_username: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          oversellpercentage: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          reversecommon: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          spec: string | null
          specialpuller: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          suspendto: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string
          unitprice: string | null
          varietycode: string | null
          warehousei: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Insert: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          av_rule_av_note_updated_at?: string | null
          av_rule_bundle_updated_at?: string | null
          av_rule_caliper_updated_at?: string | null
          av_rule_holdstop_snapshot?: string | null
          av_rule_last_clear_reason?: string | null
          av_rule_last_cleared_at?: string | null
          av_rule_match_updated_at?: string | null
          av_rule_photo_updated_at?: string | null
          av_rule_priority_snapshot?: string | null
          av_rule_spec_updated_at?: string | null
          avg_price_eunit_shipped?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          brand?: string | null
          bypassloc?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
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
          ext_eunit_shipped?: string | null
          ext_ptronhand?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          field_tag_color?: string | null
          fieldtagcolor?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          genusname?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          hold_release_approved_at?: string | null
          hold_release_approved_by?: string | null
          hold_release_approved_by_display?: string | null
          hold_release_approved_holdstopbegindate?: string | null
          holdstopbegindate?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hsreasonbegin?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          inventorynote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          largeptrqty?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          locationptn2?: string | null
          lochold?: string | null
          lotcode?: string | null
          match?: string | null
          maxorderquantity?: string | null
          mcstatus?: string | null
          nationalaccount?: string | null
          ncloadinstructions?: string | null
          ncr_approval_message?: string | null
          ncr_approval_type?: string | null
          ncr_requested_at?: string | null
          ncr_requested_by_display?: string | null
          ncr_requested_by_email?: string | null
          ncr_requested_by_username?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          oversellpercentage?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          prisetby?: string | null
          priupdated?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          pullerresponsibility?: string | null
          pulltagnote1?: string | null
          pulltagnote2?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          reversecommon?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesnotebegindate?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          saleyear?: string | null
          season?: string | null
          season_available?: string | null
          season_demand?: string | null
          season_oh?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          specialpuller?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          suspendto?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id: string
          unitprice?: string | null
          varietycode?: string | null
          warehousei?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
        }
        Update: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          app_tab_assignment?: string | null
          assignedto?: string | null
          av_note?: string | null
          av_rule_av_note_updated_at?: string | null
          av_rule_bundle_updated_at?: string | null
          av_rule_caliper_updated_at?: string | null
          av_rule_holdstop_snapshot?: string | null
          av_rule_last_clear_reason?: string | null
          av_rule_last_cleared_at?: string | null
          av_rule_match_updated_at?: string | null
          av_rule_photo_updated_at?: string | null
          av_rule_priority_snapshot?: string | null
          av_rule_spec_updated_at?: string | null
          avg_price_eunit_shipped?: string | null
          bay?: string | null
          blockalpha?: string | null
          blocknumber?: string | null
          botanicalname?: string | null
          brand?: string | null
          bypassloc?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
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
          ext_eunit_shipped?: string | null
          ext_ptronhand?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          field_tag_color?: string | null
          fieldtagcolor?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_av_note?: string | null
          flyer_caliper?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_initial_ptr?: number | null
          flyer_inst?: string | null
          flyer_loc_match_qty?: number | null
          flyer_match?: number | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_pick?: string | null
          flyer_spec?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          genusname?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          hold_release_approved_at?: string | null
          hold_release_approved_by?: string | null
          hold_release_approved_by_display?: string | null
          hold_release_approved_holdstopbegindate?: string | null
          holdstopbegindate?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hsreasonbegin?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          inventorynote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          largeptrqty?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          locationptn1?: string | null
          locationptn2?: string | null
          lochold?: string | null
          lotcode?: string | null
          match?: string | null
          maxorderquantity?: string | null
          mcstatus?: string | null
          nationalaccount?: string | null
          ncloadinstructions?: string | null
          ncr_approval_message?: string | null
          ncr_approval_type?: string | null
          ncr_requested_at?: string | null
          ncr_requested_by_display?: string | null
          ncr_requested_by_email?: string | null
          ncr_requested_by_username?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          oversellpercentage?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          prisetby?: string | null
          priupdated?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          pullerresponsibility?: string | null
          pulltagnote1?: string | null
          pulltagnote2?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          reversecommon?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesnotebegindate?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          saleyear?: string | null
          season?: string | null
          season_available?: string | null
          season_demand?: string | null
          season_oh?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          specialpuller?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          suspendto?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id?: string
          unitprice?: string | null
          varietycode?: string | null
          warehousei?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
        }
        Relationships: []
      }
      ph_master_inventory_user_assignments: {
        Row: {
          assignedto: string
          assignment_source: string
          created_at: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_unique_id: string
          source: string | null
          source_assignedto: string | null
          updated_at: string
        }
        Insert: {
          assignedto: string
          assignment_source?: string
          created_at?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id: string
          source?: string | null
          source_assignedto?: string | null
          updated_at?: string
        }
        Update: {
          assignedto?: string
          assignment_source?: string
          created_at?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string
          source?: string | null
          source_assignedto?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ph_ml_github_dispatch_state: {
        Row: {
          dispatch_count: number
          dispatch_key: string
          last_dispatched_at: string
          last_event_type: string | null
          last_row_id: string | null
          last_table_name: string | null
          updated_at: string
        }
        Insert: {
          dispatch_count?: number
          dispatch_key: string
          last_dispatched_at?: string
          last_event_type?: string | null
          last_row_id?: string | null
          last_table_name?: string | null
          updated_at?: string
        }
        Update: {
          dispatch_count?: number
          dispatch_key?: string
          last_dispatched_at?: string
          last_event_type?: string | null
          last_row_id?: string | null
          last_table_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ph_ncr_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          created_at: string
          emailed_jd: boolean
          itemcode: string | null
          locationcode: string | null
          source_unique_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          emailed_jd?: boolean
          itemcode?: string | null
          locationcode?: string | null
          source_unique_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          emailed_jd?: boolean
          itemcode?: string | null
          locationcode?: string | null
          source_unique_id?: string
        }
        Relationships: []
      }
      ph_photo_archive_jobs: {
        Row: {
          attempts: number
          copied_at: string | null
          created_at: string
          deleted_at: string | null
          drive_file_id: string | null
          drive_file_name: string | null
          drive_folder_id: string | null
          first_ref_scan_at: string | null
          invalid_reasons: Json
          last_error_code: string | null
          last_error_message: string | null
          master_unique_ids: Json
          quarantine_until: string | null
          second_ref_scan_at: string | null
          sha256: string | null
          source_bucket: string
          source_created_at: string | null
          source_key: string
          source_path: string
          source_size: number | null
          source_url: string | null
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          copied_at?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_file_id?: string | null
          drive_file_name?: string | null
          drive_folder_id?: string | null
          first_ref_scan_at?: string | null
          invalid_reasons?: Json
          last_error_code?: string | null
          last_error_message?: string | null
          master_unique_ids?: Json
          quarantine_until?: string | null
          second_ref_scan_at?: string | null
          sha256?: string | null
          source_bucket: string
          source_created_at?: string | null
          source_key: string
          source_path: string
          source_size?: number | null
          source_url?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          copied_at?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_file_id?: string | null
          drive_file_name?: string | null
          drive_folder_id?: string | null
          first_ref_scan_at?: string | null
          invalid_reasons?: Json
          last_error_code?: string | null
          last_error_message?: string | null
          master_unique_ids?: Json
          quarantine_until?: string | null
          second_ref_scan_at?: string | null
          sha256?: string | null
          source_bucket?: string
          source_created_at?: string | null
          source_key?: string
          source_path?: string
          source_size?: number | null
          source_url?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      ph_photo_archive_runs: {
        Row: {
          candidates_found: number
          completed_at: string | null
          copied_count: number
          deleted_count: number
          error_code: string | null
          failed_count: number
          id: string
          local_archive_date: string
          release: string
          started_at: string
          status: string
          summary: Json
          updated_at: string
          verified_count: number
        }
        Insert: {
          candidates_found?: number
          completed_at?: string | null
          copied_count?: number
          deleted_count?: number
          error_code?: string | null
          failed_count?: number
          id?: string
          local_archive_date: string
          release: string
          started_at?: string
          status?: string
          summary?: Json
          updated_at?: string
          verified_count?: number
        }
        Update: {
          candidates_found?: number
          completed_at?: string | null
          copied_count?: number
          deleted_count?: number
          error_code?: string | null
          failed_count?: number
          id?: string
          local_archive_date?: string
          release?: string
          started_at?: string
          status?: string
          summary?: Json
          updated_at?: string
          verified_count?: number
        }
        Relationships: []
      }
      ph_photo_history_assets: {
        Row: {
          bucket: string
          commonname: string
          contexts: Json
          contsize: string
          drive_file_id: string | null
          filename: string
          id: string
          indexed_at: string
          itemcode: string
          locationcode: string
          lotcode: string
          path: string
          photo_at: string
          search_text: string
          source_key: string
          storage_available: boolean
        }
        Insert: {
          bucket: string
          commonname?: string
          contexts?: Json
          contsize?: string
          drive_file_id?: string | null
          filename: string
          id?: string
          indexed_at?: string
          itemcode?: string
          locationcode?: string
          lotcode?: string
          path: string
          photo_at: string
          search_text?: string
          source_key: string
          storage_available?: boolean
        }
        Update: {
          bucket?: string
          commonname?: string
          contexts?: Json
          contsize?: string
          drive_file_id?: string | null
          filename?: string
          id?: string
          indexed_at?: string
          itemcode?: string
          locationcode?: string
          lotcode?: string
          path?: string
          photo_at?: string
          search_text?: string
          source_key?: string
          storage_available?: boolean
        }
        Relationships: []
      }
      ph_photo_history_audit: {
        Row: {
          created_at: string
          event: string
          id: number
          share_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: never
          share_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: never
          share_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ph_photo_history_audit_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "ph_photo_history_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_photo_history_index_state: {
        Row: {
          asset_count: number
          refreshed_at: string | null
          singleton: boolean
        }
        Insert: {
          asset_count?: number
          refreshed_at?: string | null
          singleton?: boolean
        }
        Update: {
          asset_count?: number
          refreshed_at?: string | null
          singleton?: boolean
        }
        Relationships: []
      }
      ph_photo_history_shares: {
        Row: {
          actor_id: string
          created_at: string
          dismissed_at: string | null
          event_id: string
          fingerprint: string
          id: string
          idempotency_key: string
          photo_count: number
          recipient_name: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          dismissed_at?: string | null
          event_id: string
          fingerprint: string
          id?: string
          idempotency_key: string
          photo_count: number
          recipient_name: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          dismissed_at?: string | null
          event_id?: string
          fingerprint?: string
          id?: string
          idempotency_key?: string
          photo_count?: number
          recipient_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_photo_history_shares_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_photo_history_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_photo_history_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_photo_history_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
        ]
      }
      ph_pikes_order_assignment_repair_audit: {
        Row: {
          ambiguous_count: number
          audit_id: string
          batch_id: string
          corrected_count: number
          created_at: string
          eligible_count: number
          idempotency_key: string
          newer_count: number
          no_match_count: number
          repair_fingerprint: string
          result: Json
        }
        Insert: {
          ambiguous_count: number
          audit_id?: string
          batch_id: string
          corrected_count: number
          created_at?: string
          eligible_count: number
          idempotency_key: string
          newer_count: number
          no_match_count: number
          repair_fingerprint: string
          result: Json
        }
        Update: {
          ambiguous_count?: number
          audit_id?: string
          batch_id?: string
          corrected_count?: number
          created_at?: string
          eligible_count?: number
          idempotency_key?: string
          newer_count?: number
          no_match_count?: number
          repair_fingerprint?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ph_pikes_order_assignment_repair_audit_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ph_pikes_order_batches"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      ph_pikes_order_batches: {
        Row: {
          archived_at: string | null
          batch_date: string | null
          batch_id: string
          content_bytes: number | null
          content_sha256: string
          created_at: string
          daily_sequence: number | null
          display_name: string | null
          distinct_item_count: number
          drive_file_id: string
          file_name: string
          imported_at: string | null
          inventory_row_count: number
          last_error_code: string | null
          matched_item_count: number
          source_header_row: number | null
          source_key: string
          source_row_count: number
          source_sheet_name: string | null
          status: string
          unmatched_item_count: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          batch_date?: string | null
          batch_id?: string
          content_bytes?: number | null
          content_sha256: string
          created_at?: string
          daily_sequence?: number | null
          display_name?: string | null
          distinct_item_count?: number
          drive_file_id: string
          file_name: string
          imported_at?: string | null
          inventory_row_count?: number
          last_error_code?: string | null
          matched_item_count?: number
          source_header_row?: number | null
          source_key?: string
          source_row_count?: number
          source_sheet_name?: string | null
          status?: string
          unmatched_item_count?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          batch_date?: string | null
          batch_id?: string
          content_bytes?: number | null
          content_sha256?: string
          created_at?: string
          daily_sequence?: number | null
          display_name?: string | null
          distinct_item_count?: number
          drive_file_id?: string
          file_name?: string
          imported_at?: string | null
          inventory_row_count?: number
          last_error_code?: string | null
          matched_item_count?: number
          source_header_row?: number | null
          source_key?: string
          source_row_count?: number
          source_sheet_name?: string | null
          status?: string
          unmatched_item_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      ph_pikes_order_inventory_rows: {
        Row: {
          assignedto: string | null
          assignedto_key: string | null
          assignment_authority_assigned_at: string | null
          assignment_authority_key: string | null
          assignment_match_method: string | null
          batch_id: string
          blockalpha: string | null
          blocknumber: string | null
          commonname: string | null
          contsize: string | null
          desigitem: string | null
          desigloc: string | null
          fieldtagcolor: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          itemcode: string
          itemcode_normalized: string
          itemspec: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          lotcode: string | null
          master_unique_id: string
          photo_link: string | null
          photo_name: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          s_lts: string | null
          season: string | null
          snapshotted_at: string
        }
        Insert: {
          assignedto?: string | null
          assignedto_key?: string | null
          assignment_authority_assigned_at?: string | null
          assignment_authority_key?: string | null
          assignment_match_method?: string | null
          batch_id: string
          blockalpha?: string | null
          blocknumber?: string | null
          commonname?: string | null
          contsize?: string | null
          desigitem?: string | null
          desigloc?: string | null
          fieldtagcolor?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          itemcode: string
          itemcode_normalized: string
          itemspec?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          lotcode?: string | null
          master_unique_id: string
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          s_lts?: string | null
          season?: string | null
          snapshotted_at?: string
        }
        Update: {
          assignedto?: string | null
          assignedto_key?: string | null
          assignment_authority_assigned_at?: string | null
          assignment_authority_key?: string | null
          assignment_match_method?: string | null
          batch_id?: string
          blockalpha?: string | null
          blocknumber?: string | null
          commonname?: string | null
          contsize?: string | null
          desigitem?: string | null
          desigloc?: string | null
          fieldtagcolor?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          itemcode?: string
          itemcode_normalized?: string
          itemspec?: string | null
          locationcode?: string | null
          locationnote?: string | null
          locationnotedate?: string | null
          lotcode?: string | null
          master_unique_id?: string
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          s_lts?: string | null
          season?: string | null
          snapshotted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_pikes_order_inventory_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ph_pikes_order_batches"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      ph_pikes_order_source_rows: {
        Row: {
          batch_id: string
          created_at: string
          itemcode: string
          itemcode_normalized: string
          matched: boolean
          order_tot: string | null
          pick_notes: string | null
          source_row_number: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          itemcode: string
          itemcode_normalized: string
          matched?: boolean
          order_tot?: string | null
          pick_notes?: string | null
          source_row_number: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          itemcode?: string
          itemcode_normalized?: string
          matched?: boolean
          order_tot?: string | null
          pick_notes?: string | null
          source_row_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ph_pikes_order_source_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "ph_pikes_order_batches"
            referencedColumns: ["batch_id"]
          },
        ]
      }
      ph_production_workflow_rows: {
        Row: {
          baynumber: string
          blockalpha: string | null
          commonname: string | null
          completed_at: string | null
          completed_by_display: string | null
          completed_by_username: string | null
          contsize: string | null
          created_at: string
          created_by_display: string
          created_by_username: string
          genus: string | null
          instructions: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          ptravailable: number | null
          quantity: number
          revision: number
          season: string | null
          snapshot: Json
          source_unique_id: string
          status: string
          unique_id: string
          updated_at: string
          updated_by_display: string
          updated_by_username: string
          workflow_type: string
        }
        Insert: {
          baynumber?: string
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display: string
          created_by_username: string
          genus?: string | null
          instructions?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          ptravailable?: number | null
          quantity: number
          revision?: number
          season?: string | null
          snapshot: Json
          source_unique_id: string
          status?: string
          unique_id?: string
          updated_at?: string
          updated_by_display: string
          updated_by_username: string
          workflow_type: string
        }
        Update: {
          baynumber?: string
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string
          created_by_username?: string
          genus?: string | null
          instructions?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          ptravailable?: number | null
          quantity?: number
          revision?: number
          season?: string | null
          snapshot?: Json
          source_unique_id?: string
          status?: string
          unique_id?: string
          updated_at?: string
          updated_by_display?: string
          updated_by_username?: string
          workflow_type?: string
        }
        Relationships: []
      }
      ph_productivity_history: {
        Row: {
          commonname: string | null
          completed_at: string
          completed_by_display: string
          completed_by_username: string
          contsize: string | null
          customer_name: string | null
          event_key: string
          id: string
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          request_folder: string | null
          snapshot: Json
          source_assignment: string | null
          source_kind: string
          source_table: string
          source_unique_id: string
        }
        Insert: {
          commonname?: string | null
          completed_at: string
          completed_by_display: string
          completed_by_username: string
          contsize?: string | null
          customer_name?: string | null
          event_key: string
          id?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          request_folder?: string | null
          snapshot: Json
          source_assignment?: string | null
          source_kind: string
          source_table: string
          source_unique_id: string
        }
        Update: {
          commonname?: string | null
          completed_at?: string
          completed_by_display?: string
          completed_by_username?: string
          contsize?: string | null
          customer_name?: string | null
          event_key?: string
          id?: string
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          request_folder?: string | null
          snapshot?: Json
          source_assignment?: string | null
          source_kind?: string
          source_table?: string
          source_unique_id?: string
        }
        Relationships: []
      }
      ph_push_subscriptions: {
        Row: {
          app_build: string | null
          auth: string
          created_at: string
          device_label: string | null
          display_name: string | null
          endpoint: string
          id: number
          last_seen: string
          notifications_enabled: boolean
          p256dh: string
          profile_id: string | null
          role: string | null
          subscription_json: Json
          updated_at: string
          user_agent: string | null
          username: string
          wants_new_request: boolean
          wants_request_complete: boolean
        }
        Insert: {
          app_build?: string | null
          auth: string
          created_at?: string
          device_label?: string | null
          display_name?: string | null
          endpoint: string
          id?: never
          last_seen?: string
          notifications_enabled?: boolean
          p256dh: string
          profile_id?: string | null
          role?: string | null
          subscription_json?: Json
          updated_at?: string
          user_agent?: string | null
          username: string
          wants_new_request?: boolean
          wants_request_complete?: boolean
        }
        Update: {
          app_build?: string | null
          auth?: string
          created_at?: string
          device_label?: string | null
          display_name?: string | null
          endpoint?: string
          id?: never
          last_seen?: string
          notifications_enabled?: boolean
          p256dh?: string
          profile_id?: string | null
          role?: string | null
          subscription_json?: Json
          updated_at?: string
          user_agent?: string | null
          username?: string
          wants_new_request?: boolean
          wants_request_complete?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ph_push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_request_delivery_outbox: {
        Row: {
          attempt_count: number
          channel_results: Json
          created_at: string
          delivered_at: string | null
          delivery_mode: string | null
          email_delivered_at: string | null
          event_id: string
          event_key: string
          event_type: string
          first_attempt_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          last_attempt_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          message_id_header: string | null
          next_attempt_at: string
          payload: Json
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
          sanitized_error_code: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          channel_results?: Json
          created_at?: string
          delivered_at?: string | null
          delivery_mode?: string | null
          email_delivered_at?: string | null
          event_id?: string
          event_key: string
          event_type: string
          first_attempt_at?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          last_attempt_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          message_id_header?: string | null
          next_attempt_at?: string
          payload?: Json
          push_delivered_at?: string | null
          request_folder?: string | null
          request_id?: string | null
          sanitized_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          channel_results?: Json
          created_at?: string
          delivered_at?: string | null
          delivery_mode?: string | null
          email_delivered_at?: string | null
          event_id?: string
          event_key?: string
          event_type?: string
          first_attempt_at?: string | null
          gmail_message_id?: string | null
          gmail_thread_id?: string | null
          last_attempt_at?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          lease_token?: string | null
          message_id_header?: string | null
          next_attempt_at?: string
          payload?: Json
          push_delivered_at?: string | null
          request_folder?: string | null
          request_id?: string | null
          sanitized_error_code?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_request_delivery_worker_state: {
        Row: {
          last_canary_at: string | null
          last_claimed_count: number
          last_delivered_count: number
          last_error_code: string | null
          last_failed_count: number
          last_heartbeat_at: string
          metadata: Json
          updated_at: string
          worker_id: string
        }
        Insert: {
          last_canary_at?: string | null
          last_claimed_count?: number
          last_delivered_count?: number
          last_error_code?: string | null
          last_failed_count?: number
          last_heartbeat_at?: string
          metadata?: Json
          updated_at?: string
          worker_id: string
        }
        Update: {
          last_canary_at?: string | null
          last_claimed_count?: number
          last_delivered_count?: number
          last_error_code?: string | null
          last_failed_count?: number
          last_heartbeat_at?: string
          metadata?: Json
          updated_at?: string
          worker_id?: string
        }
        Relationships: []
      }
      ph_request_email_threads: {
        Row: {
          id: string
          initial_email_sent_at: string | null
          initial_message_id: string | null
          initial_thread_id: string | null
          last_reply_sent_at: string | null
          metadata: Json
          recipients: Json
          request_customer: string | null
          request_folder: string
          sales_rep_email: string | null
          sales_rep_name: string | null
          status: string
        }
        Insert: {
          id?: string
          initial_email_sent_at?: string | null
          initial_message_id?: string | null
          initial_thread_id?: string | null
          last_reply_sent_at?: string | null
          metadata?: Json
          recipients?: Json
          request_customer?: string | null
          request_folder: string
          sales_rep_email?: string | null
          sales_rep_name?: string | null
          status?: string
        }
        Update: {
          id?: string
          initial_email_sent_at?: string | null
          initial_message_id?: string | null
          initial_thread_id?: string | null
          last_reply_sent_at?: string | null
          metadata?: Json
          recipients?: Json
          request_customer?: string | null
          request_folder?: string
          sales_rep_email?: string | null
          sales_rep_name?: string | null
          status?: string
        }
        Relationships: []
      }
      ph_request_history: {
        Row: {
          app_tab_assignment: string | null
          assigned_rep_id: string | null
          av_note: string | null
          client_batch_id: string | null
          commonname: string | null
          completed_by_display: string | null
          completed_by_email: string | null
          completed_by_username: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          contsize: string | null
          created_at: string | null
          created_by_display: string | null
          created_by_username: string | null
          customeridentityid: string | null
          customername: string | null
          date_completed: string | null
          delivery_state: string
          desired_caliper: string | null
          desired_spec: string | null
          est_ship: string | null
          field_tag_color: string | null
          holdstopcode: string | null
          id: number
          itemcode: string | null
          last_event: string | null
          locationcode: string | null
          lotcode: string | null
          master_app_tab_assignment: string | null
          master_id: string | null
          master_unique_id: string | null
          photo_link: string | null
          photo_name: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          recovered_at: string | null
          req_archived: boolean | null
          req_caliper: string | null
          req_comments: string | null
          req_customer: string | null
          req_match: string | null
          req_photo_link: string | null
          req_photo_name: string | null
          req_pic_note: string | null
          req_qty: string | null
          req_rep_action: string | null
          req_reserve: string | null
          req_spec: string | null
          req_status: string | null
          request_created_by_display: string | null
          request_created_by_email: string | null
          request_created_by_username: string | null
          request_customer: string | null
          request_folder: string | null
          request_selected_rep_display: string | null
          request_selected_rep_email: string | null
          request_selected_rep_username: string | null
          request_source: string
          requested_by: string | null
          row_version: number
          s_lts: string | null
          season: string | null
          season_supply: string | null
          snapshot: Json
          source_table: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          app_tab_assignment?: string | null
          assigned_rep_id?: string | null
          av_note?: string | null
          client_batch_id?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string | null
          created_by_display?: string | null
          created_by_username?: string | null
          customeridentityid?: string | null
          customername?: string | null
          date_completed?: string | null
          delivery_state?: string
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          holdstopcode?: string | null
          id?: number
          itemcode?: string | null
          last_event?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_app_tab_assignment?: string | null
          master_id?: string | null
          master_unique_id?: string | null
          photo_link?: string | null
          photo_name?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          recovered_at?: string | null
          req_archived?: boolean | null
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: string | null
          req_photo_link?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: string | null
          req_rep_action?: string | null
          req_reserve?: string | null
          req_spec?: string | null
          req_status?: string | null
          request_created_by_display?: string | null
          request_created_by_email?: string | null
          request_created_by_username?: string | null
          request_customer?: string | null
          request_folder?: string | null
          request_selected_rep_display?: string | null
          request_selected_rep_email?: string | null
          request_selected_rep_username?: string | null
          request_source?: string
          requested_by?: string | null
          row_version?: number
          s_lts?: string | null
          season?: string | null
          season_supply?: string | null
          snapshot?: Json
          source_table?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          app_tab_assignment?: string | null
          assigned_rep_id?: string | null
          av_note?: string | null
          client_batch_id?: string | null
          commonname?: string | null
          completed_by_display?: string | null
          completed_by_email?: string | null
          completed_by_username?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string | null
          created_by_display?: string | null
          created_by_username?: string | null
          customeridentityid?: string | null
          customername?: string | null
          date_completed?: string | null
          delivery_state?: string
          desired_caliper?: string | null
          desired_spec?: string | null
          est_ship?: string | null
          field_tag_color?: string | null
          holdstopcode?: string | null
          id?: number
          itemcode?: string | null
          last_event?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_app_tab_assignment?: string | null
          master_id?: string | null
          master_unique_id?: string | null
          photo_link?: string | null
          photo_name?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          recovered_at?: string | null
          req_archived?: boolean | null
          req_caliper?: string | null
          req_comments?: string | null
          req_customer?: string | null
          req_match?: string | null
          req_photo_link?: string | null
          req_photo_name?: string | null
          req_pic_note?: string | null
          req_qty?: string | null
          req_rep_action?: string | null
          req_reserve?: string | null
          req_spec?: string | null
          req_status?: string | null
          request_created_by_display?: string | null
          request_created_by_email?: string | null
          request_created_by_username?: string | null
          request_customer?: string | null
          request_folder?: string | null
          request_selected_rep_display?: string | null
          request_selected_rep_email?: string | null
          request_selected_rep_username?: string | null
          request_source?: string
          requested_by?: string | null
          row_version?: number
          s_lts?: string | null
          season?: string | null
          season_supply?: string | null
          snapshot?: Json
          source_table?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_request_history_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_reserves: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          assigned_to: string | null
          assignedto: string | null
          av_note: string | null
          avg_price_eunit_shipped: string | null
          brand: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          container: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
          ext_eunit_shipped: string | null
          ext_unit: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_inst: string | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          invoicedate: string | null
          isreserve: string | null
          item: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          landedretailprice: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          location: string | null
          locationcode: string | null
          lot: string | null
          lotcode: string | null
          match: string | null
          mcstatus: string | null
          merch_shipped: string | null
          national_account_idgroup: string | null
          nationalaccount: string | null
          nationalaccountidgroup: string | null
          ncloadinstructions: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesrepid: string | null
          salesrepname: string | null
          season: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          size: string | null
          sortname: string | null
          sortnamevariety: string | null
          source: string | null
          spec: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string
          unitprice: string | null
          variety: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Insert: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          assigned_to?: string | null
          assignedto?: string | null
          av_note?: string | null
          avg_price_eunit_shipped?: string | null
          brand?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          container?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
          ext_eunit_shipped?: string | null
          ext_unit?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          item?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          landedretailprice?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          location?: string | null
          locationcode?: string | null
          lot?: string | null
          lotcode?: string | null
          match?: string | null
          mcstatus?: string | null
          merch_shipped?: string | null
          national_account_idgroup?: string | null
          nationalaccount?: string | null
          nationalaccountidgroup?: string | null
          ncloadinstructions?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          season?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          size?: string | null
          sortname?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id: string
          unitprice?: string | null
          variety?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
        }
        Update: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          assigned_to?: string | null
          assignedto?: string | null
          av_note?: string | null
          avg_price_eunit_shipped?: string | null
          brand?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          container?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
          ext_eunit_shipped?: string | null
          ext_unit?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          item?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          landedretailprice?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          location?: string | null
          locationcode?: string | null
          lot?: string | null
          lotcode?: string | null
          match?: string | null
          mcstatus?: string | null
          merch_shipped?: string | null
          national_account_idgroup?: string | null
          nationalaccount?: string | null
          nationalaccountidgroup?: string | null
          ncloadinstructions?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          season?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          size?: string | null
          sortname?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id?: string
          unitprice?: string | null
          variety?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
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
      ph_sales_credit_requests: {
        Row: {
          actor_id: string | null
          assigned_rep_id: string | null
          attachment_ids: string[]
          commonname: string | null
          consigneename: string | null
          contsize: string | null
          created_at: string
          credit_note: string | null
          credit_photo_link: string | null
          credit_photo_name: string | null
          credit_qty: string | null
          credit_reason: string | null
          credit_status: string
          customername: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_id: string | null
          master_unique_id: string | null
          priority: string | null
          req_customer: string | null
          req_qty: string | null
          request_folder: string | null
          request_photo_link: string | null
          request_photo_name: string | null
          request_unique_id: string | null
          requested_by: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_display: string | null
          reviewed_by_username: string | null
          revision: number
          salesrepname: string | null
          snapshot: Json
          source_id: string | null
          submission_id: string | null
          submitted_at: string
          submitted_by_display: string | null
          submitted_by_email: string | null
          submitted_by_username: string | null
          unique_id: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          assigned_rep_id?: string | null
          attachment_ids?: string[]
          commonname?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string
          credit_note?: string | null
          credit_photo_link?: string | null
          credit_photo_name?: string | null
          credit_qty?: string | null
          credit_reason?: string | null
          credit_status?: string
          customername?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          master_unique_id?: string | null
          priority?: string | null
          req_customer?: string | null
          req_qty?: string | null
          request_folder?: string | null
          request_photo_link?: string | null
          request_photo_name?: string | null
          request_unique_id?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_display?: string | null
          reviewed_by_username?: string | null
          revision?: number
          salesrepname?: string | null
          snapshot?: Json
          source_id?: string | null
          submission_id?: string | null
          submitted_at?: string
          submitted_by_display?: string | null
          submitted_by_email?: string | null
          submitted_by_username?: string | null
          unique_id: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          assigned_rep_id?: string | null
          attachment_ids?: string[]
          commonname?: string | null
          consigneename?: string | null
          contsize?: string | null
          created_at?: string
          credit_note?: string | null
          credit_photo_link?: string | null
          credit_photo_name?: string | null
          credit_qty?: string | null
          credit_reason?: string | null
          credit_status?: string
          customername?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          master_unique_id?: string | null
          priority?: string | null
          req_customer?: string | null
          req_qty?: string | null
          request_folder?: string | null
          request_photo_link?: string | null
          request_photo_name?: string | null
          request_unique_id?: string | null
          requested_by?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_display?: string | null
          reviewed_by_username?: string | null
          revision?: number
          salesrepname?: string | null
          snapshot?: Json
          source_id?: string | null
          submission_id?: string | null
          submitted_at?: string
          submitted_by_display?: string | null
          submitted_by_email?: string | null
          submitted_by_username?: string | null
          unique_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_sales_credit_requests_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_sales_credit_requests_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_sales_credit_requests_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ph_credit_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_sales_credit_requests_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ph_credit_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_sales_office: {
        Row: {
          arrived_at: string | null
          av_note: string | null
          caliper: string | null
          commonname: string | null
          completed_at: string | null
          completed_by: string | null
          contsize: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_id: string | null
          move_actual_qty: number | null
          move_batch_id: string | null
          move_from_locationcode: string | null
          move_to_locationcode: string | null
          order_customer: string | null
          order_desired_caliper: string | null
          order_desired_spec: string | null
          order_folder: string | null
          order_number: string | null
          order_qty: string | null
          order_reserve: string | null
          order_status: string | null
          order_submitted_at: string | null
          order_submitted_by: string | null
          photo_link: string | null
          photo_name: string | null
          priority: string | null
          ptravailable: string | null
          reopen_reason: string | null
          sales_note: string | null
          so_source: string | null
          source_revision: string | null
          spec: string | null
          state_revision: number
          unique_id: string
          updated_at: string
          workflow_detail: Json
          workflow_status: string | null
        }
        Insert: {
          arrived_at?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contsize?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          move_actual_qty?: number | null
          move_batch_id?: string | null
          move_from_locationcode?: string | null
          move_to_locationcode?: string | null
          order_customer?: string | null
          order_desired_caliper?: string | null
          order_desired_spec?: string | null
          order_folder?: string | null
          order_number?: string | null
          order_qty?: string | null
          order_reserve?: string | null
          order_status?: string | null
          order_submitted_at?: string | null
          order_submitted_by?: string | null
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          reopen_reason?: string | null
          sales_note?: string | null
          so_source?: string | null
          source_revision?: string | null
          spec?: string | null
          state_revision?: number
          unique_id: string
          updated_at?: string
          workflow_detail?: Json
          workflow_status?: string | null
        }
        Update: {
          arrived_at?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by?: string | null
          contsize?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_id?: string | null
          move_actual_qty?: number | null
          move_batch_id?: string | null
          move_from_locationcode?: string | null
          move_to_locationcode?: string | null
          order_customer?: string | null
          order_desired_caliper?: string | null
          order_desired_spec?: string | null
          order_folder?: string | null
          order_number?: string | null
          order_qty?: string | null
          order_reserve?: string | null
          order_status?: string | null
          order_submitted_at?: string | null
          order_submitted_by?: string | null
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          reopen_reason?: string | null
          sales_note?: string | null
          so_source?: string | null
          source_revision?: string | null
          spec?: string | null
          state_revision?: number
          unique_id?: string
          updated_at?: string
          workflow_detail?: Json
          workflow_status?: string | null
        }
        Relationships: []
      }
      ph_season_sales_note_user_events: {
        Row: {
          actor_username: string
          allowed_usernames: string[]
          created_at: string
          id: number
          idempotency_key: string
          metadata: Json
        }
        Insert: {
          actor_username: string
          allowed_usernames?: string[]
          created_at?: string
          id?: never
          idempotency_key: string
          metadata?: Json
        }
        Update: {
          actor_username?: string
          allowed_usernames?: string[]
          created_at?: string
          id?: never
          idempotency_key?: string
          metadata?: Json
        }
        Relationships: []
      }
      ph_season_sales_office_events: {
        Row: {
          actor_username: string
          created_at: string
          event_type: string
          id: number
          metadata: Json
          reason_code: string | null
          revision: number | null
          state_id: string | null
        }
        Insert: {
          actor_username: string
          created_at?: string
          event_type: string
          id?: never
          metadata?: Json
          reason_code?: string | null
          revision?: number | null
          state_id?: string | null
        }
        Update: {
          actor_username?: string
          created_at?: string
          event_type?: string
          id?: never
          metadata?: Json
          reason_code?: string | null
          revision?: number | null
          state_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ph_season_sales_office_events_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "ph_season_sales_office_state"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_season_sales_office_state: {
        Row: {
          cav_watermark: string | null
          completed_at: string | null
          completed_by: string | null
          completed_evidence_snapshot: Json | null
          created_at: string
          current_evidence_snapshot: Json
          evidence_ready_at_completion: boolean | null
          evidence_ready_seen_after_completion: boolean
          id: string
          import_revision: string | null
          itemcode_normalized: string
          readiness_status: string
          reopen_reason: string | null
          retained_av_note: string | null
          retained_av_note_at: string
          revision: number
          sales_year: number
          season_code: string
          source_fingerprint: string
          status: string
          updated_at: string
          winner_unique_id: string
        }
        Insert: {
          cav_watermark?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_evidence_snapshot?: Json | null
          created_at?: string
          current_evidence_snapshot?: Json
          evidence_ready_at_completion?: boolean | null
          evidence_ready_seen_after_completion?: boolean
          id?: string
          import_revision?: string | null
          itemcode_normalized: string
          readiness_status?: string
          reopen_reason?: string | null
          retained_av_note?: string | null
          retained_av_note_at: string
          revision?: number
          sales_year: number
          season_code: string
          source_fingerprint?: string
          status?: string
          updated_at?: string
          winner_unique_id: string
        }
        Update: {
          cav_watermark?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_evidence_snapshot?: Json | null
          created_at?: string
          current_evidence_snapshot?: Json
          evidence_ready_at_completion?: boolean | null
          evidence_ready_seen_after_completion?: boolean
          id?: string
          import_revision?: string | null
          itemcode_normalized?: string
          readiness_status?: string
          reopen_reason?: string | null
          retained_av_note?: string | null
          retained_av_note_at?: string
          revision?: number
          sales_year?: number
          season_code?: string
          source_fingerprint?: string
          status?: string
          updated_at?: string
          winner_unique_id?: string
        }
        Relationships: []
      }
      ph_shear_list: {
        Row: {
          blockalpha: string | null
          commonname: string | null
          completed_at: string | null
          completed_by_display: string | null
          completed_by_username: string | null
          contsize: string | null
          created_at: string
          created_by_display: string | null
          created_by_username: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          instructions: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          percent_to_shear: number
          ptravailable: number | null
          season: string | null
          snapshot: Json
          source_table: string
          source_unique_id: string
          status: string
          unique_id: string
          updated_at: string
          updated_by_display: string | null
          updated_by_username: string | null
        }
        Insert: {
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          instructions?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          percent_to_shear?: number
          ptravailable?: number | null
          season?: string | null
          snapshot?: Json
          source_table?: string
          source_unique_id: string
          status?: string
          unique_id: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Update: {
          blockalpha?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          created_at?: string
          created_by_display?: string | null
          created_by_username?: string | null
          holdstopcode?: string | null
          holdstopreason?: string | null
          instructions?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          percent_to_shear?: number
          ptravailable?: number | null
          season?: string | null
          snapshot?: Json
          source_table?: string
          source_unique_id?: string
          status?: string
          unique_id?: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Relationships: []
      }
      ph_shear_location_events: {
        Row: {
          actor_username: string
          created_at: string
          event_type: string
          id: number
          inquiry_id: string
          metadata: Json
          revision: number
        }
        Insert: {
          actor_username: string
          created_at?: string
          event_type: string
          id?: never
          inquiry_id: string
          metadata?: Json
          revision: number
        }
        Update: {
          actor_username?: string
          created_at?: string
          event_type?: string
          id?: never
          inquiry_id?: string
          metadata?: Json
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "ph_shear_location_events_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "ph_shear_location_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_shear_location_inquiries: {
        Row: {
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          created_at: string
          created_by_display: string
          created_by_username: string
          delivery_event_id: string | null
          id: string
          item_count: number
          location_key: string | null
          locationcode: string
          recipient_emails: string[]
          recipient_profiles: Json
          recipient_usernames: string[]
          revision: number
          row_count: number
          status: string
          submission_id: string
          total_on_hand: number
          total_to_shear: number
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by_username?: string | null
          completed_at?: string | null
          completed_by_username?: string | null
          created_at?: string
          created_by_display: string
          created_by_username: string
          delivery_event_id?: string | null
          id?: string
          item_count?: number
          location_key?: string | null
          locationcode: string
          recipient_emails?: string[]
          recipient_profiles?: Json
          recipient_usernames?: string[]
          revision?: number
          row_count?: number
          status?: string
          submission_id: string
          total_on_hand?: number
          total_to_shear?: number
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by_username?: string | null
          completed_at?: string | null
          completed_by_username?: string | null
          created_at?: string
          created_by_display?: string
          created_by_username?: string
          delivery_event_id?: string | null
          id?: string
          item_count?: number
          location_key?: string | null
          locationcode?: string
          recipient_emails?: string[]
          recipient_profiles?: Json
          recipient_usernames?: string[]
          revision?: number
          row_count?: number
          status?: string
          submission_id?: string
          total_on_hand?: number
          total_to_shear?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_shear_location_inquiries_delivery_event_id_fkey"
            columns: ["delivery_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_outbox"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_shear_location_inquiries_delivery_event_id_fkey"
            columns: ["delivery_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_delivery_status"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ph_shear_location_inquiries_delivery_event_id_fkey"
            columns: ["delivery_event_id"]
            isOneToOne: false
            referencedRelation: "ph_request_queue_live_rows"
            referencedColumns: ["delivery_event_id"]
          },
          {
            foreignKeyName: "ph_shear_location_inquiries_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ph_shear_location_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_shear_location_items: {
        Row: {
          available_total: number
          calculated_quantity: number
          commonname: string
          created_at: string
          id: string
          inquiry_id: string
          instructions: string
          itemcode: string
          itemcode_key: string | null
          on_hand_total: number
          ordinal: number
          percent_to_shear: number
          review_total: number
          shear_type: string
        }
        Insert: {
          available_total?: number
          calculated_quantity?: number
          commonname?: string
          created_at?: string
          id?: string
          inquiry_id: string
          instructions?: string
          itemcode: string
          itemcode_key?: string | null
          on_hand_total?: number
          ordinal: number
          percent_to_shear: number
          review_total?: number
          shear_type: string
        }
        Update: {
          available_total?: number
          calculated_quantity?: number
          commonname?: string
          created_at?: string
          id?: string
          inquiry_id?: string
          instructions?: string
          itemcode?: string
          itemcode_key?: string | null
          on_hand_total?: number
          ordinal?: number
          percent_to_shear?: number
          review_total?: number
          shear_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_shear_location_items_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "ph_shear_location_inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_shear_location_rows: {
        Row: {
          assignedto: string
          blockalpha: string
          blocknumber: string
          commonname: string
          contsize: string
          holdstopcode: string
          holdstopreason: string
          id: string
          inquiry_id: string
          item_id: string
          itemcode: string
          locationcode: string
          locationnote: string
          locationnotedate: string
          lotcode: string
          ordinal: number
          origin_unique_id: string
          priority: string
          ptravailable: number
          ptronhand: number
          ptrreviewed: number
          salesyear: string
          season: string
          snapshot_at: string
          source: string
        }
        Insert: {
          assignedto?: string
          blockalpha?: string
          blocknumber?: string
          commonname?: string
          contsize?: string
          holdstopcode?: string
          holdstopreason?: string
          id?: string
          inquiry_id: string
          item_id: string
          itemcode: string
          locationcode: string
          locationnote?: string
          locationnotedate?: string
          lotcode?: string
          ordinal: number
          origin_unique_id: string
          priority?: string
          ptravailable?: number
          ptronhand?: number
          ptrreviewed?: number
          salesyear?: string
          season?: string
          snapshot_at?: string
          source?: string
        }
        Update: {
          assignedto?: string
          blockalpha?: string
          blocknumber?: string
          commonname?: string
          contsize?: string
          holdstopcode?: string
          holdstopreason?: string
          id?: string
          inquiry_id?: string
          item_id?: string
          itemcode?: string
          locationcode?: string
          locationnote?: string
          locationnotedate?: string
          lotcode?: string
          ordinal?: number
          origin_unique_id?: string
          priority?: string
          ptravailable?: number
          ptronhand?: number
          ptrreviewed?: number
          salesyear?: string
          season?: string
          snapshot_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_shear_location_rows_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "ph_shear_location_inquiries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ph_shear_location_rows_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "ph_shear_location_items"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_shear_location_submissions: {
        Row: {
          created_at: string
          created_by_profile_id: string
          created_by_username: string
          id: string
          idempotency_key: string
        }
        Insert: {
          created_at?: string
          created_by_profile_id: string
          created_by_username: string
          id?: string
          idempotency_key: string
        }
        Update: {
          created_at?: string
          created_by_profile_id?: string
          created_by_username?: string
          id?: string
          idempotency_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_shear_location_submissions_created_by_profile_id_fkey"
            columns: ["created_by_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_soc_master: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          assignedto: string | null
          av_note: string | null
          avg_price_eunit_shipped: string | null
          brand: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
          ext_eunit_shipped: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_inst: string | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          lotcode: string | null
          match: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesrepid: string | null
          salesrepname: string | null
          season: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          spec: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string
          unitprice: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Insert: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          assignedto?: string | null
          av_note?: string | null
          avg_price_eunit_shipped?: string | null
          brand?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
          ext_eunit_shipped?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          mcstatus?: string | null
          nationalaccount?: string | null
          ncloadinstructions?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          season?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id: string
          unitprice?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
        }
        Update: {
          a_lts?: string | null
          ai_lts?: string | null
          altshipcomment?: string | null
          assignedto?: string | null
          av_note?: string | null
          avg_price_eunit_shipped?: string | null
          brand?: string | null
          caliper?: string | null
          carrier?: string | null
          combinedprice?: string | null
          commonname?: string | null
          concat?: string | null
          consigneeaddress_1?: string | null
          consigneeaddress_2?: string | null
          consigneecity?: string | null
          consigneeidentityid?: string | null
          consigneename?: string | null
          consigneestate?: string | null
          consigneezip?: string | null
          containersort?: string | null
          contsize?: string | null
          customeridentityid?: string | null
          customername?: string | null
          customersku?: string | null
          date_completed?: string | null
          descriptorcode?: string | null
          desigcust?: string | null
          desigitem?: string | null
          desigloc?: string | null
          dock?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_num?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          dropweight?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          equiv_unit?: string | null
          equiv_uom?: string | null
          ext_eunit_shipped?: string | null
          ext_unit_merch_shipped?: string | null
          extunitprice?: string | null
          filename?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          fnsalesnote?: string | null
          formattedupc?: string | null
          freightrateperitem?: string | null
          generalloadinstr?: string | null
          grower?: string | null
          handlingchargeperitem?: string | null
          hardinesszone?: string | null
          hlloadinstructions?: string | null
          holdstopcode?: string | null
          holdstopenddate?: string | null
          holdstopreason?: string | null
          hz?: string | null
          idgroup?: string | null
          initial_ptr?: string | null
          insurancegroup?: string | null
          intercopo?: string | null
          internalinvnote?: string | null
          invoicedate?: string | null
          isreserve?: string | null
          itemcode?: string | null
          itemspec?: string | null
          landed?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          mcstatus?: string | null
          nationalaccount?: string | null
          ncloadinstructions?: string | null
          okloadinstructions?: string | null
          ordertotal?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          picknote?: string | null
          planstart?: string | null
          plantgroupcode?: string | null
          printedcontainercode?: string | null
          priority?: string | null
          ptravailable?: string | null
          ptronhand?: string | null
          ptrreviewed?: string | null
          purchaseordernumber?: string | null
          qa_code?: string | null
          qualitycode?: string | null
          quantityordered?: string | null
          quantityshipped?: string | null
          requestdate?: string | null
          requestdateweek?: string | null
          retailprice?: string | null
          s_lts?: string | null
          sales_note?: string | null
          salesnote?: string | null
          salesnote_1?: string | null
          salesrepid?: string | null
          salesrepname?: string | null
          season?: string | null
          season_supply?: string | null
          shiptotelephone_1?: string | null
          si_available?: string | null
          si_lts?: string | null
          sortnamevariety?: string | null
          source?: string | null
          spec?: string | null
          stagename?: string | null
          step?: string | null
          stopnumber?: string | null
          suspend?: string | null
          suspend_to?: string | null
          tagcode?: string | null
          tagdeptnote?: string | null
          taggingchargeperitem?: string | null
          transactionnumber?: string | null
          tripnumber?: string | null
          txloadinstructions?: string | null
          unique_id?: string
          unitprice?: string | null
          warehouseid?: string | null
          warehousename?: string | null
          wingdingunits?: string | null
          zonecode?: string | null
        }
        Relationships: []
      }
      ph_spread_counts: {
        Row: {
          blockalpha: string | null
          commonname: string | null
          contsize: string | null
          counted_at: string | null
          counted_by_display: string | null
          counted_by_username: string | null
          counted_qty: number | null
          created_at: string
          direction: string
          genus: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          row_order: number
          season: string | null
          snapshot: Json
          source_unique_id: string
          unique_id: string
          updated_at: string
          updated_by_display: string | null
          updated_by_username: string | null
        }
        Insert: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          counted_at?: string | null
          counted_by_display?: string | null
          counted_by_username?: string | null
          counted_qty?: number | null
          created_at?: string
          direction?: string
          genus?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          row_order?: number
          season?: string | null
          snapshot?: Json
          source_unique_id: string
          unique_id: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Update: {
          blockalpha?: string | null
          commonname?: string | null
          contsize?: string | null
          counted_at?: string | null
          counted_by_display?: string | null
          counted_by_username?: string | null
          counted_qty?: number | null
          created_at?: string
          direction?: string
          genus?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          row_order?: number
          season?: string | null
          snapshot?: Json
          source_unique_id?: string
          unique_id?: string
          updated_at?: string
          updated_by_display?: string | null
          updated_by_username?: string | null
        }
        Relationships: []
      }
      ph_take_back_queue: {
        Row: {
          added_at: string
          added_by_display: string | null
          added_by_username: string | null
          commonname: string | null
          completed_at: string | null
          completed_by_display: string | null
          completed_by_username: string | null
          contsize: string | null
          holdstopcode: string | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_unique_id: string
          photo_link: string | null
          photo_name: string | null
          priority: string | null
          ptravailable: string | null
          s_lts: string | null
          snapshot: Json
          source_table: string
          status: string
          unique_id: string
          updated_at: string
        }
        Insert: {
          added_at?: string
          added_by_display?: string | null
          added_by_username?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          holdstopcode?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id: string
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string
          status?: string
          unique_id: string
          updated_at?: string
        }
        Update: {
          added_at?: string
          added_by_display?: string | null
          added_by_username?: string | null
          commonname?: string | null
          completed_at?: string | null
          completed_by_display?: string | null
          completed_by_username?: string | null
          contsize?: string | null
          holdstopcode?: string | null
          itemcode?: string | null
          locationcode?: string | null
          lotcode?: string | null
          master_unique_id?: string
          photo_link?: string | null
          photo_name?: string | null
          priority?: string | null
          ptravailable?: string | null
          s_lts?: string | null
          snapshot?: Json
          source_table?: string
          status?: string
          unique_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ph_transactions_keyed_files: {
        Row: {
          archived_at: string | null
          content_bytes: number | null
          content_sha256: string
          created_at: string
          drive_file_id: string
          duplicate_of_drive_file_id: string | null
          file_name: string
          first_transaction_date: string | null
          import_batch_id: string | null
          imported_at: string | null
          last_error_code: string | null
          last_transaction_date: string | null
          row_count: number
          source_header_row: number | null
          source_sheet_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          content_bytes?: number | null
          content_sha256: string
          created_at?: string
          drive_file_id: string
          duplicate_of_drive_file_id?: string | null
          file_name: string
          first_transaction_date?: string | null
          import_batch_id?: string | null
          imported_at?: string | null
          last_error_code?: string | null
          last_transaction_date?: string | null
          row_count?: number
          source_header_row?: number | null
          source_sheet_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          content_bytes?: number | null
          content_sha256?: string
          created_at?: string
          drive_file_id?: string
          duplicate_of_drive_file_id?: string | null
          file_name?: string
          first_transaction_date?: string | null
          import_batch_id?: string | null
          imported_at?: string | null
          last_error_code?: string | null
          last_transaction_date?: string | null
          row_count?: number
          source_header_row?: number | null
          source_sheet_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ph_transactions_keyed_files_duplicate_of_drive_file_id_fkey"
            columns: ["duplicate_of_drive_file_id"]
            isOneToOne: false
            referencedRelation: "ph_transactions_keyed_files"
            referencedColumns: ["drive_file_id"]
          },
        ]
      }
      ph_transactions_keyed_rows: {
        Row: {
          amount: number | null
          code_1_detail: string | null
          code_2_detail: string | null
          code_3_detail: string | null
          code_4_detail: string | null
          code_5_detail: string | null
          code_item: string | null
          code_location: string | null
          code_lot: string | null
          commit_datetime: string | null
          content_sha256: string
          created_at: string
          created_by_detail: string | null
          created_by_key: string | null
          date_1_detail: string | null
          description_1_item: string | null
          desig_cust: string | null
          desig_item: string | null
          desig_loc: string | null
          drive_file_id: string
          fm_pu_stop_number_om_transaction_header: string | null
          fm_trip_number_om_transaction_header: string | null
          import_batch_id: string
          invoice_datetime: string | null
          module: string | null
          ordered_quantity: number | null
          out_ordered_transaction_location: number | null
          price: number | null
          program: string | null
          quantity: number | null
          reference: string | null
          reference_1_detail: string | null
          reference_1_lot: string | null
          reference_2_detail: string | null
          reference_2_lot: string | null
          reference_4_lot: string | null
          ship_to_name_om_transaction_header: string | null
          shipped_quantity_om_transaction_detail: number | null
          shipping_datetime_om_transaction_header: string | null
          source: string | null
          source_row_hash: string
          source_row_number: number
          source_sheet_name: string
          stage: string | null
          transaction_business_date: string | null
          transaction_datetime: string | null
          transaction_number: string | null
          transaction_status: string | null
          transaction_type: string | null
        }
        Insert: {
          amount?: number | null
          code_1_detail?: string | null
          code_2_detail?: string | null
          code_3_detail?: string | null
          code_4_detail?: string | null
          code_5_detail?: string | null
          code_item?: string | null
          code_location?: string | null
          code_lot?: string | null
          commit_datetime?: string | null
          content_sha256: string
          created_at?: string
          created_by_detail?: string | null
          created_by_key?: string | null
          date_1_detail?: string | null
          description_1_item?: string | null
          desig_cust?: string | null
          desig_item?: string | null
          desig_loc?: string | null
          drive_file_id: string
          fm_pu_stop_number_om_transaction_header?: string | null
          fm_trip_number_om_transaction_header?: string | null
          import_batch_id: string
          invoice_datetime?: string | null
          module?: string | null
          ordered_quantity?: number | null
          out_ordered_transaction_location?: number | null
          price?: number | null
          program?: string | null
          quantity?: number | null
          reference?: string | null
          reference_1_detail?: string | null
          reference_1_lot?: string | null
          reference_2_detail?: string | null
          reference_2_lot?: string | null
          reference_4_lot?: string | null
          ship_to_name_om_transaction_header?: string | null
          shipped_quantity_om_transaction_detail?: number | null
          shipping_datetime_om_transaction_header?: string | null
          source?: string | null
          source_row_hash: string
          source_row_number: number
          source_sheet_name: string
          stage?: string | null
          transaction_business_date?: string | null
          transaction_datetime?: string | null
          transaction_number?: string | null
          transaction_status?: string | null
          transaction_type?: string | null
        }
        Update: {
          amount?: number | null
          code_1_detail?: string | null
          code_2_detail?: string | null
          code_3_detail?: string | null
          code_4_detail?: string | null
          code_5_detail?: string | null
          code_item?: string | null
          code_location?: string | null
          code_lot?: string | null
          commit_datetime?: string | null
          content_sha256?: string
          created_at?: string
          created_by_detail?: string | null
          created_by_key?: string | null
          date_1_detail?: string | null
          description_1_item?: string | null
          desig_cust?: string | null
          desig_item?: string | null
          desig_loc?: string | null
          drive_file_id?: string
          fm_pu_stop_number_om_transaction_header?: string | null
          fm_trip_number_om_transaction_header?: string | null
          import_batch_id?: string
          invoice_datetime?: string | null
          module?: string | null
          ordered_quantity?: number | null
          out_ordered_transaction_location?: number | null
          price?: number | null
          program?: string | null
          quantity?: number | null
          reference?: string | null
          reference_1_detail?: string | null
          reference_1_lot?: string | null
          reference_2_detail?: string | null
          reference_2_lot?: string | null
          reference_4_lot?: string | null
          ship_to_name_om_transaction_header?: string | null
          shipped_quantity_om_transaction_detail?: number | null
          shipping_datetime_om_transaction_header?: string | null
          source?: string | null
          source_row_hash?: string
          source_row_number?: number
          source_sheet_name?: string
          stage?: string | null
          transaction_business_date?: string | null
          transaction_datetime?: string | null
          transaction_number?: string | null
          transaction_status?: string | null
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ph_transactions_keyed_rows_drive_file_id_fkey"
            columns: ["drive_file_id"]
            isOneToOne: false
            referencedRelation: "ph_transactions_keyed_files"
            referencedColumns: ["drive_file_id"]
          },
        ]
      }
      ph_walkie_call_members: {
        Row: {
          call_id: string
          channel_id: string
          device_id: string
          display_name: string | null
          id: string
          is_active: boolean
          joined_at: string
          last_seen_at: string
          left_at: string | null
          username: string
        }
        Insert: {
          call_id: string
          channel_id: string
          device_id: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          joined_at?: string
          last_seen_at?: string
          left_at?: string | null
          username: string
        }
        Update: {
          call_id?: string
          channel_id?: string
          device_id?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          joined_at?: string
          last_seen_at?: string
          left_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_walkie_call_members_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "v2_walkie_call_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_walkie_calls: {
        Row: {
          active_speaker_at: string | null
          active_speaker_device_id: string | null
          active_speaker_username: string | null
          channel_id: string
          created_at: string
          ended_at: string | null
          id: string
          listener_cap: number
          started_by: string
          started_by_display: string | null
          status: string
          updated_at: string
        }
        Insert: {
          active_speaker_at?: string | null
          active_speaker_device_id?: string | null
          active_speaker_username?: string | null
          channel_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          listener_cap?: number
          started_by: string
          started_by_display?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          active_speaker_at?: string | null
          active_speaker_device_id?: string | null
          active_speaker_username?: string | null
          channel_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          listener_cap?: number
          started_by?: string
          started_by_display?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_walkie_calls_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_walkie_channel_members: {
        Row: {
          channel_id: string
          display_name: string | null
          id: string
          is_archived: boolean
          joined_at: string
          username: string
        }
        Insert: {
          channel_id: string
          display_name?: string | null
          id?: string
          is_archived?: boolean
          joined_at?: string
          username: string
        }
        Update: {
          channel_id?: string
          display_name?: string | null
          id?: string
          is_archived?: boolean
          joined_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_walkie_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_walkie_channels: {
        Row: {
          active_call_id: string | null
          created_at: string
          created_by: string
          created_by_display: string | null
          id: string
          is_group: boolean
          last_activity_at: string
          title: string | null
          updated_at: string
        }
        Insert: {
          active_call_id?: string | null
          created_at?: string
          created_by: string
          created_by_display?: string | null
          id?: string
          is_group?: boolean
          last_activity_at?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          active_call_id?: string | null
          created_at?: string
          created_by?: string
          created_by_display?: string | null
          id?: string
          is_group?: boolean
          last_activity_at?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ph_walkie_signal_events: {
        Row: {
          call_id: string
          channel_id: string
          created_at: string
          id: string
          kind: string
          payload: Json
          recipient_device_id: string | null
          recipient_username: string | null
          sender_device_id: string
          sender_username: string
        }
        Insert: {
          call_id: string
          channel_id: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          recipient_device_id?: string | null
          recipient_username?: string | null
          sender_device_id: string
          sender_username: string
        }
        Update: {
          call_id?: string
          channel_id?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          recipient_device_id?: string | null
          recipient_username?: string | null
          sender_device_id?: string
          sender_username?: string
        }
        Relationships: [
          {
            foreignKeyName: "v2_walkie_signal_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "v2_walkie_signal_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "ph_walkie_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      ph_warehouse_assigned_items: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assignedto: string | null
          assignment_key: string | null
          assignment_reason: string | null
          commonname: string | null
          concat: string | null
          contsize: string | null
          created_at: string
          filename: string | null
          first_seen_at: string
          genusname: string | null
          genusname_normalized: string | null
          id: string
          import_batch: string | null
          itemcode: string | null
          itemcode_normalized: string | null
          last_seen_at: string
          last_updated: string | null
          locationcode: string | null
          present_in_drive: boolean
          raw_row: Json
          sheet_row_number: number | null
          source: string | null
          unassigned_notified_at: string | null
          unique_id: string
          updated_at: string
          warehousei: string | null
          zone_override_active: boolean
          zone_override_evaluated_revision: number | null
          zone_override_prior_assigned_at: string | null
          zone_override_prior_assigned_by: string | null
          zone_override_prior_assignedto: string | null
          zone_override_rule_version: string | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignedto?: string | null
          assignment_key?: string | null
          assignment_reason?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          created_at?: string
          filename?: string | null
          first_seen_at?: string
          genusname?: string | null
          genusname_normalized?: string | null
          id?: string
          import_batch?: string | null
          itemcode?: string | null
          itemcode_normalized?: string | null
          last_seen_at?: string
          last_updated?: string | null
          locationcode?: string | null
          present_in_drive?: boolean
          raw_row?: Json
          sheet_row_number?: number | null
          source?: string | null
          unassigned_notified_at?: string | null
          unique_id: string
          updated_at?: string
          warehousei?: string | null
          zone_override_active?: boolean
          zone_override_evaluated_revision?: number | null
          zone_override_prior_assigned_at?: string | null
          zone_override_prior_assigned_by?: string | null
          zone_override_prior_assignedto?: string | null
          zone_override_rule_version?: string | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assignedto?: string | null
          assignment_key?: string | null
          assignment_reason?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          created_at?: string
          filename?: string | null
          first_seen_at?: string
          genusname?: string | null
          genusname_normalized?: string | null
          id?: string
          import_batch?: string | null
          itemcode?: string | null
          itemcode_normalized?: string | null
          last_seen_at?: string
          last_updated?: string | null
          locationcode?: string | null
          present_in_drive?: boolean
          raw_row?: Json
          sheet_row_number?: number | null
          source?: string | null
          unassigned_notified_at?: string | null
          unique_id?: string
          updated_at?: string
          warehousei?: string | null
          zone_override_active?: boolean
          zone_override_evaluated_revision?: number | null
          zone_override_prior_assigned_at?: string | null
          zone_override_prior_assigned_by?: string | null
          zone_override_prior_assignedto?: string | null
          zone_override_rule_version?: string | null
        }
        Relationships: []
      }
      ph_weather_daily: {
        Row: {
          created_at: string
          daily_gdd_base_50: number
          date: string
          latitude: number | null
          longitude: number | null
          precipitation_in: number | null
          raw: Json
          source: string
          station_key: string
          temperature_high_f: number | null
          temperature_low_f: number | null
          timezone: string
          unique_id: string
          updated_at: string
          wind_direction_deg: number | null
          wind_speed_mph: number | null
        }
        Insert: {
          created_at?: string
          daily_gdd_base_50?: number
          date: string
          latitude?: number | null
          longitude?: number | null
          precipitation_in?: number | null
          raw?: Json
          source?: string
          station_key?: string
          temperature_high_f?: number | null
          temperature_low_f?: number | null
          timezone?: string
          unique_id: string
          updated_at?: string
          wind_direction_deg?: number | null
          wind_speed_mph?: number | null
        }
        Update: {
          created_at?: string
          daily_gdd_base_50?: number
          date?: string
          latitude?: number | null
          longitude?: number | null
          precipitation_in?: number | null
          raw?: Json
          source?: string
          station_key?: string
          temperature_high_f?: number | null
          temperature_low_f?: number | null
          timezone?: string
          unique_id?: string
          updated_at?: string
          wind_direction_deg?: number | null
          wind_speed_mph?: number | null
        }
        Relationships: []
      }
      ph_weather_hourly: {
        Row: {
          chill_hours: number
          created_at: string
          gdd_base_50: number
          latitude: number | null
          local_time: string | null
          longitude: number | null
          observed_at: string
          precipitation_in: number | null
          raw: Json
          relative_humidity: number | null
          source: string
          station_key: string
          temperature_f: number | null
          timezone: string
          unique_id: string
          updated_at: string
          wind_direction_deg: number | null
          wind_speed_mph: number | null
        }
        Insert: {
          chill_hours?: number
          created_at?: string
          gdd_base_50?: number
          latitude?: number | null
          local_time?: string | null
          longitude?: number | null
          observed_at: string
          precipitation_in?: number | null
          raw?: Json
          relative_humidity?: number | null
          source?: string
          station_key?: string
          temperature_f?: number | null
          timezone?: string
          unique_id: string
          updated_at?: string
          wind_direction_deg?: number | null
          wind_speed_mph?: number | null
        }
        Update: {
          chill_hours?: number
          created_at?: string
          gdd_base_50?: number
          latitude?: number | null
          local_time?: string | null
          longitude?: number | null
          observed_at?: string
          precipitation_in?: number | null
          raw?: Json
          relative_humidity?: number | null
          source?: string
          station_key?: string
          temperature_f?: number | null
          timezone?: string
          unique_id?: string
          updated_at?: string
          wind_direction_deg?: number | null
          wind_speed_mph?: number | null
        }
        Relationships: []
      }
      production_schedule_active: {
        Row: {
          changed_at: string
          slot: number
          snapshot_id: string
        }
        Insert: {
          changed_at?: string
          slot?: number
          snapshot_id: string
        }
        Update: {
          changed_at?: string
          slot?: number
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_schedule_active_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "production_schedule_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      production_schedule_rows: {
        Row: {
          cells: Json
          search_text: string
          search_vector: unknown
          sheet_index: number
          snapshot_id: string
          source_row: number
        }
        Insert: {
          cells: Json
          search_text?: string
          search_vector?: unknown
          sheet_index: number
          snapshot_id: string
          source_row: number
        }
        Update: {
          cells?: Json
          search_text?: string
          search_vector?: unknown
          sheet_index?: number
          snapshot_id?: string
          source_row?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_schedule_rows_snapshot_id_sheet_index_fkey"
            columns: ["snapshot_id", "sheet_index"]
            isOneToOne: false
            referencedRelation: "production_schedule_sheets"
            referencedColumns: ["snapshot_id", "sheet_index"]
          },
        ]
      }
      production_schedule_sheets: {
        Row: {
          columns: Json
          filter_columns: Json
          header_row: number
          row_count: number
          sheet_index: number
          snapshot_id: string
          title: string
        }
        Insert: {
          columns?: Json
          filter_columns?: Json
          header_row: number
          row_count?: number
          sheet_index: number
          snapshot_id: string
          title: string
        }
        Update: {
          columns?: Json
          filter_columns?: Json
          header_row?: number
          row_count?: number
          sheet_index?: number
          snapshot_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_schedule_sheets_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "production_schedule_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      production_schedule_snapshots: {
        Row: {
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          progress: Json
          requested_by: string
          source_file_id: string
          source_modified_at: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          progress?: Json
          requested_by: string
          source_file_id?: string
          source_modified_at?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          progress?: Json
          requested_by?: string
          source_file_id?: string
          source_modified_at?: string | null
          started_at?: string | null
          status?: string
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
    }
    Views: {
      ph_active_request_live_rows: {
        Row: {
          app_tab_assignment: string | null
          av_note: string | null
          av_rule_av_note_updated_at: string | null
          av_rule_bundle_updated_at: string | null
          av_rule_caliper_updated_at: string | null
          av_rule_holdstop_snapshot: string | null
          av_rule_last_clear_reason: string | null
          av_rule_last_cleared_at: string | null
          av_rule_match_updated_at: string | null
          av_rule_photo_updated_at: string | null
          av_rule_priority_snapshot: string | null
          av_rule_spec_updated_at: string | null
          client_batch_id: string | null
          commonname: string | null
          completed_by_display: string | null
          completed_by_email: string | null
          completed_by_username: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          contsize: string | null
          created_at: string | null
          customeridentityid: string | null
          customername: string | null
          date_completed: string | null
          desired_caliper: string | null
          desired_spec: string | null
          drive_assignedto: string | null
          drive_av_note: string | null
          drive_caliper: string | null
          drive_last_updated: string | null
          drive_loc_match_qty: string | null
          drive_match: string | null
          drive_photo_link: string | null
          drive_photo_name: string | null
          drive_pic_note: string | null
          drive_row_missing: boolean | null
          drive_spec: string | null
          est_ship: string | null
          field_tag_color: string | null
          id: number | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_app_tab_assignment: string | null
          master_id: string | null
          move_actual_qty: number | null
          move_approval_stage: string | null
          move_batch_id: string | null
          move_completed_at: string | null
          move_completed_by: string | null
          move_destination_needs_row: boolean | null
          move_dylan_approved_at: string | null
          move_from_locationcode: string | null
          move_group_key: string | null
          move_jd_approved_at: string | null
          move_planned_qty: number | null
          move_status: string | null
          move_to_locationcode: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          req_archived: boolean | null
          req_caliper: string | null
          req_comments: string | null
          req_customer: string | null
          req_match: number | null
          req_photo_link: string | null
          req_photo_mode: string | null
          req_photo_name: string | null
          req_pic_note: string | null
          req_qty: string | null
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
          request_source: string | null
          requested_by: string | null
          row_version: number | null
          season_supply: string | null
          unique_id: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      ph_company_directory_block_totals: {
        Row: {
          bed_count: number | null
          letter: string | null
          name: string | null
          total_beds: number | null
        }
        Relationships: []
      }
      ph_crop_roll_open_location_counts: {
        Row: {
          blockalpha: string | null
          contsize_counts: Json | null
          crop_roll_view: string | null
          item_count: number | null
          locationcode: string | null
          lot_count: number | null
          ptravailable_total: number | null
          row_count: number | null
          size_count: number | null
        }
        Relationships: []
      }
      ph_crop_roll_open_navigation_counts: {
        Row: {
          blockalpha: string | null
          contsize: string | null
          crop_roll_view: string | null
          item_count: number | null
          locationcode: string | null
          lot_count: number | null
          ptravailable_total: number | null
          row_count: number | null
        }
        Relationships: []
      }
      ph_crop_roll_open_rows: {
        Row: {
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          caliper: string | null
          commonname: string | null
          contsize: string | null
          created_at: string | null
          crop_roll_view: string | null
          date_completed: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          fieldtagcolor: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_completed: string | null
          flyer_initial_ptr: string | null
          flyer_loc_match_qty: string | null
          flyer_match: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          genus: string | null
          genusname: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          initial_ptr: string | null
          itemcode: string | null
          itemspec: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          lotcode: string | null
          master_unique_id: string | null
          master_updated_at: string | null
          match: string | null
          photo_link: string | null
          photo_name: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          qualitycode: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          saleyear: string | null
          search_text: string | null
          season: string | null
          season_supply: string | null
          source: string | null
          source_table: string | null
          spec: string | null
          unique_id: string | null
          updated_at: string | null
          warehouseid: string | null
        }
        Relationships: []
      }
      ph_master_inventory_assignedto_final_user_view: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          app_tab_assignment: string | null
          assignedto: string | null
          assignedto_user: string | null
          assignment_source: string | null
          av_note: string | null
          avg_price_eunit_shipped: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
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
          ext_eunit_shipped: string | null
          ext_ptronhand: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          genusname: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          hold_release_approved_at: string | null
          hold_release_approved_by: string | null
          hold_release_approved_by_display: string | null
          hold_release_approved_holdstopbegindate: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hsreasonbegin: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          inventorynote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          largeptrqty: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          match: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          ncr_approval_message: string | null
          ncr_approval_type: string | null
          ncr_requested_at: string | null
          ncr_requested_by_display: string | null
          ncr_requested_by_email: string | null
          ncr_requested_by_username: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          oversellpercentage: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          reversecommon: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          source_assignedto: string | null
          spec: string | null
          specialpuller: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          suspendto: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string | null
          unitprice: string | null
          varietycode: string | null
          warehousei: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Relationships: []
      }
      ph_master_inventory_dylan_collyge_assigned: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          app_tab_assignment: string | null
          assignedto: string | null
          assignedto_user: string | null
          assignment_source: string | null
          av_note: string | null
          avg_price_eunit_shipped: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
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
          ext_eunit_shipped: string | null
          ext_ptronhand: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          genusname: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          hold_release_approved_at: string | null
          hold_release_approved_by: string | null
          hold_release_approved_by_display: string | null
          hold_release_approved_holdstopbegindate: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hsreasonbegin: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          inventorynote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          largeptrqty: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          match: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          ncr_approval_message: string | null
          ncr_approval_type: string | null
          ncr_requested_at: string | null
          ncr_requested_by_display: string | null
          ncr_requested_by_email: string | null
          ncr_requested_by_username: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          oversellpercentage: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          reversecommon: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          source_assignedto: string | null
          spec: string | null
          specialpuller: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          suspendto: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string | null
          unitprice: string | null
          varietycode: string | null
          warehousei: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Relationships: []
      }
      ph_request_delivery_status: {
        Row: {
          delivered_at: string | null
          delivery_age_seconds: number | null
          delivery_attempt_count: number | null
          delivery_display_state: string | null
          delivery_error_code: string | null
          delivery_first_attempt_at: string | null
          delivery_last_attempt_at: string | null
          delivery_lease_expires_at: string | null
          delivery_mode: string | null
          delivery_next_attempt_at: string | null
          delivery_status: string | null
          email_delivered_at: string | null
          event_id: string | null
          event_type: string | null
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
        }
        Relationships: []
      }
      ph_request_queue_live_rows: {
        Row: {
          app_tab_assignment: string | null
          av_note: string | null
          av_rule_av_note_updated_at: string | null
          av_rule_bundle_updated_at: string | null
          av_rule_caliper_updated_at: string | null
          av_rule_holdstop_snapshot: string | null
          av_rule_last_clear_reason: string | null
          av_rule_last_cleared_at: string | null
          av_rule_match_updated_at: string | null
          av_rule_photo_updated_at: string | null
          av_rule_priority_snapshot: string | null
          av_rule_spec_updated_at: string | null
          client_batch_id: string | null
          commonname: string | null
          completed_by_display: string | null
          completed_by_email: string | null
          completed_by_username: string | null
          contsize: string | null
          created_at: string | null
          date_completed: string | null
          delivery_age_seconds: number | null
          delivery_attempt_count: number | null
          delivery_delivered_at: string | null
          delivery_display_state: string | null
          delivery_email_delivered_at: string | null
          delivery_error_code: string | null
          delivery_event_id: string | null
          delivery_first_attempt_at: string | null
          delivery_last_attempt_at: string | null
          delivery_lease_expires_at: string | null
          delivery_mode: string | null
          delivery_next_attempt_at: string | null
          delivery_push_delivered_at: string | null
          delivery_status: string | null
          desired_caliper: string | null
          desired_spec: string | null
          drive_assignedto: string | null
          drive_av_note: string | null
          drive_caliper: string | null
          drive_last_updated: string | null
          drive_loc_match_qty: string | null
          drive_match: string | null
          drive_photo_link: string | null
          drive_photo_name: string | null
          drive_pic_note: string | null
          drive_row_missing: boolean | null
          drive_spec: string | null
          est_ship: string | null
          field_tag_color: string | null
          id: number | null
          itemcode: string | null
          locationcode: string | null
          lotcode: string | null
          master_app_tab_assignment: string | null
          master_id: string | null
          move_actual_qty: number | null
          move_approval_stage: string | null
          move_batch_id: string | null
          move_completed_at: string | null
          move_completed_by: string | null
          move_destination_needs_row: boolean | null
          move_dylan_approved_at: string | null
          move_from_locationcode: string | null
          move_group_key: string | null
          move_jd_approved_at: string | null
          move_planned_qty: number | null
          move_status: string | null
          move_to_locationcode: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          req_archived: boolean | null
          req_caliper: string | null
          req_comments: string | null
          req_customer: string | null
          req_match: number | null
          req_photo_link: string | null
          req_photo_mode: string | null
          req_photo_name: string | null
          req_pic_note: string | null
          req_qty: string | null
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
          request_source: string | null
          requested_by: string | null
          row_version: number | null
          season_supply: string | null
          unique_id: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      ph_view_av_hot_price: {
        Row: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          avg_price_eunit_shipped: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          caliper: string | null
          carrier: string | null
          cav_filename: string | null
          cav_itemcode: string | null
          cav_last_updated: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
          ext_eunit_shipped: string | null
          ext_ptronhand: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_inst: string | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          genusname: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hot_price: string | null
          hsreasonbegin: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          inventorynote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          largeptrqty: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          match: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          oversellpercentage: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          reversecommon: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          spec: string | null
          specialpuller: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          suspendto: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string | null
          unitprice: string | null
          varietycode: string | null
          warehousei: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }
        Relationships: []
      }
      ph_view_av_hot_price_keys: {
        Row: {
          cav_filename: string | null
          cav_itemcode: string | null
          cav_last_updated: string | null
          hot_price: string | null
          itemcode_key: string | null
        }
        Relationships: []
      }
      ph_view_low_stock: {
        Row: {
          assignedto: string | null
          av_note: string | null
          caliper: string | null
          commonname: string | null
          concat: string | null
          contsize: string | null
          date_completed: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          field_tag_color: string | null
          flyer_assigned: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_inst: string | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_title: string | null
          initial_ptr: string | null
          itemcode: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          lotcode: string | null
          match: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          s_lts: string | null
          sales_note: string | null
          season: string | null
          season_supply: string | null
          spec: string | null
          unique_id: string | null
        }
        Insert: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          date_completed?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          field_tag_color?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          season?: string | null
          season_supply?: string | null
          spec?: string | null
          unique_id?: string | null
        }
        Update: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          date_completed?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          field_tag_color?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          season?: string | null
          season_supply?: string | null
          spec?: string | null
          unique_id?: string | null
        }
        Relationships: []
      }
      ph_view_manager_review: {
        Row: {
          assignedto: string | null
          av_note: string | null
          caliper: string | null
          commonname: string | null
          concat: string | null
          contsize: string | null
          date_completed: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          field_tag_color: string | null
          flyer_assigned: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_inst: string | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_title: string | null
          initial_ptr: string | null
          itemcode: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          lotcode: string | null
          match: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          qualitycode: string | null
          s_lts: string | null
          sales_note: string | null
          season: string | null
          season_supply: string | null
          spec: string | null
          unique_id: string | null
        }
        Insert: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          date_completed?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          field_tag_color?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          season?: string | null
          season_supply?: string | null
          spec?: string | null
          unique_id?: string | null
        }
        Update: {
          assignedto?: string | null
          av_note?: string | null
          caliper?: string | null
          commonname?: string | null
          concat?: string | null
          contsize?: string | null
          date_completed?: string | null
          dock_caliper?: string | null
          dock_note?: string | null
          dock_photo_link?: string | null
          dock_photo_name?: string | null
          dock_spec?: string | null
          end_cap_folder?: string | null
          end_cap_level?: string | null
          end_cap_qty?: string | null
          field_tag_color?: string | null
          flyer_assigned?: string | null
          flyer_cat?: string | null
          flyer_completed?: string | null
          flyer_inst?: string | null
          flyer_notes?: string | null
          flyer_photo_link?: string | null
          flyer_photo_name?: string | null
          flyer_title?: string | null
          initial_ptr?: string | null
          itemcode?: string | null
          last_updated?: string | null
          listprice?: string | null
          loc_match_qty?: string | null
          locationcode?: string | null
          lotcode?: string | null
          match?: string | null
          photo_link?: string | null
          photo_name?: string | null
          pic_note?: string | null
          plantgroupcode?: string | null
          priority?: string | null
          ptravailable?: string | null
          qualitycode?: string | null
          s_lts?: string | null
          sales_note?: string | null
          season?: string | null
          season_supply?: string | null
          spec?: string | null
          unique_id?: string | null
        }
        Relationships: []
      }
      ph_view_po_27f1_hl: {
        Row: {
          built_at: string | null
          commonname: string | null
          consigneename: string | null
          consigneestate: string | null
          contsize: string | null
          created_at: string | null
          customername: string | null
          dock: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          id: number | null
          itemcode: string | null
          locationcode: string | null
          lot_pend_rec: number | null
          lotcode: string | null
          po_remain: number | null
          priority: string | null
          ptronhand: number | null
          quantityordered: number | null
          requestdate: string | null
          row_index: number | null
          run_id: string | null
          salesrepid: string | null
          salesrepname: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          total_ptronhand: number | null
          total_quantity_ordered: number | null
        }
        Relationships: []
      }
      ph_view_po_27s1_hl: {
        Row: {
          built_at: string | null
          commonname: string | null
          consigneename: string | null
          consigneestate: string | null
          contsize: string | null
          created_at: string | null
          customername: string | null
          dock: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          id: number | null
          itemcode: string | null
          locationcode: string | null
          lot_pend_rec: number | null
          lotcode: string | null
          po_remain: number | null
          priority: string | null
          ptronhand: number | null
          quantityordered: number | null
          requestdate: string | null
          row_index: number | null
          run_id: string | null
          salesrepid: string | null
          salesrepname: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          total_ptronhand: number | null
          total_quantity_ordered: number | null
        }
        Relationships: []
      }
      ph_view_season_notes: {
        Row: {
          unique_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_request_folder_completion_v2: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      activate_eval_item_low_stock_import_v1: {
        Args: { p_run_id: string }
        Returns: Json
      }
      add_codex_ops_message_v1: {
        Args: {
          p_body: string
          p_expected_revision: number
          p_idempotency_key: string
          p_task_id: string
        }
        Returns: Json
      }
      app_account_active_v1: {
        Args: { p_profile_id?: string; p_username?: string }
        Returns: boolean
      }
      append_manager_order_source_rows_v1: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: Json
      }
      append_request_options_v1: {
        Args: {
          p_client_batch_id: string
          p_inventory_row_ids: string[]
          p_request_folder: string
          p_source_request_id: string
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
      apply_inventory_transaction_v1: {
        Args: {
          p_actor_id: string
          p_audit: Json
          p_command_id: string
          p_operations: Json
          p_request: Json
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
      aura_inventory_lot_lookup_v1: {
        Args: { p_after_uid?: string; p_limit?: number; p_lotcode: string }
        Returns: Json
      }
      aura_inventory_v2_match_v1: {
        Args: {
          p_common_name: string
          p_contsize?: string
          p_expected_season?: string
          p_locationcode?: string
          p_metric?: string
          p_open_stock_only?: boolean
        }
        Returns: Json
      }
      aura_inventory_v2_name_v1: { Args: { p_value: string }; Returns: string }
      aura_inventory_v2_number_v1: {
        Args: { p_value: string }
        Returns: number
      }
      aura_inventory_v2_read_v1: {
        Args: {
          p_contsize?: string
          p_cursor?: Json
          p_expected_season?: string
          p_itemcode?: string
          p_limit?: number
          p_lines?: Json
          p_locationcode?: string
          p_metric?: string
          p_open_stock_only?: boolean
          p_operation: string
          p_quantity?: number
        }
        Returns: Json
      }
      aura_inventory_v2_salesyear_v1: {
        Args: { p_value: string }
        Returns: number
      }
      aura_inventory_v2_size_v1: { Args: { p_value: string }; Returns: string }
      aura_llm_reserve_call_v1: {
        Args: {
          p_input_tokens: number
          p_request_id: string
          p_round: number
          p_rpd: number
          p_rpm: number
          p_tpm: number
        }
        Returns: Json
      }
      aura_manager_season_settings_v1: {
        Args: {
          p_actor_id: string
          p_expected_revision?: number
          p_operation: string
          p_sales_year?: number
          p_season_code?: string
        }
        Returns: Json
      }
      aura_query_bunch_v1: {
        Args: {
          p_actor_id: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_operation: string
        }
        Returns: Json
      }
      aura_query_conversation_v1: {
        Args: {
          p_actor_id: string
          p_conversation_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
          p_turn_id?: string
        }
        Returns: Json
      }
      aura_query_hl_order_v1: {
        Args: {
          p_actor_id: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_operation: string
        }
        Returns: Json
      }
      aura_query_inventory_v1: {
        Args: {
          p_actor_id: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_operation: string
        }
        Returns: Json
      }
      aura_query_number_v1: { Args: { v: string }; Returns: number }
      aura_query_salesyear_v1: { Args: { v: string }; Returns: number }
      aura_query_seasonal_records_v1: {
        Args: {
          p_actor_id: string
          p_capability: string
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
        }
        Returns: Json
      }
      aura_query_size_v1: { Args: { v: string }; Returns: string }
      aura_resolve_season_v1: {
        Args: { p_actor_id: string; p_reference?: string }
        Returns: Json
      }
      begin_dataset_import_v1: {
        Args: {
          p_canonical_keys?: string[]
          p_dataset_keys: string[]
          p_run_id: string
        }
        Returns: Json
      }
      begin_eval_item_low_stock_import_v1: {
        Args: { p_manifest: Json }
        Returns: Json
      }
      bloomscapes_pending_command: {
        Args: { p_action: string; p_payload?: Json; p_request_id?: string }
        Returns: Json
      }
      bunch_note_card_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
        }
        Returns: Json
      }
      bunch_note_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
        }
        Returns: Json
      }
      bunch_note_delivery_lookup_v1: {
        Args: { p_event_id: string }
        Returns: Json
      }
      bunch_note_delivery_record_v1: {
        Args: {
          p_event_id: string
          p_lease_token: string
          p_result: Json
          p_status: string
        }
        Returns: Json
      }
      bunch_note_freeze_pdfs_v1: {
        Args: { p_pdfs: Json; p_preview_id: string }
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
      cancel_eval_work_v1: {
        Args: {
          p_actor_username: string
          p_expected_version: number
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_location_work_job_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_job_id: string
        }
        Returns: {
          assigned_usernames: string[]
          assignment_event_id: string | null
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          completion_event_id: string | null
          completion_recipient: Json
          created_at: string
          created_by_display: string
          created_by_profile_id: string
          created_by_username: string
          general_instructions: string
          id: string
          idempotency_key: string
          line_count: number
          resolved_line_count: number
          revision: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_location_work_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_shear_location_inquiry_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_inquiry_id: string
        }
        Returns: {
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          created_at: string
          created_by_display: string
          created_by_username: string
          delivery_event_id: string | null
          id: string
          item_count: number
          location_key: string | null
          locationcode: string
          recipient_emails: string[]
          recipient_profiles: Json
          recipient_usernames: string[]
          revision: number
          row_count: number
          status: string
          submission_id: string
          total_on_hand: number
          total_to_shear: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_shear_location_inquiries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_request_delivery_events: {
        Args: { p_limit?: number; p_worker_id?: string }
        Returns: {
          attempt_count: number
          channel_results: Json
          created_at: string
          delivered_at: string | null
          delivery_mode: string | null
          email_delivered_at: string | null
          event_id: string
          event_key: string
          event_type: string
          first_attempt_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          last_attempt_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          message_id_header: string | null
          next_attempt_at: string
          payload: Json
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
          sanitized_error_code: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ph_request_delivery_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_password_change_profile: {
        Args: {
          p_attempt_id: string
          p_auth_user_id: string
          p_password: string
          p_password_fingerprint: string
        }
        Returns: {
          display_name: string
          division: string
          language: string
          legacy_user_id: number
          must_change_password: boolean
          profile_id: string
          role: string
          status: string
          username: string
        }[]
      }
      complete_request_delivery_event: {
        Args: {
          p_channel_results?: Json
          p_event_id: string
          p_lease_token: string
        }
        Returns: {
          attempt_count: number
          channel_results: Json
          created_at: string
          delivered_at: string | null
          delivery_mode: string | null
          email_delivered_at: string | null
          event_id: string
          event_key: string
          event_type: string
          first_attempt_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          last_attempt_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          message_id_header: string | null
          next_attempt_at: string
          payload: Json
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
          sanitized_error_code: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_request_delivery_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_season_sales_office_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_idempotency_key: string
          p_master_id: string
        }
        Returns: Json
      }
      complete_shear_location_inquiry_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_inquiry_id: string
        }
        Returns: {
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          created_at: string
          created_by_display: string
          created_by_username: string
          delivery_event_id: string | null
          id: string
          item_count: number
          location_key: string | null
          locationcode: string
          recipient_emails: string[]
          recipient_profiles: Json
          recipient_usernames: string[]
          revision: number
          row_count: number
          status: string
          submission_id: string
          total_on_hand: number
          total_to_shear: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_shear_location_inquiries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_suspend_tag_v1: {
        Args: {
          p_expected_last_updated: string
          p_request_id: string
          p_source_uid: string
        }
        Returns: Json
      }
      create_av_request_batch: {
        Args: { client_batch_id: string; requests: Json }
        Returns: Json
      }
      create_codex_ops_task_v1: {
        Args: { p_description: string; p_idempotency_key: string }
        Returns: Json
      }
      create_eval_report2_batch_v1: { Args: { p_payload: Json }; Returns: Json }
      create_eval_work_batch_multi_v2: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_eval_work_batch_v1: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_eval_work_batch_v2: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_eval_work_legacy_sep09_v1: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_eval_work_multi_v1: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_eval_work_v1: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_flyer_folder_batch_v1: {
        Args: {
          p_add_to_existing: boolean
          p_assignee_usernames: string[]
          p_folder_name: string
          p_idempotency_key: string
          p_master_uids: string[]
        }
        Returns: Json
      }
      create_location_work_job_v1: { Args: { p_payload: Json }; Returns: Json }
      create_request_batch: {
        Args: { client_batch_id: string; requests: Json }
        Returns: Json
      }
      create_shear_location_inquiries_v1: {
        Args: { p_payload: Json }
        Returns: Json
      }
      digest:
        | { Args: { input: string; type: string }; Returns: string }
        | { Args: { input: string; type: string }; Returns: string }
      enqueue_drive_reclass_inquiry_v1: {
        Args: { p_payload: Json }
        Returns: Json
      }
      enqueue_drive_reclass_inquiry_v4: {
        Args: { p_payload: Json }
        Returns: Json
      }
      fail_dataset_import_v1: { Args: { p_run_id: string }; Returns: Json }
      fail_request_delivery_event: {
        Args: {
          p_error_code: string
          p_event_id: string
          p_lease_token: string
        }
        Returns: {
          attempt_count: number
          channel_results: Json
          created_at: string
          delivered_at: string | null
          delivery_mode: string | null
          email_delivered_at: string | null
          event_id: string
          event_key: string
          event_type: string
          first_attempt_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          last_attempt_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          message_id_header: string | null
          next_attempt_at: string
          payload: Json
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
          sanitized_error_code: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_request_delivery_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_eval_item_low_stock_file_v1: {
        Args: {
          p_content_sha256: string
          p_expected_row_count: number
          p_file_version_id: string
        }
        Returns: Json
      }
      finalize_pikes_order_import: {
        Args: {
          p_content_sha256: string
          p_drive_file_id: string
          p_expected_row_count: number
          p_source_header_row: number
          p_source_sheet_name: string
        }
        Returns: Json
      }
      finalize_transactions_keyed_import: {
        Args: {
          expected_row_count: number
          source_content_sha256: string
          source_drive_file_id: string
          source_header_row: number
          source_sheet_name: string
        }
        Returns: Json
      }
      finish_dataset_import_v1: { Args: { p_run_id: string }; Returns: Json }
      get_access_control_capabilities_v1: { Args: never; Returns: Json }
      get_access_control_health_snapshot_v1: { Args: never; Returns: Json }
      get_access_control_matrix_v1: {
        Args: { p_policy_version_id?: number }
        Returns: Json
      }
      get_access_control_matrix_v2: { Args: { p_query?: Json }; Returns: Json }
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
      get_dataset_import_status_v1: {
        Args: { p_dataset_keys: string[] }
        Returns: Json
      }
      get_drive_evidence_save_health_v2: { Args: never; Returns: Json }
      get_drive_reclass_inquiry_status_v1: {
        Args: { p_actor_username: string; p_idempotency_token: string }
        Returns: Json
      }
      get_eval_item_low_stock_targets_v1: {
        Args: {
          p_after_itemcode?: string
          p_itemcodes?: string[]
          p_limit?: number
        }
        Returns: {
          calculated_at: string
          effective_qty: number
          history_from_date: string
          history_pending_files: number
          history_ready: boolean
          history_through_date: string
          history_total_files: number
          itemcode_normalized: string
          manual_override_qty: number
          mean_quantity: number
          override_revision: number
          p75_quantity: number
          qualifying_day_count: number
          qualifying_line_count: number
          source_file_count: number
          suggested_qty: number
          updated_at: string
        }[]
      }
      get_eval_itemcode_work_health_snapshot_v1: { Args: never; Returns: Json }
      get_eval_itemcode_work_health_snapshot_v2: { Args: never; Returns: Json }
      get_eval_report_settings: { Args: never; Returns: Json }
      get_eval_report2_direct_inquiry_recipients_v1: {
        Args: { p_actor_username: string }
        Returns: string[]
      }
      get_eval_request_delivery_health_snapshot_v2: {
        Args: never
        Returns: Json
      }
      get_eval_work_assignment_batch_health_v1: { Args: never; Returns: Json }
      get_eval_work_creation_health_snapshot_v1: { Args: never; Returns: Json }
      get_eval_work_review_setup_v1: {
        Args: { p_payload: Json }
        Returns: Json
      }
      get_historical_inventory_container_sizes: {
        Args: { common_name: string }
        Returns: Json
      }
      get_historical_inventory_rows: {
        Args: {
          common_name: string
          container_size: string
          cursor_report_date?: string
          cursor_unique_id?: string
          end_date?: string
          result_limit?: number
          selected_columns?: string[]
          start_date?: string
        }
        Returns: Json
      }
      get_hosted_health_snapshot: { Args: never; Returns: Json }
      get_item_inquiry_coverage_v1: { Args: never; Returns: Json }
      get_limited_access_control_matrix_v1: {
        Args: { p_query?: Json }
        Returns: Json
      }
      get_manager_order_batch_v1: {
        Args: {
          p_after_itemcode?: string
          p_after_unique_id?: string
          p_assignedto_keys?: string[]
          p_batch_id: string
          p_limit?: number
        }
        Returns: Json
      }
      get_manager_order_batches_v1: {
        Args: {
          p_before_batch_id?: string
          p_before_imported_at?: string
          p_limit?: number
          p_source_key?: string
        }
        Returns: Json
      }
      get_manager_order_sources_v1: { Args: never; Returns: Json }
      get_my_app_permissions_v1: { Args: never; Returns: Json }
      get_my_dataset_revisions_v1: {
        Args: { p_dataset_keys: string[] }
        Returns: Json
      }
      get_photo_delivery_health_v1: { Args: never; Returns: Json }
      get_pikes_order_assignment_health_v1: { Args: never; Returns: Json }
      get_po_management_health_snapshot: { Args: never; Returns: Json }
      get_request_capabilities: { Args: never; Returns: Json }
      get_request_delivery_recovery_queue: {
        Args: never
        Returns: {
          attempt_count: number
          created_at: string
          delivery_mode: string
          email_delivered_at: string
          event_id: string
          event_type: string
          first_attempt_at: string
          history_snapshot: Json
          last_attempt_at: string
          lease_expires_at: string
          next_attempt_at: string
          pending_age_seconds: number
          push_delivered_at: string
          request_folder: string
          request_id: string
          sanitized_error_code: string
          status: string
        }[]
      }
      get_request_drive_evidence_health_snapshot_v1: {
        Args: never
        Returns: Json
      }
      get_request_schema_compatibility: { Args: never; Returns: Json }
      get_season_sales_note_access_v1: {
        Args: { p_actor_username: string }
        Returns: Json
      }
      get_season_sales_office_health_v1: { Args: never; Returns: Json }
      get_transactions_keyed_dashboard: {
        Args: {
          all_dates_limit?: number
          all_dates_offset?: number
          creator_search?: string
          files_limit?: number
          files_offset?: number
          selected_date?: string
        }
        Returns: Json
      }
      get_v2_crop_roll_completion_master_ids: {
        Args: { row_data: Json }
        Returns: string[]
      }
      get_v2_crop_roll_completion_view: {
        Args: { row_data: Json }
        Returns: string
      }
      get_v2_crop_roll_drive_view: { Args: { row_data: Json }; Returns: string }
      guard_active_app_session_v1: { Args: never; Returns: undefined }
      heartbeat_dataset_import_v1: { Args: { p_run_id: string }; Returns: Json }
      heartbeat_request_delivery_worker: {
        Args: {
          p_canary?: boolean
          p_claimed?: number
          p_delivered?: number
          p_error_code?: string
          p_failed?: number
          p_worker_id: string
        }
        Returns: undefined
      }
      hl_order_can_read_outbox_v1: { Args: never; Returns: boolean }
      hl_order_command: {
        Args: {
          p_action: string
          p_command_id: string
          p_expected_revision?: number
          p_payload: Json
        }
        Returns: Json
      }
      hl_order_delivery_lookup_v1: {
        Args: { p_event_id: string }
        Returns: Json
      }
      hl_order_delivery_record_v1: {
        Args: {
          p_event_id: string
          p_lease_token: string
          p_result: Json
          p_status: string
        }
        Returns: Json
      }
      hl_order_inventory_availability: {
        Args: { p_itemcodes: string[] }
        Returns: {
          computed_balance: number
          contsize: string
          itemcode: string
          season_lot: string
        }[]
      }
      hl_order_restock_state: { Args: never; Returns: Json }
      hl_order_restock_state_v2: { Args: { p_lot: string }; Returns: Json }
      hl_order_state: { Args: never; Returns: Json }
      hl_po_import_capabilities: { Args: never; Returns: Json }
      hl_po_import_stage: {
        Args: { p_complete?: boolean; p_rows: Json; p_run_id: string }
        Returns: Json
      }
      hl_po_pdf_stage: {
        Args: {
          p_complete?: boolean
          p_metadata: Json
          p_page: number
          p_rows: Json
          p_run_id: string
        }
        Returns: Json
      }
      hr_claim_calendar_reminders_v1: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          calendar_event_id: string
          created_at: string
          event_key: string
          event_type: string
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          payload: Json
          recipient_username: string
          sent_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "hr_calendar_reminder_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      hr_finish_calendar_reminder_v1: {
        Args: { p_delivered: boolean; p_error_code?: string; p_id: string }
        Returns: undefined
      }
      inventory_transaction_history_v1: {
        Args: { p_actor_id: string; p_payload?: Json }
        Returns: Json
      }
      inventory_workflow_session_actor_v1: {
        Args: { p_actor_id: string; p_session_id: string }
        Returns: Json
      }
      list_codex_ops_tasks_v1: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      list_eval_report2_itemcodes_v1: {
        Args: { p_payload: Json }
        Returns: Json
      }
      list_expired_codex_ops_evidence_service_v1: {
        Args: { p_limit?: number }
        Returns: Json
      }
      manager_season_priority_list_v1: {
        Args: { p_actor_id: string; p_assigned_to?: string }
        Returns: Json
      }
      manager_season_priority_state_v1: {
        Args: { p_actor_id: string; p_itemcodes?: string[] }
        Returns: Json
      }
      mark_pikes_order_file_archived: {
        Args: { p_content_sha256: string; p_drive_file_id: string }
        Returns: Json
      }
      mark_transactions_keyed_file_archived: {
        Args: { source_content_sha256: string; source_drive_file_id: string }
        Returns: Json
      }
      navigation_module_allowed_v1: {
        Args: { p_actor_id: string; p_view: string }
        Returns: boolean
      }
      navigation_preferences_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
        }
        Returns: Json
      }
      ph_prepare_hold_learning_refresh_chunked: {
        Args: { p_job_name?: string }
        Returns: {
          itemcode_count: number
        }[]
      }
      ph_refresh_hold_learning_itemcode_batch: {
        Args: { p_batch_size?: number; p_job_name?: string }
        Returns: {
          cycle_rows: number
          finished: boolean
          processed_itemcodes: number
          remaining_itemcodes: number
          snapshot_rows: number
        }[]
      }
      ph_refresh_hold_learning_summary_batch: {
        Args: { p_batch_size?: number; p_job_name?: string }
        Returns: {
          finished: boolean
          inserted_summaries: number
          processed_itemcodes: number
          remaining_itemcodes: number
        }[]
      }
      ph_refresh_hold_stop_itemcode_cycles_fast: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          itemcode_cycles: number
          snapshot_rows: number
        }[]
      }
      ph_refresh_hold_stop_itemcode_summaries: { Args: never; Returns: number }
      ph_start_hold_learning_refresh_chunked: {
        Args: {
          p_item_batch_size?: number
          p_job_name?: string
          p_summary_batch_size?: number
        }
        Returns: {
          item_job_id: number
          itemcode_count: number
          job_name: string
          summary_job_id: number
        }[]
      }
      photo_history_gallery_v1: {
        Args: { p_actor_id: string; p_input?: Json; p_operation: string }
        Returns: Json
      }
      prepare_eval_item_low_stock_file_v1: {
        Args: {
          p_content_bytes: number
          p_content_sha256: string
          p_disposition?: string
          p_drive_file_id: string
          p_exclusion_counts: Json
          p_exclusion_reason?: string
          p_expected_row_count: number
          p_file_name: string
          p_run_id: string
          p_snapshot_at: string
          p_source_created_at?: string
          p_source_date_method: string
          p_source_report_date: string
          p_source_revision: string
          p_source_row_count: number
          p_source_sheet_name: string
        }
        Returns: Json
      }
      prepare_manager_order_import_v2: {
        Args: {
          p_batch_id: string
          p_content_bytes: number
          p_content_sha256: string
          p_drive_file_id: string
          p_file_name: string
          p_source_key: string
        }
        Returns: Json
      }
      prepare_password_change_profile: {
        Args: {
          p_auth_user_id?: string
          p_password_fingerprint?: string
          p_username: string
        }
        Returns: {
          attempt_id: string
          disabled_at: string
          display_name: string
          division: string
          language: string
          legacy_user_id: number
          locked_until: string
          must_change_password: boolean
          profile_id: string
          role: string
          status: string
          username: string
        }[]
      }
      prepare_pikes_order_import: {
        Args: {
          p_batch_id: string
          p_content_bytes: number
          p_content_sha256: string
          p_drive_file_id: string
          p_file_name: string
        }
        Returns: Json
      }
      prepare_request_folder_completion_v2: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: Json
      }
      prepare_suspend_tag_delivery_v1: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: Json
      }
      prepare_transactions_keyed_import: {
        Args: {
          source_content_bytes?: number
          source_content_sha256: string
          source_drive_file_id: string
          source_file_name: string
          source_import_batch_id?: string
        }
        Returns: Json
      }
      production_schedule_append_rows_v1: {
        Args: { p_rows: Json; p_sheet_index: number; p_snapshot_id: string }
        Returns: number
      }
      production_schedule_fail_import_v1: {
        Args: { p_error_code: string; p_snapshot_id: string }
        Returns: undefined
      }
      production_schedule_finish_import_v1: {
        Args: { p_snapshot_id: string }
        Returns: Json
      }
      production_schedule_read_cards_v1: {
        Args: {
          p_column_indexes?: number[]
          p_cursor?: number
          p_filters?: Json
          p_limit?: number
          p_search?: string
          p_sheet_index: number
          p_snapshot_id?: string
        }
        Returns: Json
      }
      production_schedule_read_metadata_v1: { Args: never; Returns: Json }
      production_schedule_read_rows_v1: {
        Args: {
          p_cursor?: number
          p_filters?: Json
          p_limit?: number
          p_search?: string
          p_sheet_index: number
          p_snapshot_id?: string
        }
        Returns: Json
      }
      production_schedule_read_status_v1: {
        Args: { p_snapshot_id?: string }
        Returns: Json
      }
      production_schedule_set_sheets_v1: {
        Args: { p_sheets: Json; p_snapshot_id: string }
        Returns: undefined
      }
      production_schedule_start_import_v1: {
        Args: { p_requested_by: string }
        Returns: Json
      }
      production_schedule_update_progress_v1: {
        Args: {
          p_processed_rows: number
          p_sheet_index: number
          p_snapshot_id: string
          p_total_rows: number
        }
        Returns: undefined
      }
      production_workflow_command_v1: {
        Args: { p_actor_id: string; p_operation: string; p_payload?: Json }
        Returns: Json
      }
      provision_native_auth_app_user: {
        Args: {
          p_auth_user_id: string
          p_display_name?: string
          p_division?: string
          p_language?: string
          p_must_change_password?: boolean
          p_password: string
          p_role?: string
          p_username: string
        }
        Returns: {
          legacy_user_id: number
        }[]
      }
      prune_v2_app_live_events: {
        Args: { retention_days?: number }
        Returns: number
      }
      prune_v2_app_live_events_by_count: {
        Args: { max_events?: number }
        Returns: number
      }
      publish_access_control_policy_v1: {
        Args: { p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      reassign_eval_work_v1: {
        Args: {
          p_actor_username: string
          p_assignee_email: string
          p_assignee_username: string
          p_expected_version: number
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reassign_eval_work_v2: {
        Args: { p_payload: Json }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_eval_itemcodes:
        | { Args: never; Returns: Json }
        | { Args: { p_import_run_id: string }; Returns: Json }
      reconcile_eval_report2_work_v1: {
        Args: {
          p_dry_run?: boolean
          p_import_revision: string
          p_limit?: number
        }
        Returns: Json
      }
      reconcile_request_folder_completion_window_v2: {
        Args: { p_dry_run?: boolean; p_from: string; p_to: string }
        Returns: Json
      }
      reconcile_season_sales_office_v1: {
        Args: {
          p_dry_run?: boolean
          p_idempotency_key?: string
          p_import_revision?: string
          p_itemcodes?: string[]
        }
        Returns: Json
      }
      record_pikes_order_import_failure: {
        Args: {
          p_content_sha256: string
          p_drive_file_id: string
          p_sanitized_error_code: string
        }
        Returns: Json
      }
      record_request_delivery_channel_result: {
        Args: {
          p_channel_results: Json
          p_event_id: string
          p_lease_token: string
        }
        Returns: {
          attempt_count: number
          channel_results: Json
          created_at: string
          delivered_at: string | null
          delivery_mode: string | null
          email_delivered_at: string | null
          event_id: string
          event_key: string
          event_type: string
          first_attempt_at: string | null
          gmail_message_id: string | null
          gmail_thread_id: string | null
          last_attempt_at: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          lease_token: string | null
          message_id_header: string | null
          next_attempt_at: string
          payload: Json
          push_delivered_at: string | null
          request_folder: string | null
          request_id: string | null
          sanitized_error_code: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_request_delivery_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_transactions_keyed_import_failure: {
        Args: {
          sanitized_error_code: string
          source_content_sha256: string
          source_drive_file_id: string
        }
        Returns: Json
      }
      refresh_photo_history_catalog_v1: {
        Args: { p_dry_run?: boolean }
        Returns: Json
      }
      refresh_season_sales_office_v1: {
        Args: {
          p_actor_username: string
          p_idempotency_key: string
          p_import_revision: string
          p_itemcode: string
        }
        Returns: Json
      }
      refresh_v2_crop_roll_completed_drive_keys: {
        Args: never
        Returns: undefined
      }
      repair_pikes_order_batch_assignments_v1: {
        Args: {
          p_batch_id: string
          p_dry_run: boolean
          p_idempotency_key: string
        }
        Returns: Json
      }
      repair_request_drive_evidence_v1: {
        Args: { p_dry_run?: boolean; p_request_ids: string[] }
        Returns: Json
      }
      report_app_health_event: {
        Args: {
          app_build?: string
          area: string
          duration_ms?: number
          event_name: string
          metadata?: Json
          sample_rate?: number
          sanitized_code?: string
          severity: string
        }
        Returns: number
      }
      request_archive_command_v1: {
        Args: {
          p_actor_id: string
          p_idempotency_key: string
          p_operation: string
          p_uid: string
        }
        Returns: Json
      }
      request_archive_list_v1: {
        Args: { p_actor_id: string; p_limit?: number; p_offset?: number }
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
      request_history_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
        }
        Returns: Json
      }
      requeue_request_delivery: {
        Args: { delivery_event_id: string }
        Returns: Json
      }
      resolve_location_work_line_v1: {
        Args: {
          p_actor_username: string
          p_actual_qty?: number
          p_expected_revision: number
          p_job_id: string
          p_line_id: string
          p_not_completed_reason?: string
          p_resolution_status: string
          p_variance_confirmed?: boolean
        }
        Returns: Json
      }
      resolve_operational_recipients_v1: {
        Args: { p_kind: string; p_recipients: string[] }
        Returns: string[]
      }
      retry_drive_reclass_inquiry_v1: {
        Args: { p_actor_username: string; p_idempotency_token: string }
        Returns: Json
      }
      retry_location_work_delivery_v1: {
        Args: {
          p_actor_username: string
          p_delivery_kind: string
          p_expected_revision: number
          p_job_id: string
        }
        Returns: {
          assigned_usernames: string[]
          assignment_event_id: string | null
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          completion_event_id: string | null
          completion_recipient: Json
          created_at: string
          created_by_display: string
          created_by_profile_id: string
          created_by_username: string
          general_instructions: string
          id: string
          idempotency_key: string
          line_count: number
          resolved_line_count: number
          revision: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_location_work_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_shear_location_delivery_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_inquiry_id: string
        }
        Returns: {
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          created_at: string
          created_by_display: string
          created_by_username: string
          delivery_event_id: string | null
          id: string
          item_count: number
          location_key: string | null
          locationcode: string
          recipient_emails: string[]
          recipient_profiles: Json
          recipient_usernames: string[]
          revision: number
          row_count: number
          status: string
          submission_id: string
          total_on_hand: number
          total_to_shear: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_shear_location_inquiries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_request_integrity_maintenance: { Args: never; Returns: Json }
      sales_credit_attachment_v1: {
        Args: { p_actor_id: string; p_operation: string; p_payload?: Json }
        Returns: Json
      }
      sales_credit_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_revision?: number
          p_operation: string
          p_payload?: Json
        }
        Returns: Json
      }
      sales_history_unresolved_sources_v1: {
        Args: never
        Returns: {
          salesrepid: string
          salesrepname: string
          selected_rep_username: string
          source_id: string
          source_kind: string
        }[]
      }
      save_access_control_draft_v1: {
        Args: { p_changes: Json; p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      save_dock_trip_status_v1: {
        Args: {
          p_actor_username: string
          p_checker: string
          p_dock_num: string
          p_expected_revision?: number
          p_inspector: string
          p_mistake: string
          p_status: string
          p_tripnumber: string
        }
        Returns: {
          checker: string | null
          created_at: string
          dock_num: string | null
          inspector: string | null
          mistake: string | null
          revision: number
          status: string
          tripnumber: string
          updated_at: string
          updated_by_username: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_dock_trip_status"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_drive_evidence_v1: {
        Args: {
          p_complete: boolean
          p_evidence: Json
          p_expected_itemcode: string
          p_expected_locationcode: string
          p_expected_lotcode: string
          p_expected_signature: string
          p_idempotency_key: string
          p_master_uid: string
          p_workflow: string
        }
        Returns: Json
      }
      save_drive_evidence_v2: {
        Args: {
          p_baseline: Json
          p_complete: boolean
          p_evidence: Json
          p_expected_itemcode: string
          p_expected_locationcode: string
          p_expected_lotcode: string
          p_expected_signature: string
          p_idempotency_key: string
          p_master_uid: string
          p_workflow: string
        }
        Returns: Json
      }
      save_eval_work_v1: {
        Args: {
          p_actor_username: string
          p_evidence: Json
          p_expected_version: number
          p_inquiry: Json
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_eval_work_v2: {
        Args: {
          p_actor_username: string
          p_evidence_by_origin: Json
          p_expected_version: number
          p_inquiry: Json
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_eval_work_v2_legacy_impl: {
        Args: {
          p_actor_username: string
          p_evidence_by_origin: Json
          p_expected_version: number
          p_inquiry: Json
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_limited_access_override_v1: {
        Args: { p_changes: Json; p_expected_revision: number; p_reason: string }
        Returns: Json
      }
      save_request_work: {
        Args: {
          complete?: boolean
          expected_version: number
          patch: Json
          request_id: string
        }
        Returns: Json
      }
      save_request_work_v1: {
        Args: {
          complete?: boolean
          expected_version: number
          patch: Json
          request_id: string
        }
        Returns: Json
      }
      save_season_sales_note_users_v1: {
        Args: {
          p_actor_username: string
          p_idempotency_key: string
          p_usernames: string[]
        }
        Returns: Json
      }
      save_season_sales_office_av_note_v1: {
        Args: {
          p_actor_username: string
          p_av_note: string
          p_expected_revision: number
          p_idempotency_key: string
          p_master_id: string
        }
        Returns: Json
      }
      scheduled_handover_auth_checkpoint_v1: {
        Args: { p_error_code?: string; p_ok: boolean }
        Returns: Json
      }
      scheduled_handover_claim_push_v1: {
        Args: never
        Returns: unknown[]
        SetofOptions: {
          from: "*"
          to: "scheduled_handover_push_outbox_v1"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      scheduled_handover_finish_push_v1: {
        Args: { p_error_code?: string; p_id: number; p_ok: boolean }
        Returns: boolean
      }
      scheduled_handover_tick_v1: { Args: never; Returns: Json }
      search_historical_inventory_common_names: {
        Args: { result_limit?: number; search_text: string }
        Returns: Json
      }
      send_onesignal_push: {
        Args: { push_message: string; target_user: string }
        Returns: undefined
      }
      set_eval_item_low_stock_override_v1: {
        Args: {
          p_expected_revision: number
          p_itemcode: string
          p_override_qty: number
        }
        Returns: {
          calculated_at: string
          effective_qty: number
          history_from_date: string
          history_pending_files: number
          history_ready: boolean
          history_through_date: string
          history_total_files: number
          itemcode_normalized: string
          manual_override_qty: number
          mean_quantity: number
          override_revision: number
          p75_quantity: number
          qualifying_day_count: number
          qualifying_line_count: number
          source_file_count: number
          suggested_qty: number
          updated_at: string
        }[]
      }
      set_eval_itemcode_assignment:
        | { Args: { assignedto: string; itemcode: string }; Returns: Json }
        | {
            Args: { assignedto: string; genusname: string; itemcode: string }
            Returns: Json
          }
      set_eval_report_settings: {
        Args: {
          hold_age_days: number
          location_note_age_days: number
          low_stock_max_slts: number
        }
        Returns: Json
      }
      set_item_inquiry_coverage_v1: {
        Args: {
          p_away: boolean
          p_expected_revision: number
          p_idempotency_key: string
        }
        Returns: Json
      }
      set_itemcode_default_owners_v1: {
        Args: { p_changes: Json; p_request_id: string }
        Returns: Json
      }
      stage_eval_item_low_stock_rows_v1: {
        Args: { p_file_version_id: string; p_rows: Json }
        Returns: number
      }
      submit_eval_work_legacy_v1: {
        Args: {
          p_actor_username: string
          p_evidence: Json
          p_expected_version: number
          p_inquiry: Json
          p_submission_token: string
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_eval_work_legacy_v2: {
        Args: {
          p_actor_username: string
          p_evidence_by_origin: Json
          p_expected_version: number
          p_inquiry: Json
          p_submission_token: string
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_eval_work_v1: {
        Args: {
          p_actor_username: string
          p_evidence: Json
          p_expected_version: number
          p_inquiry: Json
          p_submission_token: string
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_eval_work_v2: {
        Args: {
          p_actor_username: string
          p_evidence_by_origin: Json
          p_expected_version: number
          p_inquiry: Json
          p_submission_token: string
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_eval_work_v2_legacy_impl: {
        Args: {
          p_actor_username: string
          p_evidence_by_origin: Json
          p_expected_version: number
          p_inquiry: Json
          p_submission_token: string
          p_work_id: string
        }
        Returns: {
          assigned_to_users: string[]
          assignee_display: string
          assignee_email: string
          assignee_profiles: Json
          assignee_username: string
          assignee_usernames: string[]
          assignment_event_id: string | null
          batch_token: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          commonname: string
          completion_event_id: string | null
          completion_recipients: string[]
          context_rows: Json
          contract_version: string
          contsize: string
          create_token: string
          created_at: string
          creator_display: string
          creator_username: string
          evidence_draft: Json
          id: string
          inquiry_draft: Json
          instructions: string
          inventory_signature: string
          itemcode: string
          origin_count: number
          origin_locationcode: string
          origin_lotcode: string
          origin_snapshot: Json
          origin_source: string
          origin_unique_id: string
          resolved_import_at: string | null
          resolved_import_report_id: string | null
          resolved_import_revision: string | null
          settings_signature: string
          source_context: Json
          started_at: string | null
          status: string
          submission_request_fingerprint: string | null
          submission_token: string | null
          submitted_at: string | null
          submitted_by_username: string | null
          submitted_evidence: Json | null
          submitted_inquiry: Json | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "ph_eval_work"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_manager_season_priority_v1: {
        Args: {
          p_actor_id: string
          p_expected_priority: number
          p_idempotency_token: string
          p_scope_fingerprint: string
          p_source_unique_id: string
        }
        Returns: Json
      }
      suspend_tag_command_v1: {
        Args: {
          p_actor_id: string
          p_command_id?: string
          p_expected_version?: number
          p_operation: string
          p_payload?: Json
          p_session_id?: string
        }
        Returns: Json
      }
      suspend_tag_push_receipt_v1: {
        Args: {
          p_approval_id: string
          p_delivered?: boolean
          p_endpoint: string
        }
        Returns: boolean
      }
      update_location_work_job_v1: {
        Args: {
          p_actor_username: string
          p_expected_revision: number
          p_general_instructions: string
          p_job_id: string
          p_title: string
        }
        Returns: {
          assigned_usernames: string[]
          assignment_event_id: string | null
          cancelled_at: string | null
          cancelled_by_username: string | null
          completed_at: string | null
          completed_by_username: string | null
          completion_event_id: string | null
          completion_recipient: Json
          created_at: string
          created_by_display: string
          created_by_profile_id: string
          created_by_username: string
          general_instructions: string
          id: string
          idempotency_key: string
          line_count: number
          resolved_line_count: number
          revision: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "ph_location_work_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_my_push_subscription: {
        Args: { subscription: Json }
        Returns: Json
      }
      v2_classify_hold_reason: { Args: { p_reason: string }; Returns: string }
      v2_crop_roll_completion_key_rows: {
        Args: { row_data: Json }
        Returns: {
          contsize: string
          itemcode: string
          key_type: string
          locationcode: string
          lotcode: string
          master_unique_id: string
          match_key: string
        }[]
      }
      v2_crop_roll_drive_row_from_json: {
        Args: { row_data: Json }
        Returns: {
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          caliper: string | null
          commonname: string | null
          contsize: string | null
          created_at: string
          crop_roll_view: string
          date_completed: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          fieldtagcolor: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_completed: string | null
          flyer_initial_ptr: string | null
          flyer_loc_match_qty: string | null
          flyer_match: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          genus: string | null
          genusname: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopreason: string | null
          initial_ptr: string | null
          itemcode: string | null
          itemspec: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          lotcode: string | null
          master_unique_id: string
          master_updated_at: string | null
          match: string | null
          photo_link: string | null
          photo_name: string | null
          plantgroupcode: string | null
          priority: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          qualitycode: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          saleyear: string | null
          search_text: string | null
          season: string | null
          season_supply: string | null
          source: string | null
          source_table: string
          spec: string | null
          unique_id: string
          updated_at: string
          warehouseid: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ph_crop_roll_drive_rows"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      v2_get_hold_event_date: {
        Args: {
          p_fallback?: string
          p_filename: string
          p_holdstopbegindate: string
        }
        Returns: string
      }
      v2_master_inventory_for_assigned_user: {
        Args: { p_username: string }
        Returns: {
          a_lts: string | null
          ai_lts: string | null
          altshipcomment: string | null
          app_tab_assignment: string | null
          assignedto: string | null
          av_note: string | null
          av_rule_av_note_updated_at: string | null
          av_rule_bundle_updated_at: string | null
          av_rule_caliper_updated_at: string | null
          av_rule_holdstop_snapshot: string | null
          av_rule_last_clear_reason: string | null
          av_rule_last_cleared_at: string | null
          av_rule_match_updated_at: string | null
          av_rule_photo_updated_at: string | null
          av_rule_priority_snapshot: string | null
          av_rule_spec_updated_at: string | null
          avg_price_eunit_shipped: string | null
          bay: string | null
          blockalpha: string | null
          blocknumber: string | null
          botanicalname: string | null
          brand: string | null
          bypassloc: string | null
          caliper: string | null
          carrier: string | null
          combinedprice: string | null
          commonname: string | null
          concat: string | null
          consigneeaddress_1: string | null
          consigneeaddress_2: string | null
          consigneecity: string | null
          consigneeidentityid: string | null
          consigneename: string | null
          consigneestate: string | null
          consigneezip: string | null
          containersort: string | null
          contsize: string | null
          customeridentityid: string | null
          customername: string | null
          customersku: string | null
          date_completed: string | null
          descriptorcode: string | null
          desigcust: string | null
          desigitem: string | null
          desigloc: string | null
          dock: string | null
          dock_caliper: string | null
          dock_note: string | null
          dock_num: string | null
          dock_photo_link: string | null
          dock_photo_name: string | null
          dock_spec: string | null
          dropweight: string | null
          end_cap_folder: string | null
          end_cap_level: string | null
          end_cap_qty: string | null
          equiv_unit: string | null
          equiv_uom: string | null
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
          ext_eunit_shipped: string | null
          ext_ptronhand: string | null
          ext_unit_merch_shipped: string | null
          extunitprice: string | null
          field_tag_color: string | null
          fieldtagcolor: string | null
          filename: string | null
          flyer_assigned: string | null
          flyer_av_note: string | null
          flyer_caliper: string | null
          flyer_cat: string | null
          flyer_completed: string | null
          flyer_initial_ptr: number | null
          flyer_inst: string | null
          flyer_loc_match_qty: number | null
          flyer_match: number | null
          flyer_notes: string | null
          flyer_photo_link: string | null
          flyer_photo_name: string | null
          flyer_pick: string | null
          flyer_spec: string | null
          flyer_title: string | null
          fnsalesnote: string | null
          formattedupc: string | null
          freightrateperitem: string | null
          generalloadinstr: string | null
          genusname: string | null
          grower: string | null
          handlingchargeperitem: string | null
          hardinesszone: string | null
          hlloadinstructions: string | null
          hold_release_approved_at: string | null
          hold_release_approved_by: string | null
          hold_release_approved_by_display: string | null
          hold_release_approved_holdstopbegindate: string | null
          holdstopbegindate: string | null
          holdstopcode: string | null
          holdstopenddate: string | null
          holdstopreason: string | null
          hsreasonbegin: string | null
          hz: string | null
          idgroup: string | null
          initial_ptr: string | null
          insurancegroup: string | null
          intercopo: string | null
          internalinvnote: string | null
          inventorynote: string | null
          invoicedate: string | null
          isreserve: string | null
          itemcode: string | null
          itemspec: string | null
          landed: string | null
          largeptrqty: string | null
          last_updated: string | null
          listprice: string | null
          loc_match_qty: string | null
          locationcode: string | null
          locationnote: string | null
          locationnotedate: string | null
          locationptn1: string | null
          locationptn2: string | null
          lochold: string | null
          lotcode: string | null
          match: string | null
          maxorderquantity: string | null
          mcstatus: string | null
          nationalaccount: string | null
          ncloadinstructions: string | null
          ncr_approval_message: string | null
          ncr_approval_type: string | null
          ncr_requested_at: string | null
          ncr_requested_by_display: string | null
          ncr_requested_by_email: string | null
          ncr_requested_by_username: string | null
          okloadinstructions: string | null
          ordertotal: string | null
          oversellpercentage: string | null
          photo_link: string | null
          photo_name: string | null
          pic_note: string | null
          picknote: string | null
          planstart: string | null
          plantgroupcode: string | null
          printedcontainercode: string | null
          priority: string | null
          prisetby: string | null
          priupdated: string | null
          ptravailable: string | null
          ptronhand: string | null
          ptrreviewed: string | null
          pullerresponsibility: string | null
          pulltagnote1: string | null
          pulltagnote2: string | null
          purchaseordernumber: string | null
          qa_code: string | null
          qualitycode: string | null
          quantityordered: string | null
          quantityshipped: string | null
          requestdate: string | null
          requestdateweek: string | null
          retailprice: string | null
          reversecommon: string | null
          s_lts: string | null
          sales_note: string | null
          salesnote: string | null
          salesnote_1: string | null
          salesnotebegindate: string | null
          salesrepid: string | null
          salesrepname: string | null
          saleyear: string | null
          season: string | null
          season_available: string | null
          season_demand: string | null
          season_oh: string | null
          season_supply: string | null
          shiptotelephone_1: string | null
          si_available: string | null
          si_lts: string | null
          sortnamevariety: string | null
          source: string | null
          spec: string | null
          specialpuller: string | null
          stagename: string | null
          step: string | null
          stopnumber: string | null
          suspend: string | null
          suspend_to: string | null
          suspendto: string | null
          tagcode: string | null
          tagdeptnote: string | null
          taggingchargeperitem: string | null
          transactionnumber: string | null
          tripnumber: string | null
          txloadinstructions: string | null
          unique_id: string
          unitprice: string | null
          varietycode: string | null
          warehousei: string | null
          warehouseid: string | null
          warehousename: string | null
          wingdingunits: string | null
          zonecode: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ph_master_inventory"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      v2_parse_hold_file_date: { Args: { p_value: string }; Returns: string }
      v2_refresh_hold_learning_from_drive_around_rows: {
        Args: { p_limit?: number }
        Returns: {
          hold_events_upserted: number
          release_cycles_upserted: number
        }[]
      }
      v2_refresh_hold_learning_from_drive_around_rows_range: {
        Args: { p_end_date?: string; p_limit?: number; p_start_date?: string }
        Returns: {
          hold_events_upserted: number
          release_cycles_upserted: number
        }[]
      }
      v2_refresh_hold_learning_profiles: { Args: never; Returns: number }
      v2_refresh_hold_learning_weather_features: {
        Args: { p_limit?: number }
        Returns: number
      }
      v2_refresh_hold_stop_itemcode_episode_learning: {
        Args: {
          p_end_date?: string
          p_start_date?: string
          p_weather_refresh_limit?: number
        }
        Returns: {
          hold_events_upserted: number
          itemcode_cycles: number
          profiles_refreshed: number
          release_cycles_upserted: number
          snapshot_rows: number
        }[]
      }
      validate_eval_work_delivery_v1: {
        Args: {
          p_event_type: string
          p_membership_signature: string
          p_work_id: string
        }
        Returns: Json
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

