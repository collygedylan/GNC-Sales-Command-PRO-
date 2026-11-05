import type { PostgrestSingleResponse, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../supabase/functions/_shared/database.types';

type Client = SupabaseClient<Database>;
type Employee = Pick<Database['public']['Tables']['core_employees']['Row'], 'id' | 'name' | 'emp_number' | 'department' | 'role' | 'hired_date' | 'vacation_balance'>;
type JobCode = Pick<Database['public']['Tables']['hr_job_codes']['Row'], 'job_code' | 'description'>;
type Timesheet = Pick<Database['public']['Tables']['labor_timesheets']['Row'], 'id' | 'employee_id' | 'work_date' | 'job_code' | 'hours'>;
type QueryResult<T> = PromiseLike<PostgrestSingleResponse<T>>;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const entrySchema = z.object({
  employee_id: z.string().uuid(), work_date: date, job_code: z.string().min(1),
  hours: z.number().finite().min(0).max(24),
}).strict();

export const commandCenterDatabase = {
  employees(client: Client): QueryResult<Employee[]> {
    return client.from('core_employees').select('id,name,emp_number,department,role,hired_date,vacation_balance')
      .eq('active', true).order('name').limit(200);
  },
  jobCodes(client: Client): QueryResult<JobCode[]> {
    return client.from('hr_job_codes').select('job_code,description').eq('enabled', true).order('job_code').limit(200);
  },
  timesheets(client: Client, start: unknown, end: unknown): QueryResult<Timesheet[]> {
    const first = date.parse(start);
    const last = date.parse(end);
    if (first > last) throw new Error('Invalid timesheet date range.');
    return client.from('labor_timesheets').select('id,employee_id,work_date,job_code,hours')
      .gte('work_date', first).lte('work_date', last).limit(1000);
  },
  saveTimesheet(client: Client, input: unknown, profileId: unknown): QueryResult<Timesheet> {
    const entry = entrySchema.parse(input);
    return client.from('labor_timesheets').upsert({ ...entry, created_by_profile_id: z.string().uuid().parse(profileId) },
      { onConflict: 'employee_id,work_date,job_code' }).select('id,employee_id,work_date,job_code,hours').single();
  },
};
