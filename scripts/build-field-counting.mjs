import { build } from 'esbuild';
import { copyFile, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function removeObsoleteFieldCountingChunks(chunkDirectory, retainedNames = []) {
  const retained = new Set(retainedNames);
  await mkdir(chunkDirectory, { recursive: true });
  for (const entry of await readdir(chunkDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^[\w-]+-[A-Z0-9]{8}\.js$/i.test(entry.name) && !retained.has(entry.name)) {
      await unlink(join(chunkDirectory, entry.name));
    }
  }
}

export async function buildFieldCounting({ root = process.cwd() } = {}) {
  const chunkDirectory = join(root, 'assets/field-counting-chunks');
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      'field-counting': 'components/field-counting/mount.tsx',
      'field-counting-chunks/FieldCountingView': 'components/field-counting/FieldCountingView.tsx'
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
    chunkNames: 'field-counting-chunks/[name]-[hash]'
  });
  const outputFiles = result.outputFiles || [];
  const outputInfo = file => result.metafile.outputs[relative(root, file.path).replaceAll('\\', '/')];
  const mainFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/field-counting/mount.tsx');
  const viewFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/field-counting/FieldCountingView.tsx');
  if (!mainFile || !viewFile) throw new Error('Field counting build did not emit both lazy entry modules.');

  const mainPath = join(root, 'assets/field-counting.js');
  const chunkPath = `./${relative(dirname(mainPath), viewFile.path).replaceAll('\\', '/')}`;
  const mainSource = Buffer.from(mainFile.contents).toString('utf8');
  if (!mainSource.includes('__FIELD_COUNTING_VIEW_CHUNK_URL__')) throw new Error('Field counting lazy chunk placeholder is missing.');

  const chunks = outputFiles.filter(file => file !== mainFile);
  for (const file of chunks) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
  }
  await copyFile(join(root, 'components/field-counting/field-counting.css'), join(root, 'assets/field-counting.css'));
  await mkdir(dirname(mainPath), { recursive: true });
  await writeFile(mainPath, mainSource.replace('__FIELD_COUNTING_VIEW_CHUNK_URL__', chunkPath));
  await removeObsoleteFieldCountingChunks(chunkDirectory, chunks.filter(file => file.path.startsWith(`${chunkDirectory}/`)
    || file.path.startsWith(`${chunkDirectory}\\`)).map(file => basename(file.path)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildFieldCounting();
}
