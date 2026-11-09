export async function fetchLoginUser(username, password) {
    startGlobalProgress();
    try {
        const user = normalizeNativeAuthAlias(username).split('@')[0].replace(/^ben_harvison$/, 'ben_harveson');
        const code = String(password || '').trim();
        const saved = await getMatchingSavedSignIn(user, code);
        if (saved) return saved;
        if (navigator.onLine === false) return unavailableSignIn();
        return await (window.GncLoginTrace?.measure('remote-login', () => fetchRemoteLoginUser(user, code)) ?? fetchRemoteLoginUser(user, code));
    } catch {
        return unavailableSignIn();
    } finally {
        stopGlobalProgress();
    }
}

async function getMatchingSavedSignIn(user, code) {
    const access = window.GncUserAccessControl?.getSelfState?.();
    if (access?.denied === true && normalizeNativeAuthAlias(access.username).split('@')[0] === user) return null;
    const verified = await tryVerifiedLoginRecord(user, code);
    const cached = verified || await tryLocalCachedLoginRecord(user, code);
    if (!cached) return null;
    scheduleLoginCachePrefetch(cached);
    return { ok: true, user: cached, source: verified ? 'verified-cache' : 'local-cache', backgroundValidation: navigator.onLine !== false };
}

function unavailableSignIn() {
    return { ok: false, reason: 'network', error: new Error('Sign-in service is slow. Try again shortly.') };
}
