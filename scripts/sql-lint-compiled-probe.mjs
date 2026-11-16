import {compiledDuplicateTables} from './sql-lint-compiled-catalog.mjs';

const identifier=/^[a-z_][a-z0-9_$]*$/i;
function quoted(name) {
  if(!identifier.test(name)) throw new Error('SQL_LINT_TEMP_CONTEXT_IDENTIFIER_INVALID');
  return '"'+name+'"';
}

function sourceFunction(inventory,name) {
  const source=inventory.get(name);
  if(!source) throw new Error('SQL_LINT_COMPILED_SETUP_PRODUCER_MISSING:'+name);
  return source;
}

function tableStatement(inventory,extract,owner,name,index=0) {
  const source=sourceFunction(inventory,owner);
  const statements=extract(source.body,owner,{duplicateTables:compiledDuplicateTables[owner],allowNoData:true});
  const statement=statements.filter(statement=>statement.name.toLowerCase()===name)[index];
  if(!statement) throw new Error('SQL_LINT_COMPILED_SETUP_TABLE_MISSING:'+owner+':'+name);
  return statement.statement;
}

function contextView(inventory) {
  const body=sourceFunction(inventory,'private.open_master_bulk_temp_context_v3046').body;
  const view=body.match(/\$view\$(create temp view ph_master_bulk_context_v3046 as[\s\S]*?)\$view\$/i)?.[1];
  if(!view || (view.match(/%L/g)||[]).length!==4
    || !/\$view\$\s*,\s*p_run\s*,\s*p_request\s*,\s*backend\s*,\s*transaction_id\s*\)/i.test(body)) {
    throw new Error('SQL_LINT_COMPILED_CONTEXT_VIEW_DRIFT');
  }
  const table=view.replace(/^create temp view ph_master_bulk_context_v3046 as/i,
    'create temp table ph_master_bulk_context_v3046 on commit drop as');
  return `EXECUTE format($lint_context_view$${table} WITH NO DATA;$lint_context_view$,
    NULL::uuid,NULL::uuid,NULL::integer,NULL::bigint);`;
}

function compiledSetup(item,extract) {
  const inventory=item.probeInventory;
  const work=sourceFunction(inventory,'private.load_drive_work_v3078').body;
  if(!/attname\s*<>\s*'stage_id'/.test(work)
    || !/create temp view ph_master_bulk_stage_v1 with\(security_invoker=true\) as select %s/i.test(work)) {
    throw new Error('SQL_LINT_COMPILED_STAGE_VIEW_DRIFT');
  }
  const pick=(owner,name)=>tableStatement(inventory,extract,'private.'+owner,name);
  const steps=[
    'CREATE TEMP TABLE ph_master_bulk_stage_v1 ON COMMIT DROP AS SELECT * FROM private.erp_drive_compiled_rows_v3078 WITH NO DATA;',
    'ALTER TABLE pg_temp.ph_master_bulk_stage_v1 DROP COLUMN stage_id;',
    pick('load_drive_work_v3078','agdata_drive_work_binding_v3078'),
    pick('open_drive_decode_input_v3078','erp_drive_decode_input_v3078'),
    pick('prepare_drive_lineage_work_v3082','staged_lineage_v3082'),
    pick('prepare_drive_lineage_work_v3082','live_lineage_v3082'),
    tableStatement(inventory,extract,'public.bulk_import_master_snapshot_v2374_base','ph_master_bulk_prior_alias_v3046'),
    tableStatement(inventory,extract,'public.bulk_import_master_snapshot_v2374_base','ph_master_bulk_map_v1'),
    pick('build_compiled_drive_order_delta_v3078','erp_order_delta_v23196'),
    pick('load_drive_work_v3078','ph_master_bulk_tuples_v3046'),
    pick('build_drive_publication_input_v3078','agdata_drive_publication_input_v3042'),
    pick('open_master_bulk_temp_context_v3046','ph_master_bulk_context_keys_v3046'),
    contextView(inventory),
    pick('build_drive_ordinal_edges_v3082','ph_master_ordinal_edges'),
  ];
  return `DO $lint_compiled_setup$ DECLARE p_rows jsonb; p_stage uuid; p_stage_id uuid; compact jsonb; digest text;
    BEGIN\n${steps.join('\n')}\nEND $lint_compiled_setup$;`;
}

function captureShapes(names) {
  const values=names.map(name=>{quoted(name);return "'"+name+"'";}).join(',');
  return `INSERT INTO pg_temp.gnc_lint_temp_shapes(name,shape)
    SELECT c.relname,jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE c.relnamespace=pg_my_temp_schema() AND c.relname=ANY(ARRAY[${values}]::text[])
    GROUP BY c.oid,c.relname;`;
}

export function compiledProbeSql(item,extract) {
  const declarations=item.specification.declarations.length
    ?'DECLARE\n'+item.specification.declarations.join('\n')+'\n':'';
  const steps=item.variants.map((statement,index)=>`DO $lint_compiled_variant_${index}$\n${declarations}BEGIN
    DROP TABLE IF EXISTS pg_temp.${quoted(statement.name)};
    ${statement.statement}\nEND $lint_compiled_variant_${index}$;\n${captureShapes([statement.name])}`);
  return `BEGIN;\n${compiledSetup(item,extract)}
    CREATE TEMP TABLE gnc_lint_temp_shapes(name text,shape jsonb) ON COMMIT DROP;
    ${captureShapes(item.specification.contextTables)}\n${steps.join('\n')}
    DO $lint_compiled_shape_check$ BEGIN
      IF EXISTS(SELECT name FROM pg_temp.gnc_lint_temp_shapes GROUP BY name HAVING count(DISTINCT shape)>1)
      THEN RAISE EXCEPTION 'SQL_LINT_TEMP_CONTEXT_VARIANT_SHAPE_CHANGED'; END IF;
    END $lint_compiled_shape_check$;
    SELECT 'SQL_LINT_SHAPES:'||replace(encode(convert_to(coalesce(jsonb_agg(jsonb_build_object(
      'name',name,'columns',shape) ORDER BY name),'[]'::jsonb)::text,'UTF8'),'base64'),E'\\n','')
    FROM(SELECT DISTINCT name,shape FROM pg_temp.gnc_lint_temp_shapes) shapes;
    ROLLBACK;\n`;
}
