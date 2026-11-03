import test from 'node:test';
import {dormantFamilyContract,additiveReadContract,sourceFingerprintContract,fastDefaultContract} from './helpers/fast-release-contract.mjs';
test('dormant family groups retain assignments and indexed history',dormantFamilyContract);
test('additive GET metadata retains known-field and mutation validation',additiveReadContract);
test('Apps Script source equivalence rejects differing or unknown sources',sourceFingerprintContract);
test('explicit full audit is consumed once and resets to parallel',fastDefaultContract);

test('Retained web version and authenticated trigger source are verified separately',async()=>{await (await import('./helpers/fast-release-contract.mjs')).verifiedHeadOnlyContract();});

test('Hosted health requests exact deployment identity fields and rejects trigger source drift',async()=>{await (await import('./helpers/fast-release-contract.mjs')).projectedDeploymentHealthContract();});

test('Hosted OAuth accepts production clasp encodings without exposing credential material',async()=>{(await import('./helpers/fast-release-contract.mjs')).hostedClaspCredentialContract();});
