import test from 'node:test';
import {assertTableDrivenRowAuthorization} from './helpers/table-row-authorization-contract.mjs';

test('photo, evaluation, Request and Suspend authority follows verified tables rather than actor names',assertTableDrivenRowAuthorization);
