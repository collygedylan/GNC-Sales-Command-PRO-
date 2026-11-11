import test from 'node:test';
import { assertPortableRollup } from '../src/core/portable-rollup-contract.mjs';

test('Workbox uses the pinned official WASM Rollup with native addon loading disabled',assertPortableRollup);
