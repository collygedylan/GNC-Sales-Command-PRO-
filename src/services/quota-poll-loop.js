export function createQuotaPollLoop({ enabled, run, interval = 300000, onError = () => {} }, root = window) {
    let timer = null, pending = null, failures = 0, stopped = true;
    const active = () => !stopped && !root.document.hidden && root.navigator.onLine !== false && enabled();
    function pause() {
        if (timer !== null) root.clearTimeout(timer);
        timer = null;
    }
    function schedule(immediate = false) {
        pause();
        if (!active() || pending) return;
        const delay = immediate ? 0 : Math.min(1800000, Math.max(300000, interval) * 2 ** Math.min(failures, 3));
        timer = root.setTimeout(tick, delay);
    }
    async function tick() {
        timer = null;
        if (!active() || pending) return;
        pending = Promise.resolve().then(run);
        try {
            const result = await pending;
            failures = result === false ? failures + 1 : 0;
        } catch (error) {
            failures += 1;
            onError(error);
        } finally {
            pending = null;
            schedule();
        }
    }
    function lifecycle() { schedule(); }
    root.document.addEventListener('visibilitychange', lifecycle);
    root.addEventListener('online', lifecycle);
    root.addEventListener('offline', pause);
    return {
        start(immediate = false) { stopped = false; schedule(immediate); },
        stop() { stopped = true; pause(); },
        dispose() {
            stopped = true;
            pause();
            root.document.removeEventListener('visibilitychange', lifecycle);
            root.removeEventListener('online', lifecycle);
            root.removeEventListener('offline', pause);
        }
    };
}

window.GncQuotaPolling = { create: createQuotaPollLoop };
