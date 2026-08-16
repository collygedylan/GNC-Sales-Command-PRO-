#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const outputPath = String(process.env.STORAGE_MANIFEST_PATH || 'artifacts/storage-cleanup-manifest.json');
const priorPath = String(process.env.PRIOR_STORAGE_MANIFEST_PATH || '').trim();
const bucketNames = String(process.env.STORAGE_BUCKETS || 'request_photos,flyer_photos,season_sales_notes_photos,location_sales_notes_photos,credit_photos,dock_photos')
  .split(',').map((value) => value.trim()).filter(Boolean);
if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function listFolder(bucket, prefix = '') {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const path = prefix ? `${prefix}/${row.name}` : row.name;
      if (row.id) objects.push({ bucket, path, size: Number(row.metadata?.size || 0), updatedAt: row.updated_at || row.created_at || null });
      else objects.push(...await listFolder(bucket, path));
    }
    if (rows.length < 1000) return objects;
  }
}

const objects = [];
for (const bucket of bucketNames) objects.push(...await listFolder(bucket));
objects.sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));

// References are exported separately by read-only SQL/API jobs. This script
// never assumes that an unreferenced object is safe to delete.
let references = [];
const referencePath = String(process.env.STORAGE_REFERENCE_EXPORT || '').trim();
if (referencePath) references = JSON.parse(await readFile(referencePath, 'utf8'));
const referenceSet = new Set((Array.isArray(references) ? references : []).map((value) => String(value || '').replace(/^\/+/, '')));
const scannedAt = new Date().toISOString();
const candidates = objects.filter((object) => !referenceSet.has(`${object.bucket}/${object.path}`)).map((object) => ({
  ...object,
  quarantineEligibleAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  action: 'none'
}));
const canonical = JSON.stringify(objects.map(({ bucket, path, size }) => ({ bucket, path, size })));
const manifest = {
  version: 1,
  scanId: createHash('sha256').update(canonical).digest('hex'),
  scannedAt,
  buckets: bucketNames,
  objectCount: objects.length,
  totalBytes: objects.reduce((sum, item) => sum + item.size, 0),
  referenceCount: referenceSet.size,
  candidates,
  destructiveActionsEnabled: false,
  secondScanAgreement: false
};

if (priorPath) {
  const prior = JSON.parse(await readFile(priorPath, 'utf8'));
  const elapsedMs = Date.now() - new Date(prior.scannedAt || 0).getTime();
  const priorCandidates = new Set((prior.candidates || []).map((item) => `${item.bucket}/${item.path}`));
  manifest.secondScanAgreement = elapsedMs >= 24 * 60 * 60 * 1000 && candidates.every((item) => priorCandidates.has(`${item.bucket}/${item.path}`));
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, scanId: manifest.scanId, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes, candidates: candidates.length, secondScanAgreement: manifest.secondScanAgreement }, null, 2)}\n`);
