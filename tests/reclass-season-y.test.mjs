import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { chromium } from 'playwright';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const policy = read('assets/reclass-access-policy.js');
const submission = read('assets/reclass-submission.js');
const modal = read('assets/reclass-modal-open.js');
function appFunction(file, name) {
    const source = read(file);
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, name + ' exists');
    const tail = source.slice(start);
    const next = tail.slice(1).search(/\n[ \t]*(?:async )?function \w+\(/);
    assert.ok(next >= 0, name + ' boundary');
    return tail.slice(0, next + 1);
}
const explanation = ['isReclassExplanationExempt', 'getReclassExplanation', 'updateReclassExplanation',
    'requireReclassExplanation', 'buildReclassExplanationField', 'collectReclassExplanations']
    .map(name => appFunction('assets/row-workflow-functions.js', name)).join('\n');
const proposal = appFunction('assets/app-runtime.js', 'buildArgosReclassV3ProposalHtml');

test('administrator authority requires the current active authenticated matrix row and exact normalized role', () => {
    const context = { Date, normalizeEvidenceActor: value => String(value || '').trim().toLowerCase() };
    vm.createContext(context);
    vm.runInContext(policy, context);
    const input = { currentActor: 'new_admin', identity: { id: 'p1', username: 'new_admin', authenticated: true },
        profile: { id: 'p1', username: 'new_admin', role: 'admin', active: true },
        matrix: { username: 'new_admin', profile_id: 'p1', verified: true, role: 'admin' } };
    for (const role of ['Admin', 'super-admin', 'SUPER_ADMIN', 'super admin', 'superadmin']) {
        assert.ok(context.resolveReclassAdministrator({ ...input, matrix: { ...input.matrix, role } }));
    }
    for (const role of ['a-d-m-i-n', 'manager', 'eval', 'administrator', '', 'super--admin']) {
        assert.equal(context.resolveReclassAdministrator({ ...input, matrix: { ...input.matrix, role } }), null);
    }
    for (const patch of [{ verified: false }, { profile_id: 'foreign' }, { username: 'foreign' }]) {
        assert.equal(context.resolveReclassAdministrator({ ...input, matrix: { ...input.matrix, ...patch } }), null);
    }
    for (const patch of [{ active: false }, { disabled_at: '2026-11-11' }, { must_change_password: true }]) {
        assert.equal(context.resolveReclassAdministrator({ ...input, profile: { ...input.profile, ...patch } }), null);
    }
    assert.equal(context.resolveReclassAdministrator({ ...input, identity: null }), null);
    assert.equal(context.resolveReclassAdministrator({ ...input, denied: true }), null);
    assert.equal(context.resolveReclassAdministrator({ ...input, currentActor: 'foreign' }), null);
    assert.equal(context.resolveReclassAdministrator({ ...input, identity: { ...input.identity, id: 'foreign' } }), null);
    for (const row of [{ SEASON: 'Y' }, { season: '26.Y' }, { lotcode: '*.Y' }, { lotcode: 'Y' }]) {
        assert.equal(context.isSeasonYReclassSource(row), true);
    }
    for (const row of [null, { SEASON: 'F1', LOTCODE: '26.F1' }, { SEASON: 'MY' }, { lotcode: '26.YX' }]) {
        assert.equal(context.isSeasonYReclassSource(row), false);
    }
});

function browserIdentity(config) {
    const actor = config.actor || 'renamed_account';
    const rows = (config.seasons || ['Y']).map((season, index) => ({ unique_id: 'row-' + index,
        values: { ptronhand: '100', priority: '2', lotcode: '26.' + season },
        sourceRow: { UNIQUE_ID: 'row-' + index, ITEMCODE: 'ITEM-1', LOCATIONCODE: 'A.01.00' + index,
            SEASON: season, LOTCODE: config.bareLot ? 'Y' : '26.' + season, PTRONHAND: '100' } }));
    Object.assign(window, { currentUser: actor, currentUserDisplay: actor, testConfig: config, testRows: rows,
        testCommands: [], testNotices: [], nativeAuthProfile: { id: 'p1', username: actor,
            role: config.profileRole || config.role, active: config.active !== false, must_change_password: false },
        testMatrix: { username: actor, profile_id: 'p1', role: config.role, verified: true,
            submit_reclass: 'N', view_permissions: { view_drive_mode: config.moduleDenied ? 'N' : 'Y' } },
        argosReclassMultiActionState: { rowProposals: new Map(), rowResolutions: new Map(), holdStopProposals: {} },
        argosInventoryTransactionState: { item: rows[0].sourceRow, sourceView: 'drive', action: 'reclass',
            inquiryModel: { locationRows: rows }, idempotencyToken: 'stable-command', submitting: false },
        normalizeEvidenceActor: value => String(value || '').trim().toLowerCase(),
        getCanonicalAccessSessionIdentity: () => config.unauthenticated ? null : { id: 'p1', username: actor, authenticated: true },
        resolveUserAccessMatrix: () => window.testMatrix,
        GncUserAccessControl: { getSelfState: () => ({ denied: false }) },
        isEvalReclassRowAssigned: (_actor, row) => !!config.standardAllowed && row.UNIQUE_ID !== config.deniedRow,
        canCurrentUserUseDriveCardOptions: () => !!config.standardAllowed,
        canCurrentUserSubmitRepInventoryOperations: () => window.nativeAuthProfile.role === 'REP',
        canCurrentUserViewDockSuspendDcRequests: () => true,
        getArgosReclassRowEditorEntry: uid => rows.find(row => row.unique_id === uid),
        getArgosReclassRowProposalMap: (uid, create) => {
            const map = window.argosReclassMultiActionState.rowProposals;
            if (!map.has(uid) && create) map.set(uid, {});
            return map.get(uid);
        },
        getArgosReclassV3Proposal: (uid, action) => window.getArgosReclassRowProposalMap(uid, false)?.[action],
        getArgosReclassV3HoldProposal: () => null,
        showToast: (...notice) => window.testNotices.push(notice),
        focusArgosReclassRow() {}, markArgosReclassProposalEdited() {}, captureEvalWorkLocalDraftSoon() {},
        escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;') });
}

function browserEditor() {
    const labels = { move_up: 'Move Up', move_down: 'Move Down', priority_change: 'Priority Change' };
    Object.assign(window, { RECLASS_ACTION_WORKFLOW_V3_ENABLED: true,
        RECLASS_ACTION_WORKFLOW_V5_ORDER: Object.keys(labels), RECLASS_ACTION_WORKFLOW_V3_HOLD_ACTIONS: [],
        RECLASS_ACTION_WORKFLOW_V2_SEASONS: ['F1', 'S1', 'Y'], ARGOS_INVENTORY_TRANSACTION_REQUEST_LABELS: labels,
        getReclassActionWorkflowV5Config: action => ({ kind: action === 'priority_change' ? 'priority' : 'move', label: labels[action] }),
        getArgosReclassV3ScopeActionsForEntry: () => [], getArgosReclassTemporaryOverlay: () => null,
        getEvalWorkInquiryRowResolution: () => '', isArgosReclassMobileEditorViewport: () => true,
        isArgosReclassLocationDetailsOpen: () => false, renderArgosReclassInventoryFields: () => '',
        getArgosReclassRowCurrentSeason: entry => entry.sourceRow.SEASON,
        getArgosReclassMoveUpLotState: () => ({ rowMaximum: 100 }),
        cloneArgosReclassProposal: value => structuredClone(value),
        getArgosReclassMoveBalance: () => ({ remaining: 100 }), getArgosReclassMoveBalanceText: () => '100 remaining',
        getArgosReclassLiveEditIdentityKey: () => window.currentUser + ':p1', getCurrentReclassDeliveryActor: () => window.currentUser,
        ensureArgosReclassSubmissionVerification() {},
        applyArgosInventoryTransactionSourceContext: value => value,
        generateArgosInventoryTransactionId: () => 'stable-command',
        closeArgosInventoryTransactionModal() {}, removeConfirmedMoveProposalsFromInquiryPayload: () => ({ rowOverlays: [] }),
        hasRemainingArgosReclassInquiry: () => false, getCurrentVisibleViewId: () => 'drive', queueInteractiveViewRender() {},
        getArgosInventoryTransactionRequestAction: () => 'move_up', getFriendlyBackendErrorMessage: error => String(error.message || error),
        setArgosInventoryTransactionAction() {}, applyArgosInventoryTransactionEmailRecipients: async value => value });
    window.refreshArgosReclassMultiActionUi = () => {
        document.getElementById('rows').innerHTML = window.testRows.map(entry => '<article data-reclass-row-card="' + entry.unique_id
            + '">' + window.buildArgosReclassActionFieldsHtml(entry) + '</article>').join('');
    };
    window.buildArgosInventoryTransactionPayload = () => {
        const rowOverlays = window.testRows.map(entry => ({ unique_id: entry.unique_id,
            proposals: Object.values(window.getArgosReclassRowProposalMap(entry.unique_id, false) || {}).filter(value => value.action) }));
        const payload = { idempotencyToken: 'stable-command', rowOverlays, transaction: {} };
        window.collectReclassExplanations(payload);
        return payload;
    };
    window.applyArgosInventoryReclassMoveCommand = async (_state, payload) => {
        window.testCommands.push(structuredClone(payload));
        await new Promise(resolve => setTimeout(resolve, 20));
        return { ok: true };
    };
}

async function mount(page, config) {
    if (page.url() === 'about:blank') {
        await page.route('http://reclass.fixture/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' }));
        await page.goto('http://reclass.fixture/');
    }
    await page.setContent('<main><div id="rows"></div><button id="argos-inventory-transaction-apply" onclick="submitArgosInventoryTransaction(event)">Apply</button></main>');
    await page.evaluate(browserIdentity, config);
    await page.evaluate(browserEditor);
    await page.addScriptTag({ content: policy });
    await page.addScriptTag({ content: explanation });
    await page.addScriptTag({ content: modal });
    await page.addScriptTag({ content: proposal });
    await page.addScriptTag({ content: submission });
    await page.evaluate(() => window.refreshArgosReclassMultiActionUi());
}

async function stageMove(page, uid = 'row-0', destination = 'F1') {
    const card = page.locator('[data-reclass-row-card="' + uid + '"]');
    await card.locator('[data-reclass-v3-action="move_up"]').click();
    await card.getByRole('spinbutton', { name: 'Move Up quantity 1', exact: true }).fill('7');
    await card.getByRole('combobox', { name: 'Move Up destination 1', exact: true }).selectOption(destination);
}

async function submittedCommands(page) {
    await page.waitForFunction(() => !window.argosInventoryTransactionState.submitting);
    return page.evaluate(() => window.testCommands);
}

test('real Chromium stages and submits individual and batch Y moves for arbitrary active admin roles', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const role of ['Admin', 'super-admin']) {
            const page = await browser.newPage();
            await mount(page, { role, profileRole: 'REP', seasons: ['Y', 'Y'] });
            await stageMove(page);
            await page.getByRole('button', { name: 'Apply', exact: true }).click();
            const single = await submittedCommands(page);
            assert.equal(single.length, 1);
            assert.equal(single[0].rowOverlays[0].proposals[0].splits[0].quantity, '7');
            await mount(page, { role, actor: 'another_unlisted_actor', seasons: ['Y', 'Y'] });
            await stageMove(page, 'row-0');
            await stageMove(page, 'row-1');
            await page.getByRole('button', { name: 'Apply', exact: true }).dblclick();
            const batch = await submittedCommands(page);
            assert.equal(batch.length, 1, 'duplicate activation keeps the single-flight command');
            assert.equal(batch[0].rowOverlays.filter(row => row.proposals.length).length, 2);
            assert.equal(batch[0].idempotencyToken, 'stable-command');
            await page.close();
        }
    } finally { await browser.close(); }
});

test('real Chromium retains non-admin explanation and source/module/account restrictions', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, { role: 'eval', standardAllowed: true });
        await page.locator('[data-reclass-v3-action="move_up"]').click();
        assert.equal(await page.getByRole('spinbutton', { name: 'Move Up quantity 1', exact: true }).count(), 0);
        await page.getByRole('textbox', { name: 'Reclass Explanation', exact: true }).fill('Approved physical row adjustment');
        await stageMove(page);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        assert.equal((await submittedCommands(page)).length, 1);
        for (const config of [{ role: 'eval' }, { role: 'eval', standardAllowed: true, bareLot: true }, { role: 'Admin', moduleDenied: true },
            { role: 'Admin', active: false }, { role: 'Admin', unauthenticated: true }]) {
            await mount(page, config);
            await page.locator('[data-reclass-v3-action="move_up"]').click();
            assert.equal(await page.getByRole('spinbutton', { name: 'Move Up quantity 1', exact: true }).count(), 0);
            await page.getByRole('button', { name: 'Apply', exact: true }).click();
            assert.equal((await submittedCommands(page)).length, 0);
        }
        await page.close();
    } finally { await browser.close(); }
});

async function installCanonicalBrowserAccess(page, legacy) {
    await page.evaluate(() => { delete window.GncUserAccessControl; });
    await page.addScriptTag({ content: read('assets/access-matrix-policy.js') });
    await page.addScriptTag({ content: read('assets/row-access-policy.js') });
    await page.addScriptTag({ content: read('assets/user-access-control.js') });
    await page.evaluate(async legacySession => {
        const profileId = '54c87ebf-d76d-452b-96b4-beaaeb1742d9';
        window.nativeAuthProfile.id = profileId;
        window.testMatrix.profile_id = profileId;
        window.testMatrix.edit_any_row = 'N';
        window.nativeAuthSessionActive = !legacySession;
        window.nativeAuthSessionUserId = profileId;
        window.hasExplicitLogoutMarker = () => false;
        window.hasConfirmedCurrentAccountRevocation = () => false;
        window.readPersistedAppSessionRecord = () => ({ username: window.currentUser, token: 'fixture-token', expiresAt: Date.now() + 60000 });
        window.getCurrentAppSessionToken = () => 'fixture-token';
        const profile = { id: profileId, username: window.currentUser, display_name: window.currentUser, role: 'Admin' };
        const permissions = Object.fromEntries(window.GncUserAccessControl.permissionKeys.map(key => [key, key === 'can_access_drive_mode']));
        window.GncUserAccessControl.configure({ getSessionIdentity: window.getCanonicalAccessSessionIdentity,
            matrixLoader: legacySession ? null : async () => ({ data: [window.testMatrix] }),
            transport: async () => ({ ok: true, matrix: window.testMatrix, profile, baseline: { role: 'Admin', permissions },
                effective_permissions: permissions, permission_overrides: {}, revision: 1,
                data_hydration_policy: { use_shared_instant_snapshot: true, av_season_rule: 'ALL', av_visibility_rule: 'ALL' } }) });
        if (!legacySession) await window.GncUserAccessControl.preloadAccessMatrix();
        await window.GncUserAccessControl.loadSelf();
        window.resolveUserAccessMatrix = window.GncUserAccessControl.resolveUserAccessMatrix;
    }, legacy);
}

function browserOpenContext() {
    Object.assign(window, { activeDetailSourceView: '', lastView: 'drive', argosInquiryOpenRevision: 0,
        argosInquiryReadController: null, firstNonEmptyValue: (...values) => values.find(value => value != null && value !== '') || '',
        escJsAttrValue: value => String(value), findItemByUniqueId: uid => window.testRows.find(row => row.unique_id === uid)?.sourceRow,
        getVerifiedCachedArgosItemInquiryGroup: () => null, getReadableCachedArgosItemInquiryGroup: () => null,
        ensureArgosInventoryTransactionModal: () => document.getElementById('worksheet'),
        getArgosInventorySourceSnapshot: row => ({ uniqueId: row.UNIQUE_ID, commonName: 'Fixture Y row' }),
        buildItemInquiryViewModel: () => ({ locationRows: window.testRows }), getItemInquiryRows: () => window.testRows.map(row => row.sourceRow),
        resetArgosReclassMultiActionState() {}, getDriveSearchTerm: () => '', readPendingArgosInventoryReclassMove: () => null,
        refreshArgosInventoryTransactionLotOptions() {}, refreshArgosInventoryTransactionPriorityOptions() {},
        setArgosInventoryTransactionHoldAction() {}, isEvalWorkManagerUser: () => false,
        captureArgosInventoryTransactionDraftBaseline: () => [], canUseProductionLiveSync: () => false,
        renderArgosReclassInquiryEditor: () => '<div id="rows">' + window.testRows.map(entry => '<article data-reclass-row-card="'
            + entry.unique_id + '">' + window.buildArgosReclassActionFieldsHtml(entry) + '</article>').join('') + '</div>' });
    document.body.innerHTML = '<div id="card-entry"></div><section id="worksheet" class="hidden"><div id="argos-reclass-item-inquiry"></div>'
        + '<button id="argos-inventory-transaction-apply" onclick="submitArgosInventoryTransaction(event)">Apply</button></section>';
}

test('real Chromium native and legacy matrix loading exposes the Drive card entry with submit_reclass=N and edit_any=N', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const legacy of [false, true]) {
            await mount(page, { role: 'Admin', profileRole: 'REP', actor: 'unlisted_current_admin', bareLot: legacy });
            await installCanonicalBrowserAccess(page, legacy);
            await page.evaluate(browserOpenContext);
            await page.addScriptTag({ content: appFunction('assets/app-runtime.js', 'isArgosInventoryTransactionEligible') });
            await page.addScriptTag({ content: appFunction('assets/app-runtime.js', 'buildArgosInventoryTransactionRailHtml') });
            const state = await page.evaluate(() => {
                document.getElementById('card-entry').innerHTML = window.buildArgosInventoryTransactionRailHtml(window.testRows[0].sourceRow, 'drive');
                return { self: window.GncUserAccessControl.getSelfState().verified, matrix: window.resolveUserAccessMatrix(window.currentUser) };
            });
            assert.equal(state.self, true);
            assert.equal(state.matrix.submit_reclass, 'N');
            assert.equal(state.matrix.edit_any_row, 'N');
            await page.getByRole('button', { name: 'Open reclass transaction', exact: true }).click();
            await stageMove(page);
            await page.getByRole('button', { name: 'Apply', exact: true }).click();
            assert.equal((await submittedCommands(page)).length, 1);
        }
        await page.close();
    } finally { await browser.close(); }
});

test('real Chromium rechecks every staged source and rejects a mixed batch after a row permission change', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, { role: 'Admin', standardAllowed: true, seasons: ['Y', 'F1'] });
        await stageMove(page, 'row-0');
        await stageMove(page, 'row-1', 'S1');
        await page.evaluate(() => { window.testConfig.deniedRow = 'row-1'; });
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        assert.equal((await submittedCommands(page)).length, 0);
        assert.equal(await page.locator('[data-reclass-row-card="row-1"] [data-reclass-move-action="move_up"]').count(), 1);
        assert.ok(await page.evaluate(() => window.testNotices.some(notice => /assigned/i.test(notice[1]))));
        await mount(page, { role: 'Admin', standardAllowed: true, seasons: ['F1', 'Y'] });
        await stageMove(page, 'row-1');
        await page.evaluate(() => { window.testConfig.standardAllowed = false; });
        assert.equal(await page.evaluate(() => window.authorizeArgosReclassRow(window.testRows[0].sourceRow, 'drive', 'open')), false);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        const onlyY = await submittedCommands(page);
        assert.equal(onlyY.length, 1, 'an already open worksheet authorizes the changed Y row independently of its untouched F1 origin');
        assert.equal(onlyY[0].rowOverlays[0].proposals.length, 0);
        assert.equal(onlyY[0].rowOverlays[1].proposals.length, 1);
        await page.close();
    } finally { await browser.close(); }
});
