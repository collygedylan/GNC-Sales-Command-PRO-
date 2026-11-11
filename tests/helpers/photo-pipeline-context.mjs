import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {functionSource} from './completed-row-contract.mjs';

const functions = new Map();
for (const file of ['src/core/inventory-photo-domain.js', 'src/services/app-api-transport.js', 'src/services/operational-rpc-retry.js',
    'src/engine/confirmed-evaluation-ui.js', 'src/engine/canonical-inventory-evidence.js']) {
    const source = fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
    simple(parse(source, {ecmaVersion:'latest', sourceType:'module'}), {
        FunctionDeclaration(node) { functions.set(node.id.name, source.slice(node.start, node.end)); }
    });
}

export function context(names, values = {}) {
    const result = vm.createContext({Blob, AbortController, TextEncoder, Uint8Array, crypto:webcrypto,
        setTimeout, clearTimeout, ...values});
    vm.runInContext(names.map(name => functions.get(name) || functionSource(name)).join('\n'), result);
    return result;
}
