import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareLiveIslandAssets } from '../scripts/live-island-assets.mjs';

test('release copies all deferred chunks and precaches only public root-island assets', async()=>{
 const base=await mkdtemp(path.join(tmpdir(),'gnc-island-assets-'));
 try {
  const root=path.join(base,'source'),site=path.join(base,'site');
  await mkdir(path.join(root,'assets'),{recursive:true});await mkdir(site);
  const worker=await readFile(new URL('../sw.js',import.meta.url),'utf8');await writeFile(path.join(site,'sw.js'),worker);
  for(const name of ['bunch-note-structured.js','bunch-note.css','bunch-note-cards.css','field-counting.js','field-counting.css'])await writeFile(path.join(root,'assets',name),'public code');
  for(const group of ['bunch-note','field-counting']){await mkdir(path.join(root,'assets',group+'-chunks'));await writeFile(path.join(root,'assets',group+'-chunks','screen-ABC12345.js'),'deferred code');}
  const assets=await prepareLiveIslandAssets({root,site});assert.equal(assets.length,7);
  for(const asset of assets)assert.equal(await readFile(path.join(site,'assets',asset),'utf8'),await readFile(path.join(root,'assets',asset),'utf8'));
  const built=await readFile(path.join(site,'sw.js'),'utf8');
  assert.match(built,/field-counting-chunks\/screen-ABC12345\.js/);assert.match(built,/\.\.\.DEFERRED_VIEW_ASSETS/);
  const list=JSON.parse(built.match(/release-generated \*\/ (\[[\s\S]*?\]);/)[1]);
  assert.ok(list.every(x=>x.startsWith('./assets/')&&!/v2|partner|reports|api/.test(x)));
  await writeFile(path.join(root,'assets','field-counting-chunks','unexpected.json'),'private');
  await assert.rejects(prepareLiveIslandAssets({root,site}),/ASSET_INVALID/);
 }finally {await rm(base,{recursive:true,force:true});}
});
