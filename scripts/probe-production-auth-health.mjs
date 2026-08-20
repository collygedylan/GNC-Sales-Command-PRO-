import fs from 'node:fs';

const source = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const supabaseUrl = process.env.PRODUCTION_SUPABASE_URL
  || source.match(/const SUPABASE_URL = "([^"]+)"/)?.[1]
  || '';
const publishableKey = process.env.PRODUCTION_SUPABASE_PUBLISHABLE_KEY
  || source.match(/const SUPABASE_KEY = "([^"]+)"/)?.[1]
  || '';
const appOrigin = String(process.env.PRODUCTION_APP_ORIGIN || 'https://agmetricapp.com').replace(/\/+$/, '');
const expectedRelease = source.match(/window\.__APP_SHELL_VERSION__ = '([^']+)'/)?.[1] || '';

if (!supabaseUrl || !publishableKey) {
  throw new Error('production_probe_configuration_missing');
}

async function checkedFetch(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeCode(value = '') {
  return String(value || 'unknown')
    .trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').slice(0, 64) || 'UNKNOWN';
}

const startedAt = Date.now();
const checks = [];

const shellResponse = await checkedFetch(`${appOrigin}/?health=${Date.now()}`, {
  headers: { 'cache-control': 'no-cache' }
});
const shellText = await shellResponse.text();
if (!shellResponse.ok || !/window\.__APP_SHELL_VERSION__\s*=/.test(shellText)) {
  throw new Error(`app_shell_unhealthy_http_${shellResponse.status}`);
}
const liveRelease = shellText.match(/window\.__APP_SHELL_VERSION__ = '([^']+)'/)?.[1] || 'unknown';
checks.push({ name: 'app_shell', status: shellResponse.status, release: liveRelease });

const probeResponse = await checkedFetch(`${supabaseUrl}/functions/v1/app-api`, {
  method: 'POST',
  headers: {
    apikey: publishableKey,
    authorization: `Bearer ${publishableKey}`,
    'content-type': 'application/json',
    'x-request-id': `hosted-auth-health-${Date.now()}`
  },
  body: JSON.stringify({
    action: 'login',
    username: 'hosted_auth_health_probe_nonexistent',
    password: 'invalid-health-probe'
  })
});
const probeText = await probeResponse.text();
let probePayload = null;
try { probePayload = probeText ? JSON.parse(probeText) : null; } catch {}
const healthyMismatch = probeResponse.status === 200
  && probePayload?.ok === false
  && probePayload?.reason === 'mismatch';
if (!healthyMismatch) {
  const code = sanitizeCode(probePayload?.details?.code || probePayload?.code || `HTTP_${probeResponse.status}`);
  throw new Error(`production_login_bridge_unhealthy_${code}`);
}
checks.push({ name: 'login_bridge_and_data_api', status: probeResponse.status, result: 'expected_mismatch' });

const result = {
  ok: true,
  checkedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAt,
  expectedRelease,
  liveRelease,
  checks
};

process.stdout.write(`${JSON.stringify(result)}\n`);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Production login health\n\n- Status: healthy\n- App shell: ${liveRelease}\n- Login bridge/Data API: HTTP 200 expected mismatch\n- Duration: ${result.durationMs} ms\n`
  );
}
