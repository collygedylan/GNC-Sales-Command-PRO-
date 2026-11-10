import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResponsiveFilterRows, assertResponsiveHeader } from '../../scripts/drive-mobile-geometry.mjs';

const box = (left, top, width, height = 40) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('balanced desktop filters reject the old oversized mode and squeezed siblings', () => {
    const controls = [box(0, 0, 300), ...Array.from({ length: 6 }, (_, i) => box(306 + i * 126, 0, 120))];
    assert.doesNotThrow(() => assertResponsiveFilterRows({ width: 1440, controls }));
    assert.throws(() => assertResponsiveFilterRows({ width: 1440, controls: [box(0, 0, 900), ...controls.slice(1)] }));
    assert.throws(() => assertResponsiveFilterRows({ width: 1440, controls: [controls[0], box(306, 0, 50), ...controls.slice(2)] }));
});

test('mobile filters require two ordered rows without overlap', () => {
    const controls = [box(0, 0, 140), box(146, 0, 72), box(224, 0, 72), box(302, 0, 72),
        box(0, 44, 120), box(126, 44, 120), box(252, 44, 120)];
    assert.doesNotThrow(() => assertResponsiveFilterRows({ width: 390, controls }));
    assert.throws(() => assertResponsiveFilterRows({ width: 390, controls: controls.map(c => ({ ...c, top: 0 })) }));
    assert.throws(() => assertResponsiveFilterRows({ width: 390, controls: [controls[0], box(100, 0, 72), ...controls.slice(2)] }));
});

test('header allows a second action row while rejecting clipping and old sizes', () => {
    const header = { back: box(8, 0, 40), search: box(58, 0, 324), bloom: box(8, 50, 80), bloomParent: 'global-header-search-row' };
    assert.doesNotThrow(() => assertResponsiveHeader({ width: 390, header }));
    assert.throws(() => assertResponsiveHeader({ width: 390, header: { ...header, back: box(8, 0, 32, 32) } }));
    assert.throws(() => assertResponsiveHeader({ width: 390, header: { ...header, bloom: box(360, 50, 80) } }));
    assert.throws(() => assertResponsiveHeader({ width: 390, header: { ...header, bloom: box(70, 0, 80) } }));
});
