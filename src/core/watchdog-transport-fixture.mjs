import vm from 'node:vm';
export function watchdogTransportFixture(helper, { native = false, token = '', headersPromise = Promise.resolve({ apikey: 'public-key', Authorization: 'Bearer native-token', 'Content-Type': 'application/json' }) } = {}) {
    let options = null;
    const posted = [];
    let headerReads = 0;
    const context = {
      window: { GncRuntimeWatchdog: { configure(value) { options = value; } } },
      APP_API_FUNCTION_URL: 'https://example.supabase.co/functions/v1/app-api',
      currentUser: 'dylan_collyge', currentRole: 'Admin', activeHomeTab: 'dashboard',
      getCurrentVisibleViewId: () => 'managers',
      getCurrentAppSessionToken: () => token,
      nativeAuthSessionActive: native,
      nativeAuthProfile: native ? { id: 'profile-1' } : null,
      nativeAuthSessionUserId: native ? 'profile-1' : '',
      nativeAuthRecoveryEpoch: 4, paintFooterRequestBadgeOnly() {},
      getNativeAuthRequestHeaders: async () => { headerReads += 1; return await headersPromise; },
      postAppFunctionJson: async (...args) => { posted.push(args); return { ok: true }; }
    };
    vm.runInNewContext(helper, context);
    context.configureRuntimeWatchdogForCurrentSession();
    return { context, options: () => options, posted, headerReads: () => headerReads };
  }
