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
