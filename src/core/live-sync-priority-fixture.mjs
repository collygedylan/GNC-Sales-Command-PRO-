const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

export function fixture(createCoordinator, cache = new Map(), overrides = {}) {
    const commits = [], statuses = [], backgroundStatuses = [], reads = [], metadata = [], timers = new Map();
    let timerId = 0, permission = 'p1', revision = '1', state = 'ready';
    const gates = new Map();
    const adapter = id => ({ id, cacheKey: `${id}/all`, sourceKeys: [id],
        stage: async () => { reads.push(id); if (gates.has(id)) await gates.get(id); return [{ id, revision }]; },
        commit: value => commits.push({ id, value }) });
    const foreground = adapter('inventory'), background = adapter('badges');
    const context = { scope: 'user-a', viewKey: 'inventory', visible: true, online: true, adapters: [foreground], backgroundAdapters: [background] };
    const coordinator = createCoordinator({ getContext: () => context,
        readRevisions: async keys => { metadata.push([...keys]); return { contractVersion: 1, permissionVersion: permission,
            sources: keys.map(key => ({ key, revision, state })) }; },
        readCachedSnapshot: async (item, meta) => cache.get(`${meta.scope}/${item.id}`),
        writeCachedSnapshot: (item, value, meta) => { cache.set(`${meta.scope}/${item.id}`, structuredClone({ meta, value })); },
        onStatus: value => statuses.push(value), onBackgroundStatus: value => backgroundStatuses.push(value),
        setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
        clearTimeout: id => timers.delete(id), ...overrides
    });
    return { coordinator, context, foreground, background, commits, statuses, backgroundStatuses, reads, metadata, cache, gates, adapter, timers,
        set permission(value) { permission = value; }, set revision(value) { revision = value; }, set state(value) { state = value; },
        async backgroundTick() { for (const [id, timer] of [...timers]) if (timer.delay < 8000) { timers.delete(id); timer.callback(); } await settle(); }
    };
}

