import test from 'node:test';
import {assertDrivePostUpsert} from './helpers/erp-drive-post-upsert.mjs';

test('Invariant 659: compiled DRIVE reconciles only changed Item6 notes and preserves the raw publication path', assertDrivePostUpsert);
