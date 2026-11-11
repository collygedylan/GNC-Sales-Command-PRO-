import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function assertPortableRollup() {
  const script = `
    const assert=require('node:assert/strict');
    const {createRequire}=require('node:module');
    require.extensions['.node']=()=>{throw Error('NATIVE_ADDON_FORBIDDEN')};
    assert.throws(()=>require.extensions['.node']({},'fixture.node'),/NATIVE_ADDON_FORBIDDEN/);
    const resolve=createRequire(require.resolve('workbox-build'));
    const pkg=resolve('rollup/package.json');
    assert.equal(pkg.name,'@rollup/wasm-node');
    resolve('rollup').rollup({input:'fixture',plugins:[{
      name:'fixture',resolveId:id=>id,load:()=> 'export default 65'
    }]}).then(bundle=>bundle.generate({format:'esm'})).then(result=>{
      assert.match(result.output[0].code,/65/);
      process.stdout.write('PORTABLE_ROLLUP_PASS');
    }).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
  `;
  const result=spawnSync(process.execPath,['-e',script],{
    cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',windowsHide:true,timeout:10000
  });
  assert.equal(result.status,0,result.stderr || result.error?.message);
  assert.equal(result.stdout,'PORTABLE_ROLLUP_PASS');
}
