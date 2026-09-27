import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const phases = ['diagnosis', 'implementation', 'validation', 'deployment', 'verification', 'complete', 'blocked'];
export function recordCandidateValidation(root, result) {
  const directory = path.join(root, '.gnc-local');
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(path.join(directory, 'validation-history.jsonl'), JSON.stringify({ kind: 'candidate', at: new Date().toISOString(), ...result }) + '\n');
}
export function recordValidationRun(root, report) {
  const file = path.join(root, '.gnc-local', 'validation-history.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const foundation = report.foundationStages || [];
  const sum = stages => stages.reduce((total, stage) => total + stage.durationMs, 0);
  fs.appendFileSync(file, JSON.stringify({ kind: 'local', at: report.completedAt, ok: report.ok,
    sourceDigest: report.sourceDigest || null, report: path.join(report.output, 'report.json'),
    buildMs: sum(foundation.filter(stage => ['monitoring', 'assets', 'v2', 'complete-site'].includes(stage.name))),
    baselineMs: sum(foundation.filter(stage => ['syntax', 'contracts', 'browser'].includes(stage.name))),
    focusedMs: sum(report.stages.filter(stage => stage.name !== 'foundation')),
    suites: report.plan || null, unknown: report.selection?.unknown || [],
  }) + '\n');
}
function validateEvents(events) {
  if (!Array.isArray(events) || events.some((e, i) => !e || !phases.includes(e.phase) || !Number.isFinite(Date.parse(e.at))
    || (i > 0 && Date.parse(e.at) < Date.parse(events[i - 1].at)))) throw new Error('REPAIR_LEDGER_INVALID_HISTORY');
}
export function appendRepairEvent(events, { phase, model = 'unavailable', effort = 'unavailable', retry = false, usedPercent = null }, now = new Date().toISOString()) {
  validateEvents(events);
  if (!phases.includes(phase) || !/^[\w.-]{1,60}$/.test(model) || !/^[\w-]{1,20}$/.test(effort)
    || !Number.isFinite(Date.parse(now)) || (events.length && Date.parse(now) < Date.parse(events.at(-1).at))
    || (usedPercent !== null && (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100))) throw new Error('REPAIR_LEDGER_INVALID');
  return [...events, { at: now, phase, model, effort, retry: retry === true, accountUsedPercent: usedPercent }];
}
export function summarizeRepair(events) {
  validateEvents(events);
  const seconds = {};
  for (let i = 0; i + 1 < events.length; i++) seconds[events[i].phase] = (seconds[events[i].phase] || 0) + Math.max(0, Date.parse(events[i + 1].at) - Date.parse(events[i].at)) / 1000;
  const usage = events.filter(e => Number.isFinite(e.accountUsedPercent));
  return { phaseSeconds: seconds, retries: events.filter(e => e.retry).length,
    accountUsageDelta: usage.length > 1 && usage.at(-1).accountUsedPercent >= usage[0].accountUsedPercent
      ? usage.at(-1).accountUsedPercent - usage[0].accountUsedPercent : null,
    billingNote: 'Shared account allowance delta, not exact task billing; resets and other tasks can affect it.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [phase, model, effort, used] = process.argv.slice(2);
    const file = path.resolve('.gnc-local', 'repair-ledger.json');
    const events = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    if (phase === 'validation-report') {
      const history = path.resolve('.gnc-local', 'validation-history.jsonl');
      const runs = fs.existsSync(history) ? fs.readFileSync(history, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
      console.log(JSON.stringify({ runs, reviewAfterChanges: 3, note: 'Compare distinct changes; repeated runs are not separate changes. Candidate timing comes from report-release-timings.mjs.' }, null, 2));
    } else if (phase === 'report') console.log(JSON.stringify(summarizeRepair(events), null, 2));
    else {
      const next = appendRepairEvent(events, { phase, model, effort, usedPercent: used === undefined ? null : Number(used) });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      const fd = fs.openSync(temp, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
      console.log(JSON.stringify({ phase, recorded: true }));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
