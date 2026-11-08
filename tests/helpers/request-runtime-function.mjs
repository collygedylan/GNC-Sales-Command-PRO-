import assert from 'node:assert/strict';

export function extractRequestRuntimeFunction(appSource, name) {
    const match = appSource.match(new RegExp(`^( *)function ${name}\\(`, 'm'));
    assert.ok(match, `expected ${name} in composed runtime`);
    const start = match.index;
    const closing = `\n${name === 'getPhotoEntryDateMs' ? '        ' : match[1]}}`;
    const end = appSource.indexOf(closing, start);
    assert.notEqual(end, -1, `expected ${name} to close`);
    return appSource.slice(start, end + closing.length);
}

