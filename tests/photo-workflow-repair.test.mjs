import test from 'node:test';
import {assertPhotoSurfaceScope,assertPhotoFallback,assertPhotoRpcContracts,assertPhotoControlOrigin,assertPhotoPublicationStatus} from '../src/core/golden-photo-repair-contract.mjs';
test('photo mutations stay in actual Drive and Que surfaces without trusting master-table aliases',assertPhotoSurfaceScope);
test('every Edge photo error falls back to authenticated Storage and denied Storage never becomes Saved',assertPhotoFallback);
test('the finite photo RPC bridge rejects unknown names and invalid arguments before network dispatch',assertPhotoRpcContracts);

test('photo controls retain the exact detail origin over department chrome',assertPhotoControlOrigin);

test('photo slots wait for canonical publication before displaying Saved',assertPhotoPublicationStatus);
