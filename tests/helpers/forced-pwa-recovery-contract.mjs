import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { liveUpdateFixture } from '../../src/ui/live-update-fixture.mjs';
import { harness, origin } from './root-service-worker-fixture.mjs';
import { upgradeOpenWindows } from './pwa-shell-upgrade-contract.mjs';

const asset = name => readFileSync(new URL(`../../assets/${name}.js`, import.meta.url), 'utf8');

export async function assertForcedWorkerRecovery() {
    await upgradeOpenWindows();
    const worker = harness([{ id: 'root', url: `${origin}/` }, { id: 'v2', url: `${origin}/v2/` }]);
    const currentBuild = worker.evaluate('APP_SHELL_BUILD');
    const obsolete = 'agdata-v3.0.43-network-first-r1';
    for (const name of [obsolete, 'agdata-photo-cache-v1', 'agdata-v3.0.43-field-photos', 'partner-cache']) await worker.caches.open(name);
    await worker.dispatch('install');
    const event = source => ({ source, data: { type: 'GNC_SHELL_READY', build: currentBuild } });
    await worker.dispatch('message', event(worker.clients[0]));
    assert.deepEqual(worker.calls.deleted, [], 'an unverified root tab keeps its former assets');
    worker.clients[0].url = `${origin}/?shellv=${encodeURIComponent(currentBuild)}`;
    await worker.dispatch('message', event(worker.clients[1]));
    assert.deepEqual(worker.calls.deleted, [], 'a v2 client cannot retire root assets');
    await worker.dispatch('message', event(worker.clients[0]));
    assert.deepEqual(worker.calls.deleted, [obsolete]);
    assert.ok((await worker.caches.keys()).includes('agdata-photo-cache-v1'));
    assert.ok((await worker.caches.keys()).includes('agdata-v3.0.43-field-photos'));
    assert.ok((await worker.caches.keys()).includes('partner-cache'));
}

export async function assertExplicitUpdateTapRecovery() {
    const fixture = liveUpdateFixture();
    try {
        const { root, state, navigation, checkpoints } = fixture;
        state.busy = true;
        const events = [];
        root.GncLiveAppUpdate.runtimeReady(() => { events.push('release stale lock'); state.busy = false; });
        const save = root.saveWorkStateBeforeAppUpdate;
        root.saveWorkStateBeforeAppUpdate = options => { events.push('checkpoint'); return save(options); };
        const fetch = root.fetch;
        root.fetch = (...args) => { events.push('verify shell'); return fetch(...args); };
        await root.requestLiveAppUpdate('1.2.4');
        assert.equal(await fixture.tap(), true);
        assert.deepEqual(events, ['release stale lock', 'checkpoint', 'verify shell']);
        assert.equal(checkpoints.length, 1);
        assert.equal(new URL(navigation[0]).searchParams.get('shellv'), 'AgData v1.2.4');
        assert.ok(new URL(navigation[0]).searchParams.has('_reload'));
    } finally { fixture.close(); }
}

export async function assertOnlyBannerStartsApply() {
    const fixture = liveUpdateFixture();
    try {
        const { root, checkpoints, navigation } = fixture;
        let begin, finish, prepared = 0;
        const verificationStarted = new Promise(resolve => { begin = resolve; });
        const responseReady = new Promise(resolve => { finish = resolve; });
        const fetch = root.fetch;
        root.fetch = async (...args) => { begin(); await responseReady; return fetch(...args); };
        root.GncLiveAppUpdate.runtimeReady(() => { prepared += 1; });
        await root.requestLiveAppUpdate('1.2.4');
        assert.equal(await root.GncLiveAppUpdate.requestApply('settled'), false);
        assert.equal(checkpoints.length, 0);
        const tapped = fixture.tap();
        await verificationStarted;
        assert.equal(fixture.tap(), tapped);
        assert.equal(prepared, 1);
        assert.equal(checkpoints.length, 1);
        assert.equal(navigation.length, 0);
        finish();
        assert.equal(await tapped, true);
        assert.equal(checkpoints.length, 1);
        assert.equal(navigation.length, 1);
    } finally { fixture.close(); }
}

function storage(entries) {
    const values = new Map(entries);
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key) };
}

export function assertStaleCheckpointRecovery() {
    const owner = { username: 'rep', subject: 'profile' };
    const envelope = { schema: 1, owner, createdAt: Date.now(), tabNonce: 'tab', targetVersion: '3.0.45', snapshotId: 'old' };
    const saved = JSON.stringify(envelope);
    const key = 'agdata_update_restore_v1';
    const localStorage = storage([[key, saved], [`${key}:tab`, saved], [`${key}:another-tab`, 'untouched']]);
    const sessionStorage = storage([['agdata_update_restore_tab_v1', 'tab'], ['agdata_update_restore_commit_v1', saved]]);
    const job = { running: false, status: 'Save failed' };
    const context = vm.createContext({ window: {}, document: { querySelectorAll: () => [] }, localStorage, sessionStorage,
        currentUser: owner.username, nativeAuthProfile: { id: owner.subject }, nativeAuthSessionActive: true,
        nativeAuthSessionUserId: owner.subject, pendingPhotoUploads: new Map(), drivePhotoAttachments: new Map([['photo', job]]),
        isCurrentDrivePhotoAttachment: () => true });
    vm.runInContext(asset('app-update-state'), context);
    assert.equal(context.getAppUpdateBusyState().reasons[0], 'restore-pending');
    context.prepareAppUpdateTap();
    assert.equal(localStorage.getItem(key), null);
    assert.equal(localStorage.getItem(`${key}:tab`), null);
    assert.equal(localStorage.getItem(`${key}:another-tab`), 'untouched');
    assert.equal(localStorage.getItem('agdata_update_recovery_v1:tab'), saved);
    assert.equal(sessionStorage.getItem('agdata_update_restore_commit_v1'), null);
    assert.equal(context.getAppUpdateBusyState().busy, false);
    job.running = true;
    assert.equal(context.getAppUpdateBusyState().reasons[0], 'photo-upload');
}

export function assertLogoutReleasesWorkLocks() {
    const events = [], upload = new Map([['photo', true]]);
    const photos = { first: 1 }, shared = { second: 2 };
    const pending = { resolve: result => events.push(result.reason) };
    const rows = new Map([['row', { running: true, pending }]]);
    const camera = { cameraCaptureInFlight: true, startedAt: 123, returnUntil: 456 };
    const context = vm.createContext({ window: { GncCameraState: camera,
        persistCameraCaptureState: () => events.push('camera released') },
        expireAppUpdateRestore: () => events.push('archive checkpoint'), pendingPhotoUploads: upload,
        pendingPhotoPersistTimers: photos, pendingSharedPhotoMasterPersistTimers: shared, rowSaveCoordinatorState: rows,
        clearTimeout: id => events.push(id) });
    vm.runInContext(asset('logout-work-state'), context);
    context.clearLogoutUpdateLocks();
    assert.deepEqual(events, ['archive checkpoint', 'camera released', 1, 2, 'logout']);
    assert.deepEqual(camera, { cameraCaptureInFlight: false, startedAt: 0, returnUntil: 0 });
    assert.deepEqual(photos, {});
    assert.deepEqual(shared, {});
    assert.equal(upload.size, 0);
    assert.equal(rows.size, 0);
}

export async function assertForcedPwaRecovery() {
    await assertForcedWorkerRecovery();
    await assertExplicitUpdateTapRecovery();
    await assertOnlyBannerStartsApply();
    assertStaleCheckpointRecovery();
    assertLogoutReleasesWorkLocks();
}
