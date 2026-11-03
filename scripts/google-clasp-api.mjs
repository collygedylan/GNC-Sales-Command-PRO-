import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Credentials remain in process memory. This helper never copies production
// Script Properties, changes production content, or creates a public web app.
export async function googleApiFromClasp(credentialsFile = path.join(os.homedir(), '.clasprc.json')) {
  const rc = JSON.parse(process.env.APPS_SCRIPT_CLASPRC_JSON || fs.readFileSync(credentialsFile, 'utf8'));
  const tokens = rc.tokens || {};
  const token = rc.token || tokens.default || Object.values(tokens).find(t => t?.refresh_token) || {};
  const settings = rc.oauth2ClientSettings || rc.oauth2Client || {};
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(15000), body: new URLSearchParams({
      client_id: settings.clientId || settings.client_id || token.client_id || '',
      client_secret: settings.clientSecret || settings.client_secret || token.client_secret || '',
      refresh_token: token.refresh_token || '', grant_type: 'refresh_token'
    })
  });
  const access = await response.json();
  if (!response.ok || !access.access_token) throw new Error(`GOOGLE_AUTH_HTTP_${response.status}`);
  return async (url, method = 'GET', body) => {
    if (!['https://script.googleapis.com', 'https://www.googleapis.com'].includes(new URL(url).origin)) throw new Error('GOOGLE_ORIGIN_BLOCKED');
    const r = await fetch(url, { method, signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${access.access_token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`GOOGLE_API_HTTP_${r.status}`);
    return r.status === 204 ? {} : r.json();
  };
}
