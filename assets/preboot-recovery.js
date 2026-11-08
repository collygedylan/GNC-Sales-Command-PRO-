function hasPrebootRememberedSession(env) {
  try {
    if (env.window.__agdataSessionBoundary === true || env.localStorage.getItem('gnc_explicit_logout_v1') === '1') return false;
    const profile = JSON.parse(env.localStorage.getItem('gnc_native_auth_profile_v1') || 'null');
    const session = JSON.parse(env.localStorage.getItem('sb-kzrnyjsosryejjejliii-auth-token') || env.sessionStorage.getItem('sb-kzrnyjsosryejjejliii-auth-token') || 'null');
    if (profile && profile.id && profile.username && session && session.user && session.user.id === profile.id
      && (session.access_token || session.refresh_token) && !profile.disabled_at && !profile.must_change_password
      && (!profile.locked_until || Date.parse(profile.locked_until) <= Date.now())) return true;
    const record = JSON.parse(env.sessionStorage.getItem('gnc_app_session_v1') || 'null');
    return !!(record && record.token && record.username && Number(record.expiresAt) > Date.now() && !record.mustChangePassword);
  } catch { return false; }
}

function suppressPrebootFailure(env) {
  try {
    if (env.window.__agdataSessionBoundary === true || env.localStorage.getItem('gnc_explicit_logout_v1') === '1') return false;
    return env.window.__agdataBootComplete === true || env.window.hasAgDataRememberedSession()
      || !!env.window.isAuthenticatedAppSessionActive?.();
  } catch { return env.window.__agdataBootComplete === true && env.window.__agdataSessionBoundary !== true; }
}

function disarmPreboot(state) {
  state.env.clearTimeout(state.timer);
  state.env.window.dispatchEvent(new state.env.Event('agdata:boot-complete'));
}

function recordPrebootRecovery(state, code) {
  try {
    let entries = JSON.parse(state.env.localStorage.getItem('agdata_preboot_recovery_log') || '[]');
    if (!Array.isArray(entries)) entries = [];
    entries.push({ scope: 'preboot_auto_recovery', code, version: state.version, at: Date.now() });
    state.env.localStorage.setItem('agdata_preboot_recovery_log', JSON.stringify(entries.slice(-20)));
  } catch { /* Recovery remains available when browser storage is unavailable. */ }
}

function revealPrebootLogin(state) {
  const { window, document } = state.env;
  if (window.__agdataSuppressBootFailure()) { disarmPreboot(state); return; }
  try {
    if (typeof window.recoverAgDataPreboot === 'function' && window.recoverAgDataPreboot()) return;
    document.documentElement.classList.remove('booting-session');
    for (const id of ['app-boot-overlay', 'login-loading', 'loading-spinner']) {
      const node = document.getElementById(id);
      if (node) { node.hidden = true; node.style.display = 'none'; }
    }
    document.querySelectorAll('.boot-loading').forEach(node => { node.style.display = 'none'; });
    const login = document.getElementById('view-login'), inputs = document.getElementById('login-inputs');
    if (login) { login.style.display = 'flex'; login.classList.remove('hidden'); }
    if (inputs) inputs.classList.remove('hidden');
  } catch { /* A partial document may not have mounted the login shell yet. */ }
}

function recoverPreboot(state, code) {
  const { window, document, navigator } = state.env;
  if (window.__agdataSuppressBootFailure()) { disarmPreboot(state); return; }
  if (window.__agdataVersionReloadPending || state.recovered || document.hidden) return;
  state.recovered = true;
  recordPrebootRecovery(state, code);
  revealPrebootLogin(state);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => revealPrebootLogin(state), { once: true });
  try {
    if (state.env.sessionStorage.getItem(state.key) || navigator.onLine === false) return;
    state.env.sessionStorage.setItem(state.key, '1');
  } catch { return; }
  window.__gncShellUpdateReady = true;
  void window.checkForLiveAppUpdate?.('preboot:' + code);
}

function checkPreboot(state) {
  if (state.env.window.__agdataSuppressBootFailure()) { disarmPreboot(state); return; }
  if (state.env.document.readyState === 'loading' && !state.env.window.__agdataVersionReloadPending) return;
  recoverPreboot(state, 'BOOT_TIMEOUT');
}

function installAgDataPrebootRecovery(version, env = globalThis) {
  const state = { version, env, recovered: false, timer: null, key: 'agdata_sw_recovered_' + version.replace(/\./g, '_') };
  const { window, document } = env;
  window.hasAgDataRememberedSession = () => hasPrebootRememberedSession(env);
  window.__agdataSuppressBootFailure = () => suppressPrebootFailure(env);
  window.__agdataDisarmBootGuards = () => disarmPreboot(state);
  window.__agdataMarkBootComplete = () => {
    window.__agdataBootComplete = true;
    window.__agdataBootCompleted = true;
    disarmPreboot(state);
  };
  document.addEventListener('DOMContentLoaded', () => {
    if (window.__agdataSuppressBootFailure()) disarmPreboot(state);
    else {
      env.clearTimeout(state.timer);
      state.timer = env.setTimeout(() => checkPreboot(state), 2200);
    }
  }, { once: true });
  window.addEventListener('error', event => {
    if (!window.__agdataBootComplete && (event.target === window || event.target?.tagName === 'SCRIPT')) recoverPreboot(state, 'STARTUP_ERROR');
  }, true);
  window.addEventListener('unhandledrejection', () => {
    if (!window.__agdataBootComplete) recoverPreboot(state, 'STARTUP_REJECTION');
  });
  state.timer = env.setTimeout(() => checkPreboot(state), 2200);
}
