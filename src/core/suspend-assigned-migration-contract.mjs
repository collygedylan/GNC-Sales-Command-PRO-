export const suspendAssignedMigrationName = '20261111061223_suspend_assigned_items_scope.sql';

export const suspendAssignedMigrationContracts = Object.freeze({
    [suspendAssignedMigrationName]: `select
      to_regprocedure('suspend_tag_private.assigned_owner_v3068(text,text,text)') is not null
      and position('suspend_owner_zone_override' in pg_get_viewdef('public.ph_active_suspend'::regclass,true))>0
      and position('assigned_owner_v3068' in pg_get_viewdef('public.ph_active_suspend'::regclass,true))>0
      and position('exact.assignedto' in pg_get_viewdef('public.ph_active_suspend'::regclass,true))=0
      and position('require_row_owner_v3068' in pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
      and position('can_work_row_v3068(actor,r)' in pg_get_functiondef('suspend_tag_private.command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
      and position('require_row_owner_v3068' in pg_get_functiondef('suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
      and position('is_admin_v3068(p.role)' in pg_get_functiondef('private.queue_scope_actor_v23159(text)'::regprocedure))>0
      and not has_function_privilege('authenticated','suspend_tag_private.require_row_owner_v3068(public.profiles,public.ph_soc_master)','execute')
      and not has_function_privilege('anon','suspend_tag_private.can_work_row_v3068(public.profiles,public.ph_soc_master)','execute')
      and (select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.ph_active_suspend'::regclass)
      as installed`
});
