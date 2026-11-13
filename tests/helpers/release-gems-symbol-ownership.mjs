import assert from 'node:assert/strict';
import { indexReleaseDeclarations } from './release-gems-declarations.mjs';

const legacyRowWorkflow = 'assets/row-workflow-functions.js';
const reportOverview = 'assets/eval-report2-overview.js';
const detailPhoto = 'assets/detail-photo-attachments.js';
const extracted = new Map([
    ['buildEvalAggregateDashboardModel', reportOverview],
    ['renderEvalAggregateDashboard', reportOverview],
    ['openEvalAggregateReport', reportOverview],
    ['queueEvalAggregateDashboardRefresh', reportOverview],
    ['backEvalAggregateDashboard', reportOverview],
    ['persistQueuePhotoAttachment', detailPhoto],
    ['persistCameraDetailSession', detailPhoto],
    ['restoreCameraDetailSession', detailPhoto]
]);

function assertRuntimeFragment(file, read) {
    assert.ok(read('assets/app-runtime.js').includes(`/* @runtime-fragment ${file} */`), `missing composed owner: ${file}`);
    const tag = read('index.html').matchAll(/<script\b[^>]+data-runtime-fragment[^>]*>/g);
    assert.equal(Array.from(tag).filter(([element]) => element.includes(`src="./${file}?`)).length, 1, file);
}

function verifyConfirmedSuspendPull(read, composed) {
    const owner = 'assets/suspend-detail-save-domain.js';
    assertRuntimeFragment(owner, read);
    const find = indexReleaseDeclarations(read(owner));
    const change = find('changeSuspendPullLocation');
    const commit = find('commitSuspendPullLocation');
    assert.match(change, /confirmSuspendLocationChange[\s\S]*serializeSuspendTagRowWrite[\s\S]*commitSuspendPullLocation/);
    assert.match(find('stageSuspendPullRemoval'), /if \(operation !== 'remove_location'\) return false/);
    assert.match(commit, /await suspendTagApi[\s\S]*matchesFinalSuspendPullReceipt[\s\S]*result\?\.ok[\s\S]*scheduleRequestRender/);
    assert.ok(!/\bpreviewSuspendPullAllocation\b/.test(composed), 'pre-receipt replacement must stay retired');
}

export function verifyRegisteredSymbol(file, symbol, read, composed) {
    if (file === legacyRowWorkflow) {
        const owner = extracted.get(symbol);
        if (owner) {
            assertRuntimeFragment(owner, read);
            indexReleaseDeclarations(read(owner))(symbol);
            return;
        }
        if (symbol === 'previewSuspendPullAllocation') {
            verifyConfirmedSuspendPull(read, composed);
            return;
        }
    }
    const source = file === 'assets/app-runtime.js' ? composed : read(file);
    const escaped = symbol.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    assert.ok(new RegExp(`\\b${escaped}\\b`).test(source), `${file}:${symbol}`);
}
