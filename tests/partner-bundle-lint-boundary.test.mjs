import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('sealed partner bundle stays provenance-pinned and only that bundle is outside authored lint', async () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'v2/public/partner/bundle-provenance.json'), 'utf8'));
  const bundle = provenance.files.find(file => file.path === 'assets/index-B5eWPKuw.js');
  assert.ok(bundle, 'partner provenance must pin the vendored JavaScript bundle');
  const bytes = fs.readFileSync(path.join(root, 'v2/public/partner', bundle.path));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), bundle.sha256);

  const eslint = new ESLint({ cwd: root });
  assert.equal(await eslint.isPathIgnored(path.join(root, 'v2/public/partner', bundle.path)), true);
  assert.equal(await eslint.isPathIgnored(path.join(root, 'v2/src/components/PartnerWorkspace.tsx')), false);
});
