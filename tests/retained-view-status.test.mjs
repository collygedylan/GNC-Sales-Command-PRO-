import { readComposedAppSource } from '../scripts/composed-app-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = readComposedAppSource();
function fixture() {
    const notices = [], renders = [];
    const container = { dataset: {} }, crumb = { innerText: 'REQUEST (2)' };
    const context = vm.createContext({
        Date, Map, Error, Object,
        VIEW_LOAD_UI: { request: { container: 'request-content', crumb: 'crumb' }, av: { container: 'av-content' } },
        document: { getElementById: id => id === 'crumb' ? crumb : container },
        hasProgressiveViewData: () => true,
        containerHasRenderableContent: () => true,
        isSupabaseReadTerminalDenial: error => error?.status === 403,
        nativeSessionRecoveryError: () => ({ message: 'Session recovery required' }),
        getSupabaseReadIdentityScope: () => 'account-a',
        viewTerminalReadDenials: new Map(), avReadNoticeTimes: new Map(),
        notifySupabaseReadAccessDenied: (...args) => notices.push(args),
        showToast: (...args) => notices.push(args), markViewDirty: () => {},
        setContainerHtml: (_, html) => renders.push(html), setContainerUiState: () => {},
        escapeHtml: value => String(value), getViewRetryState: () => ({ count: 0 }), VIEW_LOAD_RETRY_MAX_ATTEMPTS: 3
    });
    const extract = (name, next) => source.slice(source.indexOf(`        function ${name}(`), source.indexOf(`        ${next}`, source.indexOf(`        function ${name}(`)));
    vm.runInContext(extract('showViewErrorState', 'const VIEW_LOAD_RETRY_MAX_ATTEMPTS'), context);
    vm.runInContext(extract('showAvReadUnavailableState', 'function hasProgressiveViewData('), context);
    return { context, notices, renders, crumb };
}

test('verified retained Request rows keep their count during an import refresh', () => {
    const { context, renders, crumb } = fixture();
    context.showViewErrorState('request', 'An import is in progress. Keeping the last verified data.', true, new Error('Importing'));
    assert.equal(renders.length, 0);
    assert.equal(crumb.innerText, 'REQUEST (2)');
});

test('retained AV rows refresh silently but a terminal denial replaces their view', () => {
    const { context, renders, notices } = fixture();
    context.showAvReadUnavailableState(new Error('Offline'), true, 'av');
    assert.equal(notices.length, 0);
    assert.equal(renders.length, 0);
    context.showAvReadUnavailableState(Object.assign(new Error('Forbidden'), { status: 403 }), true, 'av');
    assert.equal(notices.length, 1);
    assert.equal(renders.length, 1);
    assert.match(renders[0], /access is unavailable/);
});
