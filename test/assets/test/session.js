(function () {
  'use strict';
  const project = 'apztnscvagayslumnalr';
  let pending;
  async function ensure() {
    if (!location.pathname.startsWith('/test/') || window.AGDATA_TEST_CONFIG?.project !== project) throw Error('TEST_ENVIRONMENT_REQUIRED');
    if (pending) return pending;
    pending = (async () => {
      const started = Date.now();
      while (!window.getSupabaseBrowserClient?.()) {
        if (Date.now() - started > 30000) throw Error('Test app is still starting. Refresh to resume.');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const client = window.getSupabaseBrowserClient();
      const existing = await client.auth.getSession();
      if (existing.data?.session?.user?.id) return client;
      const response = await fetch(`https://${project}.supabase.co/functions/v1/test-session-bootstrap`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.AGDATA_TEST_CONFIG.anonKey },
        body: JSON.stringify({ environment: 'agdata-test', path: location.pathname }), referrerPolicy: 'no-referrer'
      });
      const result = await response.json();
      if (!response.ok || !result.session?.access_token) throw Error('Test session recovery is temporarily unavailable.');
      const saved = await client.auth.setSession(result.session);
      if (saved.error) throw saved.error;
      return client;
    })().finally(() => { pending = null; });
    return pending;
  }
  window.AgDataTestSession = { ensure };
})();
