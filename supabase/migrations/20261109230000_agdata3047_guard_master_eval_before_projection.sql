begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- Both functions are installed on the master table. A missing eval
-- GUC is NULL, so the old AND could still evaluate the whole-row JSON operand.
-- Keep the existing authenticated bulk return and exact editor bypass.
do $guard$
declare
  canonical regprocedure := 'private.sync_master_inventory_canonical_v2362()'::regprocedure;
  evidence regprocedure := 'private.apply_inventory_location_evidence_v1()'::regprocedure;
  definition text := pg_get_functiondef(canonical);
  edit_at integer := strpos(definition,'  IF current_setting(''app.eval_publication_v309'',true)');
  bulk_at integer := strpos(definition,'  if tg_table_schema=''public'' and tg_table_name in');
  next_path text := '  if tg_op=''UPDATE'' and not guard_enabled';
  bulk_end integer := strpos(definition,next_path);
  guard_value text := 'coalesce(current_setting(''gnc.inventory_location_evidence_apply'',true),'''')=''on''';
  guard_declaration text := 'guard_enabled boolean:='||guard_value||';';
begin
  if exists(select 1 from pg_trigger t where t.tgfoid in (canonical,evidence)
    and t.tgrelid<>'public.ph_master_inventory'::regclass) then
    raise exception 'ERP_MASTER_EVAL_TRIGGER_RELATION_CHANGED';
  end if;
  if edit_at=0 or bulk_at<=edit_at or bulk_end<=bulk_at or strpos(definition,guard_declaration)=0 then
    raise exception 'ERP_MASTER_CANONICAL_EVAL_GUARD_ANCHOR_MISSING';
  end if;
  definition:=overlay(definition placing substring(definition from bulk_at for bulk_end-bulk_at)
    || $exact$  if current_setting('app.eval_publication_v309',true)='on'
    and current_setting('app.eval_publication_uid_v309',true)=new.unique_id then return new; end if;
$exact$ from edit_at for bulk_end-edit_at);
  definition:=replace(definition,guard_declaration,'guard_enabled boolean;');
  execute replace(definition,next_path,'  guard_enabled:='||guard_value||';'||chr(10)||next_path);

  definition:=pg_get_functiondef(evidence);
  if strpos(definition,guard_declaration)=0 or strpos(definition,next_path)=0
    or strpos(definition,'=new.unique_id')=0 then
    raise exception 'ERP_MASTER_LOCATION_EVAL_GUARD_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,guard_declaration,'guard_enabled boolean;');
  execute replace(definition,next_path,'  guard_enabled:='||guard_value||';'||chr(10)||next_path);
end
$guard$;

-- Actor lookup belongs to the actual evidence write. Existing bulk and
-- unchanged-evidence returns neither consume nor validate an edit actor.
do $capture$
declare
  definition text := pg_get_functiondef('private.capture_inventory_location_evidence_v1()'::regprocedure);
  guard_value text := 'coalesce(current_setting(''gnc.inventory_location_evidence_apply'',true),'''')';
  actor_value text := 'coalesce(nullif(current_setting(''gnc.inventory_edit_actor'',true),''''),auth.uid()::text,''system'')';
  guard_declaration text := 'previous_guard text:='||guard_value||';';
  actor_declaration text := 'actor text:='||actor_value||';';
  gate_at text := '  if private.ph_master_inventory_import_run_v1() is not null or previous_guard=''on''';
  write_at text := '  insert into app_sync_private.inventory_location_evidence_v1 as stored(';
begin
  if strpos(definition,guard_declaration)=0 or strpos(definition,actor_declaration)=0
    or strpos(definition,gate_at)=0 or strpos(definition,write_at)=0 then
    raise exception 'ERP_MASTER_CAPTURE_EVAL_GUARD_ANCHOR_MISSING';
  end if;
  definition:=replace(definition,guard_declaration,'previous_guard text;');
  definition:=replace(definition,actor_declaration,'actor text;');
  definition:=replace(definition,gate_at,'  previous_guard:='||guard_value||';'||chr(10)||gate_at);
  execute replace(definition,write_at,'  actor:='||actor_value||';'||chr(10)||write_at);
end
$capture$;
commit;
