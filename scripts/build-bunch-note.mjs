import { build } from 'esbuild';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function removeObsoleteBunchChunks(chunkDirectory, retainedNames = []) {
  const retained = new Set(retainedNames);
  await mkdir(chunkDirectory, { recursive: true });
  for (const entry of await readdir(chunkDirectory, { withFileTypes: true })) {
    if (entry.isFile() && /^[\w-]+-[A-Z0-9]{8}\.js$/i.test(entry.name) && !retained.has(entry.name)) {
      await unlink(join(chunkDirectory, entry.name));
    }
  }
}

export async function buildBunchNote({ root = process.cwd() } = {}) {
  const chunkDirectory = join(root, 'assets/bunch-note-chunks');
  const result = await build({
    absWorkingDir: root,
    entryPoints: {
      'bunch-note-structured': 'components/bunch-notes/BunchNoteEntry.tsx',
      'bunch-note-chunks/CardBoard': 'components/bunch-notes/CardBoard.jsx',
      'bunch-note-chunks/StructuredBunchNote': 'components/bunch-notes/StructuredBunchNote.jsx'
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
    entryNames: '[name]-[hash]',
    chunkNames: 'bunch-note-chunks/[name]-[hash]'
  });
  const outputFiles = result.outputFiles || [];
  const outputInfo = file => result.metafile.outputs[relative(root, file.path).replaceAll('\\', '/')];
  const mainFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/bunch-notes/BunchNoteEntry.tsx');
  const cardFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/bunch-notes/CardBoard.jsx');
  const structuredFile = outputFiles.find(file => outputInfo(file)?.entryPoint === 'components/bunch-notes/StructuredBunchNote.jsx');
  if (!mainFile || !cardFile || !structuredFile) throw new Error('Bunch view entries were not emitted.');
  const mainPath = join(root, 'assets/bunch-note-structured.js');
  const cardTarget = join(chunkDirectory, basename(cardFile.path));
  const structuredTarget = join(chunkDirectory, basename(structuredFile.path));
  const cardChunkPath = `./${relative(dirname(mainPath), cardTarget).replaceAll('\\', '/')}`;
  const structuredChunkPath = `./${relative(dirname(mainPath), structuredTarget).replaceAll('\\', '/')}`;
  let mainSource = Buffer.from(mainFile.contents).toString('utf8');
  if (!mainSource.includes('__BUNCH_CARD_BOARD_CHUNK__') || !mainSource.includes('__BUNCH_STRUCTURED_CHUNK__')) {
    throw new Error('Bunch view chunk placeholder is missing.');
  }
  mainSource = mainSource
    .replace('__BUNCH_CARD_BOARD_CHUNK__', cardChunkPath)
    .replace('__BUNCH_STRUCTURED_CHUNK__', structuredChunkPath);
  const entryFiles = new Map([[cardFile, cardTarget], [structuredFile, structuredTarget]]);
  const outputEntries = outputFiles.filter(file => file !== mainFile);
  const chunkFiles = outputEntries.filter(file => file.path.startsWith(`${chunkDirectory}/`) || file.path.startsWith(`${chunkDirectory}\\`));
  const retainedChunkNames = new Set([
    ...chunkFiles.map(file => basename(file.path)),
    basename(cardTarget), basename(structuredTarget)
  ]);
  // Publish chunks before the stable entry so it never points at chunks that
  // have not been written. Stale chunks are removed only after a successful
  // compile and complete output write.
  for (const file of outputEntries) {
    const target = entryFiles.get(file) || file.path;
    let contents = file.contents;
    if (entryFiles.has(file)) {
      contents = Buffer.from(contents).toString('utf8').replaceAll('./bunch-note-chunks/', './');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  await mkdir(dirname(mainPath), { recursive: true });
  await writeFile(mainPath, mainSource.replace('__BUNCH_CARD_BOARD_CHUNK__', cardChunkPath));
  await removeObsoleteBunchChunks(chunkDirectory, [...retainedChunkNames]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildBunchNote();
}
