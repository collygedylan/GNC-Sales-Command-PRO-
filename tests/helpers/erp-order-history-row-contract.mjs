import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { erpOrderHistoryWholeRowMigration } from '../../src/services/erp-publication-migration-registry.mjs';

function projectHistoryRow(aliasReference, row) {
    if (aliasReference === 'source') return row.source;
    assert.equal(aliasReference, 'source.*');
    return row;
}

export function assertOrderHistoryWholeRowProjection() {
    const sql = readFileSync(new URL(`../../supabase/migrations/${erpOrderHistoryWholeRowMigration}`, import.meta.url), 'utf8');
    const legacy = sql.match(/anchor text := 'to_jsonb\(([^)]+)\)'/)?.[1];
    const installed = sql.match(/execute replace\(definition,anchor,'to_jsonb\(([^)]+)\)'\)/)?.[1];
    for (const source of [null, 'PH']) {
        const row = { unique_id: 'order-fixture', itemcode: 'ORDER-1', filename: 'original.xlsx', source };
        assert.equal(projectHistoryRow(legacy, row), source);
        assert.deepEqual(projectHistoryRow(installed, row), row);
    }
}
