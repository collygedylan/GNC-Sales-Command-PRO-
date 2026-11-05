import { testMailReport } from '../_shared/test-mail-report.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
const URL = 'https://apztnscvagayslumnalr.supabase.co';
const RECIPIENT = 'dylan_collyge@greenleafnursery.com';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const client = createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = { 'Access-Control-Allow-Origin': 'https://agmetricapp.com', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-test-mail-key', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const escape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Event = { source: string; id: string; lease: string; payload: Record<string, unknown> };
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ ok: true, environment: 'agdata-test', recipient: RECIPIENT });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const scheduled = request.headers.get('x-test-mail-key') === Deno.env.get('TEST_MAIL_SIGNING_SECRET') && Boolean(Deno.env.get('TEST_MAIL_SIGNING_SECRET'));
  if (token !== key && !scheduled) { const { data, error } = await client.auth.getUser(token); if (error || !data.user || data.user.app_metadata?.environment !== 'agdata-test') return json({ ok: false, code: 'AUTH_REQUIRED' }, 401); }
  const endpoint = Deno.env.get('TEST_MAIL_WEB_APP_URL'), secret = Deno.env.get('TEST_MAIL_SIGNING_SECRET');
  if (!endpoint || !secret) return json({ ok: false, code: 'TEST_MAIL_CONFIGURATION_REQUIRED' }, 503);
  const { data, error } = await client.rpc('test_mail_claim', { worker: 'test-email-worker' });
  if (error) return json({ ok: false, code: 'OUTBOX_CLAIM_FAILED' }, 500);
  const results = [];
  for (const event of (data || []) as Event[]) {
    let proof: Record<string, unknown>, outcome = 'RETRY';
    try {
      const body = JSON.stringify(testMailReport(event.payload));
      const timestamp = Date.now(), encoder = new TextEncoder();
      const signingKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const signed = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(timestamp + '\n' + event.id + '\n' + body));
      const signature = [...new Uint8Array(signed)].map(b => b.toString(16).padStart(2, '0')).join('');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamp, eventId: event.id, body, signature }), signal: AbortSignal.timeout(30000) });
      proof = await response.json();
      if (proof.status === 'SENT' && proof.eventId === event.id && proof.recipient === RECIPIENT) outcome = 'SENT';
      else if (proof.status === 'REVIEW') outcome = 'REVIEW';
    } catch { proof = { code: 'TEST_MAIL_TRANSPORT_RETRY' }; }
    const settled = await client.rpc('test_mail_settle', { source: event.source, event: event.id, lease: event.lease, outcome, proof });
    results.push({ eventId: event.id, outcome, recorded: !settled.error && settled.data === true });
  }
  return json({ ok: true, recipient: RECIPIENT, results });
});
