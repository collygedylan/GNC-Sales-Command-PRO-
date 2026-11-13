import path from 'node:path';
import { run } from 'node:test';
import { pipeline } from 'node:stream/promises';
import compactTestReporter from './compact-test-reporter.mjs';

function workerOptions(args) {
  const [mode, ...files] = args;
  if (!['--test-concurrency=1','--test-concurrency=4'].includes(mode) || !files.length) {
    throw new Error('TOOLING_WORKER_ARGUMENTS_INVALID');
  }
  return { files: files.map(file => path.resolve(file)), concurrency: Number(mode.at(-1)) };
}

async function* recordFailedEvents(events) {
  for await (const event of events) {
    if (event.type === 'test:fail') process.exitCode = 1;
    if (event.type === 'test:summary' && !event.data.file) {
      const counts = event.data.counts;
      if (!counts?.passed || counts.failed || counts.cancelled || counts.skipped || counts.todo) process.exitCode = 1;
    }
    yield event;
  }
}

await pipeline(run(workerOptions(process.argv.slice(2))), recordFailedEvents, compactTestReporter, process.stdout);
