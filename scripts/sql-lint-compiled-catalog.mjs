const definitions=[
  ['build_compiled_drive_order_delta_v3078',[],[]],
  ['build_drive_ordinal_edges_v3082',['boolean'],['p_compiled']],
  ['build_drive_publication_input_v3078',['uuid','integer','text'],['p_stage_id','p_expected','p_canonical'],['digest text;','compact jsonb;']],
  ['capture_drive_order_delta_v3078',[],[]],
  ['compile_master_bulk_stage_v3077',[],[]],
  ['load_drive_fast_parts_v3078',['uuid','integer'],['p_stage_id','p_expected']],
  ['load_drive_preparation_seal_v3078',['uuid'],['p_stage_id'],['seal private.erp_drive_preparation_seals_v3078%rowtype;']],
  ['load_drive_typed_checkpoint_v3077',['uuid'],['p_stage_id']],
  ['load_drive_work_v3078',['uuid'],['p_stage']],
  ['open_drive_decode_input_v3078',['jsonb'],['p_rows']],
  ['open_master_bulk_temp_context_v3046',['uuid','uuid'],['p_run','p_request']],
  ['plan_drive_row_assignments_v3047',['bigint'],['p_source_revision']],
  ['prepare_drive_lineage_work_v3082',[],[]],
  ['prepare_drive_pending_ack_v3084',[],[]],
  ['prepare_master_bulk_stage_v3046',['jsonb'],['p_rows']],
  ['reconcile_drive_item6_location_notes_v3084',['uuid'],['p_run_id']],
];

export const compiledDuplicateTables=Object.freeze({
  'private.build_drive_ordinal_edges_v3082':{ph_master_ordinal_edges:2},
  'public.bulk_import_master_snapshot_v2374_base':{ph_master_bulk_prior_alias_v3046:2},
});

function compiledEntry([name,args,names,locals=[]]) {
  const qualifiedName='private.'+name;
  return [qualifiedName,{args,declarations:[...names.map((name,index)=>`${name} ${args[index]};`),...locals],
    contextTables:[],compiledEpoch:true,compiledProbe:true,probeGroup:'compiled:'+qualifiedName,
    duplicateTables:compiledDuplicateTables[qualifiedName]}];
}

export const compiledTempContexts=Object.freeze(Object.fromEntries(definitions.map(compiledEntry)));
const consumers=new Set(['private.apply_inventory_live_overrides_bulk_v1','private.apply_inventory_reclass_import_overlay_v1',
  'public.bulk_import_master_snapshot_v1','public.bulk_import_master_snapshot_v2374_base']);

export function compiledTempSpecification(name,body,specification,compiledEpoch) {
  if(!specification) return specification;
  if(name==='public.apply_inventory_reclass_move_v1'
    && body.includes('private.require_reclass_capability_v3076(')
    && body.includes("actor_username := lower(btrim(coalesce(actor_profile.username,'')));") ) {
    return {...specification,declarations:['destination_season text;','destination_lot text;']};
  }
  const currentBulk=name==='public.bulk_import_master_snapshot_v2374_base'
    && body.includes('private.prepare_master_bulk_stage_v3046(p_rows)');
  if((!compiledEpoch && !currentBulk) || !consumers.has(name)) return specification;
  if(name==='public.bulk_import_master_snapshot_v2374_base'
    && !body.includes('private.prepare_master_bulk_stage_v3046(p_rows)')) return specification;
  const declarations=name==='public.bulk_import_master_snapshot_v2374_base'?[]:specification.declarations;
  return {...specification,declarations,legacyDeclaration:undefined,compiledProbe:true,
    probeGroup:'compiled:'+name,duplicateTables:compiledDuplicateTables[name]};
}
