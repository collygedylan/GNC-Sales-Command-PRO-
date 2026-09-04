export const PHOTO_HISTORY_BUCKETS = new Set([
  'request_photos', 'flyer_photos', 'season_sales_notes_photos', 'location_sales_notes_photos',
]);

export function isPhotoHistoryUsernameAllowed(username: unknown): boolean {
  return ['dylan_collyge', 'madison_austin', 'madelyn_gray'].includes(String(username || '').trim().toLowerCase());
}

/** Paths originate in the catalog; never accept an arbitrary browser URL. */
export function historyPhotoUrl(base: string, asset: Record<string, unknown>, open = false): string {
  const bucket = String(asset.bucket || '');
  const path = String(asset.path || '');
  if (!PHOTO_HISTORY_BUCKETS.has(bucket) || !path || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('PHOTO_HISTORY_ASSET_UNAVAILABLE');
  }
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const root = base.replace(/\/$/, '') + '/storage/v1/';
  if (open) return `${root}object/public/${bucket}/${encoded}`;
  const match = /^v2\/([a-f0-9]{64})\.(webp|jpg)$/i.exec(path);
  if (match) return `${root}object/public/${bucket}/_thumbs/v2/${match[1]}-w320.${match[2]}`;
  return `${root}render/image/public/${bucket}/${encoded}?width=320&quality=62&resize=contain`;
}

export function publicHistoryPhoto(base: string, asset: Record<string, unknown>) {
  const { bucket: _bucket, path: _path, ...safe } = asset;
  return { ...safe, thumbnailUrl: asset.storage_available ? historyPhotoUrl(base, asset) : '', archived: !asset.storage_available };
}

export async function readArchivedHistoryThumbnail(asset: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpoint = Deno.env.get('APPS_SCRIPT_WEB_APP_URL');
  const secret = Deno.env.get('REQUEST_DELIVERY_SIGNING_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!endpoint || !secret) throw new Error('PHOTO_HISTORY_PREVIEW_UNAVAILABLE');
  const timestamp = new Date().toISOString();
  const deliveryJson = JSON.stringify({ eventType: 'photo_history_thumbnail', assetId: asset.id, driveFileId: asset.drive_file_id });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + deliveryJson)));
  const signature = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'photo_history_thumbnail', timestamp, signature, deliveryJson }), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.ok !== true || !/^data:image\/(jpeg|png|webp);base64,/.test(String(data.thumbnail || ''))
    || String(data.thumbnail).length > 225000) throw new Error('PHOTO_HISTORY_PREVIEW_UNAVAILABLE');
  return { ok: true, thumbnail: data.thumbnail };
}
