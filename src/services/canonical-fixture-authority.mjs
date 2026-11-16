import {sqlStatements} from '../../scripts/database-catalog.mjs';

const reclassPermissions={can_submit_reclass:true,can_access_drive_mode:true,can_access_av:true,
  can_access_que:true,can_access_manager_tab:true,can_access_eval_reports_2:true};

function matrixStatement(statement,template,{reclass=false,rep=false,profile=false}={}) {
  const permissions=rep?{...reclassPermissions,can_access_av:false,can_access_que:false,
    can_access_manager_tab:false,can_access_eval_reports_2:false}:reclass?reclassPermissions:{};
  const setup=template.replace('__RECLASS_FLAG__',reclass?"'Y'":"'N'")
    .replace('__PERMISSION_OVERRIDES__',"'"+JSON.stringify(permissions)+"'");
  if(profile) {
    const username=rep?'operations_rep':'conflict_http_fixture';
    return `${statement}\nWITH fixture_admitted AS (SELECT id AS profile_id FROM public.profiles WHERE username='${username}'),\n${setup}`;
  }
  return `WITH fixture_admitted AS (\n${statement.trim().replace(/;$/,'')} RETURNING profile_id\n),\n${setup}`;
}

export function grantCanonicalFixtureAuthority(source,template,mode) {
  const statements=sqlStatements(source);
  const matches=statements.filter(statement=>mode==='reclass'
    ? /insert\s+into\s+private\.app_access_user_overrides\s*\(/i.test(statement)
      && /'drive\.reclass\.submit',true,'global'/.test(statement.replace(/\s+/g,''))
    : /insert\s+into\s+public\.profiles\s*\(/i.test(statement)
      && statement.includes(mode==='rep'?"'operations_rep'":"'conflict_http_fixture'"));
  if(!matches.length) throw new Error('CANONICAL_FIXTURE_AUTHORITY_ANCHOR_MISSING:'+mode);
  let result=source;
  for(const statement of matches) result=result.replace(statement,matrixStatement(statement,template,
    {reclass:mode!=='request',rep:mode==='rep',profile:mode!=='reclass'}));
  return result;
}
