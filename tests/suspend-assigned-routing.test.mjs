import test from 'node:test';
import {assertSuspendAssignedRouting,assertSuspendSourceTurnover,assertSuspendUnauthorizedSave} from './helpers/suspend-assigned-routing-contract.mjs';

test('SUSPEND uses exact Assigned Items owners and role-based All Users permissions',assertSuspendAssignedRouting);
test('SUSPEND source turnover removes absent tags even when they contain saved evidence',assertSuspendSourceTurnover);
test('SUSPEND denies an unauthorized save without returning a successful acknowledgment',assertSuspendUnauthorizedSave);
