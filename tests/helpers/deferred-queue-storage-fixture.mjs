import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {indexReleaseDeclarations} from './release-gems-declarations.mjs';

const read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8');
let normalize;
export function normalizeStoragePublicUrlFixture(value) {
    if (!normalize) {
        const context = vm.createContext({window:{location:{href:'https://example.test/'}},globalThis:null,URL,
            getSupabaseStorageOriginalUrl:()=>''});
        context.globalThis = context;
        vm.runInContext(read('assets/storage-request-guard.js'),context);
        context.window.AgDataStorageGuard = context.AgDataStorageGuard;
        const declarations = indexReleaseDeclarations(read('assets/app-runtime.js'));
        vm.runInContext(declarations('normalizeStoragePublicUrl'),context);
        normalize = context.normalizeStoragePublicUrl;
    }
    return normalize(value);
}
