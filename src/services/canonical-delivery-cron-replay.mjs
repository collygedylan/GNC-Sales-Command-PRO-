import {readFileSync} from 'node:fs';
import path from 'node:path';

const target='20261112022023_agdata3078_delivery_cron_single_flight.sql';
const identity='jobid=(select jobid from pg_temp.ci_delivery_cron_identity where production_job_id=45)';
const cleanup=`
do $cleanup$
begin
 if not exists(select 1 from cron.job where jobid=(select jobid from pg_temp.ci_delivery_cron_identity)
 and jobname='gnc-request-delivery-worker'
 and command='select private.dispatch_request_delivery_worker_cron()' and active) then
 raise exception 'CANONICAL_DELIVERY_CRON_RECEIPT_CHANGED'; end if;
 perform cron.unschedule((select jobid from pg_temp.ci_delivery_cron_identity));
end $cleanup$;
`;

export function replayCanonicalDeliveryCron(source,migrationName,root) {
  if(migrationName!==target)return source;
  const begin=/^begin;\n/i,commit=/^commit;\s*$/im;
  if(!begin.test(source) || (source.match(/^commit;\s*$/gim)||[]).length!==1 || !commit.test(source)
    || (source.match(/jobid=45/g)||[]).length!==2) {
    throw Error('CANONICAL_DELIVERY_CRON_TRANSACTION_CHANGED');
  }
  const fixture=readFileSync(path.join(root,'supabase/ci/canonical_delivery_cron_identity.sql'),'utf8').replaceAll('\r\n','\n');
  return source.replaceAll('jobid=45',identity).replace(begin,match=>match+fixture+'\n').replace(commit,cleanup+'commit;\n');
}
