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
const names = ['firstNonEmptyValue', 'extractDetailPrefixFromInputId', 'isLagSensitiveDetailPrefix',
  'usesProductionMasterListProjection', 'isProductionMasterDetailSessionCurrent', 'restoreProductionMasterDetailDraft',
  'shouldUseDebouncedDetailInputSave', 'handleConsolidatedDetailEvidenceInput',
  'getDetailHydrationDraftContext', 'isDetailHydrationDraftContextCurrent', 'rememberDetailHydrationInputEdit',
  'captureDetailHydrationInputDrafts', 'restoreDetailHydrationInputDrafts', 'runDeferredDetailHydration',
  'buildSecureDriveEvidencePayload', 'buildSecureDriveEvidenceBaseline', 'normalizeDriveEvidenceComparable', 'buildSecureDriveEvidencePatch'];

function runtime() {
  let generation = 1, allowed = true, renderHook = () => {};
  const fields = new Map(), queued = [];
  const detail = { querySelectorAll: () => [...fields.values()] };
  const document = { activeElement: null, getElementById: id => id === 'view-detail' ? detail : fields.get(id) };
  const ctx = vm.createContext({ WeakMap, Map, Set, console, document,
    activeItem: { UNIQUE_ID:'row-a', SOURCE_TABLE:'ph_master_inventory', ITEMCODE:'item-a', LOCATIONCODE:'location-a', LOTCODE:'lot-a', AV_NOTE:'', SPEC:'N/A' },
    activeDetailSourceView:'drive', lastView:'drive', activeDetailTab:'notes', detailHydrationToken:1,
    productionMasterDetailSession: null, getDatasetState: () => ({ listProjectionVersion: '' }),
    captureLoginSessionOwnership: () => ({ generation, username:'actor-a' }),
    isLoginSessionOwnershipCurrent: owner => owner.generation === generation,
    canEditRowDetails: () => allowed,
    isDetailMeasurementKeyboardInput: () => false,
    queueLagSensitiveInputSave: (...args) => queued.push(args),
    getCurrentVisibleViewId: () => 'detail', beginInternalPerfMeasure: () => 0,
    getPrimaryDetailTabForItemContext: () => 'overview', resolveVisibleDetailTab: tab => tab,
    recordInternalPerfDuration: () => {}, setRequestDetailLoadState: () => {}, reportSemanticHealthEvent: () => {},
    renderDetailView: () => {
      fields.get('na-av-note').value = ctx.activeItem.AV_NOTE;
      fields.get('na-spec').value = ctx.activeItem.SPEC;
      fields.get('na-pick').value = 'fresh canonical pick';
      renderHook();
    }
  });
  vm.runInContext(`const detailHydrationInputEditContexts = new WeakMap();\n${names.map(source).join('\n')}`, ctx);
  for (const [id, initial] of [['na-av-note',''], ['na-spec','N/A'], ['na-pick','old pick']]) {
    let value = initial;
    const field = { id, tagName:'INPUT', disabled:false, isConnected:true, selectionStart:0, selectionEnd:0, selectionDirection:'none',
      closest: selector => selector === '#view-detail' ? detail : null,
      focus: () => { document.activeElement = field; },
      setSelectionRange: (start, end, direction) => { field.selectionStart = start; field.selectionEnd = end; field.selectionDirection = direction; }
    };
    Object.defineProperty(field, 'value', { get: () => value, set: next => { value = next; field.selectionStart = field.selectionEnd = 0; } });
    fields.set(id, field);
  }
  return { ctx, fields, queued,
    edit(id, value, focus = true) {
      const field = fields.get(id);
      field.value = value;
      if (focus) field.focus();
      ctx.handleConsolidatedDetailEvidenceInput({ target:field });
      return field;
    },
    setRenderHook: fn => { renderHook = fn; }, switchSession: () => { generation++; }, deny: () => { allowed = false; }
  };
}

test('all supported detail field IDs resolve to their exact autosave prefix', () => {
  const h = runtime();
  for (const prefix of ['global-', 'ssn-', 'lsn-', 'na-', 'req-', 'dock-', 'flyer-']) {
    for (const suffix of ['av-note', 'spec', 'caliper', 'match', 'pick', 'comments']) {
      assert.equal(h.ctx.extractDetailPrefixFromInputId(prefix + suffix), prefix, prefix + suffix);
      assert.equal(h.ctx.shouldUseDebouncedDetailInputSave(prefix + suffix), true, prefix + suffix);
    }
  }
  assert.equal(h.ctx.shouldUseDebouncedDetailInputSave('unrelated-spec'), false);
});

test('late hydration retains focused and blurred edits and caret without changing the canonical baseline', () => {
  const h = runtime();
  h.edit('na-spec', '24-30 H');
  const note = h.edit('na-av-note', 'FRESH GROWTH');
  note.setSelectionRange(2, 5, 'backward');
  assert.equal(h.ctx.runDeferredDetailHydration(1), true);
  assert.equal(note.value, 'FRESH GROWTH');
  assert.equal(h.fields.get('na-spec').value, '24-30 H');
  assert.equal(h.fields.get('na-pick').value, 'fresh canonical pick', 'untouched fields still hydrate');
  assert.equal(h.ctx.document.activeElement, note);
  assert.deepEqual([note.selectionStart,note.selectionEnd,note.selectionDirection], [2,5,'backward']);
  assert.equal(h.ctx.activeItem.AV_NOTE, '');
  assert.equal(h.ctx.activeItem.SPEC, 'N/A');
  const baseline = h.ctx.buildSecureDriveEvidenceBaseline(h.ctx.activeItem);
  const patch = h.ctx.buildSecureDriveEvidencePatch({ av_note:note.value, spec:h.fields.get('na-spec').value }, baseline);
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), { spec:'24-30 H', av_note:'FRESH GROWTH' });
  assert.deepEqual(h.queued, [['na-', 'na-spec'], ['na-', 'na-av-note']]);
});

test('intentional empty input stays empty rather than restoring saved text', () => {
  const h = runtime();
  h.ctx.activeItem.AV_NOTE = 'OLD NOTE';
  h.edit('na-av-note', '');
  h.ctx.runDeferredDetailHydration(1);
  assert.equal(h.fields.get('na-av-note').value, '');
  assert.equal(h.ctx.activeItem.AV_NOTE, 'OLD NOTE');
});

for (const [name, change] of [
  ['new opening token', h => { h.ctx.detailHydrationToken++; }],
  ['different row', h => { h.ctx.activeItem.UNIQUE_ID = 'row-b'; }],
  ['same UID but different exact identity', h => { h.ctx.activeItem.LOCATIONCODE = 'location-b'; }],
  ['different source view', h => { h.ctx.activeDetailSourceView = 'av'; }],
  ['different login generation', h => h.switchSession()],
  ['revoked editing permission', h => h.deny()]
]) {
  test(`hydration cannot restore a draft after ${name}`, () => {
    const h = runtime();
    h.edit('na-av-note', 'old context draft');
    h.setRenderHook(() => change(h));
    h.ctx.runDeferredDetailHydration(1);
    assert.equal(h.fields.get('na-av-note').value, '');
  });
}

test('stale draft marker is ignored before capture and disabled fields are not restored', () => {
  const h = runtime();
  h.edit('na-av-note', 'stale');
  h.ctx.detailHydrationToken = 2;
  h.ctx.runDeferredDetailHydration(2);
  assert.equal(h.fields.get('na-av-note').value, '');
  h.edit('na-av-note', 'disabled');
  h.fields.get('na-av-note').disabled = true;
  h.ctx.runDeferredDetailHydration(2);
  assert.equal(h.fields.get('na-av-note').value, '');
});

test('a renderer error does not erase the draft while propagating the failure', () => {
  const h = runtime();
  h.edit('na-av-note', 'retained draft');
  h.setRenderHook(() => { throw new Error('RENDER_FAILED'); });
  assert.throws(() => h.ctx.runDeferredDetailHydration(1), /RENDER_FAILED/);
  assert.equal(h.fields.get('na-av-note').value, 'retained draft');
});

function requestVerificationRuntime() {
  const frames = [], timers = [], reports = [], panelStates = [], ensures = [];
  let generation = 1;
  const classList = () => { const values = new Set(); return { contains:key => values.has(key), add:key => values.add(key), remove:key => values.delete(key) }; };
  const controls = ['req-match','req-spec','req-av-note','req-btn-save-complete'].map(id => ({ id, visible:true,
    getClientRects() { return this.visible ? [{}] : []; } }));
  const content = { classList:classList(), height:400, querySelectorAll:() => controls,
    children:[{ getClientRects:() => content.height ? [{}] : [], getBoundingClientRect:() => ({height:content.height}) }] };
  const detail = { classList:classList() }, app = { classList:classList() };
  const ctx = vm.createContext({ console, document:{ getElementById:id => ({'view-detail':detail,'det-request-content':content,'app-wrapper':app})[id] },
    activeItem:{ UNIQUE_ID:'request-a', SOURCE_TABLE:'ph_active_request', ITEMCODE:'item-a', LOCATIONCODE:'location-a', LOTCODE:'lot-a' },
    activeDetailSourceView:'request', lastView:'request', activeDetailTab:'request', detailHydrationToken:1, visibleView:'detail',
    captureLoginSessionOwnership:() => ({generation,username:'actor-a'}),
    isLoginSessionOwnershipCurrent:owner => owner.generation === generation,
    getCurrentVisibleViewId:() => ctx.visibleView,
    requestAnimationFrame:fn => frames.push(fn), setTimeout:(fn,ms) => { assert.equal(ms,80); timers.push(fn); },
    scheduleRequestDetailEntryVisible:(...args) => ensures.push(args),
    setRequestDetailLoadState:(...args) => panelStates.push(args), reportSemanticHealthEvent:(...args) => reports.push(args),
    normalizeRuleText:value => String(value || '').trim(), isHoldReleaseOverrideActiveForItem:() => false,
    findLinkedMasterRow:() => null
  });
  const requestNames = ['firstNonEmptyValue','getDetailHydrationDraftContext','isDetailHydrationDraftContextCurrent',
    'captureRequestDetailRenderContext','isRequestDetailRenderContextCurrent','scheduleRequestDetailRenderVerification','verifyRequestDetailRendered',
    'normalizeHoldStopSnapshotValue','getHoldStopBlockTokens','getRawHoldStopSnapshotFromItem','getHoldStopSnapshotFromItem',
    'hasBlockingHoldStopCodeForAv','itemOrLinkedMasterHasBlockingHoldStopCodeForAv','requiresAvNoteForCompletion'];
  vm.runInContext(requestNames.map(source).join('\n'),ctx);
  return { ctx, controls, content, detail, app, frames, timers, reports, panelStates, ensures,
    switchSession:() => { generation++; },
    flushFrames:() => { while(frames.length) frames.shift()(); },
    flush:() => { while(frames.length || timers.length) { while(frames.length) frames.shift()(); if(timers.length) timers.shift()(); } }
  };
}

const invalidateRequestContexts = [
  ['closed Request', h => { h.ctx.activeItem = null; h.ctx.activeDetailSourceView = ''; h.ctx.activeDetailTab = 'overview'; h.ctx.detailHydrationToken++; h.detail.classList.add('hidden'); h.ctx.visibleView = 'request'; }],
  ['new opening token', h => { h.ctx.detailHydrationToken++; }],
  ['different Request row', h => { h.ctx.activeItem.UNIQUE_ID = 'request-b'; }],
  ['changed row identity', h => { h.ctx.activeItem.LOCATIONCODE = 'location-b'; }],
  ['changed source', h => { h.ctx.activeDetailSourceView = 'drive'; }],
  ['changed tab', h => { h.ctx.activeDetailTab = 'overview'; h.content.classList.add('hidden'); }],
  ['logout or new login', h => h.switchSession()],
  ['hidden detail ancestor', h => h.detail.classList.add('hidden')],
  ['hidden app ancestor', h => h.app.classList.add('hidden')],
  ['different primary view', h => { h.ctx.visibleView = 'home'; }]
];

for (const [name, invalidate] of invalidateRequestContexts) {
  test(`Request verification cannot retry, unhide, or report after ${name}`, () => {
    for (const phase of ['before-first-frame','between-frames','before-retry','after-retry-timer']) {
      const h = requestVerificationRuntime();
      h.content.height = 0;
      h.controls.forEach(control => { control.visible = false; });
      assert.equal(h.ctx.scheduleRequestDetailRenderVerification('render'),true);
      if(phase === 'between-frames') h.frames.shift()();
      if(phase === 'before-retry' || phase === 'after-retry-timer') h.flushFrames();
      if(phase === 'after-retry-timer') h.timers.shift()();
      const ensuresBeforeChange = h.ensures.length;
      invalidate(h);
      h.flush();
      assert.equal(h.ensures.length,ensuresBeforeChange,phase);
      assert.equal(h.reports.length,0,phase);
      assert.equal(h.panelStates.length,0,phase);
    }
  });
}

test('a visible genuinely blank current Request still retries once and reports render failure', () => {
  const h = requestVerificationRuntime();
  h.controls.forEach(control => { control.visible = false; });
  h.content.height = 0;
  h.ctx.scheduleRequestDetailRenderVerification('render');
  h.flush();
  assert.equal(h.ensures.length,1);
  assert.equal(h.reports.length,1);
  assert.equal(h.reports[0][2],'REQUEST_DETAIL_RENDER_FAILED');
  assert.equal(h.reports[0][3].controls,4);
  assert.equal(h.panelStates[0][0],'error');
});

test('an intact visible Request, including disabled read-only controls, does not report an error', () => {
  const h = requestVerificationRuntime();
  h.controls.forEach(control => { control.disabled = true; });
  assert.equal(h.ctx.verifyRequestDetailRendered('render'),true);
  assert.equal(h.ensures.length,0);
  assert.equal(h.reports.length,0);
});

test('hold and stop rules allow only the intentionally hidden AV Note, with all four controls still required', () => {
  for (const holdCode of ['H','S']) {
    const h = requestVerificationRuntime();
    h.ctx.activeItem.HOLDSTOPCODE = holdCode;
    h.controls[2].visible = false;
    assert.equal(h.ctx.requiresAvNoteForCompletion(h.ctx.activeItem),false);
    assert.equal(h.ctx.verifyRequestDetailRendered('render'),true);
    h.controls[1].visible = false;
    h.ctx.scheduleRequestDetailRenderVerification('render'); h.flush();
    assert.equal(h.reports.length,1,'hidden Spec must still be reported');
    h.reports.length = 0;
    h.controls[1].visible = true;
    h.controls.splice(2,1);
    h.ctx.scheduleRequestDetailRenderVerification('render'); h.flush();
    assert.equal(h.reports.length,1,'missing AV Note element must still be reported');
  }
});

test('an unexpectedly hidden AV Note on a normal Request remains a render error', () => {
  const h = requestVerificationRuntime();
  h.controls[2].visible = false;
  h.ctx.scheduleRequestDetailRenderVerification('render'); h.flush();
  assert.equal(h.reports.length,1);
});
