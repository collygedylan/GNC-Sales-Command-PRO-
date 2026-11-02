import {execFileSync} from 'node:child_process';
export function expectedAppsScriptCommit(cwd=process.cwd()) {
  const sha=execFileSync('git',['log','-1','--format=%H','--','Code.gs'],{cwd,encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(sha))throw new Error('APPS_SCRIPT_SOURCE_COMMIT_MISSING');
  return sha;
}
export function matchesAppsScriptFingerprint(payload,expected) {
  return /^[a-f0-9]{40}$/.test(String(expected||'')) && String(payload?.deployedCommit||'').toLowerCase()===expected.toLowerCase();
}
