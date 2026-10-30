import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';
import { runSocHistorySyncStep } from '../supabase/functions/_shared/erp-history-sync.mjs';

export async function fetchHistoryDriveResource(input, init = {}, fetcher = fetch) {
  const url = new URL(input);
  if (url.hostname !== 'www.googleapis.com' || url.searchParams.get('alt') !== 'media') return fetcher(input, init);
  const chunkSize = 256 * 1024;
  const request = (start, end) => fetcher(input, { ...init,
    headers: { ...init.headers, Range: `bytes=${start}-${end}` },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  const first = await request(0, chunkSize - 1);
  if (first.status !== 206) return first;
  const range = String(first.headers.get('content-range') || '').match(/^bytes 0-(\d+)\/(\d+)$/);
  const total = Number(range?.[2]);
  if (!range || !Number.isSafeInteger(total) || total < 1 || total > 256 * 1024 * 1024) throw new Error('HISTORY_DOWNLOAD_RANGE_INVALID');
  const bytes = new Uint8Array(total), firstBytes = new Uint8Array(await first.arrayBuffer());
  if (firstBytes.length !== Number(range[1]) + 1) throw new Error('HISTORY_DOWNLOAD_RANGE_TRUNCATED');
  bytes.set(firstBytes);
  let offset = firstBytes.length;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (offset < total) {
      const start = offset, end = Math.min(total - 1, start + chunkSize - 1);
      offset = end + 1;
      const response = await request(start, end);
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${total}`) throw new Error('HISTORY_DOWNLOAD_RANGE_CHANGED');
      const part = new Uint8Array(await response.arrayBuffer());
      if (part.length !== end - start + 1) throw new Error('HISTORY_DOWNLOAD_RANGE_TRUNCATED');
      bytes.set(part, start);
    }
  }));
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
}

// These 76 files belong to the immutable SOC average-order manifest. Reuse its
// prepare/stage/finalize/activate RPCs instead of relabeling the separate ledger.
export async function finishPendingHistoryFiles({ supabase, token, fetcher = fetch, onProgress = () => {}, maxSteps = 1000, runStep = runSocHistorySyncStep, concurrency = 3 }) {
  if (concurrency > 1) {
    const count = Math.min(3, concurrency);
    const workers = await Promise.allSettled(Array.from({ length: count }, (_, index) =>
      finishPendingHistoryFiles({ supabase, token, fetcher, onProgress, maxSteps, concurrency: 1,
        runStep: options => runStep({ ...options, filePartition: { index, count } }) })));
    const failed = workers.find(worker => worker.status === 'rejected');
    if (failed) throw failed.reason;
    return finishPendingHistoryFiles({ supabase, token, fetcher, onProgress, maxSteps, runStep, concurrency: 1 });
  }
  for (let step = 0; step < maxSteps; step++) {
    const result = await runStep({ supabase, token, fetcher, maxFilesPerSlice: 2, maxRowsPerFile: 1000000, rowsPerBatch: 1000,
      parseWorkbook: bytes => {
        const book = XLSX.read(bytes, { type: 'array', cellDates: false });
        return book.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '', raw: false }) }));
      } });
    await onProgress({ step: step + 1, ...result.result });
    if (result.done || result.result.partitionComplete) return result.result;
  }
  throw new Error('HISTORY_RECOVERY_STEP_LIMIT');
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const supplied = process.argv.includes('--credentials-stdin') ? JSON.parse(await new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', part => { text += part; if (text.length > 20000) reject(new Error('HISTORY_CREDENTIAL_INPUT_TOO_LARGE')); });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  })) : {};
  const token = supplied.accessToken || process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  const key = supplied.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token || !key) throw new Error('HISTORY_RECOVERY_CREDENTIALS_REQUIRED');
  const supabase = createClient(process.env.SUPABASE_URL || 'https://kzrnyjsosryejjejliii.supabase.co', key,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const log = 'G:/My Drive/GNC/AgData/Release Evidence/agdata-v23116-history.jsonl';
  const result = await finishPendingHistoryFiles({ supabase, token, fetcher: fetchHistoryDriveResource,
    onProgress: progress => fs.appendFile(log, JSON.stringify({ ...progress, at: new Date().toISOString() }) + '\n') });
  console.log(JSON.stringify({ status: 'complete', ...result }));
}
