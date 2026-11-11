async function readReviewedWatchdogEvents(url, {action, includeResolved = false, offset = 0}) {
    if (action !== 'watchdog_list_events' || url !== SUPABASE_URL + '/rest/v1/rpc/read_reviewed_watchdog_events_v3074') throw Error('WATCHDOG_PARAMETERS_INVALID');
    const owner = getSupabaseReadIdentityScope();
    const headers = await getNativeAuthRequestHeaders();
    if (!headers?.Authorization || owner !== getSupabaseReadIdentityScope()) throw Error('WATCHDOG_REVIEW_SESSION_REQUIRED');
    const response = await fetchWithTimeout(url, {
        method:'POST', cache:'no-store', referrerPolicy:'no-referrer', headers:{...headers,'Content-Type':'application/json'},
        body:JSON.stringify({p_include_resolved:includeResolved,p_offset:offset})
    }, 5000, 'Watchdog review list');
    if (!response.ok) throw Error('WATCHDOG_REVIEW_HTTP_' + response.status);
    const page = await response.json();
    if (owner !== getSupabaseReadIdentityScope() || page?.ok !== true || !Array.isArray(page.data)
        || page.data.length > 250 || typeof page.hasMore !== 'boolean' || page.hasMore && !page.data.length) throw Error('WATCHDOG_REVIEW_PAGE_INVALID');
    return page;
}
