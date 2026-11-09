begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

-- Resolve current ownership on read for existing and newly ingested lines.
-- Preserve the physical SOC row, membership, evidence, grants and view shape.
do $migration$
declare
  prior text := pg_get_viewdef('public.ph_active_suspend'::regclass,true);
  changed text;
  route constant text := $route$(?s)CASE lower[(]btrim[(]COALESCE[(]tag_1[.]suspend_to, ''::text[)][)][)].*?ELSE COALESCE[(]exact[.]owner, families[.]owner, 'Unassigned'::text[)][[:space:]]+END[[:space:]]+END$route$;
  owner_value constant text := 'nullif(lower(btrim(exact.assignedto)), '''')';
begin
  if strpos(prior,'tag.suspend_eval_owner AS assignedto')>0 then return; end if;
  if cardinality(regexp_split_to_array(prior,route))<>3
    or cardinality(string_to_array(prior,'tag.assignedto,'))<>2 then
    raise exception 'SUSPEND_EXACT_OWNER_PROJECTION_CHANGED';
  end if;
  changed:=regexp_replace(prior,route,owner_value,'g');
  changed:=replace(changed,'tag.assignedto,','tag.suspend_eval_owner AS assignedto,');
  changed:=regexp_replace(changed,'(?s)WITH owners AS MATERIALIZED .*?SELECT tag_1[.]unique_id','SELECT tag_1.unique_id');
  changed:=regexp_replace(changed,
    'LEFT JOIN owners exact ON [^\n]+\n[[:blank:]]+LEFT JOIN families ON [^\n]+',
    $join$LEFT JOIN public.ph_itemcode_default_owners exact ON exact.itemcode_normalized =
      upper(case when btrim(tag_1.itemcode) ~ '^[0-9]{6}[.][0-9]{3}[.]$'
        then btrim(tag_1.itemcode)||'1' else btrim(tag_1.itemcode) end)$join$);
  if strpos(changed,'LEFT JOIN public.ph_itemcode_default_owners exact')=0
    or strpos(changed,'families')>0 or changed~'CASE lower[(]btrim[(]COALESCE[(]tag_1[.]suspend_to' then
    raise exception 'SUSPEND_EXACT_OWNER_JOIN_CHANGED';
  end if;
  execute 'CREATE OR REPLACE VIEW public.ph_active_suspend WITH (security_invoker=true) AS '||changed;
end
$migration$;

comment on view public.ph_active_suspend is
  'Active physical Suspend lines with evaluator ownership from the exact Assigned Items itemcode.';
notify pgrst, 'reload schema';
commit;
