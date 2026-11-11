import test from 'node:test';
import {assertQueHeaderContract} from './helpers/que-header-contract.mjs';

test('Que resolves normalized exact owners and rejects ambiguous family evidence',assertQueHeaderContract);
