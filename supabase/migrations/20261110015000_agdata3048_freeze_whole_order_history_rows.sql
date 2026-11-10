begin;
set local lock_timeout='4s';
set local statement_timeout='20s';

-- RESERVES and SOC both have a nullable column named source. Qualify the
-- whole row so the history snapshot never binds that scalar column instead.
do $snapshot$
declare
  definition text := pg_get_functiondef('private.freeze_erp_order_history_rows_v3046(text,text)'::regprocedure);
  anchor text := 'to_jsonb(source)';
begin
  if cardinality(string_to_array(definition,anchor))<>2 then
    raise exception 'ERP_ORDER_HISTORY_WHOLE_ROW_ANCHOR_MISSING';
  end if;
  execute replace(definition,anchor,'to_jsonb(source.*)');
end
$snapshot$;

commit;
