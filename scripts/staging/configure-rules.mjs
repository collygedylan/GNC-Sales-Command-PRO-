import { execFileSync } from 'node:child_process';
const repository = 'collygedylan/GNC-Sales-Command-PRO-';
const phase = process.argv.includes('--require-review') ? 'review' : 'approved-two-phases';
const ruleset = {
  name: 'Isolated teardown staging', target: 'branch', enforcement: 'active', bypass_actors: [],
  conditions: { ref_name: { include: ['refs/heads/staging-teardown'], exclude: [] } },
  rules: [
    { type:'deletion' }, { type:'non_fast_forward' },
    { type:'pull_request', parameters: {
      dismiss_stale_reviews_on_push: true, require_code_owner_review: phase === 'review',
      require_last_push_approval: false, required_approving_review_count: phase === 'review' ? 1 : 0,
      required_review_thread_resolution: true
    } },
    { type:'required_status_checks', parameters: {
      strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
      required_status_checks: [{context:'staging-gate', integration_id:15368}]
    } }
  ]
};
if (!process.argv.includes('--apply')) console.log(JSON.stringify({repository,phase,ruleset},null,2));
else {
  const gh = (args,input) => execFileSync('gh',args,{input,encoding:'utf8',windowsHide:true});
  const existing = JSON.parse(gh(['api',`repos/${repository}/rulesets`])).find(item=>item.name===ruleset.name);
  const result = JSON.parse(gh(['api','--method',existing?'PUT':'POST',`repos/${repository}/rulesets${existing?'/'+existing.id:''}`,'--input','-'],JSON.stringify(ruleset)));
  if (result.enforcement !== 'active') throw new Error('STAGING_RULESET_NOT_ACTIVE');
  console.log(JSON.stringify({id:result.id,phase,branch:'staging-teardown'}));
}
