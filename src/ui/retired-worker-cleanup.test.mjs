import test from 'node:test';
import assert from 'node:assert/strict';
import { liveUpdateFixture } from './live-update-fixture.mjs';

function workerFixture(version = '1.2.3', deferEnumeration = false) {
    const listeners = new Map(), removed = [], messages = [];
    const registration = (scope, script, other) => ({ scope, active: script ? { scriptURL: script } : null,
        waiting: other ? { scriptURL: other } : null, unregister: async () => { removed.push(scope); return true; } });
    const registrations = [
        registration('https://app.test/test/', 'https://app.test/test/sw.js?v=2.3.195'),
        registration('https://app.test/', 'https://app.test/sw.js?v=1.2.3'),
        registration('https://app.test/v2/', 'https://app.test/v2/sw.js'),
        registration('https://other.test/test/', 'https://other.test/test/sw.js'),
        registration('https://app.test/test/', null),
        registration('https://app.test/test/', 'https://app.test/test/sw.js', 'https://app.test/another.js')
    ];
    const controller = { postMessage(message) {
        messages.push(message);
        if (message.type === 'GNC_GET_SHELL_VERSION') listeners.get('message')?.({ source: controller,
            data: { type: 'GNC_SHELL_VERSION', build: 'AgData v' + version } });
    } };
    let resolveEnumeration;
    const enumeration = new Promise(resolve => { resolveEnumeration = resolve; });
    const serviceWorker = { controller, addEventListener: (event, handler) => listeners.set(event, handler),
        getRegistrations: () => deferEnumeration ? enumeration : Promise.resolve(registrations) };
    return { ...liveUpdateFixture(serviceWorker), removed, messages, serviceWorker,
        finishEnumeration: () => resolveEnumeration(registrations) };
}

test('only the verified retired test worker is removed after current shell readiness', async t => {
    const fixture = workerFixture(); t.after(fixture.close);
    await new Promise(setImmediate);
    assert.deepEqual(fixture.removed, ['https://app.test/test/']);
    assert.ok(fixture.messages.some(message => message.type === 'GNC_SHELL_READY'));
    fixture.root.GncLiveAppUpdate.runtimeReady();
    await new Promise(setImmediate);
    assert.equal(fixture.removed.length, 1);
    assert.deepEqual(fixture.navigation, []);
});

test('an older controlling worker cannot authorize cleanup or cache retirement', async t => {
    const fixture = workerFixture('1.2.2'); t.after(fixture.close);
    await new Promise(setImmediate);
    assert.deepEqual(fixture.removed, []);
    assert.equal(fixture.messages.some(message => message.type === 'GNC_SHELL_READY'), false);
});

test('a controller change during worker enumeration cancels cleanup', async t => {
    const fixture = workerFixture('1.2.3', true); t.after(fixture.close);
    await new Promise(setImmediate);
    fixture.serviceWorker.controller = { postMessage() {} };
    fixture.finishEnumeration();
    await new Promise(setImmediate);
    assert.deepEqual(fixture.removed, []);
});
