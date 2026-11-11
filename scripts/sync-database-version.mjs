import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertReleaseAdvance} from './recover-or-publish-release.mjs';

export async function syncDatabaseVersion({version, key, url, fetcher = fetch}) {
  assertReleaseAdvance(version, version);
  if (url !== 'https://kzrnyjsosryejjejliii.supabase.co') throw Error('RELEASE_SUPABASE_ORIGIN_INVALID');
  if (!key) throw Error('RELEASE_SERVICE_CREDENTIAL_REQUIRED');
  const endpoint = url + '/rest/v1/ph_app_settings';
  const headers = {apikey:key, Authorization:'Bearer '+key, 'Content-Type':'application/json', Prefer:'return=representation'};
  const request = async (query, method = 'GET', body) => {
    const response = await fetcher(endpoint + query, {
      method, headers, signal:AbortSignal.timeout(12000),
      ...(body ? {body:JSON.stringify(body)} : {})
    });
    if (!response.ok) throw Error('RELEASE_SETTINGS_HTTP_'+response.status);
    return response.json();
  };
  const query = '?key=eq.app_version&select=value';
  const current = (await request(query))[0]?.value;
  if (!current?.app_version) throw Error('RELEASE_SETTING_MISSING');
  assertReleaseAdvance(current.app_version, version);
  if (current.app_version !== version) {
    const changed = await request('?key=eq.app_version&value->>app_version=eq.'+encodeURIComponent(current.app_version), 'PATCH', {
      value:{...current, app_version:version, release:'AgData v'+version},
      updated_by:'release-v'+version, updated_at:new Date().toISOString()
    });
    if (changed.length !== 1) throw Error('RELEASE_SETTING_CONCURRENT_CHANGE');
  }
  if ((await request(query))[0]?.value?.app_version !== version) throw Error('RELEASE_SETTING_MISMATCH');
  return {version, verified:true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
    const result = await syncDatabaseVersion({version,
      key:process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      url:process.env.PRODUCTION_SUPABASE_URL || process.env.SUPABASE_URL
    });
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch (error) {
    process.stderr.write(String(error.message).startsWith('RELEASE_') ? error.message+'\n' : 'RELEASE_SETTINGS_REQUEST_FAILED\n');
    process.exitCode = 1;
  }
}
