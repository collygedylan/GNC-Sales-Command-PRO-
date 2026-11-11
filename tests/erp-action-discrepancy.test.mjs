import assert from 'node:assert/strict';
import test from 'node:test';
import {readActionDiscrepancyRows} from '../src/core/erp-action-discrepancies.js';
import {executeManagerTableManagement} from '../src/core/erp-action-discrepancy-rpc.ts';

const actor = 'adc9d3dc-8888-4333-8888-999999999999';

test('all pages use the last exact id, with one complete export snapshot', async () => {
    const cursors = [], visible = [], remembered = [];
    const source = {current:() => true, remember:rows => remembered.push(rows),
        request:async (_operation, payload) => {
            cursors.push(payload.before_id);
            return payload.before_id ? {rows:[{id:71}], next_before_id:null} : {rows:[{id:81}], next_before_id:81};
        }};
    const rows = await readActionDiscrepancyRows(source, new AbortController().signal, page => visible.push(page));
    assert.deepEqual(cursors, [undefined, 81]);
    assert.deepEqual(visible, [[{id:81}]]);
    assert.deepEqual(remembered, [rows]);
    assert.deepEqual(rows.map(row => row.id), [81, 71]);
});

test('reject a stale account and bad cursor without persisting an incomplete export', async () => {
    const response = {rows:[{id:17}], next_before_id:22};
    const source = {current:() => true, request:async () => response, remember:() => assert.fail()};
    const signal = new AbortController().signal;
    await assert.rejects(readActionDiscrepancyRows(source, signal, () => {}), /cursor/);
    source.current = () => false;
    await assert.rejects(readActionDiscrepancyRows(source, signal, () => {}), /account/);
});

test('Manager RPC binds verified actor and accepts only the selected discrepancy id', async () => {
    const calls = [];
    const client = {rpc:async (name, args) => {
        calls.push({name, args});
        return {data:{row:{id:3, status:'learned'}}};
    }};
    const request = {action:'manager_table_management', table:'action-discrepancy', operation:'teach', payload:{id:3}};
    assert.equal((await executeManagerTableManagement(client, actor, request)).row.id, 3);
    assert.deepEqual(calls[0], {name:'manager_action_discrepancies_v3070',
        args:{p_actor_id:actor, p_operation:'teach', p_payload:{id:3}}});
    await assert.rejects(executeManagerTableManagement(client, actor, {...request, p_actor_id:'other'}), /INVALID/);
    await assert.rejects(executeManagerTableManagement(client, actor, {...request, payload:{id:3, rule:{}}}), /INVALID/);
    assert.equal(calls.length, 1);
});
