import { execFileSync } from 'node:child_process';
import { appToken, revokeAppToken } from './bootstrap-app.mjs';
const repository = 'collygedylan/GNC-Sales-Command-PRO-';
const branch = execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
if (!['codex/teardown-phase-1','codex/teardown-phase-2'].includes(branch)) throw new Error('STAGING_PHASE_BRANCH_REQUIRED');
const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const token = await appToken(repository);
try {
const env = {...process.env, GH_TOKEN:token};
const gh = args => execFileSync('gh',args,{env,encoding:'utf8',windowsHide:true});
const existing = JSON.parse(gh(['pr','list','--repo',repository,'--head',branch,'--base','staging-teardown','--json','url,number']));
const url = existing.length ? existing[0].url : gh(['pr','create','--repo',repository,'--base','staging-teardown','--head',branch,'--fill']).trim();
const pr = JSON.parse(gh(['pr','view',url,'--json','baseRefName,headRefName,headRefOid,author']));
if (pr.baseRefName !== 'staging-teardown' || pr.headRefName !== branch || pr.headRefOid !== head || !pr.author.is_bot) throw new Error('STAGING_PR_IDENTITY_INVALID');
gh(['pr','merge',url,'--auto','--merge','--match-head-commit',head]);
console.log(url);
} finally {
  await revokeAppToken(token);
}
