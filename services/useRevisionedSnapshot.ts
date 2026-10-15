import { useEffect, useRef } from 'react';
import useSWR, { useSWRConfig, type SWRConfiguration } from 'swr';

function isAccessDenial(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const item = error as { status?: unknown; code?: unknown };
  return ['401', '403', '42501'].includes(String(item.status ?? ''))
    || ['401', '403', '42501'].includes(String(item.code ?? ''));
}

/** Revision events revalidate the same scoped query without unmounting its data.
 * Identity, permissions and query parameters must remain part of the key.
 */
export function useRevisionedSnapshot<T>(
  key: string | null,
  revision: string,
  read: () => Promise<T>,
  options: SWRConfiguration<T, Error> = {},
) {
  const result = useSWR<T, Error>(key, read, { ...options, keepPreviousData: false });
  const { cache } = useSWRConfig();
  const previous = useRef({ key, revision });
  const latest = useRef({ key, revision });
  const mutateRef = useRef(result.mutate);
  const drainingKey = useRef<string | null>(null);
  mutateRef.current = result.mutate;
  useEffect(() => {
    const prior = previous.current;
    previous.current = { key, revision };
    latest.current = { key, revision };
    if (prior.key !== key || prior.revision === revision || !key || drainingKey.current === key) return;
    drainingKey.current = key;
    void (async () => {
      let requestedRevision = prior.revision;
      try {
        while (latest.current.key === key && latest.current.revision !== requestedRevision) {
          requestedRevision = latest.current.revision;
          try { await mutateRef.current(); } catch { /* SWR exposes the retryable error. */ }
        }
      } finally {
        if (drainingKey.current === key) drainingKey.current = null;
      }
    })();
  }, [key, revision]);
  const denied = isAccessDenial(result.error);
  useEffect(() => {
    if (denied && key) cache.delete(key);
  }, [cache, denied, key]);
  // SWR intentionally retains its last good value after an error. Never expose
  // that value after the server has denied the current identity or permissions.
  return denied ? { ...result, data: undefined } : result;
}
