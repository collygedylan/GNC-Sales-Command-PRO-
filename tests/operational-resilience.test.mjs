import test from 'node:test';
import {requestContract,emailContract,aliasContract,photoContract,touchContract,syncContract} from './helpers/operational-resilience-contract.mjs';
for(const [name,run] of Object.entries({requestContract,emailContract,aliasContract,photoContract,touchContract,syncContract}))test(name,run);
