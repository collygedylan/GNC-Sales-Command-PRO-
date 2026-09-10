import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function source(name) {
  const start = html.search(new RegExp(`        (?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, name);
  const end = html.indexOf('\n        }', start);
  assert.notEqual(end, -1, `${name} closes`);
  return html.slice(start, end + '\n        }'.length);
}
const PHOTO = 'https://photos.invalid/v2/new.webp';
const SECOND = 'https://photos.invalid/v2/second.webp';
const REMOTE = 'https://photos.invalid/v2/remote.webp';
const row = () => ({ UNIQUE_ID: 'row-a', ITEMCODE: 'item-a', LOCATIONCODE: 'location-a', LOTCODE: 'lot-a',
  SOURCE_TABLE: 'ph_master_inventory', LAST_UPDATED: 'v1', SAVED_PHOTO_LINK: '', SAVED_PHOTO_NAME: '', SPEC: 'original spec' });
const names = ['firstNonEmptyValue', 'appendPhotoCsvValue', 'getDrivePhotoIdentity', 'getDrivePhotoMasterItem',
  'usesProductionMasterListProjection', 'hasProductionMasterDetailForItem',
  'captureProductionMasterDetailOwnSave', 'continueProductionMasterDetailOwnSave', 'finishProductionMasterDetailOwnSave',
  'runWithProductionMasterDetailSaveQueue',
  'canUploadRowPhoto', 'canUploadRowPhotoByRole', 'getDrivePhotoDraftStorageKey', 'persistDrivePhotoDraftRecord', 'getDrivePhotoDraft',
  'hasPendingProtectedPhotoDrafts', 'beginDrivePhotoDraft', 'assertDrivePhotoDraftContext', 'buildDrivePhotoDraftPayload', 'applyConfirmedDrivePhotoFields',
  'persistDrivePhotoDraft', 'retryDrivePhotoSave', 'buildSecureDriveEvidencePayload', 'buildSecureDriveEvidenceBaseline',
  'normalizeDriveEvidenceComparable', 'buildSecureDriveEvidencePatch', 'createDriveEvidenceConflictState', 'getSecureDriveEvidenceWorkflow', 'saveSecureDriveEvidence', 'ensureAppApiWriteProxySession',
  'persistSharedPhotoMasterFields'];

function runtime(options = {}) {
  let generation = 1, username = 'actor-a', profileId = 'profile-a', isAdmin = true, ids = 0;
  const storage = options.storage || new Map();
  const calls = [], acknowledgements = [], cleared = [];
  let server = row(), handler = null, shellResumes = 0;
  const canonical = (value) => ({ ...value,
    UNIQUE_ID: value.UNIQUE_ID || value.unique_id, ITEMCODE: value.ITEMCODE || value.itemcode,
    LOCATIONCODE: value.LOCATIONCODE || value.locationcode, LOTCODE: value.LOTCODE || value.lotcode,
    SAVED_PHOTO_LINK: value.photo_link ?? value.SAVED_PHOTO_LINK ?? '',
    SAVED_PHOTO_NAME: value.photo_name ?? value.SAVED_PHOTO_NAME ?? '',
    LAST_UPDATED: value.last_updated ?? value.LAST_UPDATED });
  const ctx = vm.createContext({ Map, Set, AbortController, Date, Promise, URL, console,
    window: {}, navigator: { onLine: true }, sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    nativeAuthSessionActive: true, activeItem: row(), activeDetailSourceView: 'drive', lastView: 'drive',
    getDatasetState: () => ({ listProjectionVersion: '' }),
    captureLoginSessionOwnership: () => ({ generation, username, profileId }),
    isLoginSessionOwnershipCurrent: (owner) => owner.generation === generation && owner.username === username && owner.profileId === profileId,
    getRoleAccessState: () => ({ isAdmin }), canEditRowDetails: () => true,
    findLinkedMasterRow: () => null,
    mergePhotoCsvList: (values) => [...new Set(values.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean))].join(','),
    parsePhotoCsvValues: (value) => String(value || '').split(',').map((part) => part.trim()).filter(Boolean),
    formatFetchedRows: (rows) => rows.map(canonical),
    refreshDrivePhotoDraftUi: () => {},
    refreshPhotoAcrossViews: (item) => acknowledgements.push({ uid: item.UNIQUE_ID, url: item.SAVED_PHOTO_LINK }),
    clearPendingPhotoPreview: (...args) => cleared.push(args),
    scheduleDeferredShellReloadAfterTyping: () => { shellResumes++; },
    clearDriveEvidenceConflict: (item) => { delete item.__driveEvidenceConflict; },
    getDriveEvidenceConflictState: (item) => item.__driveEvidenceConflict || null,
    setDriveEvidenceConflict: (item, prefix, result) => { item.__driveEvidenceConflict = {
      code: result.code, canonicalSignature: result.row.LAST_UPDATED || result.row.last_updated,
      canonicalBaseline: ctx.buildSecureDriveEvidenceBaseline(canonical(result.row)), conflictFields: result.conflictFields || []
    }; },
    runWithDriveEvidenceCrossTabLock: async (uid, runner) => runner(),
    createStableClientBatchId: () => `test-${++ids}`,
    getDetailRowWriteTimeoutMs: () => 1000,
    waitForDriveEvidenceRetry: async () => {},
    showAppConfirm: async () => true, showToast: () => {},
    getCurrentAppSessionToken: () => '', getNativeAuthSession: async () => ({ access_token: 'synthetic-native-token' }),
    ensureNativeAppSessionBridge: async () => { throw new Error('Legacy bridge must not be requested'); },
    ensureLeafAssistantSession: async () => { throw new Error('Native upload must not bootstrap legacy auth'); },
    supabaseRpc: async (name, body) => {
      calls.push({ name, body: JSON.parse(JSON.stringify(body)) });
      if (handler) return handler(name, body);
      server = { ...server, ...body.p_evidence, last_updated: `v${calls.length + 1}`, av_rule_photo_updated_at: '2026-09-09T13:00:00Z' };
      return { ok: true, canonicalConfirmed: true, row: server, requestRows: [] };
    }
  });
  vm.runInContext(`const pendingDrivePhotoDrafts = new Map();
    const SECURE_DRIVE_EVIDENCE_PREFIXES = new Set(['ssn-', 'lsn-', 'na-']);
    const PROTECTED_DRIVE_PHOTO_PREFIXES = new Set(['ssn-', 'lsn-', 'na-', 'flyer-']);
    const DRIVE_EVIDENCE_TERMINAL_CONFLICT_CODES = new Set(['DRIVE_FIELD_CONFLICT','DRIVE_ROW_STALE','DRIVE_ROW_IDENTITY_CONFLICT']);
    const driveEvidenceAbortControllers = new Map();
    ${names.map(source).join('\n')}`, ctx);
  return { ctx, calls, acknowledgements, cleared, storage, setHandler: (value) => { handler = value; },
    switchActor: () => { generation++; username = 'actor-b'; profileId = 'profile-b'; },
    signInAgain: () => { generation++; }, setAdmin: (value) => { isAdmin = value; },
    shellResumes: () => shellResumes,
    stage(url = PHOTO, id = 'photo-1', item = ctx.activeItem) {
      const result = ctx.beginDrivePhotoDraft(item, 'ssn-', id);
      result.entry.publicUrl = url; result.entry.fileName = `${id}.webp`;
      ctx.persistDrivePhotoDraftRecord(result.draft);
      return result;
    }
  };
}

test('native photo session does not require a legacy bridge', async () => {
  const { ctx } = runtime();
  assert.equal(await ctx.ensureAppApiWriteProxySession(), true);
});

test('photo-only save sends the original baseline through the RPC and waits for acknowledgement', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  let release;
  r.setHandler(async (name, body) => {
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, canonicalConfirmed: true, row: { ...item, ...body.p_evidence, last_updated: 'v2' } };
  });
  const { draft, entry } = r.stage();
  entry.previews = [{ item, id: 'preview-1' }];
  const pending = r.ctx.persistDrivePhotoDraft(item, 'ssn-');
  assert.equal(item.SAVED_PHOTO_LINK, '');
  assert.equal(draft.baseline.photo_link, '');
  assert.equal(r.ctx.hasPendingProtectedPhotoDrafts(), true);
  assert.equal(r.calls[0].name, 'save_drive_evidence_v2');
  assert.equal(r.calls[0].body.p_baseline.photo_link, '');
  assert.equal(r.calls[0].body.p_evidence.photo_link, PHOTO);
  item.SPEC = 'typing while photo saves';
  release();
  assert.equal(await pending, true);
  assert.equal(item.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(item.SPEC, 'typing while photo saves');
  assert.equal(item.LAST_UPDATED, 'v2');
  assert.equal(r.cleared.length, 1);
  assert.equal(r.ctx.getDrivePhotoDraft(item), null);
  assert.equal(r.ctx.hasPendingProtectedPhotoDrafts(), false);
  assert.equal(r.shellResumes(), 1);
});

test('a confirmed save cannot apply to a new owner after its detail continuation awaits', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  r.ctx.captureProductionMasterDetailOwnSave = () => ({ fixture: true, readIdentity: 'same-scope' });
  r.ctx.getSupabaseReadIdentityScope = () => 'same-scope';
  r.ctx.continueProductionMasterDetailOwnSave = async () => { r.switchActor(); return false; };
  r.ctx.finishProductionMasterDetailOwnSave = () => {};
  const { draft } = r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-', { draft }), false);
  assert.equal(r.calls.length, 1, 'canonical confirmation is never resent after an auth change');
  assert.equal(item.SAVED_PHOTO_LINK, '');
  assert.equal(r.acknowledgements.length, 0);
});

test('a failed detail continuation does not retry an already canonical-confirmed photo write', async () => {
  const r = runtime();
  r.ctx.captureProductionMasterDetailOwnSave = () => ({ fixture: true, readIdentity: 'same-scope' });
  r.ctx.getSupabaseReadIdentityScope = () => 'same-scope';
  r.ctx.continueProductionMasterDetailOwnSave = async () => false;
  r.ctx.finishProductionMasterDetailOwnSave = () => {};
  r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(r.ctx.activeItem, 'ssn-'), true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.ctx.activeItem.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(r.ctx.getDrivePhotoDraft(r.ctx.activeItem), null);
});

test('new permissions after a confirmed write suppress stale scoped photo application without resending', async () => {
  const r = runtime(); let identity = 'scope-permission-1';
  r.ctx.captureProductionMasterDetailOwnSave = () => ({ readIdentity: identity });
  r.ctx.getSupabaseReadIdentityScope = () => identity;
  r.ctx.continueProductionMasterDetailOwnSave = async () => { identity = 'scope-permission-2'; return false; };
  r.ctx.finishProductionMasterDetailOwnSave = () => {};
  r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(r.ctx.activeItem, 'ssn-'), false);
  assert.equal(r.calls.length, 1);
  assert.equal(r.ctx.activeItem.SAVED_PHOTO_LINK, '');
  assert.equal(r.acknowledgements.length, 0);
});

test('a pending photo cannot use the client NO_CHANGES shortcut even for a duplicate URL', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  item.SAVED_PHOTO_LINK = PHOTO; item.SAVED_PHOTO_NAME = 'photo-1.webp';
  r.setHandler(async () => ({ ok: true, canonicalConfirmed: true, row: { ...item } }));
  r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), true);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].body.p_evidence, {});
});

test('failed persistence retains the uploaded URL and retries the same idempotent write without reupload', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  r.setHandler(async () => { const error = new Error('temporarily unavailable'); error.status = 503; throw error; });
  const { draft } = r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), false);
  assert.equal(item.SAVED_PHOTO_LINK, '');
  assert.equal(draft.entries[0].publicUrl, PHOTO);
  assert.equal(draft.state, 'retry');
  assert.equal(r.ctx.hasPendingProtectedPhotoDrafts(), true);
  const failedCalls = r.calls.length, firstKey = r.calls[0].body.p_idempotency_key;
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), false);
  assert.equal(r.calls.length, failedCalls, 'background work does not create a retry loop');
  r.setHandler(null);
  await r.ctx.retryDrivePhotoSave('ssn-');
  assert.equal(item.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(r.calls.at(-1).body.p_idempotency_key, firstKey);
  assert.equal(r.ctx.getDrivePhotoDraft(item), null);
});

test('two photos completing during a save retain both links and advance the canonical baseline', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  let release;
  r.setHandler(async (name, body) => {
    if (r.calls.length === 1) await new Promise((resolve) => { release = resolve; });
    return { ok: true, canonicalConfirmed: true, row: { ...item, ...body.p_evidence, last_updated: `v${r.calls.length + 1}` } };
  });
  const { draft } = r.stage();
  const first = r.ctx.persistDrivePhotoDraft(item, 'ssn-');
  r.stage(SECOND, 'photo-2');
  const second = r.ctx.persistDrivePhotoDraft(item, 'ssn-');
  release();
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(r.calls.length, 2);
  assert.equal(r.calls[1].body.p_baseline.photo_link, PHOTO);
  assert.equal(item.SAVED_PHOTO_LINK, `${PHOTO},${SECOND}`);
  assert.equal(draft.entries.length, 0);
});

test('canonical photo acknowledgement updates exact cached copies without replacing their field drafts', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  const master = { ...item, SPEC: 'server spec' }, av = { ...item, SPEC: 'unsubmitted AV field' };
  r.ctx.masterInventoryById = new Map([[item.UNIQUE_ID, master]]);
  r.ctx.avOpenInventoryById = new Map([[item.UNIQUE_ID, av]]);
  r.stage();
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), true);
  assert.equal(master.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(av.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(master.SPEC, 'server spec');
  assert.equal(av.SPEC, 'unsubmitted AV field');
});

test('same-field conflict keeps the photo until explicit review and preserves other-device additions', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  const remote = { ...item, photo_link: REMOTE, photo_name: 'remote.webp', last_updated: 'v2' };
  r.setHandler(async () => ({ ok: false, code: 'DRIVE_FIELD_CONFLICT', row: remote, conflictFields: ['photo_link'] }));
  const { draft } = r.stage();
  item.__driveEvidenceConflict = { code: 'existing-form-conflict' };
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), false);
  assert.equal(draft.state, 'review');
  assert.equal(item.__driveEvidenceConflict.code, 'existing-form-conflict');
  assert.equal(item.SAVED_PHOTO_LINK, '');
  assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-', { retry: true }), false);
  assert.equal(r.calls.length, 1, 'retry flag cannot bypass review');
  r.setHandler(null);
  await r.ctx.retryDrivePhotoSave('ssn-');
  assert.equal(r.calls[1].body.p_baseline.photo_link, REMOTE);
  assert.equal(r.calls[1].body.p_evidence.photo_link, `${REMOTE},${PHOTO}`);
  assert.equal(item.SAVED_PHOTO_LINK, `${REMOTE},${PHOTO}`);
  assert.equal(item.__driveEvidenceConflict.code, 'existing-form-conflict', 'photo acknowledgement does not clear another form draft conflict');
});

test('navigation saves only the captured row and never writes the new active row', async () => {
  const r = runtime(), original = r.ctx.activeItem;
  r.stage();
  r.ctx.activeItem = { ...row(), UNIQUE_ID: 'row-b' };
  assert.equal(await r.ctx.persistDrivePhotoDraft(original, 'ssn-'), true);
  assert.equal(r.calls[0].body.p_master_uid, 'row-a');
  assert.equal(original.SAVED_PHOTO_LINK, PHOTO);
  assert.equal(r.ctx.activeItem.SAVED_PHOTO_LINK, '');
});

test('account switch before or during the RPC cannot apply photo state to either session', async () => {
  const before = runtime(), original = before.ctx.activeItem;
  const { draft } = before.stage(); before.switchActor();
  await assert.rejects(before.ctx.persistDrivePhotoDraft(original, 'ssn-', { draft }), { code: 'DRIVE_PHOTO_CONTEXT_CHANGED' });
  assert.equal(before.calls.length, 0);
  const during = runtime(), item = during.ctx.activeItem;
  during.stage();
  during.setHandler(async (name, body) => {
    during.switchActor();
    return { ok: true, canonicalConfirmed: true, row: { ...item, ...body.p_evidence } };
  });
  assert.equal(await during.ctx.persistDrivePhotoDraft(item, 'ssn-'), false);
  assert.equal(item.SAVED_PHOTO_LINK, '');
  assert.equal(during.acknowledgements.length, 0);
  assert.equal(during.ctx.getDrivePhotoDraft(item), null);
});

test('same-account sign-in generation change and changed row identity both block late writes', async () => {
  const r = runtime(), item = r.ctx.activeItem;
  const { draft } = r.stage();
  r.signInAgain();
  await assert.rejects(r.ctx.persistDrivePhotoDraft(item, 'ssn-', { draft }), { code: 'DRIVE_PHOTO_CONTEXT_CHANGED' });
  const next = runtime(), target = next.ctx.activeItem;
  const staged = next.stage(); target.LOTCODE = 'changed-lot';
  await assert.rejects(next.ctx.persistDrivePhotoDraft(target, 'ssn-', { draft: staged.draft }), { code: 'DRIVE_PHOTO_CONTEXT_CHANGED' });
  assert.equal(next.calls.length, 0);
});

test('saved URLs survive reload as an explicit retry draft and stay private to the actor', async () => {
  const first = runtime(); first.stage();
  const restored = runtime({ storage: first.storage });
  const draft = restored.ctx.getDrivePhotoDraft(restored.ctx.activeItem);
  assert.equal(draft.state, 'retry');
  assert.equal(draft.entries[0].publicUrl, PHOTO);
  assert.equal(await restored.ctx.persistDrivePhotoDraft(restored.ctx.activeItem, 'ssn-'), false);
  assert.equal(restored.calls.length, 0);
  restored.switchActor();
  assert.equal(restored.ctx.getDrivePhotoDraft(restored.ctx.activeItem), null);
});

test('unconfirmed or wrong-row success responses never mark a photo saved', async () => {
  for (const wrongRow of [false, true]) {
    const r = runtime(), item = r.ctx.activeItem;
    r.stage();
    r.setHandler(async () => ({ ok: true, canonicalConfirmed: true, row: wrongRow ? { ...item, UNIQUE_ID: 'row-b', photo_link: PHOTO } : item }));
    assert.equal(await r.ctx.persistDrivePhotoDraft(item, 'ssn-'), false);
    assert.equal(item.SAVED_PHOTO_LINK, '');
    assert.equal(r.ctx.getDrivePhotoDraft(item).state, 'retry');
  }
});

test('AV photo permission matches Admin exact-master identity and other workflows stay unavailable', () => {
  const r = runtime(), item = r.ctx.activeItem;
  assert.equal(r.ctx.canUploadRowPhoto('na-', item, 'av'), true);
  assert.equal(r.ctx.canUploadRowPhoto('req-', item, 'av'), false);
  assert.equal(r.ctx.canUploadRowPhoto('na-', { ...item, LOTCODE: '' }, 'av'), false);
  assert.equal(r.ctx.canUploadRowPhoto('na-', { ...item, SOURCE_TABLE: 'ph_sales_office' }, 'av'), false);
  r.setAdmin(false);
  assert.equal(r.ctx.canUploadRowPhoto('na-', item, 'av'), false);
  assert.equal(r.ctx.canUploadRowPhoto('ssn-', item, 'drive'), false);
});

test('native shared-photo compatibility writer cannot issue a direct master PATCH', () => {
  const { ctx } = runtime();
  // The actual helper must return before reading any timer or write dependency.
  assert.equal(ctx.persistSharedPhotoMasterFields(ctx.activeItem), undefined);
});
