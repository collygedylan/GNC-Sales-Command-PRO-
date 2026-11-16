const tableNames=['app_dataset_revisions','app_row_actions','ph_action_discrepancies','ph_action_learning_rules'];
const rpcNames=['append_request_photo_intent_v3079','authorize_photo_upload_v3074','authorize_reclass_command_v3076',
  'authorize_request_photo_intent_v3079','begin_pending_erp_stage_v3070','can_reclass_y_administrator_v3076',
  'can_write_photo_object_v3074','complete_request_with_photo_intents_v3079','manager_action_discrepancies_v3070',
  'read_reviewed_watchdog_events_v3074','record_erp_stage_checked_v3070','request_completion_dispatch_rows_v3065',
  'resolve_runtime_watchdog_events_v23158','resume_erp_stage_publication_v3077','resume_failed_erp_sync_run_v3077'];

export function extractCurrentSchemaContracts(contracts) {
  const selected={};
  for(const kind of ['tables','functions','functionReturns']) {
    const names=kind==='tables'?tableNames:rpcNames;
    selected[kind]=Object.fromEntries(names.map(name=>[name,contracts[kind][name]]));
    if(Object.values(selected[kind]).some(value=>value===undefined)) throw Error('DATABASE_CURRENT_SCHEMA_CONTRACT_MISSING:'+kind);
  }
  for(const [kind,values] of Object.entries(selected)) {
    for(const name of Object.keys(values)) delete contracts[kind][name];
  }
  return selected;
}

function declaration(kind,name,values,format) {
  const keys=Object.keys(values).map(key=>JSON.stringify(key)).join(' | ');
  return `export const ${name}: Pick<RuntimeContracts<Database>['${kind}'], ${keys}> = ${format(values)};\n`;
}

export function writeCurrentSchemaContractParts({root,contracts,imports,check,header,format,write}) {
  const selected=extractCurrentSchemaContracts(contracts);
  const tableFile='current-schema-table-contracts.generated.ts',rpcFile='current-schema-rpc-contracts.generated.ts';
  const tables=declaration('tables','currentSchemaTables',selected.tables,format);
  const rpc=declaration('functions','currentSchemaArgs',selected.functions,format)
    +declaration('functionReturns','currentSchemaReturns',selected.functionReturns,format);
  const files=[[tableFile,header+imports+tables],[rpcFile,header+imports+rpc]];
  if(files.some(([,content])=>content.split('\n').length>400)) throw Error('DATABASE_CURRENT_SCHEMA_CONTRACT_PART_TOO_LARGE');
  for(const [file,content] of files) write(root,'services/'+file,content,check);
  return {
    imports:`import { currentSchemaTables } from './${tableFile}';\nimport { currentSchemaArgs, currentSchemaReturns } from './${rpcFile}';\n`,
    tables:'    ...currentSchemaTables,\n',functions:'    ...currentSchemaArgs,\n',functionReturns:'    ...currentSchemaReturns,\n',
  };
}
