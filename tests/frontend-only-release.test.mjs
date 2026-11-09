import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {planVersionSync} from '../scripts/sync-all-version-surfaces.mjs';
import {planFrontendOnlyPin,frontendOnlyPinFailures,frontendOnlyReleaseFailures} from '../scripts/frontend-only-release.mjs';

const pkg = {version:'9.0.1',frontendOnlyRelease:{version:'9.0.1',appApiVersion:'9.0.0'}};
const edge = 'const APP_RUNTIME_VERSION = "9.0.0";\nconst APP_RUNTIME_RELEASE = "AgData v9.0.0";\n';

test('frontend pin carry-forward preserves reviewed backend markers only without backend changes', () => {
    assert.deepEqual(planFrontendOnlyPin(pkg,'9.0.2',false),{version:'9.0.2',appApiVersion:'9.0.0'});
    assert.equal(planFrontendOnlyPin(pkg,'9.0.2',true),null);
    assert.throws(()=>planFrontendOnlyPin(pkg,'9.0.1',true),/FRONTEND_ONLY_BACKEND_CHANGED/);
    assert.equal(planFrontendOnlyPin({...pkg,frontendOnlyRelease:{...pkg.frontendOnlyRelease,version:'8.0.0'}},'9.0.2',false),null);
    assert.deepEqual(frontendOnlyPinFailures(pkg,edge,false),[]);
    assert.deepEqual(frontendOnlyPinFailures(pkg,edge.replace('9.0.0','9.0.1'),false),['RELEASE_APP_API_PIN_MISMATCH']);
});

function makeVersionFixture(root) {
    const files = ['version.json','src/ui/ops-pilot-state.js','package.json','package-lock.json','index.html','manifest.json','sw.js',
        'assets/app-runtime.js','supabase/functions/app-api/index.ts','scripts/build-live-shell.mjs','v2/public/manifest.webmanifest',
        'v2/src/services/api.ts','docs/architecture/agdata-symbol-index.json'];
    for (const file of files) {
        const out = path.join(root,file);fs.mkdirSync(path.dirname(out),{recursive:true});
        fs.writeFileSync(out,versionFixtureSource(file));
    }
    return files;
}

function versionFixtureSource(file) {
    if (file === 'package.json') return JSON.stringify(pkg,null,2)+'\n';
    if (file === 'package-lock.json') return JSON.stringify({version:pkg.version,packages:{'':{version:pkg.version}}})+'\n';
    if (file === 'supabase/functions/app-api/index.ts') return edge;
    if (file === 'version.json') return JSON.stringify({version:pkg.version,release:'AgData v'+pkg.version})+'\n';
    if (file === 'docs/architecture/agdata-symbol-index.json') return JSON.stringify({release:'AgData v'+pkg.version})+'\n';
    if (/manifest/.test(file)) return JSON.stringify({version:'AgData v'+pkg.version})+'\n';
    return 'const APP_VERSION = "9.0.1";\n';
}

test('real version plan and staged guard distinguish clean, unstaged, staged and untracked backend files', async () => {
    const temp = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(temp,'agdata-version-pin-'));
    assert.ok(root.startsWith(temp+path.sep));
    const git = (...args)=>execFileSync('git',args,{cwd:root,stdio:'ignore',windowsHide:true});
    try {
        const files = makeVersionFixture(root);
        git('init','--quiet');git('add','.');
        git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','baseline');
        const read = file=>fs.promises.readFile(path.join(root,file),'utf8');
        const clean = planVersionSync({root,version:'9.0.2',files});
        const next = JSON.parse(clean.edits.find(edit=>edit.file==='package.json').after);
        assert.deepEqual(next.frontendOnlyRelease,{version:'9.0.2',appApiVersion:'9.0.0'});
        assert.ok(!clean.edits.some(edit=>edit.file==='supabase/functions/app-api/index.ts'));
        assert.deepEqual(await frontendOnlyReleaseFailures(root,read),[]);
        const edgeFile = path.join(root,'supabase/functions/app-api/index.ts');fs.appendFileSync(edgeFile,'// changed implementation\n');
        assert.deepEqual(await frontendOnlyReleaseFailures(root,read),['worktree: RELEASE_FRONTEND_ONLY_BACKEND_CHANGED']);
        git('add','supabase');
        assert.deepEqual(await frontendOnlyReleaseFailures(root,read),['worktree: RELEASE_FRONTEND_ONLY_BACKEND_CHANGED','index: RELEASE_FRONTEND_ONLY_BACKEND_CHANGED']);
        fs.writeFileSync(edgeFile,edge);git('add','supabase');
        assert.deepEqual(await frontendOnlyReleaseFailures(root,read),[]);
        fs.writeFileSync(path.join(root,'supabase/new.sql'),'select 1;\n');
        const mixed = planVersionSync({root,version:'9.0.2',files});
        assert.equal(JSON.parse(mixed.edits.find(edit=>edit.file==='package.json').after).frontendOnlyRelease.version,'9.0.1');
        assert.match(mixed.edits.find(edit=>edit.file==='supabase/functions/app-api/index.ts').after,/VERSION = "9.0.2"/);
        assert.deepEqual(await frontendOnlyReleaseFailures(root,read),['worktree: RELEASE_FRONTEND_ONLY_BACKEND_CHANGED']);
    } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
