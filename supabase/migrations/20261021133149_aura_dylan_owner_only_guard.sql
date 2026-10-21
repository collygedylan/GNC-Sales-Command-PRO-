begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Keep the existing SECURITY DEFINER body, grants, rollout flag and capability
-- calculation while making the authenticated profile identity the sole gate.
do $$
declare
  definition text;
  old_gate text:='if actor.id is null or (actor_role not in (''ADMIN'',''ADMINISTRATOR'',''MANAGER'',''REP'',''SALESREP'',''CSR'') and actor.username<>''dylan_collyge'')';
  new_gate text:='if actor.id is null or coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''';
  context_old_gate text:=$old$if actor.id is null or (upper(regexp_replace(coalesce(actor.role,''),'^[[:space:]]+|[[:space:]]+$','','g')) not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR')
      and actor.username<>'dylan_collyge')$old$;
  context_new_gate text:=$new$if actor.id is null or coalesce(lower(btrim(actor.username)),'')<>'dylan_collyge'$new$;
  context_definition text;
  inventory_definition text;
  soc_definition text;
  soc_old_gate text:=$old$if actor.id is null or (actor_role not in ('ADMIN','ADMINISTRATOR','MANAGER','REP','SALESREP','CSR') and actor_name<>'dylan_collyge')$old$;
  soc_new_gate text:=$new$if actor.id is null or coalesce(lower(btrim(actor_name)),'')<>'dylan_collyge'$new$;
begin
  definition:=pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure);
  if length(definition)-length(replace(definition,old_gate,''))<>length(old_gate) then
    raise exception 'AURA_OWNER_ACCESS_CONTRACT_MISMATCH';
  end if;
  definition:=replace(definition,old_gate,new_gate);
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in definition)=0 then
    raise exception 'AURA_OWNER_ACCESS_GUARD_MISSING';
  end if;
  execute definition;

  context_definition:=pg_get_functiondef('public.aura_voice_context_v1()'::regprocedure);
  if length(context_definition)-length(replace(context_definition,context_old_gate,''))<>length(context_old_gate) then
    raise exception 'AURA_OWNER_CONTEXT_CONTRACT_MISMATCH';
  end if;
  context_definition:=replace(context_definition,context_old_gate,context_new_gate);
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in context_definition)=0 then
    raise exception 'AURA_OWNER_CONTEXT_GUARD_MISSING';
  end if;
  execute context_definition;

  inventory_definition:=pg_get_functiondef('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if length(inventory_definition)-length(replace(inventory_definition,old_gate,''))<>length(old_gate) then
    raise exception 'AURA_OWNER_INVENTORY_CONTRACT_MISMATCH';
  end if;
  inventory_definition:=replace(inventory_definition,old_gate,new_gate);
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in inventory_definition)=0 then
    raise exception 'AURA_OWNER_INVENTORY_GUARD_MISSING';
  end if;
  execute inventory_definition;

  soc_definition:=pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure);
  if length(soc_definition)-length(replace(soc_definition,soc_old_gate,''))<>length(soc_old_gate) then
    raise exception 'AURA_OWNER_SOC_CONTRACT_MISMATCH';
  end if;
  soc_definition:=replace(soc_definition,soc_old_gate,soc_new_gate);
  if position('coalesce(lower(btrim(actor_name)),'''')<>''dylan_collyge''' in soc_definition)=0 then
    raise exception 'AURA_OWNER_SOC_GUARD_MISSING';
  end if;
  execute soc_definition;
end $$;

do $$
begin
  if not has_function_privilege('authenticated','public.aura_voice_access_v1()','EXECUTE')
    or has_function_privilege('anon','public.aura_voice_access_v1()','EXECUTE')
    or has_function_privilege('service_role','public.aura_voice_access_v1()','EXECUTE') then
    raise exception 'AURA_ACCESS_RPC_GRANTS_CHANGED';
  end if;
  if not has_function_privilege('authenticated','public.aura_voice_context_v1()','EXECUTE')
    or has_function_privilege('anon','public.aura_voice_context_v1()','EXECUTE')
    or not has_function_privilege('authenticated','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','EXECUTE')
    or has_function_privilege('anon','public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','EXECUTE')
    or has_function_privilege('anon','public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)','EXECUTE') then
    raise exception 'AURA_READ_RPC_GRANTS_CHANGED';
  end if;
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in
      pg_get_functiondef('public.aura_voice_access_v1()'::regprocedure))=0 then
    raise exception 'AURA_OWNER_ACCESS_ASSERTION_FAILED';
  end if;
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in
      pg_get_functiondef('public.aura_voice_context_v1()'::regprocedure))=0 then
    raise exception 'AURA_OWNER_CONTEXT_ASSERTION_FAILED';
  end if;
  if position('coalesce(lower(btrim(actor.username)),'''')<>''dylan_collyge''' in
      pg_get_functiondef('public.aura_voice_inventory_read_v1(text,jsonb,jsonb,integer)'::regprocedure))=0 then
    raise exception 'AURA_OWNER_INVENTORY_ASSERTION_FAILED';
  end if;
  if position('coalesce(lower(btrim(actor_name)),'''')<>''dylan_collyge''' in
      pg_get_functiondef('public.aura_voice_soc_read_v1(text,jsonb,jsonb,integer)'::regprocedure))=0 then
    raise exception 'AURA_OWNER_SOC_ASSERTION_FAILED';
  end if;
end $$;
commit;
