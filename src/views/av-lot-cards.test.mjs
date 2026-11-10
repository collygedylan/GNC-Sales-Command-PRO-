import assert from 'node:assert/strict';
import test from 'node:test';
import { getCanonicalAvLotKey, hydrateCanonicalAvLotCard, projectCanonicalInventoryRow } from '../engine/canonical-inventory-evidence.js';
import { collapseCanonicalAvLotRows } from './av-lot-cards.js';

const identity = {ITEMCODE:'010620.021.1', LOCATIONCODE:'E.07.000', LOTCODE:'27.F1', SALEYEAR:'2027', SEASON:'F1'};
const date = '2026-11-09T18:55:53.546Z';
const photos = 'https://photos.invalid/1.jpg,https://photos.invalid/2.jpg,https://photos.invalid/3.jpg';
const evaluated = {...identity, UNIQUE_ID:'evaluated', DOM_ID:'avo_evaluated', SPEC:'20–22" H', AV_NOTE:'SPEC – 20–22" H',
    PTRONHAND:46, PTRAVAILABLE:46, PTRREVIEWED:0, LOC_PHOTO_MATCH:30, MATCH:65, EVAL_BASELINE_AVAILABLE:46, S_LTS:39,
    PHOTO_LINK:photos, PHOTO_DATE:date, PHOTO_EXPIRES_AT:'2026-11-19T18:55:53.546Z'};
const remainder = {...identity, UNIQUE_ID:'remainder', DOM_ID:'avo_remainder', LOTCODE:' f1 ', PTRONHAND:2,
    PTRAVAILABLE:2, PTRREVIEWED:0, LOC_MATCH_QTY:0, S_LTS:39};

function resolver(masterRows = []) {
    const byUid = new Map(masterRows.map(row => [row.UNIQUE_ID, row]));
    const deps = {now: Date.parse('2026-11-10T03:00:00Z'), resolve: row => byUid.get(row.UNIQUE_ID) || row,
        getPhotoUrlList: value => String(value || '').split(',').filter(Boolean),
        getPhotoEntryDateMs: (_url, row) => Date.parse(row.PHOTO_DATE)};
    return card => hydrateCanonicalAvLotCard(card, deps);
}

test('AV groups the 27.F1 projections into the evaluated card and keeps both physical stocks', () => {
    const [card] = collapseCanonicalAvLotRows([remainder, evaluated, evaluated], resolver());
    assert.equal(card.UNIQUE_ID, evaluated.UNIQUE_ID);
    assert.equal(card.DOM_ID, evaluated.DOM_ID);
    assert.equal(card.PTRONHAND, 48);
    assert.equal(card.PTRAVAILABLE, 48);
    assert.equal(card.PTRREVIEWED, 0);
    assert.equal(card.LOC_PHOTO_MATCH, 31);
    assert.equal(card.S_LTS, 39);
    assert.equal(card.PHOTO_LINK, photos);
    assert.equal(card.SPEC, evaluated.SPEC);
    assert.equal(card.AV_NOTE, evaluated.AV_NOTE);
    assert.equal(evaluated.PTRONHAND, 46);
});

test('AV expands a previously collapsed snapshot and uses indexed physical evidence over its stale photos', () => {
    const snapshot = {...evaluated, __physicalInventoryRows:[evaluated, remainder]};
    const deleted = {...evaluated, PHOTO_LINK:'', PHOTO_DATE:'', LOC_PHOTO_MATCH:0};
    const [card] = collapseCanonicalAvLotRows([snapshot], resolver([deleted]));
    assert.equal(card.PTRONHAND, 48);
    assert.equal(card.PHOTO_LINK, '');
    assert.equal(card.LOC_PHOTO_MATCH, 0);
});

test('AV keeps another season, another year and an unqualified shorthand separate', () => {
    const unknown = {...remainder, SALEYEAR:''};
    const earlier = {...evaluated, UNIQUE_ID:'earlier', LOTCODE:'26.F1', SALEYEAR:'2026'};
    const summer = {...evaluated, UNIQUE_ID:'summer', LOTCODE:'27.U1', SEASON:'U1'};
    assert.equal(getCanonicalAvLotKey(unknown), '');
    assert.equal(getCanonicalAvLotKey({...evaluated, SALEYEAR:'2026'}), '');
    const result = collapseCanonicalAvLotRows([evaluated, remainder, earlier, summer, unknown], resolver());
    assert.deepEqual(result.map(row => row.UNIQUE_ID), ['evaluated', 'earlier', 'summer', 'remainder']);
});

test('AV never re-expands a depleted match and retains unknown inventory metrics', () => {
    const depleted = {...evaluated, PTRAVAILABLE:40, LOC_PHOTO_MATCH:24};
    const [card] = collapseCanonicalAvLotRows([depleted, {...remainder, PTRREVIEWED:undefined}], resolver());
    assert.equal(card.LOC_PHOTO_MATCH, 24);
    assert.equal(card.PTRREVIEWED, undefined);
});

test('a larger unevaluated physical sibling cannot inherit a named lot note and become the photo owner', t => {
    const stamp = Date.now() - 60_000;
    const owner = {...evaluated, PHOTO_LINK:'', SPEC:undefined, AV_NOTE:undefined, PHOTO_EXPIRES_AT:undefined};
    const larger = {...remainder, PTRONHAND:80, PTRAVAILABLE:80, LOC_MATCH_QTY:undefined};
    const note = {...identity, UNIQUE_ID:owner.UNIQUE_ID, PHOTO_LINK:photos, SPEC:evaluated.SPEC, AV_NOTE:evaluated.AV_NOTE, MATCH:65};
    const scope = 'fixture-account';
    const globals = {
        masterInventoryById:new Map([[owner.UNIQUE_ID,owner],[larger.UNIQUE_ID,larger]]),
        masterInventoryByItemCode:new Map([[identity.ITEMCODE,[owner,larger]]]),
        getManagerAssignedColumnState: () => ({noteScope:scope,locationSalesNotes:new Map([[identity.ITEMCODE,[note]]])}),
        getSupabaseReadIdentityScope: () => scope,
        getPhotoUrlList: value => String(value || '').split(',').filter(Boolean),
        getPhotoEntryDateMs: () => stamp,
        getPhotoRetentionFallbackDateMs: () => stamp
    };
    Object.assign(globalThis, globals);
    t.after(() => { for (const name of Object.keys(globals)) delete globalThis[name]; });
    const [card] = collapseCanonicalAvLotRows([larger,owner], projectCanonicalInventoryRow);
    assert.equal(card.UNIQUE_ID, owner.UNIQUE_ID);
    assert.equal(card.PTRONHAND, 126);
    assert.equal(card.PHOTO_LINK, photos);
    assert.equal(card.SPEC, evaluated.SPEC);
});
