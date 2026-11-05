// Explicitly authorized open sandbox session; never deploy this endpoint to production.
const PROJECT = 'apztnscvagayslumnalr';
const EMAIL = 'dylan_collyge@agdata-test.invalid';
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const allowed = ['https://agmetricapp.com', 'http://127.0.0.1:4173', 'http://localhost:4173'].includes(origin);
  const headers = { 'Access-Control-Allow-Origin': allowed ? origin : 'null', 'Access-Control-Allow-Headers': 'apikey,content-type,authorization,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Cache-Control': 'no-store', 'Content-Type': 'application/json', Vary: 'Origin' };
  if (!allowed) return new Response(JSON.stringify({ error: 'TEST_ORIGIN_REQUIRED' }), { status: 403, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (new URL(url).hostname !== `${PROJECT}.supabase.co` || !key) return new Response('{}', { status: 503, headers });
  try {
    const body = await req.json();
    if (body.environment !== 'agdata-test' || !String(body.path).startsWith('/test/')) return new Response('{}', { status: 403, headers });
    const serviceHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    const profileResponse = await fetch(`${url}/rest/v1/test_profiles?username=eq.dylan_collyge&select=id,role,disabled_at`, { headers: serviceHeaders });
    const profiles = await profileResponse.json();
    const profile = profiles[0];
    if (!profileResponse.ok || !profile || profile.disabled_at || !['super-admin','super_admin'].includes(profile.role)) throw Error('TEST_PROFILE_REQUIRED');
    // generate_link does not send email. The token is consumed server-side immediately.
    const linkResponse = await fetch(`${url}/auth/v1/admin/generate_link`, { method: 'POST', headers: serviceHeaders, body: JSON.stringify({ type: 'magiclink', email: EMAIL }) });
    const link = await linkResponse.json();
    if (!linkResponse.ok || link.id !== profile.id || !link.hashed_token) throw Error('TEST_IDENTITY_MISMATCH');
    const verified = await fetch(`${url}/auth/v1/verify`, { method: 'POST', headers: serviceHeaders, body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }) });
    const session = await verified.json();
    if (!verified.ok || session.user?.id !== profile.id) throw Error('TEST_SESSION_MISMATCH');
    return new Response(JSON.stringify({ session: { access_token: session.access_token, refresh_token: session.refresh_token }, email: 'dylan_collyge@greenleafnursery.com' }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'TEST_SESSION_UNAVAILABLE' }), { status: 503, headers });
  }
});
