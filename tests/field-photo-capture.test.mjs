import test from 'node:test';
import { fieldPhotoContract } from './helpers/field-photo-contract.mjs';
test('field photos survive stale snapshots and stopped completion', fieldPhotoContract);
