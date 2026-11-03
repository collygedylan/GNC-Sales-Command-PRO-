import {execFileSync} from 'node:child_process';
export function expectedAppsScriptCommit(cwd=process.cwd()) {
  const sha=execFileSync('git',['log','-1','--format=%H','--','Code.gs'],{cwd,encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('APPS_SCRIPT_SOURCE_COMMIT_MISSING');
  return sha;
}
export function matchesAppsScriptFingerprint(payload,expected) {
  return /^[a-f0-9]{40}$/.test(String(expected||'')) && String(payload?.deployedCommit||'').toLowerCase()===expected.toLowerCase();
}

export function matchesAppsScriptSourceFingerprint(payload, expected, readBlob = sha =>
 execFileSync('git',['rev-parse',sha+':Code.gs'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:4000}).trim()) {
 if(matchesAppsScriptFingerprint(payload,expected))return true;
 const deployed=String(payload?.deployedCommit||'');
 if(!/^[a-f0-9]{40}$/i.test(deployed)||!/^[a-f0-9]{40}$/i.test(String(expected||'')))return false;
 try {const expectedBlob=readBlob(expected),deployedBlob=readBlob(deployed);return /^[a-f0-9]{40}$/i.test(expectedBlob)&&expectedBlob===deployedBlob;}catch{return false;}
}
