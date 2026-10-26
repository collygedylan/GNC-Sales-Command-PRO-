begin;

set local lock_timeout='5s';
set local statement_timeout='30s';

do $fix_functions$
declare
  function_oid regprocedure;
  function_definition text;
  old_expression constant text:='current_sales_year:=private.season_sales_year_v1(private.season_sales_settings_v1()->>''salesYear'');';
  new_expression constant text:='current_sales_year:=private.inventory_consolidation_sales_year_v2366(private.season_sales_settings_v1()->>''salesYear'',null);';
begin
  foreach function_oid in array array[
    'public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure,
    'public.create_location_work_job_v1(jsonb)'::regprocedure
  ]
  loop
    function_definition:=pg_get_functiondef(function_oid);
    if position(new_expression in function_definition)>0 then continue; end if;
    if position(old_expression in function_definition)=0 then
      raise exception using errcode='55000',message='INVENTORY_CONSOLIDATION_YEAR_FIX_SOURCE_MISMATCH';
    end if;
    execute replace(function_definition,old_expression,new_expression);
  end loop;
end
$fix_functions$;

do $assertions$
begin
  if position('inventory_consolidation_sales_year_v2366(private.season_sales_settings_v1()->>''salesYear'',null)'
      in pg_get_functiondef('public.inventory_consolidation_suggestions_v1(jsonb)'::regprocedure))=0
     or position('inventory_consolidation_sales_year_v2366(private.season_sales_settings_v1()->>''salesYear'',null)'
      in pg_get_functiondef('public.create_location_work_job_v1(jsonb)'::regprocedure))=0 then
    raise exception using errcode='55000',message='INVENTORY_CONSOLIDATION_YEAR_FIX_FAILED';
  end if;
end
$assertions$;

commit;
