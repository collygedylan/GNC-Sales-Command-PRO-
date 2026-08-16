#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';

const executeDerivatives = process.argv.includes('--execute-derivatives');
const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bucket = String(process.env.STORAGE_BUCKET || '').trim();
const prefix = String(process.env.STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const outputPath = String(process.env.DERIVATIVE_MANIFEST_PATH || `artifacts/${bucket || 'storage'}-derivatives.json`);
const maxObjects = Math.max(1, Number(process.env.MAX_OBJECTS || 100));
if (!url || !serviceRoleKey || !bucket) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and STORAGE_BUCKET are required.');

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = { version: 1, bucket, prefix, executeDerivatives, createdAt: new Date().toISOString(), entries: [], cleanupAuthorized: false };

async function listObjects(folder = '') {
  const objects = [];
  for (let offset = 0; objects.length < maxObjects; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: Math.min(1000, maxObjects - objects.length), offset });
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const path = folder ? `${folder}/${row.name}` : row.name;
      if (row.id && !path.startsWith('_optimized/')) objects.push({ path, size: Number(row.metadata?.size || 0) });
      else if (!row.id) objects.push(...await listObjects(path));
      if (objects.length >= maxObjects) break;
    }
    if (rows.length < 1000) break;
  }
  return objects.slice(0, maxObjects);
}

for (const object of await listObjects(prefix)) {
  const entry = { sourcePath: object.path, sourceBytes: object.size, action: executeDerivatives ? 'create_derivative' : 'dry_run', verified: false };
  if (executeDerivatives) {
    const { data, error } = await supabase.storage.from(bucket).download(object.path);
    if (error) throw new Error(`${object.path}: ${error.message}`);
    const source = Buffer.from(await data.arrayBuffer());
    const derivative = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4, smartSubsample: true })
      .toBuffer();
    const hash = createHash('sha256').update(derivative).digest('hex');
    const derivativePath = `_optimized/${hash.slice(0, 2)}/${hash}.webp`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(derivativePath, derivative, {
      contentType: 'image/webp', cacheControl: '31536000', upsert: false
    });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message || '')) throw uploadError;
    const { data: verificationData, error: verificationError } = await supabase.storage.from(bucket).download(derivativePath);
    if (verificationError) throw verificationError;
    const verifiedHash = createHash('sha256').update(Buffer.from(await verificationData.arrayBuffer())).digest('hex');
    Object.assign(entry, {
      derivativePath,
      derivativeBytes: derivative.length,
      sha256: hash,
      verified: verifiedHash === hash,
      quarantineEligibleAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cleanupAction: 'none'
    });
  }
  manifest.entries.push(entry);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, executeDerivatives, entries: manifest.entries.length, verified: manifest.entries.filter((entry) => entry.verified).length, cleanupAuthorized: false }, null, 2)}\n`);
