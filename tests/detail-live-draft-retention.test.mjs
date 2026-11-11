import test from 'node:test';
import {assertDetailLiveDraftRetention} from './helpers/detail-live-draft-contract.mjs';

test('detail drafts publish before photo completion and survive exact-row refreshes and upload failure',assertDetailLiveDraftRetention);
