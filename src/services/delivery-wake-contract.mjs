export const deliveryWakeTransitionsMigration = '20261115194846_bound_delivery_wake_transitions.sql';
export function deliveryWakeTransitionsContract() {
    return `select exists(select 1 from pg_trigger
      where tgrelid='public.ph_request_delivery_outbox'::regclass
        and tgname='ph_request_delivery_outbox_wake' and tgenabled='O'
        and tgnewtable='inserted_delivery_events')
      and position('inserted_delivery_events' in pg_get_functiondef(
        'private.wake_request_delivery_worker_after_insert()'::regprocedure))>0
      and position('FOLDER_COMPLETION_STALE' in pg_get_functiondef(
        'private.wake_request_delivery_worker_after_requeue()'::regprocedure))>0
      and position('old.next_attempt_at is distinct from new.next_attempt_at' in pg_get_functiondef(
        'private.wake_request_delivery_worker_after_requeue()'::regprocedure))>0
      and not has_function_privilege('authenticated',
        'private.wake_request_delivery_worker_after_insert()','execute')
      as installed`;
}
