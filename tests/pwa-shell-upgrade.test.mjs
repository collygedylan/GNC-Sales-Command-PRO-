import test from 'node:test';
import * as contracts from './helpers/pwa-shell-upgrade-contract.mjs';
for (const [name, check] of Object.entries(contracts)) test(name, check);
