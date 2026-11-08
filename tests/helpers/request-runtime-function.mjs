import assert from 'node:assert/strict';
import { tokenizer } from 'acorn';

function trackFunctionBodyToken(state, token) {
    const label = token.type.label;
    if (!state.bodyStarted) {
        if (label === '(') state.parameterDepth += 1;
        if (label === ')') state.parameterDepth -= 1;
        if (label === '{' && state.parameterDepth === 0) {
            state.bodyStarted = true;
            state.bodyDepth = 1;
        }
        return false;
    }
    if (label === '{' || label === '${') state.bodyDepth += 1;
    if (label === '}') state.bodyDepth -= 1;
    return state.bodyDepth === 0;
}

function findFunctionEnd(source, start) {
    const state = { parameterDepth: 0, bodyDepth: 0, bodyStarted: false };
    for (const token of tokenizer(source.slice(start), { ecmaVersion: 'latest' })) {
        if (trackFunctionBodyToken(state, token)) return start + token.end;
    }
    return -1;
}

export function extractRequestRuntimeFunction(appSource, name) {
    const match = appSource.match(new RegExp(`^( *)function ${name}\\(`, 'm'));
    assert.ok(match, `expected ${name} in composed runtime`);
    const start = match.index;
    const end = findFunctionEnd(appSource, start);
    assert.notEqual(end, -1, `expected ${name} to close`);
    return appSource.slice(start, end);
}

