import {execFile, execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readGitBlobs} from './git-batch-blobs.mjs';

const semantic = /^\d+\.\d+\.\d+$/;

export function hasBackendReleaseChanges(root, staged = false) {
    const options = {cwd:root, encoding:'utf8', windowsHide:true};
    const args = ['diff','--name-only',...(staged ? ['--cached'] : []),'HEAD','--','supabase'];
    if (execFileSync('git',args,options).trim()) return true;
    return !staged && !!execFileSync('git',['ls-files','--others','--exclude-standard','--','supabase'],options).trim();
}

export function planFrontendOnlyPin(pkg, version, backendChanged) {
    const pin = pkg.frontendOnlyRelease;
    if (!pin) return null;
    if (!semantic.test(pin.version || '') || !semantic.test(pin.appApiVersion || '')) throw Error('RELEASE_APP_API_PIN_INVALID');
    if (pin.version !== pkg.version && pin.version !== version) return null;
    if (backendChanged) {
        if (pin.version === version) throw Error('RELEASE_FRONTEND_ONLY_BACKEND_CHANGED');
        return null;
    }
    return {...pin, version};
}

export function frontendOnlyPinFailures(pkg, edgeSource, backendChanged) {
    try {
        const pin = pkg.frontendOnlyRelease;
        if (pin?.version !== pkg.version) return [];
        planFrontendOnlyPin(pkg, pkg.version, backendChanged);
        const markers = ['const APP_RUNTIME_VERSION = "'+pin.appApiVersion+'"', 'const APP_RUNTIME_RELEASE = "AgData v'+pin.appApiVersion+'"'];
        return markers.every(marker => edgeSource.includes(marker)) ? [] : ['RELEASE_APP_API_PIN_MISMATCH'];
    } catch (error) { return [error.message]; }
}

export async function frontendOnlyReleaseFailures(root, read) {
    const edgeFile = 'supabase/functions/app-api/index.ts';
    const run = promisify(execFile);
    const [pkgText, edge, status, staged] = await Promise.all([
        read('package.json'), read(edgeFile),
        run('git',['status','--porcelain=v1','-z','--untracked-files=all','--','supabase'],{cwd:root, windowsHide:true}),
        readGitBlobs(root,[':package.json',':'+edgeFile]),
    ]);
    const rows = status.stdout.split('\0').filter(Boolean);
    const current = frontendOnlyPinFailures(JSON.parse(pkgText),edge,rows.length > 0);
    const index = frontendOnlyPinFailures(JSON.parse(staged.get(':package.json').toString()),staged.get(':'+edgeFile).toString(),rows.some(row => ![' ','?'].includes(row[0])));
    return [...current.map(issue => 'worktree: '+issue),...index.map(issue => 'index: '+issue)];
}
