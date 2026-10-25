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

async function verifyArchiveSearch(page, recordKind) {
  const card = page.locator('[data-archive-record]').first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
  const recordText = normalizeCardText(await card.textContent());
  const metadata = normalizeCardText(await card.locator('.historical-requests__request-meta').first().textContent());
  const searchTerm = metadata.split(/\s+/)[0];
  if (!searchTerm || searchTerm.length < 2) fail(`${recordKind} did not expose a searchable record identity.`);
  const search = page.getByRole('searchbox', { name: 'Search this archive' });
  await search.fill(searchTerm);
  await page.getByRole('heading', { name: /Search results for/ }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('[data-archive-record]').first().waitFor({ state: 'visible', timeout: 30_000 });
  const searchText = normalizeCardText(await page.locator('[data-archive-record]').first().textContent());
  if (!searchText.toLowerCase().includes(searchTerm.toLowerCase())) fail(`${recordKind} search did not return ${searchTerm}.`);
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.locator('[data-archive-folder]').first().waitFor({ state: 'visible', timeout: 30_000 });
  return { searchTerm, recordText: recordText.slice(0, 240) };
}

async function verifyRequestArchiveSearch(page) {
  await page.getByRole('heading', { name: 'Sales Reps' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.historical-requests__group-button').first().click();
  await page.getByRole('heading', { name: 'Customers' }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.historical-requests__group-button').first().click();
  const card = page.locator('.historical-requests__request').first();
  await card.waitFor({ state: 'visible', timeout: 30_000 });
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
  return { searchTerm, recordText: recordText.slice(0, 240) };
}

async function verifyGenericArchiveTab(page, { kind, label, depth }) {
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
      throw new Error(`${kind} level ${level + 1}: ${String(error?.message || error)} state=${JSON.stringify(state)}`);
    }
  }
  const search = await verifyArchiveSearch(page, kind);
  return { label, rootFolderCount, visibleRecordCount, ...search };
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
  if (requestBadgeCount < 6 || noPendingVisible) fail('Request queue retained its empty state.');
  const activeRequestId = String(await page.locator('#request-content [data-request-uid]').first().getAttribute('data-request-uid') || '').trim();
  if (!activeRequestId) fail('A live Request card identifier was not rendered.');

  const queueProof = {
    request: { label: `REQUEST ${requestBadgeCount}`, badge: requestBadgeCount, cards: cardDomText.length },
  };

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

  stage = 'historical-requests';
  const historyFailureOffset = failedResponses.length;
  await page.evaluate(() => window.switchView('home', { force: true }));
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
  const archiveTabs = {
    requests: { label: expectedTabLabels[0], rootFolderCount: requestRootFolderCount, ...requestSearch },
    orders: await verifyGenericArchiveTab(page, { kind: 'orders', label: expectedTabLabels[1], depth: 3 }),
    reserves: await verifyGenericArchiveTab(page, { kind: 'reserves', label: expectedTabLabels[2], depth: 4 }),
    drive: await verifyGenericArchiveTab(page, { kind: 'drive', label: expectedTabLabels[3], depth: 3 }),
  };
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
  if (!release.includes('2.3.66')) fail(`Unexpected release version: ${release || 'missing'}.`);
  return { release, homeMetadataMs, filenames, requestBadgeCount, activeRequestId, queueProof, historicalPricedValue,
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
    const anonSecurity = await probeAnonSecurity({ supabaseUrl, anonKey, existingRequestId: result.activeRequestId });
    const archiveCounts = await readArchiveDatabaseCounts(localEnv);
    console.log(JSON.stringify({ status: 'passed', origin, ...result, archiveCounts, anonSecurity }, null, 2));
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
