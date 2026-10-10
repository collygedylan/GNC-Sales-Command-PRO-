import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Only public code/CSS from these production islands may enter the root cache.
// Account-scoped SWR data is memory-only and is never copied or precached here.
const islands = ['bunch-note', 'field-counting'];
export async function prepareLiveIslandAssets({ root, site }) {
  const assets = ['bunch-note-structured.js', 'bunch-note.css', 'bunch-note-cards.css', 'field-counting.js', 'field-counting.css'];
  for (const island of islands) {
    const directory = `${island}-chunks`;
    const entries = await readdir(path.join(root, 'assets', directory), { withFileTypes: true });
    if (!entries.length) throw new Error(`LIVE_ISLAND_CHUNKS_MISSING:${island}`);
    for (const entry of entries) {
      if (!entry.isFile() || !/^[\w-]+\.js$/.test(entry.name)) throw new Error('LIVE_ISLAND_ASSET_INVALID');
      assets.push(`${directory}/${entry.name}`);
    }
  }
  for (const asset of assets) {
    const target = path.join(site, 'assets', asset);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, 'assets', asset), target);
  }
  const workerPath = path.join(site, 'sw.js');
  let worker;
  try { worker = await readFile(workerPath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return assets; throw error; }
  const marker = /const DEFERRED_VIEW_ASSETS = \/\* release-generated \*\/ \[[\s\S]*?\];/;
  if (!marker.test(worker)) throw new Error('LIVE_ISLAND_PRECACHE_MARKER_MISSING');
  worker = worker.replace(marker, `const DEFERRED_VIEW_ASSETS = /* release-generated */ ${JSON.stringify(assets.sort().map(asset => `./assets/${asset}`), null, 2)};`);
  await writeFile(workerPath, worker);
  return assets;
}
