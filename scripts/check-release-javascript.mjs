import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), files = [];
async function visit(directory) {
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['node_modules', '.git', 'dist', 'supabase', 'database', 'tests', 'tools'].includes(entry.name)) continue;
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(relative);
    else if (/\.(mjs|js)$/.test(entry.name)) files.push(relative);
  }
}
for (const directory of ['assets', 'services', 'utils', 'components', 'test']) await visit(directory);
files.push('sw.js', 'OneSignalSDKWorker.js');
let index = 0; const failures = [], started = Date.now();
await Promise.all(Array.from({ length: 4 }, async () => {
  while (index < files.length) {
    const file = files[index++];
    await new Promise(resolve => {
      const child = spawn(process.execPath, ['--check', file], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', error => { failures.push({ file, error: error.message }); resolve(); });
      child.on('close', code => { if (code !== 0) failures.push({ file, code, stderr }); resolve(); });
    });
  }
}));
console.log(JSON.stringify({ javascriptFiles: files.length, failures, elapsedMs: Date.now() - started }));
if (failures.length) process.exitCode = 1;
