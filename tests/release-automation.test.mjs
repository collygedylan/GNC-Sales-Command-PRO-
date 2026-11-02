import test from 'node:test';
import {versionTransactionContract,frontendRecoveryContract,finalizationContract} from './helpers/release-automation-contract.mjs';
test('release synchronization rolls back source writes and rejects stale staged artifacts',versionTransactionContract);
test('green CI recovers an unpublished frontend without a second source commit',frontendRecoveryContract);
test('verified publication resumes interrupted metadata and local-state reconciliation',finalizationContract);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
test('post-CI finalization trusts only successful current-main repository workflows',()=>{const workflow=yaml.load(fs.readFileSync(new URL('../.github/workflows/release-finalize.yml',import.meta.url),'utf8'));assert.deepEqual(workflow.on.workflow_run.workflows,['Deploy static app to Pages']);assert.deepEqual(workflow.on.workflow_run.branches,['main']);assert.match(workflow.jobs.finalize.if,/conclusion == 'success'/);assert.match(workflow.jobs.finalize.if,/head_repository.full_name == github.repository/);assert.equal(workflow.permissions.contents,'read');assert.equal(workflow.permissions.actions,'write');const step=workflow.jobs.finalize.steps.find(step=>step.run);assert.match(step.run,/recover-or-publish-release.mjs --no-push/);assert.ok(step.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY);});
