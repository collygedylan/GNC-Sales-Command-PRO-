import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function matches(pattern, file) {
  if (pattern.endsWith('/**')) return file === pattern.slice(0, -3) || file.startsWith(pattern.slice(0, -2));
  return file === pattern;
}

export function selectFocusedTests(changedFiles, map) {
  const files = [...new Set(changedFiles.map(file => String(file).replaceAll('\\', '/')).filter(Boolean))].sort();
  const modules = map.modules.filter(module => files.some(file => module.paths.some(pattern => matches(pattern, file))));
  const unknown = files.filter(file => !map.modules.some(module => module.paths.some(pattern => matches(pattern, file))));
  const commands = [];
  const add = command => { if (!commands.includes(command)) commands.push(command); };
  for (const module of modules) for (const command of module.commands) add(command);
  if (unknown.length || !commands.length) for (const command of map.fallbackCommands) add(command);
  return { files, modules: modules.map(module => module.id), unknown, commands };
}

export function changedFilesFromGit(cwd = root) {
  const read = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  return [...new Set([
    ...read(['diff', '--name-only', '--relative', 'HEAD']),
    ...read(['ls-files', '--others', '--exclude-standard']),
  ])];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const json = process.argv.includes('--json');
  const explicit = process.argv.slice(2).filter(argument => argument !== '--json');
  const map = JSON.parse(readFileSync(path.join(root, 'live-src', 'change-impact.json'), 'utf8'));
  if (map.schemaVersion !== 'gnc-change-impact-v1') throw new Error('Unsupported change-impact schema.');
  const result = selectFocusedTests(explicit.length ? explicit : changedFilesFromGit(), map);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    console.log(`Affected modules: ${result.modules.join(', ') || 'fallback'}`);
    if (result.unknown.length) console.log(`Unknown paths: ${result.unknown.join(', ')}`);
    console.log('Focused commands:');
    for (const command of result.commands) console.log(`- ${command}`);
  }
}
