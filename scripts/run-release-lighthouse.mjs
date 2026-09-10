import { spawn } from 'node:child_process';
import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function mayRetryLighthouse(code, output, attempt) {
  return code !== 0 && attempt < 3 && /PROTOCOL_TIMEOUT|Waiting for DevTools protocol response has exceeded the allotted time/.test(output);
}

const root = fileURLToPath(new URL('../', import.meta.url));
async function runOnce() {
  let output = '';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/@lhci/cli/src/cli.js'), 'autorun', '--config=lighthouserc.json'], {cwd: root, env: process.env});
    child.on('error', reject);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      process.stdout.write(chunk);
      output = (output + chunk.toString()).slice(-2_000_000);
    });
    child.on('close', code => resolve({code: code ?? 1, output}));
  });
}

async function main() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await runOnce();
    if (result.code === 0) return;
    if (!mayRetryLighthouse(result.code, result.output, attempt)) {
      process.exitCode = result.code;
      return;
    }
    // Preserve failed diagnostics rather than delete them. Both paths are fixed
    // children of this repository; never follow a link or overwrite an archive.
    const source = path.join(root, '.lighthouseci');
    const archive = path.join(root, `.lighthouseci-attempt-${attempt}`);
    const info = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('LIGHTHOUSE_OUTPUT_INVALID');
      if (await lstat(archive).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('LIGHTHOUSE_ARCHIVE_EXISTS');
      await rename(source, archive);
    }
    console.log(`Retrying Lighthouse after protocol timeout (${attempt}/3); failed diagnostics retained.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
