import http from 'node:http';
import { randomBytes, createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const sourceRepo = 'collygedylan/GNC-Sales-Command-PRO-';
const hostingRepo = 'collygedylan/gnc-teardown-staging';
const directory = path.join(os.homedir(), '.codex', 'staging-publisher');
const credentialsFile = path.join(directory, 'app.dpapi.json');
const gh = (args, input) => execFileSync('gh', args, { input, encoding: 'utf8', windowsHide: true });
const crypt = (value, decrypt = false) => execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Import-Module "$PSHOME\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1" -ErrorAction Stop; ' + (decrypt
  ? '$s = ($input | Out-String).Trim() | ConvertTo-SecureString; [System.Net.NetworkCredential]::new("", $s).Password'
  : '$s = ($input | Out-String).Trim(); ConvertTo-SecureString -String $s -AsPlainText -Force | ConvertFrom-SecureString')],
{ input: value, encoding: 'utf8', windowsHide: true }).trim();
const json = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { Accept: 'application/vnd.github+json', ...options.headers } });
  if (!response.ok) throw new Error(`GITHUB_APP_HTTP_${response.status}`);
  return response.json();
};
function storeApp(result) {
  writeFileSync(credentialsFile, JSON.stringify({ id: result.id, slug: result.slug, encryptedKey: crypt(result.pem) }));
  for (const repo of [sourceRepo, hostingRepo]) {
    gh(['api', '--method', 'PUT', `repos/${repo}/environments/staging-teardown`, '--input', '-'],
      JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
    const branch = repo === sourceRepo ? 'staging-teardown' : 'gh-pages';
    const policies = JSON.parse(gh(['api', `repos/${repo}/environments/staging-teardown/deployment-branch-policies`]));
    if (!policies.branch_policies?.some(policy => policy.name === branch)) {
      gh(['api', '--method', 'POST', `repos/${repo}/environments/staging-teardown/deployment-branch-policies`, '--input', '-'],
        JSON.stringify({ name: branch, type: 'branch' }));
    }
    gh(['secret', 'set', 'STAGING_APP_PRIVATE_KEY', '--repo', repo, '--env', 'staging-teardown'], result.pem);
    gh(['variable', 'set', 'STAGING_APP_ID', '--repo', repo, '--env', 'staging-teardown', '--body', String(result.id)]);
  }
  writeFileSync(path.join(directory, 'status.json'), JSON.stringify({ registered: true, id: result.id, slug: result.slug }));
}
export async function appToken(repository = sourceRepo) {
  if (![sourceRepo, hostingRepo].includes(repository)) throw new Error('STAGING_REPOSITORY_REQUIRED');
  const saved = JSON.parse(readFileSync(credentialsFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const body = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: now - 30, exp: now + 540, iss: saved.id })}`;
  const signer = createSign('RSA-SHA256'); signer.update(body);
  const jwt = `${body}.${signer.sign(crypt(saved.encryptedKey, true), 'base64url')}`;
  const headers = { Authorization: `Bearer ${jwt}` };
  const installation = await json(`https://api.github.com/repos/${repository}/installation`, { headers });
  if (installation.account?.login !== 'collygedylan' || installation.repository_selection !== 'selected') {
    throw new Error('APP_INSTALLATION_MUST_SELECT_ONLY_STAGING_REPOSITORIES');
  }
  const metadata = await json(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: 'POST', headers, body: JSON.stringify({ permissions: { metadata: 'read' } })
  });
  try {
    const installed = await json('https://api.github.com/installation/repositories?per_page=100', {
      headers: { Authorization: `Bearer ${metadata.token}` }
    });
    const names = installed.repositories.map(repo => repo.full_name).sort();
    if (installed.total_count !== 2 || JSON.stringify(names) !== JSON.stringify([sourceRepo, hostingRepo].sort())) {
      throw new Error('APP_INSTALLATION_REPOSITORY_SCOPE_REJECTED');
    }
  } finally {
    const revoked = await fetch('https://api.github.com/installation/token', {
      method: 'DELETE', headers: { Authorization: `Bearer ${metadata.token}` }
    });
    if (!revoked.ok) throw new Error('APP_METADATA_TOKEN_REVOCATION_FAILED');
  }
  const token = await json(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
    method: 'POST', headers, body: JSON.stringify({ repositories: [repository.split('/')[1]],
      permissions: repository === sourceRepo ? { contents: 'write', pull_requests: 'write' } : { contents: 'write' } })
  });
  return token.token;
}

export async function revokeAppToken(token) {
  const response = await fetch('https://api.github.com/installation/token', {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('APP_TOKEN_REVOCATION_FAILED');
}

async function bootstrap() {
  mkdirSync(directory, { recursive: true });
  const port = 43191;
  const state = randomBytes(32).toString('hex');
  if (crypt(crypt('staging-encryption-probe'), true) !== 'staging-encryption-probe') throw new Error('APP_SECURE_STORAGE_UNAVAILABLE');
  const manifest = {
    name: 'GNC Teardown Publisher', url: `https://github.com/${hostingRepo}`,
    description: 'Authors the two approved staging PRs and publishes the isolated teardown sandbox.',
    public: false, hook_attributes: { url: 'https://example.invalid/disabled', active: false },
    redirect_url: `http://127.0.0.1:${port}/callback`,
    setup_url: `http://127.0.0.1:${port}/installed`,
    default_permissions: { contents: 'write', pull_requests: 'write' },
    default_events: []
  };
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    try {
      if (!['GET','POST'].includes(request.method) || request.headers.host !== `127.0.0.1:${port}`) {
        response.writeHead(403); response.end('Request rejected.'); return;
      }
      if (url.pathname === '/recover' && request.method === 'GET') {
        response.end(`<h1>Recover existing staging App</h1><p>Open <a href="https://github.com/settings/apps" target="_blank">GitHub Apps settings</a>, select the App you just created, copy its App ID, then generate a private key. Submit the downloaded .pem file below. Credentials stay on this computer and in the staging GitHub environment.</p><form method="post" enctype="multipart/form-data" action="/recover"><input type="hidden" name="state" value="${state}"><label>App ID <input name="id" type="number" required></label><br><label>Private key <input name="key" type="file" accept=".pem" required></label><br><button>Store credentials and continue</button></form>`);
      } else if (url.pathname === '/recover' && request.method === 'POST') {
        if (request.headers.origin !== `http://127.0.0.1:${port}`) throw new Error('APP_RECOVERY_ORIGIN_REJECTED');
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > 20000) throw new Error('APP_RECOVERY_TOO_LARGE'); chunks.push(chunk); }
        const form = await new Request(`http://127.0.0.1:${port}/recover`, { method:'POST', headers:{'content-type':request.headers['content-type']}, body:Buffer.concat(chunks) }).formData();
        if (form.get('state') !== state || !/^\d+$/.test(String(form.get('id')))) throw new Error('APP_RECOVERY_REJECTED');
        const pem = await form.get('key').text();
        const now = Math.floor(Date.now()/1000);
        const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
        const body = `${encode({alg:'RS256',typ:'JWT'})}.${encode({iat:now-30,exp:now+540,iss:form.get('id')})}`;
        const signer = createSign('RSA-SHA256'); signer.update(body);
        const info = await json('https://api.github.com/app', {headers:{Authorization:`Bearer ${body}.${signer.sign(pem,'base64url')}`}});
        if (info.owner?.login !== 'collygedylan') throw new Error('APP_OWNER_REJECTED');
        storeApp({...info,pem});
        response.end(`<h1>Credentials recovered.</h1><p>Select only GNC-Sales-Command-PRO- and gnc-teardown-staging when installing:</p><a href="https://github.com/apps/${escape(info.slug)}/installations/new">Install this App</a>`);
      } else if (url.pathname === '/' && request.method === 'GET') {
        response.end(`<h1>GNC isolated staging publisher</h1><p>Create this private GitHub App, then install it on <b>only</b> GNC-Sales-Command-PRO- and gnc-teardown-staging. No production deployment is performed.</p><form method="post" action="https://github.com/settings/apps/new?state=${state}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Create staging publisher App</button></form>`);
      } else if (url.pathname === '/callback') {
        if (url.searchParams.get('state') !== state || !/^[a-zA-Z0-9_-]+$/.test(url.searchParams.get('code') || '')) throw new Error('APP_CALLBACK_REJECTED');
        const result = await json(`https://api.github.com/app-manifests/${url.searchParams.get('code')}/conversions`, { method: 'POST' });
        storeApp(result);
        response.end(`<h1>App created; credentials stored securely.</h1><p>Install on only the two staging repositories:</p><a href="https://github.com/apps/${escape(result.slug)}/installations/new">Install GitHub App</a>`);
      } else if (url.pathname === '/installed') {
        for (const repository of [sourceRepo, hostingRepo]) {
          const token = await appToken(repository);
          await revokeAppToken(token);
        }
        writeFileSync(path.join(directory, 'status.json'), JSON.stringify({ registered: true, installed: true }));
        response.end('<h1>Staging publisher is ready.</h1><p>You can return to Codex. No production files were changed.</p>');
      } else { response.writeHead(404); response.end('Not found.'); }
    } catch (error) {
      console.error('Staging App setup failed:', error.message);
      response.writeHead(500); response.end('Setup failed. Return to Codex for the sanitized error.');
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Setup URL: http://127.0.0.1:${port}/`));
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  bootstrap().catch(error => { console.error(error.message); process.exitCode = 1; });
}
