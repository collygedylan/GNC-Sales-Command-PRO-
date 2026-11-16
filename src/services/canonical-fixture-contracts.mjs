export function replaceFixtureText(source,before,after) {
  if(source.split(before).length!==2) throw new Error('CANONICAL_FIXTURE_CONTRACT_ANCHOR_CHANGED:'+before);
  return source.replace(before,after);
}

export function currentRecipientContract(source) {
  const before="position('result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_payload);' in wrapper_sql)>0";
  const after="position('result:=private.run_scoped_reclass_inquiry_v3076(actor.id,p_payload);' in wrapper_sql)>0\n"+
    "  and position('result:=private.enqueue_drive_reclass_inquiry_v7_rep_impl(p_command);' in regexp_replace(lower(pg_get_functiondef("+
    "'private.run_scoped_reclass_inquiry_v3076(uuid,jsonb)'::regprocedure)),'[[:space:]]+','','g'))>0\n"+
    "  and position('public.authorize_reclass_command_v3076' in lower(pg_get_functiondef("+
    "'private.run_scoped_reclass_inquiry_v3076(uuid,jsonb)'::regprocedure)))>0";
  return replaceFixtureText(source,before,after);
}

export function currentPhotoContract(source) {
  let result=replaceFixtureText(source,"'27.f1','[]')","'27.f1','[{\"unique_id\":\"CI-PHOTO-INDEX-1\"}]')");
  result=replaceFixtureText(result,"'missing','[]')","'missing','[{\"unique_id\":\"CI-PHOTO-INDEX-1\"}]')");
  result=replaceFixtureText(result,"'https://fixture.invalid/exact,https://fixture.invalid/other-lot','missing lot falls back within the exact location'",
    "'','a missing exact lot never merges another physical row'");
  return replaceFixtureText(result,"'','CI-BAY','27.F1','[]')","'','CI-BAY','27.F1','[{\"unique_id\":\"CI-PHOTO-INDEX-5\"}]')");
}

export function currentFolderContract(source) {
  let result=replaceFixtureText(source,'effective_qty,is_default_qty,sales_rep,customer_name,customer_consignee_label)',
    'effective_qty,is_default_qty,sales_rep,customer_name,customer_consignee_label,last_event)');
  result=replaceFixtureText(result,"'Queue Customer / Queue Consignee'),","'Queue Customer / Queue Consignee','completed'),");
  return replaceFixtureText(result,"'Queue Customer / Queue Consignee');","'Queue Customer / Queue Consignee','completed');");
}

export function currentSuspendContract(source) {
  const result=replaceFixtureText(source,"close_branch not like '%ph_master_inventory%'",
    "close_branch !~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+public[.]ph_master_inventory'");
  return replaceFixtureText(result,"prosrc like '%set date_completed=null where unique_id=uid%'",
    "prosrc like '%set date_completed=null where unique_id=uid returning * into s%'");
}

export function currentReclassDenials(source,file) {
  let result=source;
  if(file.includes('inventory_reclass_moves_v1')) result=replaceFixtureText(result,
    "'42501','DRIVE_RECLASS_ROW_NOT_ASSIGNED','evaluators cannot submit moves for rows outside their assigned inventory'",
    "'42501','DRIVE_RECLASS_FORBIDDEN','evaluators cannot submit moves for rows outside their assigned inventory'");
  if(file.includes('reclass_server_revision')) {
    result=replaceFixtureText(result,"'PT409','INVENTORY_RECLASS_SOURCE_MISSING','missing global watermark never permits a missing physical source'",
      "'42501','DRIVE_RECLASS_FORBIDDEN','missing global watermark never permits a missing physical source'");
    result=replaceFixtureText(result,"'42501','DRIVE_RECLASS_PROFILE_NOT_ACTIVE','server revision resolution does not bypass current actor authorization'",
      "'42501','DRIVE_RECLASS_FORBIDDEN','server revision resolution does not bypass current actor authorization'");
  }
  if(file.includes('sales_rep_inventory_operations')) result=replaceFixtureText(result,
    "'42501','DRIVE_RECLASS_PROFILE_NOT_ACTIVE','Locked actor cannot submit operations'",
    "'42501','DRIVE_RECLASS_FORBIDDEN','Locked actor cannot submit operations'");
  return result;
}

export function currentReclassLedgerContract(source,read) {
  const marker="  if exists(select 1 from jsonb_array_elements(result_value->'rows') e(value)";
  if(!source.includes(marker)) throw new Error('CANONICAL_RECLASS_LEDGER_CROP_BOUNDARY_CHANGED');
  source=replaceFixtureText(source,
    "locationcode,lotcode,ptronhand,ptravailable,source,season,saleyear)\nselect 'reclass-existing-u1-'",
    "locationcode,lotcode,ptronhand,ptravailable,s_lts,source,season,saleyear)\nselect 'reclass-existing-u1-'");
  source=replaceFixtureText(source,"  '10','8','PH','U1','27';","  '10','8','8','PH','U1','27';");
  source=currentReclassImportEnvelope(source,read);
  const start=source.indexOf(marker);
  const end=source.indexOf("  if (select count(*) from public.ph_inventory_transactions",start);
  if(start<0||end<=start) throw new Error('CANONICAL_RECLASS_LEDGER_CROP_BOUNDARY_CHANGED');
  const check="  if exists(select 1 from jsonb_array_elements(result_value->'rows') e(value)\n"+
    "    left join public.ph_master_inventory master on master.unique_id=e.value#>>'{row,unique_id}'\n"+
    "    where master.unique_id is null or e.value->'row' is distinct from to_jsonb(master))\n"+
    "    or exists(select 1 from public.ph_crop_roll_drive_rows crop\n"+
    "      join jsonb_array_elements(result_value->'rows') e(value) on crop.master_unique_id=e.value#>>'{row,unique_id}')\n"+
    "    or not (select count(*)=3 and bool_and(tgenabled='D') from pg_trigger\n"+
    "      where tgrelid='public.ph_master_inventory'::regclass and tgname=any(array[\n"+
    "        'trg_v2_master_inventory_crop_roll_drive_rows','trg_v2_master_inventory_crop_roll_drive_rows_insert',\n"+
    "        'trg_v2_master_inventory_crop_roll_drive_rows_delete'])) then\n"+
    "    raise exception 'canonical movement receipt differs or retired crop publication was revived';\n  end if;\n";
  return source.slice(0,start)+check+source.slice(end);
}

function currentReclassImportEnvelope(source,read) {
  const pattern=/(public\.bulk_import_master_snapshot_v1\(run_id,'b4000000-0000-4000-8000-00000000000[1-9]',)(imported_rows|pre_rows|intermediate_rows)(,repeat\('[a-f]',64\)\))/g;
  const matches=[...source.matchAll(pattern)];
  if(matches.length!==9) throw new Error('CANONICAL_RECLASS_IMPORT_ENVELOPE_COUNT_CHANGED');
  const helper=read('src/services/canonical-runtime-fixtures/import-envelope.sql');
  const result=source.replace(pattern,(_,before,rows,after)=>before+'pg_temp.reclass_erp_file_rows_v1('+rows+')'+after);
  return replaceFixtureText(result,'select plan(60);','select plan(60);\n'+helper);
}

export function currentSmartPublicContract(source) {
  const start=source.indexOf('create function pg_temp.v6_public_rpc_payload(');
  const end=source.indexOf('-- Eval Work uses the same V6 live transaction',start);
  if(start<0||end<=start) throw new Error('CANONICAL_SMART_PUBLIC_PAYLOAD_BOUNDARY_CHANGED');
  const legacy='reclass-action-workflow-v6-smart-shield-20261009';
  const current='reclass-action-workflow-v7-editable-fields-20261009';
  const tail=source.slice(start,end);
  if(!tail.includes('public.enqueue_drive_reclass_inquiry_v6(')) throw new Error('CANONICAL_SMART_PUBLIC_ROUTE_CHANGED');
  const call="pg_temp.v6_public_rpc_payload('smart-shield-v6-eval-token-0001','7','8')";
  const evalWork=replaceFixtureText(source.slice(end),call,
    `jsonb_set(${call},'{workflowPolicyVersion}','"${legacy}"'::jsonb)`);
  return source.slice(0,start)+tail.replaceAll('public.enqueue_drive_reclass_inquiry_v6(',
    'public.enqueue_drive_reclass_inquiry_v7(').replaceAll(legacy,current)+evalWork;
}
