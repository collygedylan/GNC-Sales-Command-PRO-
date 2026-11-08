import vm from 'node:vm';

export function createReadBoundaryFixture(evalSecurityHelpers, guardSource, concurrency = 3) {
    const ctx = { Map, Promise, JSON, String, Number, Math, Date, Error, AbortController, setTimeout, clearTimeout, SUPABASE_READ_CONCURRENCY_LIMIT: concurrency,
        SUPABASE_URL: 'https://fixture.invalid', currentUser: 'dylan_collyge', currentRole: 'Admin', currentUserDivision: '10',
        window: {}, nativeAuthSessionActive: true, nativeAuthProfile: { id: 'user-a' }, incrementInternalPerfCounter() {}, getCurrentLoginCacheScopeKey: () => 'scope'
    };
    vm.createContext(ctx);
    vm.runInContext(evalSecurityHelpers + guardSource + '\nthis.generation = () => { productionLiveSyncReadGeneration++; abortSupabaseReadsBeforeGeneration(productionLiveSyncReadGeneration); }; this.permission = value => { productionLiveSyncReadPermissionVersion = value; }; this.resetAuth = () => { productionLiveSyncReadAuthEpoch++; }; this.reads = supabaseReadInFlight;', ctx);
    return ctx;
}

