begin;

create index if not exists ph_eval_work_assignment_event_idx
    on public.ph_eval_work (assignment_event_id)
    where assignment_event_id is not null;

create index if not exists ph_eval_work_completion_event_idx
    on public.ph_eval_work (completion_event_id)
    where completion_event_id is not null;

commit;
