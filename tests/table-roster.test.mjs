import test from 'node:test';
import {assignmentFallbackContract,rosterParityContract,requestSchemaContract,avCardDetailContract} from './helpers/table-roster-contract.mjs';
test('Assigned Items retains working rows during module failure and scopes checked saves',assignmentFallbackContract);
test('Role roster preserves all identities without enabling missing or disabled profiles',rosterParityContract);
test('Pending request schema accepts submitted_by while rejecting unknown fields',requestSchemaContract);
test('AV card bodies open exact Item Detail and retain separate scope formats',avCardDetailContract);

test('AV retains same-account complete rows during optional refresh and paints synchronously',async()=>{const {avDisplayContinuityContract}=await import('./helpers/table-roster-contract.mjs');avDisplayContinuityContract();});

test('AV preview cache follows search text and AURA probes respect explicit denials',async()=>{const {avPreparationAndAuraProbeContract}=await import('./helpers/table-roster-contract.mjs');avPreparationAndAuraProbeContract();});
