import test from 'node:test';
import {photoRecoveryContract,stagedReclassContract,suspendLocationContract} from './helpers/photo-suspend-contract.mjs';
test('quota recovery is exact-row authenticated and reports failed persistence',photoRecoveryContract);
test('Reclass retains two open rows and both staged drafts',stagedReclassContract);
test('Suspend opens canonical evidence and updates only its exact order source',suspendLocationContract);

test('cooldown expires and preserves authorization',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.photoCooldownContract();});
test('fallback photos resolve through the existing catalog',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.fallbackHistoryContract();});
test('cache repair stays bounded and service-only',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');m.boundedCacheContract();});
test('reload persists bounded cooldown and detail warm-up remains read-only',async()=>{const m=await import('./helpers/photo-suspend-contract.mjs');await m.persistentPhotoWarmupContract();});

test('photo drafts, explicit completion, expiry and one-transaction attachment',async()=>{const m=await import('./helpers/photo-field-lifecycle-contract.mjs');await m.photoFieldLifecycleContract();});
