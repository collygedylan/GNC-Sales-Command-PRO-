import { inspect } from 'node:util';

function bounded(value) {
  return inspect(value, { depth: 1, maxStringLength: 180, maxArrayLength: 8, customInspect: false }).slice(0, 600);
}

export function contractFailure(data) {
  const error = data.details?.error;
  const cause = error?.cause || error;
  return JSON.stringify({
    name: String(data.name || '').slice(0, 300),
    file: data.file,
    line: data.line,
    error: String(cause?.message || '').slice(0, 500),
    code: cause?.code || error?.code,
    expected: bounded(cause?.expected),
    actual: bounded(cause?.actual),
  });
}

export default async function* compactTestReporter(events) {
  let summarySeen = false;
  for await (const event of events) {
    if (event.type === 'test:fail') yield `not ok ${contractFailure(event.data)}\n`;
    if (event.type === 'test:pass' && event.data.details?.duration_ms >= 1000)
      yield `# slow ${Math.round(event.data.details.duration_ms)}ms ${JSON.stringify(String(event.data.name).slice(0,300))}\n`;
    if (event.type === 'test:stderr') yield `stderr ${JSON.stringify(String(event.data.message).slice(0, 1000))}\n`;
    if (event.type !== 'test:summary' || event.data.file) continue;
    if (summarySeen) throw new Error('TEST_SUMMARY_DUPLICATE');
    const { counts, duration_ms: duration } = event.data;
    if (!counts) throw new Error('TEST_SUMMARY_COUNTS_MISSING');
    summarySeen = true;
    yield `# tests ${counts.tests}\n# pass ${counts.passed}\n# fail ${counts.failed}\n`;
    yield `# cancelled ${counts.cancelled}\n# skipped ${counts.skipped}\n# todo ${counts.todo}\n`;
    yield `# duration_ms ${duration}\n`;
  }
  if (!summarySeen) throw new Error('TEST_SUMMARY_MISSING');
}
