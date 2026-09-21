import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'node_modules', '@phosphor-icons', 'web', 'src');
const targetRoot = path.join(root, 'assets', 'vendor', 'phosphor');
const weights = [
  ['regular', 'Phosphor.woff2'],
  ['bold', 'Phosphor-Bold.woff2'],
  ['duotone', 'Phosphor-Duotone.woff2'],
  ['fill', 'Phosphor-Fill.woff2'],
  ['light', 'Phosphor-Light.woff2']
];

for (const [weight, fontName] of weights) {
  const sourceDir = path.join(sourceRoot, weight);
  const targetDir = path.join(targetRoot, weight);
  await mkdir(targetDir, { recursive: true });
  await copyFile(path.join(sourceDir, 'style.css'), path.join(targetDir, 'style.css'));
  await copyFile(path.join(sourceDir, fontName), path.join(targetDir, fontName));
}

// Serve the pinned browser build locally; mobile editing must not depend on a CDN.
const fabricRoot = path.join(root, 'node_modules', 'fabric');
await copyFile(path.join(fabricRoot, 'dist', 'index.min.mjs'), path.join(root, 'assets', 'vendor', 'fabric-6.7.1.min.mjs'));
await copyFile(path.join(fabricRoot, 'LICENSE'), path.join(root, 'assets', 'vendor', 'fabric-LICENSE.txt'));
