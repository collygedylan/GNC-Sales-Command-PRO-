import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { chromium } from '@playwright/test';
import { createDatabaseClientOptions } from './apply-item-low-stock-migration.mjs';
import { readComposedAppSource } from './composed-app-source.mjs';
import { startReleaseTestServer } from './serve-release-tests.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
const caFile = path.join(root, 'scripts', 'certs', 'supabase-prod-ca-2021.crt');
const username = 'dylan_collyge';
const minimumRequestImpact = 6_067_786.53;
const expectedCards = [
  ['003139.250.1', 'Oakland® Red Holly', 'A.08.000'],
  ['008280.150.1', 'Sunburst® Honeylocust', 'C.05.000'],
  ['009199.013.1', 'Ruby Star Coneflower', 'D.09.013'],
  ['009501.013.1', 'Queen Victoria Cardinal Flower', 'D.09.044'],
  ['001711.030.1', 'Purple Pride Beautyberry', 'D.26.000'],
  ['001711.070.1', 'Purple Pride Beautyberry', 'F.05.000'],
];
const expectedSuspendCard = ['Pink Delight Butterfly Bush', 'D.26.000'];

function fail(message) {
  const error = new Error(message);
  error.name = 'RequestQueueVerifierError';
  throw error;
}

function readLocalEnv() {
  if (!fs.existsSync(envFile)) return {};
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).flatMap(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return [];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function resolveAccessCode({ supabaseUrl, localEnv }) {
  const explicit = String(process.env.GNC_REQUEST_QUEUE_ACCESS_CODE || '').trim();
  if (explicit) return explicit;
  const serviceRoleKey = String(process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY
    || localEnv.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (serviceRoleKey) {
    const response = await fetch(`${supabaseUrl}/rest/v1/ph_app_users?select=password&username=eq.${username}&limit=1`, {
      headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const rows = await readJson(response);
    const value = String(Array.isArray(rows) ? rows[0]?.password || '' : '').trim();
    if (response.ok && value) return value;
  }
  const databaseUrl = String(process.env.GNC_REQUEST_QUEUE_DB_URL || localEnv.GNC_SUPABASE_DB_URL
    || process.env.GNC_SUPABASE_DB_URL || '').trim();
  if (!databaseUrl || !fs.existsSync(caFile)) fail('Set GNC_REQUEST_QUEUE_ACCESS_CODE or configure the protected production database URL.');
  const client = new Client(createDatabaseClientOptions(databaseUrl));
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query("set local statement_timeout = '3000ms'");
    const result = await client.query('select password from public.ph_app_users where lower(username)=lower($1) and disabled_at is null limit 1', [username]);
    await client.query('commit');
    const value = String(result.rows[0]?.password || '').trim();
    if (!value) fail('The protected dylan_collyge access code is unavailable.');
    return value;
  } finally {
    await client.end().catch(() => {});
  }
}

function normalizeCardText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCurrency(value) {
  const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

async function dismissPushPermissionHelp(page) {
  const modal = page.locator('#push-permission-help-modal');
  if (!await modal.isVisible().catch(() => false)) return false;
  await modal.getByRole('button', { name: 'Close' }).click({ force: true });
  await modal.waitFor({ state: 'hidden', timeout: 5_000 });
  return true;
}

async function dismissBlockingToast(page) {
  return page.locator('#toast-notification.show').evaluate(toast => {
    toast.classList.remove('show');
    toast.setAttribute('data-dismiss-reason', 'browser-verifier');
    return true;
  }).catch(() => false);
}

async function clickPastPushPermissionHelp(page, target) {
  await dismissPushPermissionHelp(page);
  await dismissBlockingToast(page);
  try {
    await target.click({ timeout: 2_000 });
  } catch {
    await dismissPushPermissionHelp(page);
    await dismissBlockingToast(page);
    if (await target.getAttribute('aria-pressed') !== 'true') {
      await target.evaluate(element => element.click());
    }
  }
}

async function openQueueCategory(page, category) {
  const pill = page.locator(`#request-filter-toolbar [data-request-category="${category}"]`);
  await pill.waitFor({ state: 'visible', timeout: 10_000 });
  await clickPastPushPermissionHelp(page, pill);
  await page.waitForFunction(key => document.querySelector(
    `#request-filter-toolbar [data-request-category="${key}"]`,
  )?.getAttribute('aria-pressed') === 'true', category, { timeout: 10_000 });
  return page.locator(`#request-filter-toolbar [data-request-category="${category}"]`);
}

async function queueCategoryCount(page, category) {
  const text = await page.locator(
    `#request-filter-toolbar [data-request-category="${category}"] .request-category-chip__count`,
  ).textContent();
  return Number((String(text || '').match(/\d+/) || ['0'])[0]);
}

async function probeAnonSecurity({ supabaseUrl, anonKey, existingRequestId }) {
  if (!anonKey || !existingRequestId) fail('Anon security probe prerequisites are unavailable.');
  const headers = { apikey: anonKey, authorization: `Bearer ${anonKey}`, 'Cache-Control': 'no-store' };
  const reads = [
    ['ph_app_users', 'username,password_hash'],
    ['user_access_control', 'username,canonical_role'],
    ['ph_request_delivery_outbox', 'event_id'],
    ['ph_requests_completed_history', 'unique_id'],
  ];
  const readResults = {};
  for (const [table, select] of reads) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    const payload = await readJson(response);
    if (response.ok && (!Array.isArray(payload) || payload.length !== 0)) fail(`Anonymous read exposed ${table}.`);
    if (!response.ok && ![401, 403].includes(response.status)) fail(`Anonymous read probe for ${table} returned ${response.status}.`);
    readResults[table] = { status: response.status, rows: Array.isArray(payload) ? payload.length : 0 };
  }

  const impossibleId = `__anon_security_probe_${Date.now()}__`;
  const mutations = [
    ['POST', '', { unique_id: existingRequestId }],
    ['PATCH', `?unique_id=eq.${encodeURIComponent(impossibleId)}`, { comments: 'blocked' }],
    ['DELETE', `?unique_id=eq.${encodeURIComponent(impossibleId)}`, null],
  ];
  const mutationResults = {};
  for (const [method, query, body] of mutations) {
    const response = await fetch(`${supabaseUrl}/rest/v1/ph_requests_pending${query}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal,tx=rollback' },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.text();
    if (![401, 403].includes(response.status)) fail(`Anonymous ${method} mutation probe returned ${response.status}.`);
    mutationResults[method] = response.status;
  }
  return { reads: readResults, mutations: mutationResults };
}

async function readArchiveDatabaseCounts(localEnv) {
  const databaseUrl = String(process.env.GNC_REQUEST_QUEUE_DB_URL || localEnv.GNC_SUPABASE_DB_URL
    || process.env.GNC_SUPABASE_DB_URL || '').trim();
  if (!databaseUrl || !fs.existsSync(caFile)) fail('The protected production database URL is required for archive counts.');
  const client = new Client(createDatabaseClientOptions(databaseUrl));
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query("set local statement_timeout = '3000ms'");
    const result = await client.query(`select
      (select count(*) from public.ph_requests_completed_history)::bigint requests,
      (select count(*) from public.ph_orders_history)::bigint orders,
      (select count(*) from public.ph_reserves_history)::bigint reserves,
      (select count(*) from public.ph_drive_mode_history_files)::bigint drive_files,
      (select coalesce(sum(row_count),0) from public.ph_drive_mode_history_files)::bigint drive_rows_indexed,
      (select count(*) from public.ph_drive_mode_history)::bigint drive_evidence,
      (select count(*) from public.ph_orders_history where source_kind in ('trip','trip_audit'))::bigint dock_records,
      (select count(*) from public.ph_orders_history where nullif(checker,'') is not null)::bigint checker_records,
      (select count(*) from public.ph_orders_history where nullif(inspector,'') is not null)::bigint inspector_records,
      (select count(*) from public.ph_orders_history where nullif(mistake,'') is not null)::bigint mistake_records`);
    await client.query('commit');
    return Object.fromEntries(Object.entries(result.rows[0] || {}).map(([key, value]) => [key, Number(value)]));
  } finally {
    await client.end().catch(() => {});
  }
}

async function readQueueInvariantCounts(localEnv) {
  const databaseUrl = String(process.env.GNC_REQUEST_QUEUE_DB_URL || localEnv.GNC_SUPABASE_DB_URL
    || process.env.GNC_SUPABASE_DB_URL || '').trim();
  if (!databaseUrl || !fs.existsSync(caFile)) fail('The protected production database URL is required for queue invariants.');
  const client = new Client(createDatabaseClientOptions(databaseUrl));
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query("set local statement_timeout = '3000ms'");
    const result = await client.query(`select
      (select count(*) from public.ph_active_location_moves)::bigint active_location_moves,
      (select count(*) from public.ph_active_request)::bigint active_request,
      (select count(*) from public.ph_active_recount)::bigint active_recount,
      (select count(*) from public.ph_active_bunch_notes)::bigint active_bunch_notes,
      (select count(*) from public.ph_active_suspend)::bigint active_suspend`);
    await client.query('commit');
    return Object.fromEntries(Object.entries(result.rows[0] || {}).map(([key, value]) => [key, Number(value)]));
  } finally {
    await client.end().catch(() => {});
  }
}

async function readAuraGlossaryTerms(localEnv) {
  const databaseUrl = String(process.env.GNC_REQUEST_QUEUE_DB_URL || localEnv.GNC_SUPABASE_DB_URL
    || process.env.GNC_SUPABASE_DB_URL || '').trim();
  if (!databaseUrl || !fs.existsSync(caFile)) fail('The protected production database URL is required for AURA glossary verification.');
  const client = new Client(createDatabaseClientOptions(databaseUrl));
  try {
    await client.connect();
    await client.query('begin read only');
    await client.query("set local statement_timeout = '3000ms'");
    const result = await client.query('select term from public.aura_domain_glossary order by term');
    await client.query('commit');
    const terms = result.rows.map(row => String(row.term || '').trim()).filter(Boolean);
    const required = ['carry over','current crop','future crop','inv consolidation','loc photo match','request sales impact',
      'mistake guy','historical orders','historical reserves','historical drive around','location moves','suspend tag',
      'recount','bunch notes','eval work','shear list'];
    const missing = required.filter(term => !terms.includes(term));
    if (missing.length) fail(`AURA glossary is missing ${missing.join(', ')}.`);
    return terms;
  } finally {
    await client.end().catch(() => {});
  }
}

async function readConsolidationCards(page) {
  return page.locator('[data-inv-consolidation-card]').evaluateAll(cards => cards.map(card => {
    const text = String(card.textContent || '').replace(/\s+/g, ' ').trim();
    const sourceSalesYear = Number((text.match(/SalesYear\s+(\d+)/i) || [])[1]);
    const locOnHand = Number(String((text.match(/Loc On Hand\s+([\d,.]+)/i) || [])[1] || '').replaceAll(',', ''));
    const options = Array.from(card.querySelectorAll('select option')).map(option => ({
      locationcode: String(option.textContent?.split('|')[0] || '').trim(),
      salesYear: Number((option.textContent?.match(/SY\s+(\d+)/i) || [])[1]),
      text: String(option.textContent || '').replace(/\s+/g, ' ').trim(),
      selected: option.selected,
    })).filter(option => Number.isFinite(option.salesYear));
    const tier = card.getAttribute('data-consolidation-crop-tier') || '';
    const tierLabel = ({ CARRY_OVER: 'CARRY OVER', CURRENT_CROP: 'CURRENT CROP', FUTURE_CROP: 'FUTURE CROP' })[tier] || '';
    return { contsize: card.getAttribute('data-consolidation-contsize') || '', tier, text, sourceSalesYear, locOnHand, options,
      sourceLocation: String((text.match(/Move From\s*([A-Z]\.\d{2}(?:\.\d{3})?)/i) || [])[1] || ''),
      badge: tierLabel && text.includes(`${tierLabel} -> ${tierLabel}`) ? `${tierLabel} -> ${tierLabel}` : '',
      sendButtons: Array.from(card.querySelectorAll('button')).filter(button => button.textContent?.includes('Send to Location Moves')).length };
  }));
}

function archiveCount(value) {
  return Number((String(value || '').replaceAll(',', '').match(/\d+/) || ['0'])[0]);
}

function archiveRecordCount(value) {
  const match = String(value || '').match(/([\d,]+)\s+records?\b/i);
  return Number(String(match?.[1] || '0').replaceAll(',', ''));
}

function archiveFolderDataCount(value) {
  const text = String(value || '');
  const rowMatch = text.match(/([\d,]+)\s+(?:indexed\s+)?rows?\b/i);
  return rowMatch ? Number(rowMatch[1].replaceAll(',', '')) : archiveRecordCount(text);
}

async function readPhotoBadgeProof(page, selector, label, minimumPhotos = 1) {
  const root = page.locator(selector).first();
  await root.waitFor({ state: 'visible', timeout: 30_000 });
  const proof = await root.evaluate((node, proofLabel) => {
    const images = Array.from(node.querySelectorAll('img')).filter(image => {
      const source = String(image.getAttribute('data-full-src') || image.getAttribute('src') || '').trim();
      return source && !/placeholder|no[-_ ]photo/i.test(source);
    });
    const rows = images.map(image => {
      const host = image.closest('.app-inline-thumb-column, .app-drive-card-photo, .app-av-photo-slide, .historical-requests__photo, .photo-modal-slide, .eval-work-photo-thumb, button') || image.parentElement;
      const badge = host?.querySelector('.photo-thumb-date[data-photo-taken-date]');
      return { source: String(image.getAttribute('data-full-src') || image.getAttribute('src') || '').slice(0, 160), date: String(badge?.getAttribute('data-photo-taken-date') || badge?.textContent || '').trim() };
    });
    return { label: proofLabel, photos: rows.length, missing: rows.filter(row => !/^\d{2}\/\d{2}\/\d{2}$/.test(row.date)), dates: [...new Set(rows.map(row => row.date).filter(Boolean))] };
  }, label);
  if (proof.photos < minimumPhotos) fail(`${label} rendered ${proof.photos} valid photos.`);
  if (proof.missing.length) fail(`${label} rendered ${proof.missing.length} photos without MM/DD/YY badges.`);
  return proof;
}

async function findArchivePhotoBadgeProof(page, kind) {
  const archive = page.locator(`.historical-archive[data-archive-kind="${kind}"]`);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const recordWithPhoto = page.locator('[data-archive-record]').filter({ has: page.locator('.historical-requests__photo img') }).first();
    if (await recordWithPhoto.count()) return readPhotoBadgeProof(page, '[data-archive-record]:has(.historical-requests__photo img)', `${kind} archive`);
    const next = archive.getByRole('button', { name: 'Next' });
    if (!await next.isVisible().catch(() => false) || await next.isDisabled()) break;
    const priorId = await page.locator('[data-archive-record]').first().getAttribute('data-archive-record');
    await next.click();
    await page.waitForFunction(previous => {
      const row = document.querySelector('[data-archive-record]');
      return !!row && row.getAttribute('data-archive-record') !== previous;
    }, priorId, { timeout: 30_000 });
  }
  fail(`${kind} archive did not render a valid photo for badge verification.`);
}

async function assertVisibleArchiveRecordsUnique(page, recordKind, phase) {
  const signatures = await page.locator('[data-archive-record]').evaluateAll(cards => cards.map(card => {
    const heading = Array.from(card.querySelectorAll('.historical-requests__request-heading')).map(node => node.textContent?.trim() || '').join('|');
    const metadata = Array.from(card.querySelectorAll('.historical-requests__request-meta'));
    const identity = metadata[0]?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const detail = (metadata[1]?.textContent || '').replace(/\s+/g, ' ').trim()
      .replace(/\s*[·•]\s*\d{1,2}\/\d{1,2}\/\d{4}(?=\s*(?:[·•]|$))/g, '');
    const facts = Array.from(card.querySelectorAll('.historical-requests__facts div')).map(node => node.textContent?.replace(/\s+/g, ' ').trim() || '').join('|');
    const notes = metadata.slice(2).map(node => node.textContent?.replace(/\s+/g, ' ').trim() || '').join('|');
    const value = card.querySelector('.historical-requests__request-value')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const photos = Array.from(card.querySelectorAll('.historical-requests__photos a')).map(node => node.getAttribute('href') || '').join('|');
    return [heading, identity, detail, facts, notes, value, photos].join('||').toLowerCase();
  }));
  if (!signatures.length) fail(`${recordKind} ${phase} rendered no archive records.`);
  const distinct = new Set(signatures);
  if (distinct.size !== signatures.length) fail(`${recordKind} ${phase} rendered ${signatures.length - distinct.size} duplicate business-state rows.`);
  return { records: signatures.length, duplicateStates: 0 };
}

async function verifyArchiveSearch(page, recordKind) {
  const card = page.locator('[data-archive-record]').first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const recordsProof = await assertVisibleArchiveRecordsUnique(page, recordKind, 'records');
  const recordText = normalizeCardText(await card.textContent());
  const metadata = normalizeCardText(await card.locator('.historical-requests__request-meta').first().textContent());
  const searchTerm = metadata.split(/\s+/)[0];
  if (!searchTerm || searchTerm.length < 2) fail(`${recordKind} did not expose a searchable record identity.`);
  const search = page.getByRole('searchbox', { name: 'Search this archive' });
  await search.fill(searchTerm);
  await page.getByRole('heading', { name: /Search results for/ }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-archive-record]').first().waitFor({ state: 'visible', timeout: 30_000 });
  const searchProof = await assertVisibleArchiveRecordsUnique(page, recordKind, 'search');
  const searchText = normalizeCardText(await page.locator('[data-archive-record]').first().textContent());
  if (!searchText.toLowerCase().includes(searchTerm.toLowerCase())) fail(`${recordKind} search did not return ${searchTerm}.`);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.locator('[data-archive-folder]').first().waitFor({ state: 'visible', timeout: 30_000 });
  return { searchTerm, recordText: recordText.slice(0, 240), recordsProof, searchProof };
}

async function verifyRequestArchiveSearch(page) {
  await page.getByRole('heading', { name: 'Sales Reps' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.historical-requests__group-button').first().click();
  await page.getByRole('heading', { name: 'Customers' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.historical-requests__group-button').first().click();
  const card = page.locator('.historical-requests__request').first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const photoProof = await readPhotoBadgeProof(page, '.historical-requests__request:has(.historical-requests__photo img)', 'requests archive');
  const recordText = normalizeCardText(await card.textContent());
  const metadata = normalizeCardText(await card.locator('.historical-requests__request-meta').first().textContent());
  const searchTerm = metadata.split(/\s+/)[0];
  if (!searchTerm || searchTerm.length < 2) fail('Requests did not expose a searchable record identity.');
  await page.getByRole('searchbox', { name: 'Search this archive' }).fill(searchTerm);
  await page.getByRole('heading', { name: /Search results for/ }).waitFor({ state: 'visible', timeout: 30_000 });
  const result = page.locator('[data-archive-record]').first();
  await result.waitFor({ state: 'visible', timeout: 30_000 });
  if (!normalizeCardText(await result.textContent()).toLowerCase().includes(searchTerm.toLowerCase())) {
    fail(`Requests search did not return ${searchTerm}.`);
  }
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('heading', { name: 'Sales Reps' }).waitFor({ state: 'visible', timeout: 30_000 });
  return { searchTerm, recordText: recordText.slice(0, 240), photoProof };
}

async function verifyGenericArchiveTab(page, { kind, label, depth }, failedResponses = []) {
  await page.locator(`[data-archive-tab="${kind}"]`).click();
  await page.locator(`.historical-archive[data-archive-kind="${kind}"]`).waitFor({ state: 'visible', timeout: 10_000 });
  const rootFolder = page.locator('[data-archive-folder]').first();
  await rootFolder.waitFor({ state: 'visible', timeout: 30_000 });
  const rootFolderCount = archiveCount(await page.locator('.historical-archive__heading-actions > span').textContent());
  const visibleRecordCount = (await page.locator('[data-archive-folder]').allTextContents())
    .reduce((total, text) => total + archiveRecordCount(text), 0);
  for (let level = 0; level < depth; level += 1) {
    let folders = page.locator('[data-archive-folder]');
    let folderTexts = await folders.allTextContents();
    let populatedIndex = folderTexts.findIndex(text => archiveFolderDataCount(text) > 0);
    for (let pageAttempt = 0; populatedIndex < 0 && kind === 'drive' && level === depth - 1 && pageAttempt < 10; pageAttempt += 1) {
      const next = page.locator(`.historical-archive[data-archive-kind="${kind}"]`).getByRole('button', { name: 'Next' });
      if (!await next.isVisible().catch(() => false) || await next.isDisabled()) break;
      const priorKey = await folders.first().getAttribute('data-archive-folder');
      await next.click();
      await page.waitForFunction(({ archiveKind, previous }) => {
        const nextFolder = document.querySelector(`.historical-archive[data-archive-kind="${archiveKind}"] [data-archive-folder]`);
        return !!nextFolder && nextFolder.getAttribute('data-archive-folder') !== previous;
      }, { archiveKind: kind, previous: priorKey }, { timeout: 30_000 });
      folders = page.locator('[data-archive-folder]');
      folderTexts = await folders.allTextContents();
      populatedIndex = folderTexts.findIndex(text => archiveFolderDataCount(text) > 0);
    }
    const folder = folders.nth(populatedIndex >= 0 ? populatedIndex : 0);
    await folder.waitFor({ state: 'visible', timeout: 30_000 });
    const priorKey = await folder.getAttribute('data-archive-folder');
    await folder.click();
    try {
      await page.waitForFunction(previous => {
        const record = document.querySelector('[data-archive-record]');
        const next = document.querySelector('[data-archive-folder]');
        return !!record || (!!next && next.getAttribute('data-archive-folder') !== previous);
      }, priorKey, { timeout: 30_000 });
    } catch (error) {
      const state = await page.locator(`.historical-archive[data-archive-kind="${kind}"]`).evaluate(host => ({
        text: String(host.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        alert: host.querySelector('[role="alert"]')?.textContent?.trim() || '',
        folders: host.querySelectorAll('[data-archive-folder]').length,
        records: host.querySelectorAll('[data-archive-record]').length,
      }));
      throw new Error(`${kind} level ${level + 1}: ${String(error?.message || error)} state=${JSON.stringify(state)} failed=${failedResponses.slice(-8).join('|')}`);
    }
  }
  const photoProof = await findArchivePhotoBadgeProof(page, kind);
  const search = await verifyArchiveSearch(page, kind);
  return { label, rootFolderCount, visibleRecordCount, photoProof, ...search };
}

async function verifyRequestSubmissionCanary(page, origin, accessCode) {
  let exchange = null;
  const routePattern = '**/rest/v1/rpc/create_request_batch';
  await page.route(routePattern, async route => {
    const request = route.request();
    const requestBody = JSON.parse(request.postData() || '{}');
    const canaryUrl = request.url().replace('/rpc/create_request_batch', '/rpc/verify_request_batch_submission_v2368');
    const response = await route.fetch({ url: canaryUrl });
    const responseText = await response.text();
    let responseBody = null;
    try { responseBody = responseText ? JSON.parse(responseText) : null; } catch {}
    exchange = { status: response.status(), requestBody, responseBody, responseText };
    await route.fulfill({ response, body: responseText });
  });
  try {
    await page.evaluate(() => switchView('drive', { force: true }));
    await page.locator('#view-drive').waitFor({ state: 'visible', timeout: 15_000 });
    try {
      await page.waitForFunction(() => Array.isArray(fullInventory) && fullInventory.some(row => row?.DOM_ID), undefined, { timeout: 15_000 });
    } catch {
      const exactRowLoaded = await page.evaluate(async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const lookup = await requestInventoryRead('master_page', {
              dataset: 'lookup', projection: 'full', itemCode: '008866.031.1', locationCode: 'E.06.000', limit: 1, offset: 0
            }, { label: 'Request canary inventory row' });
            const raw = Array.isArray(lookup?.data?.rows) ? lookup.data.rows[0] : Array.isArray(lookup?.rows) ? lookup.rows[0] : null;
            if (!raw) return false;
            const item = formatFetchedRows([raw], 'ph_master_inventory')[0];
            item.DOM_ID = `request_canary_${String(item.UNIQUE_ID || raw.unique_id || 'row').replace(/[^a-z0-9_-]/gi, '_')}`;
            fullInventory.push(item);
            invalidateInventoryDomIdLookup();
            return true;
          } catch (error) {
            if (!/cancel|abort/i.test(String(error?.message || error)) || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 250));
          }
        }
        return false;
      });
      if (!exactRowLoaded) fail('Request canary could not load an exact inventory row.');
    }
    const selected = await page.evaluate(() => {
      const item = fullInventory.find(row => String(row.ITEMCODE || '').trim() === '008866.031.1'
        && String(row.LOCATIONCODE || '').trim() === 'E.06.000') || fullInventory.find(row => Number(row.PTRAVAILABLE || 0) > 0);
      if (!item || !item.DOM_ID) return null;
      detailRequestSourceDomIds = [];
      selectedItems.clear();
      selectedItemSources.clear();
      selectedItems.add(item.DOM_ID);
      selectedItemSources.set(item.DOM_ID, 'drive');
      showRequestModalBase();
      return { itemcode: item.ITEMCODE, locationcode: item.LOCATIONCODE, domId: item.DOM_ID };
    });
    if (!selected) fail('Request canary could not select an inventory row.');
    await page.locator('#request-rep-modal').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#rep-search-input').fill('Josh Ringleb');
    const josh = page.locator('.request-rep-option').filter({ hasText: 'Josh Ringleb' }).first();
    await josh.waitFor({ state: 'visible', timeout: 15_000 });
    await josh.click();
    await page.waitForFunction(() => buildExistingRequestFolderCustomerGroups(tempSelectedReqRep).some(group =>
      (group.consignees || []).some(consignee => new Map((consignee.mapRows || []).filter(isActiveRequestCustomerMapping)
        .map(row => { const context = getRequestCustomerContext(row); return [JSON.stringify(context), context]; })).size === 1)), undefined, { timeout: 30_000 });
    const mappedPair = await page.evaluate(() => {
      for (const group of buildExistingRequestFolderCustomerGroups(tempSelectedReqRep)) {
        for (const consignee of group.consignees || []) {
          const identities = new Map((consignee.mapRows || []).filter(isActiveRequestCustomerMapping)
            .map(row => { const context = getRequestCustomerContext(row); return [JSON.stringify(context), context]; }));
          if (identities.size === 1) return { customer: String(group.label || '').trim(), consignee: String(consignee.consigneeLabel || 'No Consignee').trim() };
        }
      }
      return null;
    });
    if (!mappedPair) fail('Request canary could not find an unambiguous active customer and consignee.');
    const customer = page.getByRole('button', { name: `Open customer ${mappedPair.customer}`, exact: true }).first();
    await customer.waitFor({ state: 'visible', timeout: 30_000 });
    await customer.click();
    const consignee = page.getByRole('button', { name: `Open consignee ${mappedPair.consignee}`, exact: true }).first();
    await consignee.waitFor({ state: 'visible', timeout: 10_000 });
    await consignee.click();
    await page.getByRole('button', { name: 'Create new folder for selected customer and consignee' }).click();
    const folder = String(await page.locator('[data-request-folder-name]').textContent() || '').trim();
    if (!folder || /(^|\s)N\/?A($|\s)/i.test(folder) || !/\d{2}\/\d{2}\/\d{2}$/.test(folder)) {
      fail(`Request canary generated an invalid folder: ${folder || 'blank'}.`);
    }
    await page.locator('.item-qty-input').fill('1');
    const reuse = page.locator('.item-reuse-data-input');
    if (await reuse.count()) await reuse.selectOption('NO');
    for (let attempt = 0; attempt < 3 && !exchange; attempt += 1) {
      await page.locator('#request-submit-btn').click();
      for (let wait = 0; wait < 40 && !exchange; wait += 1) await page.waitForTimeout(100);
    }
    if (!exchange) fail('Request wizard did not dispatch the rollback canary.');
    if (exchange.status !== 200 || /42804|coalesce types timestamp with time zone and text/i.test(exchange.responseText)) {
      fail(`Request canary failed with HTTP ${exchange.status}: ${exchange.responseText.slice(0, 300)}.`);
    }
    const receipt = exchange.responseBody || {};
    const proof = receipt.canary_proof || {};
    const payloadRows = Array.isArray(exchange.requestBody.requests) ? exchange.requestBody.requests : [];
    if (receipt.canary_rolled_back !== true || receipt.client_batch_id !== exchange.requestBody.client_batch_id
        || receipt.rows?.length !== payloadRows.length || !payloadRows.length) fail('Request canary acknowledgment was invalid.');
    if (String(proof.requested_by || '').toLowerCase() !== username
        || String(proof.request_created_by_username || '').toLowerCase() !== username
        || String(proof.request_selected_rep_username || '').toLowerCase() !== 'josh_ringleb'
        || String(proof.request_selected_rep_display || '').toLowerCase() !== 'josh ringleb'
        || !String(proof.request_created_by_email || '').includes('@')
        || !String(proof.request_selected_rep_email || '').includes('@')
        || String(proof.request_folder || '') !== folder) fail(`Request creator/rep proof was ${JSON.stringify(proof)}.`);
    return { httpStatus: exchange.status, rolledBack: true, selected, folder, rows: payloadRows.length,
      actor: proof.requested_by, selectedRep: proof.request_selected_rep_username, creatorEmail: true, selectedRepEmail: true, coalesce42804: false };
  } finally {
    await page.unroute(routePattern).catch(() => {});
    await page.goto(`${origin}/?request-queue-verifier-canary-reset=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (await page.locator('#view-login').isVisible().catch(() => true)) {
      await page.locator('#username-input').fill(username);
      await page.locator('#pin-code').fill(accessCode);
      await page.waitForFunction(() => {
        const login = document.querySelector('#view-login');
        const button = document.querySelector('#login-button');
        return !login || getComputedStyle(login).display === 'none' || !button?.disabled;
      }, undefined, { timeout: 20_000 });
      await page.evaluate(() => {
        const login = document.querySelector('#view-login');
        const button = document.querySelector('#login-button');
        if (login && getComputedStyle(login).display !== 'none' && button && !button.disabled) button.click();
      });
    }
    await page.locator('#view-login').waitFor({ state: 'hidden', timeout: 20_000 });
    await page.locator('#footer-request-btn').waitFor({ state: 'visible', timeout: 20_000 });
  }
}

async function verifyPhotoAndAvNoteProof(page, failedResponses = []) {
  const target = { itemcode: '008866.031.1', locationcode: 'E.06.000', photoDate: '10/20/26' };
  await page.evaluate(() => { window.switchView('av', { force: true }); setAVTab('open'); setAvOpenTab('name'); });
  await page.locator('#view-av').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#av-search').fill(target.itemcode);
  try {
    await page.waitForFunction(({ itemcode, locationcode }) => Array.from(document.querySelectorAll('#av-content [data-dom-id]'))
      .some(card => String(card.textContent || '').includes(itemcode) && String(card.textContent || '').includes(locationcode)), target, { timeout: 30_000 });
  } catch (error) {
    const state = await page.locator('#view-av').evaluate(node => ({
      cards: node.querySelectorAll('#av-content [data-dom-id]').length,
      text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }));
    throw new Error(`AV Alice card wait: ${String(error?.message || error)} state=${JSON.stringify(state)}`);
  }
  const avCard = page.locator('#av-content [data-dom-id]').filter({ hasText: target.itemcode }).filter({ hasText: target.locationcode }).first();
  const av = await readPhotoBadgeProof(page, '#av-content [data-dom-id]:has-text("008866.031.1"):has-text("E.06.000")', 'AV Alice card');
  if (!av.dates.includes(target.photoDate)) fail(`AV Alice photo date was ${JSON.stringify(av.dates)}.`);
  await avCard.locator('.app-av-photo-slide, .app-inline-thumb-column').first().click();
  await page.locator('#photo-modal').waitFor({ state: 'visible', timeout: 10_000 });
  const lightbox = await readPhotoBadgeProof(page, '#photo-modal-gallery', 'View Photos lightbox');
  if (!lightbox.dates.includes(target.photoDate)) fail(`View Photos date was ${JSON.stringify(lightbox.dates)}.`);
  await page.locator('#photo-modal-close').click();

  await page.evaluate(() => window.switchView('drive', { force: true }));
  await page.locator('#view-drive').waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(() => { resetDriveView(false); setDriveTab('card'); });
  await page.locator('#tab-drive-card.active').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#drive-search').fill(target.itemcode);
  try {
    await page.waitForFunction(({ itemcode, locationcode }) => Array.from(document.querySelectorAll('#drive-content [data-dom-id]'))
      .some(card => String(card.textContent || '').includes(itemcode) && String(card.textContent || '').includes(locationcode)), target, { timeout: 30_000 });
  } catch (error) {
    const state = await page.locator('#view-drive').evaluate(node => ({
      cards: node.querySelectorAll('#drive-content [data-dom-id]').length,
      text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }));
    throw new Error(`Drive Alice card wait: ${String(error?.message || error)} state=${JSON.stringify(state)}`);
  }
  const driveCard = page.locator('#drive-content [data-dom-id]').filter({ hasText: target.itemcode }).filter({ hasText: target.locationcode }).first();
  const drive = await readPhotoBadgeProof(page, '#drive-content [data-dom-id]:has-text("008866.031.1"):has-text("E.06.000")', 'Drive Alice card');
  if (!drive.dates.includes(target.photoDate)) fail(`Drive Alice photo date was ${JSON.stringify(drive.dates)}.`);
  const driveDomId = String(await driveCard.getAttribute('data-dom-id') || '');
  await page.evaluate(id => {
    const item = findItemByDomId(id);
    if (!item) throw new Error('AV_NOTE_TARGET_MISSING');
    openDetail(item.UNIQUE_ID, 'drive', { sourceDomId: id });
  }, driveDomId);
  await page.locator('#view-detail').waitFor({ state: 'visible', timeout: 15_000 });
  const noteEditor = await page.evaluate(() => {
    const candidates = [
      { tab: 'season', prefix: 'ssn-' },
      { tab: 'location', prefix: 'lsn-' },
      { tab: 'not-on-inventory', prefix: 'na-' },
      { tab: 'request', prefix: 'req-' },
      { tab: 'flyer', prefix: 'flyer-' },
    ];
    const editor = candidates.find(candidate => {
      const tab = document.getElementById(`dtab-${candidate.tab}`);
      return !!tab && !tab.classList.contains('hidden');
    }) || null;
    if (editor) switchDetailTab(editor.tab);
    return editor;
  });
  if (!noteEditor) fail('Drive detail did not expose an editable AV Note tab.');
  await page.locator(`#det-${noteEditor.tab}-content`).waitFor({ state: 'visible', timeout: 15_000 });
  const avNoteTrigger = page.locator(`[data-av-note-dropdown-trigger="${noteEditor.prefix}"]`);
  await avNoteTrigger.waitFor({ state: 'visible', timeout: 15_000 });
  await avNoteTrigger.click();
  const avNoteOptions = page.locator(`#${noteEditor.prefix}av-dropdown-list [data-av-note-option]`);
  await avNoteOptions.first().waitFor({ state: 'visible', timeout: 20_000 });
  const avNotes = (await avNoteOptions.allTextContents()).map(normalizeCardText);
  const rejectedNote = avNotes.find(note => /(^|[^a-z])(spec|caliper|cal)([^a-z]|$)/i.test(note)
    || /^\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*(?:["']|in(?:ch(?:es)?)?)?\s*(?:h\s*x\s*w|height|high|h|width|wide|w|tall|t)(?:\s|$)/i.test(note));
  if (!avNotes.length || rejectedNote) fail(`ItemCode AV Note options failed: ${rejectedNote || 'none rendered'}.`);

  await page.evaluate(() => { window.switchView('sales-office', { force: true }); window.setSalesOfficeTab('season'); });
  await page.locator('#view-sales-office').waitFor({ state: 'visible', timeout: 15_000 });
  try {
    await page.locator('#sales-office-content [data-dom-id]:has(img)').first().waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const state = await page.locator('#view-sales-office').evaluate(node => ({
      cards: node.querySelectorAll('#sales-office-content [data-dom-id]').length,
      images: node.querySelectorAll('#sales-office-content [data-dom-id] img').length,
      text: String(node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    }));
    throw new Error(`Sales Office photo wait: ${String(error?.message || error)} state=${JSON.stringify(state)} failed=${failedResponses.slice(-8).join('|')}`);
  }
  const salesOffice = await readPhotoBadgeProof(page, '#sales-office-content [data-dom-id]:has(img)', 'Sales Office card');
  await page.evaluate(() => window.switchView('home', { force: true }));
  await page.locator('#view-home').waitFor({ state: 'visible', timeout: 15_000 });
  return { target, av, drive, salesOffice, lightbox, avNotes: { itemcode: target.itemcode, count: avNotes.length, rejected: 0 } };
}

async function verifyQuickAccessEvalReports(page) {
  const requiredViews = ['eval_reports_2','inventory-suggestion','inv-consolidation','request-sales-impact',
    'archive-requests','archive-orders','archive-reserves','archive-drive','queue-pending','queue-suspend',
    'queue-moves','queue-recount','queue-eval-work','queue-shear-list','queue-bunch-notes','queue-bunch-count-review',
    'manager-eval-reports','manager-approval','qc-docks','qc-eval-work','qc-approvals',
    'office-orders','office-reserves','office-assigned-items','sales-drive','sales-av','sales-docks','sales-request'];
  let original = [];
  let changed = false;
  const openEditor = async () => {
    await page.evaluate(() => window.openFooterShortcutSettings());
    await page.locator('#footer-shortcut-modal').waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('#footer-shortcut-content [data-nav-slot]').first().waitFor({ state: 'visible', timeout: 30_000 });
  };
  const save = async values => {
    const slots = page.locator('#footer-shortcut-content [data-nav-slot]');
    const count = await slots.count();
    for (let index = 0; index < count; index += 1) await slots.nth(index).selectOption(values[index] || '');
    await page.locator('#footer-shortcut-content [data-nav-status]').evaluate(node => { node.textContent = ''; });
    await page.locator('#footer-shortcut-content [data-nav-save]').click();
    await page.waitForFunction(() => document.querySelector('#footer-shortcut-content [data-nav-status]')?.textContent?.includes('Shortcuts saved'), undefined, { timeout: 30_000 });
  };
  try {
    await openEditor();
    const slots = page.locator('#footer-shortcut-content [data-nav-slot]');
    original = await slots.evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
    const options = await slots.first().locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: String(node.textContent || '').trim() })).filter(row => row.value));
    const available = new Set(options.map(row => row.value));
    const missing = requiredViews.filter(view => !available.has(view));
    if (missing.length) fail(`Quick Access is missing ${missing.join(', ')}.`);
    const expectedOptionCount = await page.evaluate(() => window.GncNavigationPreferences.snapshot.views
      .filter(row => row.selectable && canAccessQuickAccessView(row.view)).length);
    if (options.length < expectedOptionCount) fail(`Quick Access listed ${options.length} of ${expectedOptionCount} selectable views.`);
    const desired = ['eval_reports_2', ...original.filter(view => view !== 'eval_reports_2')].slice(0, 5);
    await save(desired);
    changed = JSON.stringify(desired) !== JSON.stringify(original);
    await page.evaluate(() => window.closeFooterShortcutSettings());
    const shortcut = page.locator('[data-footer-view="eval_reports_2"]');
    await shortcut.waitFor({ state: 'visible', timeout: 10_000 });
    await shortcut.click();
    await page.locator('#view-managers').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(() => document.getElementById('manager-module-title')?.textContent?.trim() === 'Eval Reports #2', undefined, { timeout: 20_000 });
    const openedTitle = normalizeCardText(await page.locator('#manager-module-title').textContent());
    await page.locator('#global-header-inline-back').click();
    await page.locator('#view-home').waitFor({ state: 'visible', timeout: 15_000 });
    return { availableViews: options.length, requiredViews: requiredViews.length, pinned: true, openedTitle, oneClick: true, backView: 'home' };
  } finally {
    if (!await page.locator('#footer-shortcut-modal').isVisible().catch(() => false)) await openEditor().catch(() => {});
    if (original.length && await page.locator('#footer-shortcut-content [data-nav-slot]').count().catch(() => 0)) {
      await save(original).catch(() => {});
    }
    await page.evaluate(() => window.closeFooterShortcutSettings()).catch(() => {});
    if (changed) await page.waitForTimeout(200);
  }
}

async function runVerification(page, origin, accessCode) {
  let stage = 'navigate';
  try {
  const pageErrors = [];
  const failedResponses = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
  page.on('response', async response => {
    if (response.status() < 400) return;
    try {
      const url = new URL(response.url());
      if (url.hostname.endsWith('.supabase.co')) {
        const body = await response.text().catch(() => '');
        const detail = body.replace(/\s+/g, ' ').replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]').slice(0, 180);
        failedResponses.push(`${response.status()} ${url.pathname}${detail ? ` ${detail}` : ''}`);
      }
    } catch {}
  });
  await page.goto(`${origin}/?request-queue-verifier=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  stage = 'login';
  await page.locator('#username-input').fill(username);
  await page.locator('#pin-code').fill(accessCode);
  await page.locator('#login-button').click();
  await page.locator('#view-login').waitFor({ state: 'hidden', timeout: 20_000 });
  await page.locator('#footer-request-btn').waitFor({ state: 'visible', timeout: 20_000 });

  stage = 'home-metadata';
  const metadataStartedAt = Date.now();
  const metadataWaitTimeoutMs = Math.max(1000, Number(process.env.GNC_REQUEST_QUEUE_METADATA_DIAGNOSTIC_TIMEOUT_MS) || 1000);
  await page.waitForFunction(() => {
    const required = ['DRIVE', 'CAV', 'RESERVES', 'SOC'];
    const cards = new Map(Array.from(document.querySelectorAll('#dashboard-sync-files [data-sync-source]'))
      .map(card => [card.getAttribute('data-sync-source'), card]));
    return required.every(label => {
      const filename = cards.get(label)?.querySelector('.dashboard-sync-filename')?.textContent?.trim() || '';
      return filename && filename !== 'Filename pending';
    });
  }, undefined, { timeout: metadataWaitTimeoutMs });
  const homeMetadataMs = Date.now() - metadataStartedAt;
  if (homeMetadataMs > 1000) fail(`Home filenames took ${homeMetadataMs}ms after login readiness.`);
  const filenames = await page.locator('#dashboard-sync-files [data-sync-source]').evaluateAll(cards => Object.fromEntries(cards.map(card => [
    card.getAttribute('data-sync-source'), card.querySelector('.dashboard-sync-filename')?.textContent?.trim() || '',
  ])));

  await dismissPushPermissionHelp(page);
  stage = 'queue-navigation';
  await page.locator('#footer-request-btn').waitFor({ state: 'visible', timeout: 10_000 });
  await clickPastPushPermissionHelp(page, page.locator('#footer-request-btn'));
  const requestPill = page.locator('#request-filter-toolbar [data-request-category="pending"]');
  await requestPill.waitFor({ state: 'visible', timeout: 10_000 });
  await clickPastPushPermissionHelp(page, requestPill);
  stage = 'request-cards';
  try {
    await page.waitForFunction(() => {
      const root = document.getElementById('view-que') || document.getElementById('view-request');
      const countText = document.querySelector('#request-filter-toolbar [data-request-category="pending"] .request-category-chip__count')?.textContent || '0';
      const count = Number((countText.match(/\d+/) || ['0'])[0]);
      const cards = root?.querySelectorAll('#request-content [data-request-uid]') || [];
      return count >= 6 && cards.length >= 6 && !String(root?.textContent || '').includes('No pending requests.');
    }, undefined, { timeout: 20_000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const root = document.getElementById('view-que') || document.getElementById('view-request');
      return {
        pill: document.querySelector('#request-filter-toolbar [data-request-category="pending"]')?.textContent?.trim() || '',
        cards: root?.querySelectorAll('#request-content [data-request-uid]').length || 0,
        text: String(root?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      };
    });
    throw new Error(`${String(error?.message || error)} state=${JSON.stringify(state)} failed=${failedResponses.slice(-8).join('|')}`);
  }

  const requestBadgeCount = Number(((await requestPill.locator('.request-category-chip__count').textContent())?.match(/\d+/) || ['0'])[0]);
  const noPendingVisible = await page.getByText('No pending requests.', { exact: true }).isVisible().catch(() => false);
  const cardDomText = (await page.locator('#request-content [data-request-uid]').allTextContents()).map(normalizeCardText);
  for (const [itemcode, commonname, locationcode] of expectedCards) {
    if (!cardDomText.some(text => text.includes(itemcode) && text.includes(commonname) && text.includes(locationcode))) {
      fail(`Required Request card is missing: ${itemcode} at ${locationcode}.`);
    }
  }
  if (requestBadgeCount !== 6 || cardDomText.length !== 6 || noPendingVisible) {
    fail(`Request queue rendered badge ${requestBadgeCount} with ${cardDomText.length} cards.`);
  }
  const activeRequestId = String(await page.locator('#request-content [data-request-uid]').first().getAttribute('data-request-uid') || '').trim();
  if (!activeRequestId) fail('A live Request card identifier was not rendered.');

  const queueProof = {
    request: { label: `REQUEST ${requestBadgeCount}`, badge: requestBadgeCount, cards: cardDomText.length },
  };

  stage = 'request-submission-canary';
  const requestCanary = await verifyRequestSubmissionCanary(page, origin, accessCode);
  await dismissPushPermissionHelp(page);
  await clickPastPushPermissionHelp(page, page.locator('#footer-request-btn'));
  const postCanaryRequestPill = page.locator('#request-filter-toolbar [data-request-category="pending"]');
  await postCanaryRequestPill.waitFor({ state: 'visible', timeout: 15_000 });
  await clickPastPushPermissionHelp(page, postCanaryRequestPill);
  await page.waitForFunction(() => {
    const badge = Number((document.querySelector('#request-filter-toolbar [data-request-category="pending"] .request-category-chip__count')?.textContent?.match(/\d+/) || ['0'])[0]);
    return badge === 6 && document.querySelectorAll('#request-content [data-request-uid]').length === 6;
  }, undefined, { timeout: 30_000 });

  stage = 'recount-queue';
  await openQueueCategory(page, 'recount');
  await page.waitForFunction(() => {
    const content = document.getElementById('request-content');
    const count = Number((document.querySelector(
      '#request-filter-toolbar [data-request-category="recount"] .request-category-chip__count',
    )?.textContent?.match(/\d+/) || ['0'])[0]);
    return count === 0 && String(content?.textContent || '').includes('No recount rows.');
  }, undefined, { timeout: 30_000 });
  const recountBadgeCount = await queueCategoryCount(page, 'recount');
  const recountCardCount = await page.locator('#request-content > .mb-3').count();
  if (recountBadgeCount !== 0 || recountCardCount !== 0) fail(`Recount remained at ${recountBadgeCount} with ${recountCardCount} cards.`);
  queueProof.recount = { label: `RECOUNT ${recountBadgeCount}`, badge: recountBadgeCount, cards: recountCardCount };

  stage = 'bunch-notes-queue';
  await openQueueCategory(page, 'bunch-notes');
  await page.waitForFunction(() => {
    const content = document.getElementById('request-content');
    const count = Number((document.querySelector(
      '#request-filter-toolbar [data-request-category="bunch-notes"] .request-category-chip__count',
    )?.textContent?.match(/\d+/) || ['0'])[0]);
    return count === 0 && String(content?.textContent || '').includes('No Bunch Notes in this filter.')
      && content?.querySelectorAll('[data-bunch-card]').length === 0
      && Array.from(content?.querySelectorAll('.bq-toolbar button') || []).some(button => button.textContent?.trim() === 'Refresh');
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const bunchBadgeCount = await queueCategoryCount(page, 'bunch-notes');
  const bunchCardCount = await page.locator('#request-content [data-bunch-card]').count();
  if (bunchBadgeCount !== 0 || bunchCardCount !== 0) fail(`Bunch Notes remained at ${bunchBadgeCount} with ${bunchCardCount} cards.`);
  queueProof.bunchNotes = { label: `BUNCH NOTES ${bunchBadgeCount}`, badge: bunchBadgeCount, cards: bunchCardCount };

  stage = 'suspend-queue';
  await openQueueCategory(page, 'suspend-tag');
  await page.waitForFunction(([commonname, locationcode]) => {
    const content = document.getElementById('request-content');
    const count = Number((document.querySelector(
      '#request-filter-toolbar [data-request-category="suspend-tag"] .request-category-chip__count',
    )?.textContent?.match(/\d+/) || ['0'])[0]);
    const text = String(content?.textContent || '').replace(/\s+/g, ' ');
    return count >= 1 && text.includes(commonname) && text.includes(locationcode);
  }, expectedSuspendCard, { timeout: 30_000 });
  const suspendBadgeCount = await queueCategoryCount(page, 'suspend-tag');
  const suspendText = normalizeCardText(await page.locator('#request-content').textContent());
  if (suspendBadgeCount < 1 || !expectedSuspendCard.every(value => suspendText.includes(value))) {
    fail(`Suspend proof was ${suspendBadgeCount}: ${suspendText.slice(0, 240)}.`);
  }
  queueProof.suspend = {
    label: `SUSPEND ${suspendBadgeCount}`,
    badge: suspendBadgeCount,
    cards: await page.locator('#request-content [data-request-uid]').count(),
    requiredCard: expectedSuspendCard.join(' | '),
  };

  stage = 'inventory-consolidation';
  await page.evaluate(() => window.switchView('home', { force: true }));
  await page.locator('#home-tile-sales-inventory').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#home-tile-sales-inventory').click();
  await page.locator('#view-sales-inventory').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#inventory-open-suggestions').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#inventory-open-suggestions').click();
  await page.locator('#view-inventory-suggestion').waitFor({ state: 'visible', timeout: 10_000 });
  const consolidationStartedAt = Date.now();
  await page.locator('#inventory-suggestion-open-consolidation').click();
  await page.locator('#view-inv-consolidation').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('[data-inv-consolidation-card]').first().waitFor({ state: 'visible', timeout: 10_000 });
  const consolidationRenderMs = Date.now() - consolidationStartedAt;
  if (consolidationRenderMs > 2_000) fail(`Inventory Consolidation rendered in ${consolidationRenderMs}ms.`);
  const expectedSizes = ['#2','#3','#1','2DP','3DP','1GP','8DP','8 IN.','5DP','7DP','QT','2QTD','6QTD','8" P','3GP','1DP'];
  const sizeLabels = (await page.locator('[data-consolidation-size-contract] span').allTextContents()).map(normalizeCardText);
  if (JSON.stringify(sizeLabels) !== JSON.stringify(expectedSizes)) fail(`Inventory Consolidation sizes were ${JSON.stringify(sizeLabels)}.`);
  const consolidationSummary = normalizeCardText(await page.locator('#inv-consolidation-content').textContent());
  const currentSalesYear = Number((consolidationSummary.match(/Current SalesYear\s+(\d+)/i) || [])[1]);
  const cropTierOptions = (await page.locator('#inv-consolidation-rule option').allTextContents()).map(normalizeCardText);
  const expectedTierOptions = ['All Crop Tiers', `Carry Over (< SY ${currentSalesYear})`, `Current Crop (SY ${currentSalesYear})`, `Future Crop (> SY ${currentSalesYear})`];
  if (!Number.isInteger(currentSalesYear) || JSON.stringify(cropTierOptions) !== JSON.stringify(expectedTierOptions)) {
    fail(`Inventory Consolidation crop-tier filters were ${JSON.stringify(cropTierOptions)}.`);
  }
  const consolidationCards = await readConsolidationCards(page);
  if (!consolidationCards.length || consolidationCards.some(card => !expectedSizes.includes(card.contsize)
      || !(card.locOnHand > 0 && card.locOnHand < 100) || !card.options.length || card.sendButtons !== 1 || !card.badge
      || (card.tier === 'CARRY_OVER' && card.options.some(option => option.salesYear >= currentSalesYear))
      || (card.tier === 'CURRENT_CROP' && card.options.some(option => option.salesYear !== currentSalesYear))
      || (card.tier === 'FUTURE_CROP' && card.options.some(option => option.salesYear !== card.sourceSalesYear))
      || !['CARRY_OVER','CURRENT_CROP','FUTURE_CROP'].includes(card.tier))) fail('Inventory Consolidation card contract failed.');
  const consolidationTotal = Number((consolidationSummary.match(/([\d,]+) matching locations?/) || [,'0'])[1].replaceAll(',', ''));
  if (consolidationTotal < consolidationCards.length || !consolidationSummary.includes('Nothing enters Location Moves until you click Send.')) {
    fail(`Inventory Consolidation summary was ${consolidationSummary.slice(0, 240)}.`);
  }
  const search = page.locator('#inv-consolidation-search');
  await search.fill('006138.021.1');
  const fuchsiaCards = await readConsolidationCards(page);
  const badPairVisible = fuchsiaCards.some(card => card.sourceLocation === 'G.15.000' && card.sourceSalesYear === 2025
    && card.options.some(option => option.locationcode === 'E.22.000' && option.salesYear === 2027));
  if (badPairVisible) fail('Fuchsia Glow Carry Over still points to E.22.000 Current Crop.');

  await search.fill('008404.010.1');
  const greenBeautyCards = await readConsolidationCards(page);
  const greenBeauty = greenBeautyCards.find(card => card.sourceLocation === 'C.11.034' && card.sourceSalesYear === 2026);
  const greenBeautyDestination = greenBeauty?.options.find(option => option.locationcode === 'C.11.054' && option.salesYear === 2026);
  if (!greenBeauty || greenBeauty.badge !== 'CARRY OVER -> CARRY OVER' || !greenBeautyDestination) {
    fail(`Green Beauty Carry Over proof failed: ${JSON.stringify(greenBeautyCards).slice(0, 800)}.`);
  }

  await search.fill('');
  await page.locator('#inv-consolidation-rule').selectOption('CURRENT_CROP');
  const currentCropCards = await readConsolidationCards(page);
  const currentCrop = currentCropCards[0];
  if (!currentCrop || currentCrop.badge !== 'CURRENT CROP -> CURRENT CROP'
      || currentCrop.sourceSalesYear !== currentSalesYear
      || currentCrop.options.some(option => option.salesYear !== currentSalesYear)) {
    fail('Current Crop card proof failed.');
  }
  await page.evaluate(() => window.goBackUniversal());
  await page.locator('#view-inventory-suggestion').waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => window.goBackUniversal());
  await page.locator('#view-sales-inventory').waitFor({ state: 'visible', timeout: 10_000 });
  await page.evaluate(() => window.goBackUniversal());
  await page.locator('#view-home').waitFor({ state: 'visible', timeout: 10_000 });
  const consolidationProof = { hierarchy: ['Inventory','Inventory Suggestion','Inv Consolidation'], total: consolidationTotal,
    renderedCards: consolidationCards.length, sizeCount: sizeLabels.length, currentSalesYear, cropTierOptions, consolidationRenderMs,
    badPairExcluded: '006138.021.1 G.15.000 SY 2025 -> E.22.000 SY 2027',
    carryOverSample: { source: '008404.010.1 C.11.034 SY 2026', destination: greenBeautyDestination.text, badge: greenBeauty.badge },
    currentCropSample: { source: `${currentCrop.sourceLocation} SY ${currentCrop.sourceSalesYear}`, destination: currentCrop.options.find(option => option.selected)?.text, badge: currentCrop.badge },
    automaticQueueWrites: 0 };

  stage = 'photo-and-av-note-proof';
  const photoAndAvNoteProof = await verifyPhotoAndAvNoteProof(page, failedResponses);
  stage = 'quick-access-eval-reports-2';
  const quickAccessProof = await verifyQuickAccessEvalReports(page);

  stage = 'historical-requests';
  const historyFailureOffset = failedResponses.length;
  await dismissPushPermissionHelp(page);
  await page.locator('#home-tile-historical-requests').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#home-tile-historical-requests').click();
  await page.locator('#historical-requests-title').waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await page.waitForFunction(() => {
      const host = document.getElementById('historical-requests-content');
      return !!host && !host.querySelector('[role="alert"]')
        && !!host.querySelector('.historical-requests__groups .historical-requests__group')
        && !!host.querySelector('.historical-requests__summary strong');
    }, undefined, { timeout: 30_000 });
  } catch (error) {
    const state = await page.locator('#historical-requests-content').evaluate(host => ({
      text: String(host.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      alert: host.querySelector('[role="alert"]')?.textContent?.trim() || '',
      groups: host.querySelectorAll('.historical-requests__groups .historical-requests__group').length,
      summary: host.querySelectorAll('.historical-requests__summary strong').length,
    })).catch(() => ({ text: '', alert: '', groups: 0, summary: 0 }));
    throw new Error(`${String(error?.message || error)} state=${JSON.stringify(state)} failed=${failedResponses.slice(-8).join('|')}`);
  }
  const historicalPricedValue = normalizeCardText(await page.locator('.historical-requests__summary > div').nth(1).locator('strong').textContent());
  const tabLabels = (await page.locator('[data-archive-tab]').allTextContents()).map(normalizeCardText);
  const expectedTabLabels = ['Historical Requests', 'Historical SOC Open Orders', 'Historical SOC Reserves', 'Historical Drive Around'];
  if (JSON.stringify(tabLabels) !== JSON.stringify(expectedTabLabels)) fail(`Historical archive tabs were ${JSON.stringify(tabLabels)}.`);
  const requestRootFolderCount = archiveCount(await page.locator('.historical-requests__section-heading > span').first().textContent());
  const requestSearch = await verifyRequestArchiveSearch(page);
  const archiveTabs = { requests: { label: expectedTabLabels[0], rootFolderCount: requestRootFolderCount, ...requestSearch } };
  stage = 'historical-orders';
  archiveTabs.orders = await verifyGenericArchiveTab(page, { kind: 'orders', label: expectedTabLabels[1], depth: 3 }, failedResponses);
  stage = 'historical-reserves';
  archiveTabs.reserves = await verifyGenericArchiveTab(page, { kind: 'reserves', label: expectedTabLabels[2], depth: 4 }, failedResponses);
  stage = 'historical-drive';
  archiveTabs.drive = await verifyGenericArchiveTab(page, { kind: 'drive', label: expectedTabLabels[3], depth: 3 }, failedResponses);
  stage = 'historical-requests';
  const historyFailures = failedResponses.slice(historyFailureOffset).filter(value => value.includes('/functions/v1/app-api'));
  if (historyFailures.length) fail(`Historical Requests app-api failure: ${historyFailures[0]}`);

  stage = 'request-sales-impact';
  await page.locator('#historical-request-sales-impact-btn').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#historical-request-sales-impact-btn').click();
  const impactValue = page.locator('#request-sales-impact-content .request-impact-kpi-primary strong');
  try {
    await impactValue.waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      view: document.querySelector('.view:not(.hidden)')?.id || '',
      text: String(document.getElementById('request-sales-impact-content')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    }));
    throw new Error(`${String(error?.message || error)} state=${JSON.stringify(state)} failed=${failedResponses.slice(-8).join('|')}`);
  }
  const requestSalesImpactText = normalizeCardText(await impactValue.textContent());
  const requestSalesImpactTotal = parseCurrency(requestSalesImpactText);
  if (requestSalesImpactTotal < minimumRequestImpact) fail(`Request Sales Impact was ${requestSalesImpactText || 'missing'}.`);
  if (await page.locator('#request-sales-impact-content [role="alert"]').count()) fail('Request Sales Impact rendered an error alert.');
  if (pageErrors.length) fail(`Browser page error: ${pageErrors[0]}`);
  const release = normalizeCardText(await page.locator('#header-version').textContent());
  if (!release.includes('2.3.68')) fail(`Unexpected release version: ${release || 'missing'}.`);
  return { release, homeMetadataMs, filenames, requestBadgeCount, activeRequestId, requestCanary, queueProof, consolidationProof,
    photoAndAvNoteProof, quickAccessProof, historicalPricedValue,
    archiveTabs, requestSalesImpactText, requestSalesImpactTotal, cardDomText: expectedCards.map(([itemcode, , locationcode]) =>
      cardDomText.find(text => text.includes(itemcode) && text.includes(locationcode))) };
  } catch (error) {
    throw new Error(`${stage}: ${String(error?.message || error)}`);
  }
}

async function main() {
  const source = readComposedAppSource();
  const supabaseUrl = String(source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1] || '').replace(/\/+$/, '');
  const anonKey = String(source.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1] || '').trim();
  if (!supabaseUrl.includes('kzrnyjsosryejjejliii.supabase.co')) fail('Unexpected Supabase project.');
  if (!anonKey) fail('Supabase anon key is unavailable.');
    const localEnv = readLocalEnv();
    const accessCode = await resolveAccessCode({ supabaseUrl, localEnv });
    const queueCountsBefore = await readQueueInvariantCounts(localEnv);
    if (queueCountsBefore.active_request !== 6 || queueCountsBefore.active_recount !== 0
        || queueCountsBefore.active_bunch_notes !== 0 || queueCountsBefore.active_suspend < 1) {
      fail(`Protected queue baseline was ${JSON.stringify(queueCountsBefore)}.`);
    }
  let server;
  let browser;
  try {
    let origin = String(process.env.GNC_REQUEST_QUEUE_ORIGIN || '').trim().replace(/\/+$/, '');
    if (!origin) {
      server = await startReleaseTestServer({ port: 0, siteDir: path.join(root, '_site') });
      origin = `http://127.0.0.1:${server.address().port}`;
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const result = await runVerification(page, origin, accessCode);
    const queueCountsAfter = await readQueueInvariantCounts(localEnv);
    for (const [key, value] of Object.entries(queueCountsBefore)) if (queueCountsAfter[key] !== value) {
      fail(`Protected queue ${key} changed from ${value} to ${queueCountsAfter[key]}.`);
    }
    const anonSecurity = await probeAnonSecurity({ supabaseUrl, anonKey, existingRequestId: result.activeRequestId });
    const archiveCounts = await readArchiveDatabaseCounts(localEnv);
    const auraGlossaryTerms = await readAuraGlossaryTerms(localEnv);
    console.log(JSON.stringify({ status: 'passed', origin, ...result, queueCountsBefore, queueCountsAfter, archiveCounts, auraGlossaryTerms, anonSecurity }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  const safe = String(error?.message || error).replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/(token|apikey|password|secret|access[_ -]?code)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  console.error(`REQUEST_QUEUE_BROWSER_VERIFY_FAILED ${safe.slice(0, 1000)}`);
  process.exitCode = 1;
});
