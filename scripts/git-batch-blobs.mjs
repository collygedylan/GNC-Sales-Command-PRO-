import { spawn } from 'node:child_process';

export function parseGitBatch(buffer, expected) {
  const blobs = [];
  let offset = 0;
  for (let i = 0; i < expected; i++) {
    const end = buffer.indexOf(0, offset);
    if (end < 0) throw new Error('Incomplete Git batch header');
    const header = buffer.subarray(offset, end).toString('utf8');
    const match = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(header);
    if (!match) throw new Error(`Invalid Git batch object: ${header}`);
    const size = Number(match[2]);
    const start = end + 1, finish = start + size;
    if (!Number.isSafeInteger(size) || finish >= buffer.length || buffer[finish] !== 0)
      throw new Error('Incomplete Git batch blob');
    blobs.push(buffer.subarray(start, finish));
    offset = finish + 1;
  }
  if (offset !== buffer.length) throw new Error('Unexpected Git batch output');
  return blobs;
}

export async function readGitBlobs(root, specs) {
  if (!specs.length) return new Map();
  if (specs.some(spec => spec.includes('\0'))) throw new Error('Invalid Git object name');
  const chunks = [];
  const child = spawn('git', ['cat-file', '--batch', '-Z'], {cwd:root, windowsHide:true});
  child.stdout.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Git batch failed: ${code}`)));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(specs.join('\0') + '\0');
  await done;
  const blobs = parseGitBatch(Buffer.concat(chunks), specs.length);
  return new Map(specs.map((spec, index) => [spec, blobs[index]]));
}
