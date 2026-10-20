// @test-group: @release-validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReleaseAssetReferences } from '../scripts/run-release-smoke.mjs';

test('smoke preflight rejects incomplete support assets before launching browsers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<script src="./assets/runtime.js?v=release"></script><link href="./assets/cards.css">');
    fs.writeFileSync(path.join(root, 'assets/runtime.js'), '');
    assert.throws(() => assertReleaseAssetReferences(root), /RELEASE_SMOKE_ASSET_MISSING:.\/assets\/cards.css/);
    fs.writeFileSync(path.join(root, 'assets/cards.css'), '');
    assert.doesNotThrow(() => assertReleaseAssetReferences(root));
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('release-assets-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
