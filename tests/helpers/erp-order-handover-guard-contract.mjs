import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { erpReserveHandoverGuardMigration, erpSocHandoverGuardMigration } from '../../src/services/erp-publication-migration-registry.mjs';

function readNewRowGuard(migration, table) {
    const source = readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    const trigger = source.split(`on public.${table}\n`)[1];
    const predicate = trigger?.match(/for each row when \(([^)]+)\)\s*execute function private\.handover_normalize_assignment_v1\(\)/i)?.[1];
    assert.ok(predicate, `${table} needs a guard on the actual trigger`);
    return predicate.split(/\s+or\s+/i).map(clause => {
        const column = clause.match(/^new\.([a-z_]+) is not null$/i)?.[1];
        assert.ok(column, `${table} must preserve the handover for any nonnull assignment lane`);
        return column;
    });
}

function assertHandoverNullGuard(migration, table, expectedColumns) {
    const columns = readNewRowGuard(migration, table);
    assert.deepEqual(columns, expectedColumns);
    const shouldNormalize = row => columns.some(column => row[column] !== null);
    const cleared = Object.fromEntries(columns.map(column => [column, null]));
    assert.equal(shouldNormalize(cleared), false);
    for (const column of columns) {
        assert.equal(shouldNormalize({ ...cleared, [column]: 'kayla_knepp' }), true);
        assert.equal(shouldNormalize({ ...cleared, [column]: '' }), true);
    }
}

export function assertErpOrderHandoverNullGuard() {
    assertHandoverNullGuard(erpReserveHandoverGuardMigration, 'ph_reserves', ['assigned_to', 'assignedto', 'flyer_assigned']);
    assertHandoverNullGuard(erpSocHandoverGuardMigration, 'ph_soc_master', ['assignedto', 'flyer_assigned']);
}
