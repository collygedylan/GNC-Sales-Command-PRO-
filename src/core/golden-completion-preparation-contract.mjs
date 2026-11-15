import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {completionPreparationMigration} from '../services/completion-preparation-contract.mjs';

export function assertCanonicalCompletionPreparation() {
    const sql=fs.readFileSync(new URL('../../supabase/migrations/'+completionPreparationMigration,import.meta.url),'utf8');
    const argument=sql.match(/array_to_string\(current_ids, chr\((\d+)\)\)/);
    assert.ok(argument,'Completion hashes require an explicit canonical character');
    const delimiter=String.fromCharCode(Number(argument[1]));
    const digest=value=>createHash('md5').update(value).digest('hex');
    assert.equal(digest(['REQ-A','REQ-B'].join(delimiter)),digest('REQ-A\nREQ-B'));
    assert.notEqual(digest(['REQ-A','REQ-B'].join(delimiter)),digest('REQ-A\\nREQ-B'));
    assert.match(sql,/from private\.request_folder_members_v3065\(event_row\.request_folder\)/);
    assert.doesNotMatch(sql,/from public\.ph_(?:active_request|requests_pending|requests_completed_history)/);
    assert.match(sql,/not private\.is_service_role_request\(\)/);
    assert.match(sql,/lease_token = p_lease_token and status = 'processing'/);
    assert.match(sql,/or not all_complete/);
    assert.match(sql,/dependencyEventKeys/);
}
