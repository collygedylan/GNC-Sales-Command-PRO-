alter table public.v2_master_inventory
  add column if not exists eval_task_type text,
  add column if not exists eval_task_status text,
  add column if not exists eval_task_instructions text,
  add column if not exists eval_task_assigned_by text,
  add column if not exists eval_task_assigned_at timestamptz,
  add column if not exists eval_task_completed_by text,
  add column if not exists eval_task_completed_at timestamptz,
  add column if not exists eval_task_recount_qty numeric,
  add column if not exists eval_task_moved_up_qty numeric,
  add column if not exists eval_task_hold_action text,
  add column if not exists eval_task_hold_code text,
  add column if not exists eval_task_hold_reason text,
  add column if not exists eval_task_result_note text;

create index if not exists idx_v2_master_inventory_eval_tasks
  on public.v2_master_inventory (assignedto, eval_task_status, eval_task_type);

comment on column public.v2_master_inventory.eval_task_type is 'Open EVAL task type: recount, evaluate, or check-hold.';
comment on column public.v2_master_inventory.eval_task_status is 'EVAL task status, usually Open or Complete.';
comment on column public.v2_master_inventory.eval_task_instructions is 'Instructions shown to the assigned EVAL user in the Task tab.';
