import fs from 'node:fs';

export function readAccessControlSource() {
    const policy = fs.readFileSync(new URL('../../src/core/access-matrix-policy.js',import.meta.url),'utf8').replace(/^export /gm,'');
    return policy + '\n' + fs.readFileSync(new URL('../../assets/user-access-control.js',import.meta.url),'utf8');
}
