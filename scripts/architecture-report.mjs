import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.gs', '.html']);
const generated = /(^|\/)(?:node_modules|vendor|dist|build|_site|coverage|\.git|\.codex|\.gnc-local)(\/|$)|(?:\.min\.|\.generated\.|-bundle\.)/i;

function trackedSources() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/)
    .filter(file => file && sourceExtensions.has(path.extname(file).toLowerCase()) && !generated.test(file));
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r\n|\n|\r/).length - (/(\r\n|\n|\r)$/.test(text) ? 1 : 0);
}

function domainsFor(file) {
  const domains = [];
  if (/(?:que|request|bunch.?note)/i.test(file)) domains.push('que/request/bunch-notes');
  if (/suspend.?tag/i.test(file)) domains.push('suspend-tags');
  if (/(?:network|api|supabase|sync|service.?worker|delivery)/i.test(file)) domains.push('networking/sync');
  if (/(?:^components\/|^live-src\/|^services\/|^utils\/|^v2\/src\/|^assets\/|\.html$)/i.test(file)) domains.push('ui/rendering-or-runtime');
  if (file === 'index.html' || /^assets\//i.test(file)) domains.push('legacy-shell');
  if (file === 'Code.gs') domains.push('apps-script/pdf-email');
  if (/^supabase\/functions\//i.test(file)) domains.push('edge-functions/backend');
  return [...new Set(domains)];
}

function clusterSymbols(symbols) {
  const clusters = new Map();
  for (const [kind, entries] of [['functions', symbols.functions], ['stateBindings', symbols.stateBindings]]) {
    for (const entry of entries) {
      const domain = entry.domain || 'general-or-unclassified';
      if (!clusters.has(domain)) clusters.set(domain, { domain, functions: 0, stateBindings: 0, largestFunctions: [], stateExamples: [] });
      const cluster = clusters.get(domain);
      cluster[kind] += 1;
      (kind === 'functions' ? cluster.largestFunctions : cluster.stateExamples).push(entry);
    }
  }
  return [...clusters.values()].map(cluster => ({
    ...cluster,
    largestFunctions: cluster.largestFunctions.sort((a, b) => b.spanBytes - a.spanBytes).slice(0, 12),
    stateExamples: cluster.stateExamples.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12),
  })).sort((a, b) => b.functions + b.stateBindings - a.functions - a.stateBindings);
}

function frequentGlobals(globals) {
  const byName = new Map();
  for (const entry of globals) {
    if (!byName.has(entry.name)) byName.set(entry.name, { name: entry.name, declarations: 0, referenceCandidates: 0, locations: [] });
    const item = byName.get(entry.name);
    item.declarations += 1;
    item.referenceCandidates += entry.references || 0;
    if (item.locations.length < 8) item.locations.push({ file: entry.file, line: entry.line, column: entry.column });
  }
  return [...byName.values()].sort((a, b) => b.referenceCandidates - a.referenceCandidates || b.declarations - a.declarations).slice(0, 50);
}

export function reportRepository(analyzeSourceText) {
  const records = [];
  let appSymbols = { functions: [], stateBindings: [], globals: [] };
  for (const file of trackedSources()) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    const { findings, metrics, symbols } = analyzeSourceText(text, file);
    if (file === 'index.html') appSymbols = symbols;
    records.push({
      file,
      lines: countLines(text),
      domains: domainsFor(file),
      ...metrics,
      findingCounts: Object.fromEntries(['empty-catch', 'unreachable', 'global-write', 'global-declaration', 'unused-candidate', 'parse-error']
        .map(rule => [rule, findings.filter(finding => finding.rule === rule).length]).filter(([, count]) => count)),
      findings: findings.map(({ file: sourceFile, rule, line, column, message }) => ({ sourceFile, rule, line, column, message })),
    });
  }
  records.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
  const domainFiles = new Map();
  for (const record of records) for (const domain of record.domains) domainFiles.set(domain, (domainFiles.get(domain) || 0) + 1);
  const mainSource = records.find(record => record.file === 'index.html');
  process.stdout.write(`${JSON.stringify({
    mode: 'read-only-domain-inventory',
    interpretation: 'Path and identifier-name clusters are heuristic extraction leads; inspect source locations before assigning ownership.',
    files: records.length,
    domainMapping: [...domainFiles].map(([domain, fileCount]) => ({ domain, fileCount })).sort((a, b) => b.fileCount - a.fileCount),
    mainSource: mainSource ? {
      file: mainSource.file,
      lines: mainSource.lines,
      bytes: Buffer.byteLength(fs.readFileSync(path.join(root, mainSource.file))),
      functions: mainSource.functions,
      namedFunctions: appSymbols.functions.length,
      stateLikeBindings: appSymbols.stateBindings.length,
      topLevelNames: mainSource.topLevelNames,
      astNodes: mainSource.astNodes,
      findingCounts: mainSource.findingCounts,
      domainClusters: clusterSymbols(appSymbols),
      mostReferencedGlobalNameCandidates: frequentGlobals(appSymbols.globals),
    } : null,
    records,
  }, null, 2)}\n`);
  return 0;
}
