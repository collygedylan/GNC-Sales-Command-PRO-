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
const expectedCards = [
  ['003139.250.1', 'Oakland® Red Holly', 'A.08.000'],
  ['008280.150.1', 'Sunburst® Honeylocust', 'C.05.000'],
  ['009199.013.1', 'Ruby Star Coneflower', 'D.09.013'],
  ['009501.013.1', 'Queen Victoria Cardinal Flower', 'D.09.044'],
  ['001711.030.1', 'Purple Pride Beautyberry', 'D.26.000'],
  ['001711.070.1', 'Purple Pride Beautyberry', 'F.05.000'],
];

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

async function runVerification(page, origin, accessCode) {
  let stage = 'navigate';
  try {
  const pageErrors = [];
  const failedResponses = [];
  page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
  page.on('response', response => {
    if (response.status() < 400) return;
    try {
      const url = new URL(response.url());
      if (url.hostname.endsWith('.supabase.co')) failedResponses.push(`${response.status()} ${url.pathname}`);
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

  const pushHelp = page.locator('#push-permission-help-modal');
  if (await pushHelp.isVisible()) await pushHelp.getByRole('button', { name: 'Close' }).click();
  stage = 'queue-navigation';
  await page.locator('#footer-request-btn').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#footer-request-btn').click();
  const requestPill = page.locator('#request-filter-toolbar [data-request-category="pending"]');
  await requestPill.waitFor({ state: 'visible', timeout: 10_000 });
  await requestPill.click();
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
  if (pageErrors.length) fail(`Browser page error: ${pageErrors[0]}`);
  const release = normalizeCardText(await page.locator('#header-version').textContent());
  if (!release.includes('2.3.64')) fail(`Unexpected release version: ${release || 'missing'}.`);
  return { release, homeMetadataMs, filenames, requestBadgeCount, cardDomText: expectedCards.map(([itemcode, , locationcode]) =>
    cardDomText.find(text => text.includes(itemcode) && text.includes(locationcode))) };
  } catch (error) {
    throw new Error(`${stage}: ${String(error?.message || error)}`);
  }
}

async function main() {
  const source = readComposedAppSource();
  const supabaseUrl = String(source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1] || '').replace(/\/+$/, '');
  if (!supabaseUrl.includes('kzrnyjsosryejjejliii.supabase.co')) fail('Unexpected Supabase project.');
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
    console.log(JSON.stringify({ status: 'passed', origin, ...result }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  const safe = String(error?.message || error).replace(/(?:bearer\s+)[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/(token|apikey|password|secret|access[_ -]?code)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
  console.error(`REQUEST_QUEUE_BROWSER_VERIFY_FAILED ${safe.slice(0, 320)}`);
  process.exitCode = 1;
});
