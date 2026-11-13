import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const indexes = new Map();

export function indexReleaseDeclarations(source) {
    if (indexes.has(source)) return indexes.get(source);
    const declarations = new Map();
    simple(parse(source, { ecmaVersion: 'latest', sourceType: 'script' }), {
        FunctionDeclaration(node) {
            if (node.id) declarations.set(node.id.name, source.slice(node.start, node.end));
        }
    });
    const lookup = name => {
        assert.ok(declarations.has(name), `Missing production declaration: ${name}`);
        return declarations.get(name);
    };
    indexes.set(source, lookup);
    return lookup;
}
