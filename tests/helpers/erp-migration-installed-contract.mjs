import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyScopedMigrationsUsingSupabaseCli } from '../../scripts/apply-item-low-stock-migration.mjs';
import { requestPendingAutosaveMigrationName } from '../../src/services/history-delta-migration-registry.mjs';
import {
    erpDriveMasterEvalGuardMigration, erpDriveSocEvidenceDeltaMigration,
    erpDriveSocEvidenceMarkerMigration, erpDriveNarrowPublicationInputsMigration, erpDriveKeyedCropRollPublicationMigration,
    erpDrivePruneCandidateMigration, erpDeferredDriveArchiveMigration, erpRetireCropRollPublicationMigration,
    erpDriveSingleStockWriteMigration, erpAliasSingleStockWriteMigration, erpDriveFinalIdentityMapMigration,
    erpDriveBatchLiveOverridesMigration, erpInheritedEvidenceIndexesMigration, erpDriveSocEffectiveEvidenceMigration,
    erpDriveSocEvidenceHistoryMigration, erpDriveBoundedAssignmentLocksMigration, erpDriveAssignmentRevisionStampMigration,
    erpPackedDriveArchiveMigration, erpReserveHandoverGuardMigration, erpSocHandoverGuardMigration,
    erpOrderHistoryWholeRowMigration
} from '../../src/services/erp-publication-migration-registry.mjs';

const migrationProofs = [
    [erpDriveMasterEvalGuardMigration, ['sync_master_inventory_canonical_v2362()', 'guard_enabled:=', 'capture_inventory_location_evidence_v1()']],
    [erpDriveSocEvidenceDeltaMigration, ['publish_drive_evidence_to_soc_v23142()', 'with changed_drive_evidence as materialized']],
    [erpDriveSocEvidenceMarkerMigration, ['a000_drive_soc_evidence_reset_v3048', 'a000_drive_soc_evidence_mark_v3048', 'has_function_privilege']],
    [erpDriveNarrowPublicationInputsMigration, ['raw_item6_fields <@ s.field_keys', 'relowner', 'oh.field_name', 'rv.field_name']],
    [erpDriveKeyedCropRollPublicationMigration, ['crop.master_unique_id=ids.id', 'master.unique_id=ids.id', 'ph_crop_roll_drive_rows_master_uid_v3048_idx']],
    [erpDrivePruneCandidateMigration, ['missing_source as materialized', 'eligible_missing_source as materialized', 'live.ctid=candidate.physical_tid']],
    [erpDeferredDriveArchiveMigration, ['freeze_erp_drive_archive_v3048(run_id,meta)', 'read_erp_drive_archive_rows_v3048', 'agdata-erp-drive-archive-v3048']],
    [erpRetireCropRollPublicationMigration, ['trg_v2_master_inventory_crop_roll_drive_rows', "tgenabled='D'", 'finalize_master_snapshot_stage_v2374_base', 'apply_inventory_reclass_moves_set_v1']],
    [erpDriveSingleStockWriteMigration, ['erp_on_hand=s.frozen_erp_on_hand_v3048', 'as frozen_erp_available_v3048', 'apply_erp_master_provenance_v3042()']],
    [erpAliasSingleStockWriteMigration, ['erp_on_hand=excluded.erp_on_hand', 'existing.erp_source_present', 's.filename),true']],
    [erpDriveFinalIdentityMapMigration, ['i.canonical_unique_id=notes.canonical_unique_id', 'mapped.canonical_unique_id,s.unique_id,s.source_hash,p_run_id', 'BULK_MASTER_IMPORT_CONCURRENT_ROW_CHANGE']],
    [erpDriveBatchLiveOverridesMigration, ['pending=not private.inventory_override_matches_v1', 'with pending_patches as materialized', 'jsonb_populate_record(s,p.fields)', 'has_function_privilege']],
    [erpInheritedEvidenceIndexesMigration, ['inventory_location_evidence_location_v3048_idx', 'ph_location_sales_notes_location_v3048_idx', 'i.indisvalid']],
    [erpDriveSocEffectiveEvidenceMigration, ['s.photo_link,s.photo_name,s.photo_url,s.photos,s.dock_photo_link', 'coalesce(n.photo_link,s.dock_photo_link)', 'then s.date_completed else n.date_completed end', 'other.unique_id<>n.unique_id']],
    [erpDriveSocEvidenceHistoryMigration, ['gnc.erp_drive_soc_history_run_v3048', 'returning case when deferred_file is not null then to_jsonb(s) end', 'insert into private.erp_order_history_rows_v3046', 'perform private.refresh_soc_order_history_v2366(new.unique_id)']],
    [erpDriveBoundedAssignmentLocksMigration, ["strpos(prosrc,'inventory-row-assignment:')=0", 'gnc-reconcile-eval-itemcodes-v2', 'INVENTORY_ROW_ASSIGNMENT_IMPORT_FENCE_LOST', 'private.resolve_inventory_row_assignment_v1(text,bigint)']],
    [erpDriveAssignmentRevisionStampMigration, ['where p.stamp_only', 'where not stamp_only', 'p.expected_plant_group_code', 'where not exists(select 1 from public.ph_itemcode_default_owners existing']],
    [erpPackedDriveArchiveMigration, ['erp_drive_archive_batch_size_v3048', 'array_agg(source_row)', 'unnest(batch.source_rows)', 'delete from private.erp_drive_archive_batches_v3048']],
    [erpReserveHandoverGuardMigration, ['public.ph_reserves', 'scheduled_handover_normalize_assignment', 'new.assigned_toisnotnullornew.assignedtoisnotnullornew.flyer_assignedisnotnull']],
    [erpSocHandoverGuardMigration, ['public.ph_soc_master', 'scheduled_handover_normalize_assignment', 'new.assignedtoisnotnullornew.flyer_assignedisnotnull']],
    [erpOrderHistoryWholeRowMigration, ['source.unique_id,to_jsonb(source.*)', 'to_jsonb(source)', 'on conflict(dataset_key,file_id,source_uid) do nothing']]
];
const migrationPaths = migrationProofs.map(([name])=>name);
const root = fileURLToPath(new URL('../../',import.meta.url));

function migrationFixtures(proofs) {
    return new Map(proofs.map(([file,signatures]) => {
        const name = file.slice(15,-4);
        const body = readFileSync(new URL(`../../supabase/migrations/${file}`,import.meta.url),'utf8');
        return [file.slice(0,14),{name,body,signatures}];
    }));
}

function assertExactInstalledReadback(sql, fixture) {
    const proof = sql.match(/if not coalesce\(\(select installed from \(([\s\S]*?)\) as release_contract\),false\) then/)?.[1];
    assert.ok(proof,'the installed check must reject false and null before commit');
    for (const signature of fixture.signatures) assert.ok(proof.includes(signature),signature);
    assert.match(sql,/raise exception 'LOW_STOCK_DATABASE_CONTRACT_MISSING';[\s\S]*commit;\s*$/);
}

function createScopedMigrationFixture(proofs = migrationProofs) {
    const fixtures = migrationFixtures(proofs);
    const history = new Map(), rejected = new Set(), checks = [];
    const query = async sql => {
        const version = sql.match(/where version='(\d{14})'/)?.[1];
        const fixture = fixtures.get(version);
        assert.ok(fixture,'readback must address a selected ERP migration version');
        if (sql.includes('as release_migration_state')) return [{release_migration_state:{prior:history.get(version) || null}}];
        assertExactInstalledReadback(sql,fixture);
        const isApply = sql.includes('insert into supabase_migrations.schema_migrations');
        checks.push({version,isApply});
        if (rejected.has(version)) throw new Error('LOW_STOCK_DATABASE_CONTRACT_MISSING');
        if (isApply) history.set(version,{name:fixture.name,statements:[fixture.body]});
        return [];
    };
    return {history,rejected,checks,apply: paths=>applyScopedMigrationsUsingSupabaseCli({migrationPaths:paths,root,query})};
}

export async function assertErpMigrationInstalledReadback() {
    const fixture = createScopedMigrationFixture();
    const expected = status => migrationPaths.map(migration=>({migration,status}));
    assert.deepEqual(await fixture.apply(migrationPaths),expected('applied'));
    assert.deepEqual(await fixture.apply(migrationPaths),expected('already_applied'));
    assert.equal(fixture.checks.filter(check=>check.isApply).length,migrationPaths.length);
    const stale = erpDriveSocEvidenceMarkerMigration.slice(0,14);
    fixture.rejected.add(stale);
    await assert.rejects(fixture.apply(migrationPaths),/LOW_STOCK_DATABASE_CONTRACT_MISSING/);
    assert.deepEqual(fixture.checks.at(-1),{version:stale,isApply:false});
    assert.equal(fixture.history.size,migrationPaths.length,'an installed mismatch does not rewrite migration history');

    const fresh = createScopedMigrationFixture();
    fresh.rejected.add(stale);
    await assert.rejects(fresh.apply([erpDriveSocEvidenceMarkerMigration]),/LOW_STOCK_DATABASE_CONTRACT_MISSING/);
    assert.equal(fresh.history.size,0,'a failed contract does not commit an apply receipt');
}

export async function assertRequestAutosaveMigrationInstalledReadback() {
    const migration = requestPendingAutosaveMigrationName;
    const proofs = [[migration, [
        "upsert_request_history(request_id, 'updated'", "upsert_request_history(request_id, 'completed', 'pending', false)",
        "'request_completed', request_id", "not has_function_privilege('authenticated',oid,'execute')"
    ]]];
    const version = migration.slice(0,14);
    const fixture = createScopedMigrationFixture(proofs);
    assert.deepEqual(await fixture.apply([migration]),[{migration,status:'applied'}]);
    assert.deepEqual(await fixture.apply([migration]),[{migration,status:'already_applied'}]);
    fixture.rejected.add(version);
    await assert.rejects(fixture.apply([migration]),/LOW_STOCK_DATABASE_CONTRACT_MISSING/);
    assert.deepEqual(fixture.checks.at(-1),{version,isApply:false});
    const fresh = createScopedMigrationFixture(proofs);
    fresh.rejected.add(version);
    await assert.rejects(fresh.apply([migration]),/LOW_STOCK_DATABASE_CONTRACT_MISSING/);
    assert.equal(fresh.history.size,0);
}
