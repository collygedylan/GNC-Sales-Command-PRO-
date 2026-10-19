import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { chromium } from '@playwright/test';

// This verifier deliberately fails closed without genuine, native Supabase
// sessions for every active Rep. It does not create, refresh, or impersonate
// sessions, and it never records auth headers, page traces, screenshots, or
// inventory row data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = String(process.env.GNC_AV_REP_APP_ORIGIN || 'https://agmetricapp.com').replace(/\/+$/, '');
const sessionFile = String(process.env.GNC_AV_REP_SESSIONS_FILE || '').trim();
const outputFile = path.resolve(process.env.GNC_AV_REP_OUTPUT || path.join(root, '.gnc-local', 'v2310-live-av-e2e.json'));
const envFile = path.resolve(process.env.GNC_SUPABASE_ENV_FILE || 'C:/Users/dylan/Projects/GNC/repo/.env');
const caFile = path.resolve(root, 'scripts/certs/supabase-prod-ca-2021.crt');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const supabaseUrl = shell.match(/const SUPABASE_URL = "([^"]+)"/)?.[1] || '';
const publishableKey = shell.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1] || '';
const safeProgress = { failedUsername: null, completedUsers: [] };

function fail(message) {
  const error = new Error(message);
  error.name = 'SafeVerifierError';
  throw error;
}

function loadDatabaseUrl() {
  if (!fs.existsSync(envFile)) fail('GNC_SUPABASE_ENV_FILE is unavailable.');
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  const entry = lines.find(line => /^\s*GNC_SUPABASE_DB_URL\s*=/.test(line));
  if (!entry) fail('GNC_SUPABASE_DB_URL is missing from the configured env file.');
  let value = entry.slice(entry.indexOf('=') + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value) fail('GNC_SUPABASE_DB_URL is empty.');
  return value;
}

function parsePgUrl(value) {
  const url = new URL(value);
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || !url.hostname || !url.username || !url.password) fail('Database URL format is invalid.');
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

const directorySql = `
with cfg as (
  select upper(value->>'seasonCode') season, (value->>'salesYear')::int max_year
  from public.ph_app_settings where key='current_season_salesyear'
), reps as (
  select p.id, lower(p.username) username, upper(regexp_replace(coalesce(p.role,''),'[^A-Za-z]','','g')) role,
    lower(split_part(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),' ',1)) first_name,
    lower((regexp_split_to_array(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),'\\s+'))[
      array_length(regexp_split_to_array(regexp_replace(coalesce(p.display_name,p.username),'[^A-Za-z0-9]+',' ','g'),'\\s+'),1)]) last_name
  from public.profiles p join public.ph_app_users u on u.id=p.legacy_user_id
  where upper(regexp_replace(coalesce(p.role,''),'[^A-Za-z]','','g')) in ('REP','SALESREP')
    and p.disabled_at is null and (p.locked_until is null or p.locked_until<=now()) and not coalesce(p.must_change_password,false)
    and u.disabled_at is null and (u.locked_until is null or u.locked_until<=now()) and not coalesce(u.must_change_password,false)
), reserve_codes as (
  select r.username, upper(trim(rv.itemcode)) itemcode
  from reps r join public.ph_reserves rv on
    lower(coalesce(rv.salesrepname,'')) like '%'||r.first_name||'%'||r.last_name||'%' or
    lower(coalesce(rv.salesrepname,'')) like '%'||r.last_name||'%'||r.first_name||'%'
  where trim(coalesce(rv.itemcode,''))<>''
), mi as (
  select m.unique_id, upper(trim(m.itemcode)) itemcode,
    coalesce(nullif(upper(trim(m.season)),''),(regexp_match(upper(trim(coalesce(m.lotcode,''))),'^([0-9]{2})\\s*\\.\\s*([A-Z0-9]+)$'))[2]) season,
    greatest(
      coalesce(case when replace(regexp_replace(coalesce(m.saleyear,''),'[^0-9.-]','','g'),',','') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        then case when replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric>=2000
          then mod(replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric,100)
          else replace(regexp_replace(m.saleyear,'[^0-9.-]','','g'),',','')::numeric end end,-1),
      coalesce(((regexp_match(upper(trim(coalesce(m.lotcode,''))),'^([0-9]{2})\\s*\\.\\s*([A-Z0-9]+)$'))[1])::numeric,-1)
    ) year_no,
    case when coalesce(m.s_lts,'') ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)[[:space:]]*$' then m.s_lts::numeric else 0 end open_stock,
    coalesce(m.desigitem,'') desigitem, lower(coalesce(m.app_tab_assignment,'')) app_tab_assignment
  from public.ph_master_inventory m
), season_rows as (
  select m.* from mi m cross join cfg
  where m.itemcode<>'' and m.season=cfg.season and m.year_no between 0 and cfg.max_year
    and upper(m.desigitem) not like '%SHFT%'
    and lower(coalesce(m.app_tab_assignment,'')) not in ('not_on_inventory_dylan','not_on_inventory_jd','not_on_inventory_denied')
), positive_keys as (
  select distinct itemcode,season from season_rows where open_stock>0
), eligible as (
  select distinct r.id,r.username,r.role,m.unique_id,m.itemcode
  from reps r cross join season_rows m
  where exists(select 1 from positive_keys p where p.itemcode=m.itemcode and p.season=m.season)
    or exists(select 1 from reserve_codes c where c.username=r.username and c.itemcode=m.itemcode)
)
select jsonb_build_object(
  'capturedAt', now(), 'season',(select season from cfg), 'salesYearMax',(select max_year from cfg),
  'masterRows',(select count(*) from public.ph_master_inventory),
  'reserveRows',(select count(*) from public.ph_reserves),
  'revisions',(select jsonb_object_agg(key,jsonb_build_object('revision',revision,'state',state,'changedAt',changed_at))
    from public.app_dataset_revisions where key in ('ph_master_inventory','ph_reserves','ph_app_settings','ph_av_notes','ph_customer_consignee_sales_reps')),
  'reps',(select jsonb_agg(jsonb_build_object('id',c.id,'username',c.username,'role',c.role,'eligibleRows',c.row_count,'eligibleItemcodes',c.itemcode_count) order by c.username)
    from (select id,username,role,count(distinct unique_id) row_count,count(distinct itemcode) itemcode_count from eligible group by id,username,role) c)
) snapshot`;

function validateSessionFile(value, usernames) {
  if (!Array.isArray(value?.sessions)) fail('Sessions file must contain a sessions array.');
  const sessions = new Map();
  for (const entry of value.sessions) {
    const username = String(entry?.username || '').trim().toLowerCase();
    const session = entry?.session;
    if (!username || sessions.has(username) || !session || typeof session !== 'object'
      || typeof session.access_token !== 'string' || !session.access_token
      || typeof session.refresh_token !== 'string' || !session.refresh_token
      || !session.user || typeof session.user.id !== 'string') {
      fail('Sessions file has a missing, duplicate, or malformed native session.');
    }
    if (Number(session.expires_at || 0) * 1000 < Date.now() + 15 * 60_000) {
      fail(`The supplied session for ${username} expires too soon; renew it through normal sign-in and retry.`);
    }
    sessions.set(username, session);
  }
  const expected = new Set(usernames);
  const missing = [...expected].filter(username => !sessions.has(username));
  const extra = [...sessions.keys()].filter(username => !expected.has(username));
  if (missing.length || extra.length) fail(`Sessions must cover the exact active Rep directory; missing=${missing.length}, extra=${extra.length}.`);
  return sessions;
}

async function main() {
  if (!sessionFile || !fs.existsSync(sessionFile)) fail('Set GNC_AV_REP_SESSIONS_FILE to a protected JSON file of genuine native sessions for every active Rep.');
  if (!supabaseUrl || !publishableKey || !fs.existsSync(caFile)) fail('Live Supabase URL/key or verified CA is unavailable.');
  const rawSessions = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  const dbUrl = loadDatabaseUrl();
  const db = new Client({ ...parsePgUrl(dbUrl), ssl: { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 3000 });
  let browser;
  const output = { startedAt: new Date().toISOString(), appOrigin: origin, mode: 'live-read-only', noMocks: true, reps: [] };
  safeProgress.completedUsers = output.reps;
  let currentlyChecking = '';
  let initialRevisions = null;
  try {
    await db.connect();
    await db.query('begin read only');
    await db.query("set local statement_timeout = '3000ms'");
    const result = await db.query(directorySql);
    const snapshot = result.rows[0]?.snapshot;
    if (!snapshot || snapshot.season !== 'F1' || Number(snapshot.salesYearMax) !== 27 || !Array.isArray(snapshot.reps)) fail('Live directory/settings query returned an unexpected contract.');
    const reps = snapshot.reps;
    if (!reps.length || !['ben_maschino', 'brian_hatfield', 'wes_lugas'].every(username => reps.some(rep => rep.username === username))) {
      fail('The live directory is missing required Sales Rep accounts; verification cannot pass with partial coverage.');
    }
    initialRevisions = snapshot.revisions;
    const sessions = validateSessionFile(rawSessions, reps.map(rep => String(rep.username)));
    await db.query('commit');
    await db.end();
    for (const rep of reps) {
      currentlyChecking = String(rep.username);
      safeProgress.failedUsername = currentlyChecking;
      const session = sessions.get(String(rep.username));
      if (!session || session.user.id !== String(rep.id)) fail(`Session user does not match the active profile for ${rep.username}.`);
      const authResponse = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        headers: { apikey: publishableKey, authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!authResponse.ok) fail(`Native session validation failed for ${rep.username} (HTTP ${authResponse.status}).`);
      const authUser = await authResponse.json();
      if (String(authUser?.id || '') !== String(rep.id)) fail(`Auth identity does not match the active profile for ${rep.username}.`);
    }
    browser = await chromium.launch({ headless: true });
    for (const rep of reps) {
      const username = String(rep.username);
      currentlyChecking = username;
      safeProgress.failedUsername = username;
      const session = sessions.get(username);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.addInitScript(({ sessionValue }) => {
        localStorage.setItem('gnc_supabase_auth_v1', JSON.stringify(sessionValue));
      }, { sessionValue: session });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      const blockedBusinessWrites = [];
      await page.route('**/*', async route => {
        const request = route.request();
        const method = request.method().toUpperCase();
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return route.continue();
        let allowReadPost = false;
        let businessWrite = false;
        try {
          const url = new URL(request.url());
          const body = request.postDataJSON() || {};
          if (url.pathname.endsWith('/functions/v1/app-api')) {
            const action = String(body?.action || '');
            allowReadPost = new Set(['inventory_read', 'dataset_read', 'av_read', 'native_session_bridge']).has(action);
            businessWrite = !allowReadPost;
          } else if (url.pathname.startsWith('/auth/v1/token')) {
            allowReadPost = url.searchParams.get('grant_type') === 'refresh_token';
          } else if (url.pathname.startsWith('/rest/v1/rpc/')) {
            const rpc = url.pathname.slice('/rest/v1/rpc/'.length);
            allowReadPost = new Set(['get_request_capabilities', 'get_my_app_permissions_v1', 'get_my_dataset_revisions_v1', 'inventory_location_on_hand_read_v1']).has(rpc);
          }
        } catch { /* Unparsed POSTs are blocked below. */ }
        if (allowReadPost) return route.continue();
        // Record only a generic category and method; never retain request data.
        blockedBusinessWrites.push(businessWrite ? `business-${method}` : `unapproved-${method}`);
        return route.abort('blockedbyclient');
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => window.eval('!!nativeAuthProfile && !!nativeAuthProfile.id'), null, { timeout: 30_000 });
      await page.waitForFunction(() => document.body.classList.contains('role-access-ready')
        && !!document.querySelector('#view-home')?.getClientRects().length, null, { timeout: 30_000 });
      const actualProfile = await page.evaluate(() => window.eval('({ username: String(nativeAuthProfile.username || "").toLowerCase(), role: String(nativeAuthProfile.role || "").trim().toUpperCase() })'));
      if (actualProfile.username !== username || !['REP', 'SALESREP'].includes(actualProfile.role.replace(/[^A-Z]/g, ''))) fail(`App profile mismatch for ${username}.`);
      await page.locator('#footer-menu-btn').click();
      const avNav = page.locator('#drawer-av-btn');
      await avNav.waitFor({ state: 'visible', timeout: 10_000 });
      await page.evaluate(expectedRows => {
        const measurement = window.__gncAvPaint = { startedAt: null, firstCardMs: null, initialWindowMs: null, fullReadyMs: null };
        let pendingFrame = false;
        const sample = () => {
          if (measurement.startedAt === null || pendingFrame) return;
          pendingFrame = true;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            pendingFrame = false;
            const cards = document.querySelectorAll('#av-content .app-av-catalog-card[data-dom-id]');
            const visible = !!cards[0]?.getClientRects().length;
            const elapsed = performance.now() - measurement.startedAt;
            if (visible && measurement.firstCardMs === null) measurement.firstCardMs = elapsed;
            if (visible && cards.length >= 20 && measurement.initialWindowMs === null) measurement.initialWindowMs = elapsed;
            const crumb = document.getElementById('av-crumb')?.textContent || '';
            const count = Number(crumb.match(/\(([\d,]+) items?\)/i)?.[1]?.replace(/,/g, '') || -1);
            const exported = document.getElementById('av-export-btn-label')?.textContent || '';
            const exportCount = Number(exported.match(/\(([\d,]+)\)\s*$/)?.[1]?.replace(/,/g, '') || -1);
            const ready = window.eval("getDatasetState('master').fullLoaded && getDatasetState('reserves').fullLoaded && !isAvLiveCatalogIncomplete()");
            if (ready && visible && cards.length >= 20 && count === expectedRows && exportCount === expectedRows
              && !/loading full inventory/i.test(crumb) && !document.getElementById('av-export-btn')?.disabled) {
              measurement.fullReadyMs = elapsed;
              observer.disconnect();
            }
          }));
        };
        const observer = new MutationObserver(sample);
        observer.observe(document.getElementById('view-av'), { subtree: true, childList: true, characterData: true, attributes: true });
        document.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('#drawer-av-btn')) {
            measurement.startedAt = performance.now();
            sample();
          }
        }, true);
      }, Number(rep.eligibleRows));
      await avNav.click();
      await page.waitForFunction(() => Number.isFinite(window.__gncAvPaint?.fullReadyMs), null, { timeout: 120_000 });
      const { firstCardMs, initialWindowMs, fullReadyMs: fullReadyElapsedMs } = await page.evaluate(() => window.__gncAvPaint);
      const state = await page.evaluate(() => window.eval(`(() => {
        const resolved = getCurrentAVBaseItems({ usePreparedSalesRows: true }) || {};
        const rows = Array.isArray(resolved.items) ? resolved.items : [];
        const crumb = document.getElementById('av-crumb')?.textContent || '';
        const exportButton = document.getElementById('av-export-btn');
        const exportLabel = document.getElementById('av-export-btn-label')?.textContent || '';
        return { masterRows: Array.isArray(fullInventory) ? fullInventory.length : -1,
          reserveRows: Array.isArray(reservesInventory) ? reservesInventory.length : -1,
          renderedRows: rows.length,
          itemcodes: new Set(rows.map(row => String(row.ITEMCODE || row.itemcode || '').trim().toUpperCase()).filter(Boolean)).size,
          exportCount: getAVVisibleExportCount(rows),
          exportLabel,
          exportDisabled: !!exportButton?.hasAttribute('disabled'),
          isPartial: !!resolved.isPartial,
          loading: /loading full inventory/i.test(crumb),
          crumbCount: Number(crumb.match(/\\(([\\d,]+) items?\\)/i)?.[1]?.replace(/,/g, '') || -1),
          mountedCards: document.querySelectorAll('#av-content .app-av-catalog-card[data-dom-id]').length,
          currentView: getCurrentVisibleViewId() };
      })()`));
      const exportLabelCount = state.exportLabel.match(/\(([^()]*)\)\s*$/)?.[1]?.replace(/,/g, '') || '';
      if (state.masterRows !== Number(snapshot.masterRows) || state.exportDisabled || state.loading || state.currentView !== 'av'
        || state.isPartial || state.renderedRows !== Number(rep.eligibleRows) || state.itemcodes !== Number(rep.eligibleItemcodes)
        || state.crumbCount !== state.renderedRows || state.mountedCards < 20
        || state.exportCount !== state.renderedRows || Number(exportLabelCount) !== state.exportCount
        || ![firstCardMs, initialWindowMs, fullReadyElapsedMs].every(value => Number.isFinite(value) && value < 1500)
        || blockedBusinessWrites.length || pageErrors.length) {
        fail(`Live AV exact readiness or first-card gate failed for ${username}.`);
      }
      output.reps.push({ username, role: actualProfile.role, expectedRows: Number(rep.eligibleRows), expectedItemcodes: Number(rep.eligibleItemcodes),
        actualRows: state.renderedRows, actualItemcodes: state.itemcodes, exportCount: state.exportCount,
        exportLabelCount: Number(exportLabelCount), masterRows: state.masterRows, reserveRows: state.reserveRows, firstCardMs, initialWindowMs, fullReadyElapsedMs,
        blockedBusinessWriteAttempts: blockedBusinessWrites.length, pageErrors: pageErrors.length });
      await context.close();
    }
    const revisionCheck = new Client({ ...parsePgUrl(loadDatabaseUrl()), ssl: { ca: fs.readFileSync(caFile, 'utf8'), rejectUnauthorized: true }, connectionTimeoutMillis: 3000 });
    try {
      await revisionCheck.connect();
      await revisionCheck.query('begin read only');
      await revisionCheck.query("set local statement_timeout = '3000ms'");
      const latest = await revisionCheck.query("select jsonb_object_agg(key,jsonb_build_object('revision',revision,'state',state,'changedAt',changed_at)) revisions from public.app_dataset_revisions where key in ('ph_master_inventory','ph_reserves','ph_app_settings','ph_av_notes','ph_customer_consignee_sales_reps')");
      await revisionCheck.query('commit');
      if (JSON.stringify(latest.rows[0]?.revisions) !== JSON.stringify(initialRevisions)) fail('AV source revisions changed during the multi-user verification; counts are stale.');
    } finally { await revisionCheck.end().catch(() => {}); }
    output.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(JSON.stringify({ output: outputFile, repCount: output.reps.length, status: 'PASS',
      results: output.reps.map(rep => ({ username: rep.username, currentSeasonRows: rep.actualRows,
        firstCardMs: rep.firstCardMs, initialWindowMs: rep.initialWindowMs, fullReadyMs: rep.fullReadyElapsedMs })) }) + '\n');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await db.end().catch(() => {});
  }
}

main().catch(error => {
  // Write only a controlled reason and completed count summaries. Unknown
  // errors may embed tokens, URLs, or database connection details.
  const safeMessage = error?.name === 'SafeVerifierError' ? String(error.message) : 'live_av_rep_verification_failed';
  const failurePath = path.join(root, '.gnc-local', `v2310-live-av-e2e-failure-${new Date().toISOString().replace(/[-:.]/g, '')}.json`);
  try {
    fs.mkdirSync(path.dirname(failurePath), { recursive: true });
    fs.writeFileSync(failurePath, JSON.stringify({ failure: safeMessage, failedUsername: safeProgress.failedUsername, completedUsers: safeProgress.completedUsers }, null, 2) + '\n', { flag: 'wx' });
  } catch { /* Preserve no secret-bearing error output when local evidence cannot be saved. */ }
  process.stderr.write(`${safeMessage}\n`);
  process.exitCode = 1;
});
