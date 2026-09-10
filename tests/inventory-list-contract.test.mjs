import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../assets/inventory-list-contract.js', import.meta.url), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(source, context);
const contract = context.module.exports;
const fixture = JSON.parse(readFileSync(new URL('./fixtures/inventory-list-schema.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const physical = new Map(fixture.schema.map((column) => [column.name, column]));
const plain = (value) => JSON.parse(JSON.stringify(value));
const errorCode = { code: 'INVENTORY_LIST_CONTRACT_INVALID' };

function fullFixtureRows() {
    // Same physical columns and observed marginal null counts, not real row
    // values or correlations. Values are short, explicitly synthetic examples.
    return Array.from({ length: fixture.sampledRows }, (_, index) => Object.fromEntries(fixture.schema.map((column) => {
        const populated = index < column.sampleNonNullRows;
        const value = populated ? fixture.syntheticValues[column.name] : null;
        assert.notEqual(value, undefined, `Missing explicit synthetic value: ${column.name}`);
        return [column.name, column.name === 'unique_id' ? `${value}-${index}` : value];
    })));
}
function encode(rows) {
    // Emulate PostgREST's select alias transformation, with no invented columns
    // or extra payload padding. The same full rows supply both compared paths.
    return rows.map((row) => Object.fromEntries(contract.columns.map((column, index) => [contract.aliases[index], row[column]])));
}
function canonicalProjection(row) {
    return Object.fromEntries(contract.columns.map((column) => [column, row[column]]));
}
function literalFields(name) {
    const match = html.match(new RegExp(`const ${name} = (?:Object.freeze\\()?\\[([^]*?)\\]`));
    assert.ok(match, `Missing consumer field contract ${name}`);
    return Array.from(vm.runInNewContext(`[${match[1]}]`));
}
function helper(name) {
    const match = html.match(new RegExp(`        (?:async )?function ${name}\\([^]*?\\n        \\}`));
    assert.ok(match, `Missing real helper ${name}`);
    return match[0];
}

test('version, field positions and query aliases are immutable, explicit and physical', () => {
    assert.equal(contract.version, 'master-list-v1');
    assert.equal(contract.columns.length, 161); assert.equal(physical.size, 213);
    assert.equal(createHash('sha256').update(JSON.stringify(contract.columns)).digest('hex'),
        '1eb60845b951f8e6a0163daf2b8b2301cc7e187111636cb5a2dc91b92e1049c1', 'V1 must not silently change alias positions');
    assert.equal(new Set(contract.columns).size, contract.columns.length);
    assert.ok(Object.isFrozen(contract)); assert.ok(Object.isFrozen(contract.columns)); assert.ok(Object.isFrozen(contract.aliases));
    assert.equal(context.AgMetricInventoryList, contract);
    const query = new URLSearchParams(contract.buildQuery());
    assert.deepEqual([...query.keys()], ['select', 'order']);
    assert.equal(query.get('order'), 'unique_id.asc');
    assert.deepEqual(query.get('select').split(','), Array.from(contract.columns, (column, index) => `f${index}:${column}`));
    for (const column of contract.columns) assert.ok(physical.has(column), column);
    assert.ok(!query.get('select').includes('*'));
});

test('full-schema synthetic fixture preserves the observed null profile without padding', () => {
    const rows = fullFixtureRows();
    assert.equal(rows.length, 128);
    assert.equal(new Set(fixture.schema.map((column) => column.name)).size, 213);
    assert.deepEqual(Object.keys(rows[0]), fixture.schema.map((column) => column.name));
    for (const column of fixture.schema) {
        assert.equal(rows.filter((row) => row[column.name] !== null).length, column.sampleNonNullRows, column.name);
        assert.ok(['text', 'numeric', 'timestamp with time zone'].includes(column.type));
        assert.ok(column.sampleNonNullRows >= 0 && column.sampleNonNullRows <= fixture.sampledRows);
        if (column.sampleNonNullRows === 0) assert.ok(rows.every((row) => row[column.name] === null));
    }
    assert.equal(fixture.aggregateEvidence.physicalColumnCount, physical.size);
    assert.equal(fixture.aggregateEvidence.projectionColumnCount, contract.columns.length);
    assert.equal(fixture.aggregateEvidence.reductionPercent, 53.491);
});

test('same full-schema fixture is at least 50 percent smaller with projection and short aliases', (t) => {
    const full = fullFixtureRows(), encoded = encode(full);
    const fullBytes = Buffer.byteLength(JSON.stringify(full));
    const projectedBytes = Buffer.byteLength(JSON.stringify(full.map(canonicalProjection)));
    const compactBytes = Buffer.byteLength(JSON.stringify(encoded));
    assert.ok(compactBytes <= fullBytes * 0.5, `full=${fullBytes}, projected=${projectedBytes}, compact=${compactBytes}`);
    assert.deepEqual(plain(contract.decodeRows(encoded)), full.map(canonicalProjection));
    t.diagnostic(`Identical 128-row synthetic fixture: full=${fullBytes} B, projected=${projectedBytes} B, aliased=${compactBytes} B, reduction=${(100 * (1 - compactBytes / fullBytes)).toFixed(3)}%. Not compressed egress.`);
});

test('decoder preserves canonical names, nulls, empty strings, numeric text and numeric values without coercion', () => {
    const full = fullFixtureRows()[0];
    Object.assign(full, { pic_note: '', ptronhand: '000120.50', ptravailable: '0',
        photo_link: null, photo_name: null, flyer_match: 0, flyer_loc_match_qty: 12.5,
        eval_task_recount_qty: -0, eval_task_moved_up_qty: null });
    const wire = encode([full])[0], decoded = contract.decodeRow(wire);
    assert.equal(decoded.pic_note, ''); assert.equal(decoded.ptronhand, '000120.50'); assert.equal(decoded.ptravailable, '0');
    assert.equal(decoded.photo_link, null); assert.equal(decoded.photo_name, null);
    assert.equal(decoded.flyer_match, 0); assert.equal(decoded.flyer_loc_match_qty, 12.5);
    assert.equal(Object.is(decoded.eval_task_recount_qty, -0), true);
    assert.equal(decoded.eval_task_moved_up_qty, null);
    assert.notEqual(decoded, wire); assert.deepEqual(Object.keys(decoded), Array.from(contract.columns));
    decoded.pic_note = 'local unsaved draft';
    assert.equal(wire[contract.aliases[contract.columns.indexOf('pic_note')]], '');
    assert.deepEqual(plain(contract.decodeRows([])), []);
});

test('malformed arrays, missing aliases, extra keys and incorrect primitive types fail closed', () => {
    const original = encode([fullFixtureRows()[0]])[0];
    for (const invalid of [null, {}, '', 1]) assert.throws(() => contract.decodeRows(invalid), errorCode);
    assert.throws(() => contract.decodeRows(new Array(1)), errorCode, 'sparse arrays are not accepted as complete rows');
    for (const invalid of [null, [], 'row', 3]) assert.throws(() => contract.decodeRow(invalid), errorCode);
    const mutations = [
        (row) => { delete row.f0; },
        (row) => { row.unknown = 'extra'; },
        (row) => { delete row.f0; row.unknown = null; },
        (row) => { row.f0 = undefined; },
        (row) => { row.f0 = false; },
        (row) => { row.f0 = {}; },
        (row) => { row[contract.aliases[contract.columns.indexOf('ptravailable')]] = 100; },
        (row) => { row[contract.aliases[contract.columns.indexOf('flyer_match')]] = '12.5'; },
        (row) => { row[contract.aliases[contract.columns.indexOf('flyer_match')]] = Infinity; },
        (row) => { row[contract.aliases[contract.columns.indexOf('unique_id')]] = ' '; }
    ];
    for (const mutate of mutations) { const row = { ...original }; mutate(row); assert.throws(() => contract.decodeRow(row), errorCode); }
    assert.throws(() => contract.decodeRows([original, original]), errorCode);
    assert.throws(() => contract.decodeRow(fullFixtureRows()[0]), errorCode, 'full rows are not guessed to be aliased rows');
});

test('all initial, displayed, filterable and linked master fields have physical projection coverage', () => {
    const derivedAliases = { hrsseasonbegin: 'hsreasonbegin', seasonsupply: 'season_supply', holstopcode: 'holdstopcode', pick: 'pic_note' };
    const schemaAbsent = new Set(['ext_equiv_unit']);
    for (const name of ['MASTER_INITIAL_SELECT_FIELDS', 'DRIVE_COLUMN_FILTER_ALLOWED_HEADER_LABELS', 'DRIVE_DETAIL_ITEM_FIELD_ORDER', 'LINKED_ROW_SYNC_KEYS']) {
        for (const field of literalFields(name)) {
            const lower = field.toLowerCase(), physicalName = derivedAliases[lower] || lower;
            if (schemaAbsent.has(lower)) { assert.ok(!physical.has(lower)); continue; }
            assert.ok(physical.has(physicalName), `${name}: ${field} has a physical/derived mapping`);
            assert.ok(contract.columns.includes(physicalName), `${name}: ${field}`);
        }
    }
    for (const name of ['ptronhand', 'ptrreviewed', 'genusname', 'last_updated', 'filename', 'pic_note', 'picknote',
        'planstart', 'qa_code', 'field_tag_color', 'fieldtagcolor', 'warehousei', 'warehouseid', 'suspendto', 'suspend_to',
        'end_cap_folder', 'end_cap_qty', 'end_cap_level', 'ncr_approval_message', 'ncr_requested_by_email',
        'flyer_cat', 'flyer_title', 'flyer_inst', 'flyer_assigned', 'flyer_notes', 'dock_spec', 'dock_caliper', 'dock_note',
        'customername', 'consigneename', 'salesrepid', 'salesrepname', 'dock', 'dock_num', 'stopnumber', 'tripnumber']) {
        assert.ok(contract.columns.includes(name), `Shared consumer field ${name}`);
    }
});

test('real evidence baseline and Argos quantity inputs are identical after canonical decoding', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext([helper('firstNonEmptyValue'), helper('buildSecureDriveEvidenceBaseline'), helper('getArgosInventorySourceSnapshot')].join('\n'), ctx);
    ctx.formatArgosInventoryNumber = (value) => String(value);
    const full = fullFixtureRows()[0];
    Object.assign(full, { pic_note: 'Synthetic pick note', sales_note: 'Synthetic sales note',
        spec: '24 H', caliper: '1', match: '50', loc_match_qty: '25', initial_ptr: '50',
        photo_link: 'https://photos.example.invalid/evidence.webp', photo_name: 'synthetic.webp' });
    const decoded = contract.decodeRow(encode([full])[0]);
    const upper = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toUpperCase(), value]));
    assert.deepEqual(plain(ctx.buildSecureDriveEvidenceBaseline(upper(decoded))), plain(ctx.buildSecureDriveEvidenceBaseline(upper(full))));
    assert.deepEqual(plain(ctx.getArgosInventorySourceSnapshot(upper(decoded))), plain(ctx.getArgosInventorySourceSnapshot(upper(full))));
});

test('adversarial non-null full-only values remain unknown in list rows, never invented as zero or blank', () => {
    const full = fullFixtureRows()[0];
    const omitted = fixture.schema.map((column) => column.name).filter((name) => !contract.columns.includes(name));
    assert.equal(omitted.length, 52);
    omitted.forEach((name, index) => { full[name] = `SYNTHETIC FULL-ONLY ${index}`; });
    full.quantityordered = '987'; full.quantityshipped = '321'; full.unitprice = '45.67';
    const decoded = contract.markListRow(contract.decodeRow(encode([full])[0]));
    for (const name of omitted) {
        assert.equal(Object.hasOwn(decoded, name), false, name);
        assert.equal(decoded[name], undefined, name);
        assert.notEqual(full[name], null);
    }
    assert.equal(contract.isListRow(decoded), true);
    assert.equal(contract.isDetailRow(decoded, { scope: 'account-a', permissionVersion: 'policy-a', revision: '3', uniqueId: full.unique_id }), false);
    assert.equal(full.quantityordered, '987'); assert.equal(full.unitprice, '45.67');
});

test('completeness metadata is non-enumerable and exact-detail identity is fenced by account, permission and decimal revision', () => {
    const row = contract.markListRow(contract.decodeRow(encode([fullFixtureRows()[0]])[0]));
    const serialized = JSON.stringify(row);
    assert.equal(contract.isListRow(row), true);
    assert.ok(Object.isFrozen(contract.getCompleteness(row)));
    assert.ok(!Object.keys(row).includes(contract.metadataKey));
    assert.ok(!serialized.includes(contract.metadataKey));
    assert.equal(contract.getCompleteness(JSON.parse(serialized)), null, 'formatting/cache restoration must explicitly retag completeness');
    const fence = { scope: 'account-a', permissionVersion: 'policy-a', revision: '9007199254740993', uniqueId: row.unique_id };
    const full = { ...fullFixtureRows()[0], quantityordered: '987' };
    contract.markDetailRow(full, fence);
    assert.equal(contract.isDetailRow(full, fence), true);
    assert.equal(contract.isListRow(full), false);
    assert.equal(full.quantityordered, '987');
    for (const field of Object.keys(fence)) {
        assert.equal(contract.isDetailRow(full, { ...fence, [field]: field === 'revision' ? '9007199254740994' : 'other' }), false, field);
    }
    assert.equal(contract.isDetailRow(full), false);
    assert.throws(() => contract.markDetailRow(full, { ...fence, revision: 3 }), errorCode);
    assert.throws(() => contract.markDetailRow(full, { ...fence, uniqueId: 'another-row' }), errorCode);
    const formatted = { UNIQUE_ID: full.unique_id };
    contract.markDetailRow(formatted, fence);
    assert.equal(contract.isDetailRow(formatted, fence), true);
    formatted.UNIQUE_ID = 'another-row'; assert.equal(contract.isDetailRow(formatted, fence), false);
});
