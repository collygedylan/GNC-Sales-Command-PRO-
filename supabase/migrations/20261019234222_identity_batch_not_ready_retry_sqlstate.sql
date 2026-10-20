begin;

-- A source-not-ready or stale-revision guard is an expected, non-retryable
-- application outcome. SQLSTATE 40001 makes PostgREST retry the whole RPC
-- transaction automatically; use prerequisite-state SQLSTATE 55000 instead.
-- Keep the messages stable so app-api continues mapping these to 423/409.
do $migration$
declare
  definition text;
  old_not_ready text := $$raise exception using errcode='40001',message='MASTER_IDENTITY_SOURCE_NOT_READY';$$;
  new_not_ready text := $$raise exception using errcode='55000',message='MASTER_IDENTITY_SOURCE_NOT_READY';$$;
  old_revision text := $$raise exception using errcode='40001',message='MASTER_IDENTITY_REVISION_CHANGED';$$;
  new_revision text := $$raise exception using errcode='55000',message='MASTER_IDENTITY_REVISION_CHANGED';$$;
  function_oid oid := 'public.inventory_master_identity_batch_read_v1(uuid,jsonb,text)'::regprocedure;
  before_owner oid;
  before_acl aclitem[];
  before_config text[];
  before_security_definer boolean;
  after_owner oid;
  after_acl aclitem[];
  after_config text[];
  after_security_definer boolean;
  old_count integer;
  new_count integer;
begin
  select p.proowner,p.proacl,p.proconfig,p.prosecdef
  into before_owner,before_acl,before_config,before_security_definer
  from pg_proc p where p.oid=function_oid;
  definition := pg_get_functiondef(function_oid);

  old_count := (length(definition)-length(replace(definition,old_not_ready,''))) / length(old_not_ready);
  new_count := (length(definition)-length(replace(definition,new_not_ready,''))) / length(new_not_ready);
  if old_count=1 and new_count=0 then
    definition := replace(definition,old_not_ready,new_not_ready);
  elsif old_count<>0 or new_count<>1 then
    raise exception 'MASTER_IDENTITY_SOURCE_NOT_READY_PATCH_ANCHOR_INVALID';
  end if;

  old_count := (length(definition)-length(replace(definition,old_revision,''))) / length(old_revision);
  new_count := (length(definition)-length(replace(definition,new_revision,''))) / length(new_revision);
  if old_count=1 and new_count=0 then
    definition := replace(definition,old_revision,new_revision);
  elsif old_count<>0 or new_count<>1 then
    raise exception 'MASTER_IDENTITY_REVISION_CHANGED_PATCH_ANCHOR_INVALID';
  end if;

  execute definition;

  select p.proowner,p.proacl,p.proconfig,p.prosecdef
  into after_owner,after_acl,after_config,after_security_definer
  from pg_proc p where p.oid=function_oid;
  if after_owner is distinct from before_owner
     or after_acl is distinct from before_acl
     or after_config is distinct from before_config
     or after_security_definer is distinct from before_security_definer then
    raise exception 'MASTER_IDENTITY_RPC_SECURITY_CONTRACT_CHANGED';
  end if;
end
$migration$;

commit;
