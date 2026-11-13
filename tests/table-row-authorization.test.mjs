import test from 'node:test';
import {assertTableDrivenRowAuthorization,assertRetainedRowEditorAuthority} from './helpers/table-row-authorization-contract.mjs';

test('row authorization retains exact account, module, Request receipt and Dock mirror boundaries',assertTableDrivenRowAuthorization);
test('eligible authenticated row editors do not wait for permission hydration',assertRetainedRowEditorAuthority);
