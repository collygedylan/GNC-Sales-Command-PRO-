import { build } from 'esbuild';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function removeObsoleteHistoricalRequestsChunks(chunkDirectory, retainedNames = []) {
  const retained = new Set(retainedNames);
  await mkdir(chunkDirectory, { recursive: true });
  for (const entry of await readdir(chunkDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^[\w-]+-[A-Z0-9]{8}\.js$/i.test(entry.name) && !retained.has(entry.name)) {
      await unlink(join(chunkDirectory, entry.name));
    }
  }
}

export async function compileHistoricalRequests({ root = process.cwd() } = {}) {
  const chunkDirectory = join(root, 'assets/historical-requests-chunks');
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      'historical-requests': 'components/historical-requests/mount.tsx',
      'historical-requests-chunks/HistoricalRequestsView': 'components/historical-requests/HistoricalRequestsView.tsx'
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    minify: true,
    write: false,
    metafile: true,
    outdir: 'assets',
    entryNames: '[dir]/[name]-[hash]',
    chunkNames: 'historical-requests-chunks/[name]-[hash]'
  });
  const outputFiles = result.outputFiles || [];
  const outputInfo = file => result.metafile.outputs[relative(root, file.path).replaceAll('\\', '/')];
  const mainFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/historical-requests/mount.tsx');
  const viewFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/historical-requests/HistoricalRequestsView.tsx');
  if (!mainFile || !viewFile) throw new Error('Historical requests build did not emit both lazy entry modules.');

  const mainPath = join(root, 'assets/historical-requests.js');
  const chunkPath = `./${relative(dirname(mainPath), viewFile.path).replaceAll('\\', '/')}`;
  const mainSource = Buffer.from(mainFile.contents).toString('utf8');
  if (!mainSource.includes('__HISTORICAL_REQUESTS_VIEW_CHUNK_URL__')) throw new Error('Historical requests lazy chunk placeholder is missing.');

  const chunks = outputFiles.filter(file => file !== mainFile);
  const outputs = new Map(chunks.map(file => [file.path, Buffer.from(file.contents)]));
  outputs.set(mainPath, Buffer.from(mainSource.replace('__HISTORICAL_REQUESTS_VIEW_CHUNK_URL__', chunkPath)));
  outputs.set(join(root, 'assets/historical-requests.css'), await readFile(join(root, 'components/historical-requests/historical-requests.css')));
  const inputs = [...Object.keys(result.metafile.inputs), 'components/historical-requests/historical-requests.css'];
  return { outputs, inputs, chunkDirectory };
}

export async function buildHistoricalRequests({ root = process.cwd() } = {}) {
  const { outputs, chunkDirectory } = await compileHistoricalRequests({ root });
  for (const [file, bytes] of outputs) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  const retained = [...outputs.keys()].filter(file => dirname(file) === chunkDirectory).map(file => basename(file));
  await removeObsoleteHistoricalRequestsChunks(chunkDirectory, retained);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildHistoricalRequests();
}
