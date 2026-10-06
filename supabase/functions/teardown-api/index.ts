import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const project = 'https://apztnscvagayslumnalr.supabase.co';
const origin = 'https://collygedylan.github.io';
const bucket = 'teardown-photos';
const service = createClient(project, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS', Vary: 'Origin' }
});
const fail = (code: string, status = 400): never => { throw Object.assign(new Error(code), { status }); };
async function signedRows(rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const photos = Array.isArray(row.photos) ? row.photos : [];
    row.photos = await Promise.all(photos.map(async (photo: Record<string, string>) => {
      if (photo.bucket !== bucket || !photo.path) return fail('TEARDOWN_PHOTO_CONFIGURATION', 500);
      const { data, error } = await service.storage.from(bucket).createSignedUrl(photo.path, 3600);
      if (error || !data) return fail('TEARDOWN_PHOTO_LINK_FAILED', 503);
      return { ...photo, url: data.signedUrl };
    }));
  }
  return rows;
}
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return reply({});
  try {
    if (Deno.env.get('SUPABASE_URL') !== project) fail('TEARDOWN_PROJECT_MISMATCH', 503);
    if (request.method !== 'POST') fail('TEARDOWN_POST_REQUIRED', 405);
    if (request.headers.get('origin') && request.headers.get('origin') !== origin) fail('TEARDOWN_ORIGIN_DENIED', 403);
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) fail('TEARDOWN_SIGN_IN_REQUIRED', 401);
    const { data: identity, error: authError } = await service.auth.getUser(authorization.slice(7));
    if (authError || !identity.user) fail('TEARDOWN_SIGN_IN_REQUIRED', 401);
    const client = createClient(project, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
    });
    const { data: member, error: memberError } = await client.rpc('teardown_is_member');
    if (memberError || member !== true) fail('TEARDOWN_ACCESS_DENIED', 403);
    const text = await request.text();
    if (text.length > 65536) fail('TEARDOWN_PAYLOAD_TOO_LARGE', 413);
    const command = JSON.parse(text);
    const operation = command.operation;
    if (operation === 'bootstrap') {
      const { data, error } = await client.rpc('teardown_bootstrap');
      if (error) fail('TEARDOWN_LOAD_FAILED', 503);
      await signedRows([...data.inventory, ...data.requests]);
      return reply({ ...data, capabilities: { staging: true, email: 'captured', push: 'captured', pdf: false } });
    }
    if (operation === 'photo_upload_url') {
      if (!['image/jpeg','image/png','image/webp'].includes(command.contentType)) fail('TEARDOWN_PHOTO_TYPE');
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(command.rowId || '')) fail('TEARDOWN_ROW_ID');
      const { data: snapshot, error } = await client.rpc('teardown_bootstrap');
      if (error || ![...snapshot.inventory, ...snapshot.requests].some((row: Record<string, unknown>) => row.id === command.rowId)) fail('TEARDOWN_ROW_NOT_FOUND', 404);
      const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const extension = extensions[command.contentType];
      const path = `${identity.user.id}/${command.rowId}/${crypto.randomUUID()}.${extension}`;
      const signed = await service.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      if (signed.error || !signed.data) fail('TEARDOWN_UPLOAD_UNAVAILABLE', 503);
      return reply({ ...signed.data, bucket, path, uploadMethod: 'PUT', headers: { 'x-upsert': 'false' }, contentType: command.contentType });
    }
    if (operation === 'pdf') fail('TEARDOWN_PDF_NOT_CONFIGURED', 503);
    let rpc: string;
    if (operation === 'save') rpc = 'save_row';
    else if (operation === 'capture_delivery') rpc = 'capture_delivery';
    else if (operation === 'photo_commit') {
      if (!String(command.path || '').startsWith(`${identity.user.id}/${command.rowId}/`)) fail('TEARDOWN_PHOTO_FORBIDDEN', 403);
      command.photo = { bucket, path: command.path, name: String(command.filename || 'Photo').slice(0, 200), contentType: command.contentType };
      rpc = 'commit_photo';
    } else return reply({ error: 'TEARDOWN_OPERATION_UNAVAILABLE', message: 'This module is not included in the focused staging review.' }, 422);
    const { data, error } = await client.rpc('teardown_' + rpc, { command });
    if (error) {
      const code = /^TEARDOWN_[A-Z_]+$/.test(error.message) ? error.message : 'TEARDOWN_SAVE_FAILED';
      fail(code, error.code === '40001' ? 409 : error.code === '42501' ? 403 : 400);
    }
    if (data.row) await signedRows([data.row]);
    return reply(data);
  } catch (error) {
    const value = error as Error & { status?: number };
    const code = /^TEARDOWN_[A-Z_]+$/.test(value.message) ? value.message : 'TEARDOWN_REQUEST_FAILED';
    console.error(JSON.stringify({ area: 'teardown-api', code }));
    return reply({ error: code }, value.status || 400);
  }
});
