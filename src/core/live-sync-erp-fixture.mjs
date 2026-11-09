import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../assets/erp-manual-continuation.js', import.meta.url), 'utf8');

export async function verifyManualContinuation(html) {
    const requests = [];
    const optionsSeen = [];
    const delays = [];
    const applied = [];
    let call = 0;
    const sandbox = {
        module: { exports: {} },
        MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, manualSyncStartGeneration: 0,
        firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
        APP_API_FUNCTION_URL: '/app-api',
        postAppFunctionJson: async (_url, body, options) => {
            requests.push(body);
            optionsSeen.push(options);
            call += 1;
            return call < 3
                ? { ok: true, status: 'CONTINUE', retryAfterMs: call === 1 ? 25 : 0, data: { runStatus: { active: true, runId: 'run-1', currentStage: 'drive', stageIndex: call } } }
                : { ok: true, status: 'COMPLETE', data: { runStatus: { active: false, runId: 'run-1', currentStage: 'idle', stageIndex: 5 } } };
        },
        applyManualSyncStatus: status => applied.push(status),
        setTimeout: (callback, delay) => { delays.push(delay); callback(); return 0; },
        Promise
    };
    vm.runInNewContext(`${source}\nmodule.exports = continueManualErpSync;`, sandbox);
    const result = await sandbox.module.exports({ runId: 'run-1' });
    assert.equal(requests.length, 3);
    assert.equal(optionsSeen[0].timeoutMs, 45000, 'an unanswered cloud slice yields to status recovery after 45 seconds');
    assert.deepEqual(delays, [25, 250], 'top-level retryAfterMs is honored before the next claim');
    assert.deepEqual(requests.map(request => [request.action, request.operation, request.runId]), [
        ['erp_sync', 'continue', 'run-1'],
        ['erp_sync', 'continue', 'run-1'],
        ['erp_sync', 'continue', 'run-1']
    ]);
    assert.equal(applied.length, 3);
    assert.equal(result.active, false);
    assert.equal(result.currentStage, 'idle');
    assert.match(html, /async function runGoogleAppsScriptTrigger\(\)[^]*forceRestart: true/);
}

export async function verifyManualDeadline(html) {
    assert.match(html, /const MANUAL_SYNC_SCRIPT_TIMEOUT_MS = 600000/);
    assert.match(source, /state\.step < 300/);
    let now = 0;
    const timeouts = [];
    let requests = 0;
    const sandbox = {
        module: { exports: {} }, Date: { now: () => now },
        MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, manualSyncStartGeneration: 0,
        firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
        APP_API_FUNCTION_URL: '/app-api',
        postAppFunctionJson: async (_url, body, options) => {
            requests += 1;
            assert.equal(body.operation, 'continue');
            timeouts.push(options.timeoutMs);
            now += 120000;
            return { ok: true, status: 'CONTINUE', data: { runStatus: { active: true, runId: 'run-timeboxed' } } };
        },
        applyManualSyncStatus() {},
        setTimeout: callback => { callback(); return 0; },
        Promise
    };
    vm.runInNewContext(`${source}\nmodule.exports = continueManualErpSync;`, sandbox);
    const initial = { runId: 'run-timeboxed' };
    assert.equal(await sandbox.module.exports(initial), initial, 'deadline hands continuation back to its server owner');
    assert.equal(requests, 5, 'the watcher stops after the finite deadline instead of spinning indefinitely');
    assert.deepEqual(timeouts, [45000, 45000, 45000, 45000, 45000], 'each request remains below the 140-second lease');
}

export async function verifyManualRetries() {
    const rowLimits = [];
    let statusReads = 0;
    const statuses = [500, 502, 546];
    let successfulSlices = 0;
    const sandbox = {
        module: { exports: {} }, Date,
        MANUAL_SYNC_SCRIPT_TIMEOUT_MS: 600000, manualSyncStartGeneration: 0,
        firstNonEmptyValue: (...values) => values.find(value => value !== undefined && value !== null && value !== ''),
        APP_API_FUNCTION_URL: '/app-api',
        postAppFunctionJson: async (_url, body) => {
            if (body.operation === 'status') { statusReads++; return { data: { active: true, runId: 'run-slice-retry' } }; }
            rowLimits.push(body.maxRowsPerSlice);
            const status = statuses.shift();
            if (status) throw Object.assign(new Error(`worker ${status}`), { status });
            successfulSlices += 1;
            return { ok: true, status: successfulSlices === 1 ? 'CONTINUE' : 'DONE',
                data: { runStatus: { active: successfulSlices !== 2, runId: 'run-slice-retry' } } };
        },
        applyManualSyncStatus() {},
        setTimeout: callback => { callback(); return 0; },
        Promise,
    };
    vm.runInNewContext(`${source}\nmodule.exports = continueManualErpSync;`, sandbox);
    const result = await sandbox.module.exports({ runId: 'run-slice-retry' });
    assert.equal(result.active, false);
    assert.deepEqual(rowLimits, [2500, 1250, 1250, 1250, 1250]);
    assert.equal(statusReads, 2, 'gateway failures reconcile durable status before retrying');
}
