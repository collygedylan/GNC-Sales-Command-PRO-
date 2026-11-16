import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {engineeringFingerprint} from '../../scripts/engineering-proof.mjs';

export function assertStackedEvalSorting(locationContext,functionSource,runFunctions,plain) {
  const client = locationContext({
    getManagerEvalReportRowLocation: row => row.locationcode,
    getDriveColumnItemValue: (row, key) => row[String(key).toLowerCase()] ?? row[key] ?? '',
    getManagerEvalReports2Api: () => ({ SEASON_ORDER: ['S1', 'F1'], normalizeSalesYear: Number }),
  });
  vm.runInContext([
    functionSource('assets/app-runtime.js', 'compareLocationCodeValues'),
    functionSource('assets/app-runtime.js', 'compareManagerEvalReport2Natural'),
    functionSource('assets/app-runtime.js', 'compareManagerEvalReport2InventoryRows'),
  ].join('\n'), client);
  const rows = [{ locationcode: 'G.20.000' }, { locationcode: 'D.04.000' }, { locationcode: 'F.19.000' }, { locationcode: 'D.04.000', lotcode: '27.F1' }];
  rows.sort(client.compareManagerEvalReport2InventoryRows);
  assert.deepEqual(rows.map(row => row.locationcode), ['D.04.000', 'D.04.000', 'F.19.000', 'G.20.000']);
  const server = runFunctions('supabase/functions/app-api/index.ts', ['compareLocationCodeNatural', 'sortManagerEval2PreviewRows']);
  const previewRows = Array.from({ length: 12 }, (_, index) => ({ locationcode: `C.${12 - index}.000`, lotcode: `27.${index}` }));
  const sorted = plain(server.sortManagerEval2PreviewRows({ rows: [{ previewRows }] }));
  assert.equal(sorted.rows[0].previewRows.length, 12);
  assert.deepEqual(sorted.rows[0].previewRows.slice(0, 3).map(row => row.locationcode), ['C.1.000', 'C.2.000', 'C.3.000']);
}

async function parserFixture() {
  const dir=await mkdtemp(path.join(os.tmpdir(),'gnc-parser-proof-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,windowsHide:true,stdio:'pipe'});
  git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  await writeFile(path.join(dir,'package.json'),'{}');
  await writeFile(path.join(dir,'.gitignore'),'node_modules/\n');
  for(const name of ['acorn','eslint-scope','typescript-eslint','typescript','esbuild','react','react-dom','shared-parser',`@esbuild/${process.platform}-${process.arch}`]) {
    const folder=path.join(dir,'node_modules',name);
    await mkdir(folder,{recursive:true});
    const dependencies=name==='acorn'?{'shared-parser':'*'}:name==='shared-parser'?{acorn:'*'}:{};
    await writeFile(path.join(folder,'package.json'),JSON.stringify({name,main:'index.js',dependencies}));
    await writeFile(path.join(folder,'index.js'),'module.exports=1;\n');
  }
  git('add','.');git('commit','-qm','fixture');
  return dir;
}

export async function assertParserProofCoverage() {
  const dir=await parserFixture();
  try {
    const digest=await engineeringFingerprint(dir);
    assert.deepEqual(await Promise.all([engineeringFingerprint(dir),engineeringFingerprint(dir)]),[digest,digest]);
    const nested=path.join(dir,'node_modules/shared-parser/index.js');
    await writeFile(nested,'module.exports=2;\n');
    assert.notEqual(await engineeringFingerprint(dir),digest);
    await writeFile(nested,'module.exports=1;\n');
    assert.equal(await engineeringFingerprint(dir),digest);
    const added=path.join(dir,'node_modules/react-dom/new-parser.js');
    await writeFile(added,'module.exports=3;\n');
    assert.notEqual(await engineeringFingerprint(dir),digest);
    await rm(added);
    assert.equal(await engineeringFingerprint(dir),digest);
    await rm(nested);
    await assert.rejects(engineeringFingerprint(dir),error=>error.code==='ENOENT' || /Parser dependency missing/.test(error.message));
  } finally {
    if(path.dirname(dir)!==path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('gnc-parser-proof-')) throw Error('Unsafe parser fixture path');
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
}
