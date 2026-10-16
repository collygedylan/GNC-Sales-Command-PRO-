// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { createElement, type PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';
import { useRevisionedSnapshot } from '../../../services/useRevisionedSnapshot';

const cache = new Map();
const swrConfig = { provider: () => cache, shouldRetryOnError: false };
function wrapper({ children }: PropsWithChildren) {
  return createElement(SWRConfig, { value: swrConfig }, children);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

describe('useRevisionedSnapshot', () => {
  it('revalidates again when a newer revision arrives during an in-flight refresh', async () => {
    cache.clear();
    const requests: Array<ReturnType<typeof deferred<{ revision: number }>>> = [];
    const read = () => {
      const request = deferred<{ revision: number }>();
      requests.push(request);
      return request.promise;
    };
    const hook = renderHook(({ revision }) => {
      const snapshot = useRevisionedSnapshot('snapshot:one', revision, read, { revalidateOnMount: true, dedupingInterval: 0 });
      return snapshot.data;
    }, { initialProps: { revision: '0' }, wrapper });

    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => requests[0].resolve({ revision: 0 }));
    await waitFor(() => expect(hook.result.current).toEqual({ revision: 0 }));
    hook.rerender({ revision: '1' });
    await waitFor(() => expect(requests).toHaveLength(2));
    hook.rerender({ revision: '2' });
    await act(async () => requests[1].resolve({ revision: 1 }));
    await waitFor(() => expect(requests).toHaveLength(3));
    await act(async () => requests[2].resolve({ revision: 2 }));
    await waitFor(() => expect(hook.result.current).toEqual({ revision: 2 }));
  });

  it.each(['403', '42501'])('masks and clears cached data after authorization denial %s', async code => {
    cache.clear();
    let denied = false;
    const read = async () => {
      if (denied) throw Object.assign(new Error('permission denied'), { code });
      return { privateValue: 'visible only while authorized' };
    };
    const key = `snapshot:private:${code}`;
    const hook = renderHook(({ revision }) => {
      const snapshot = useRevisionedSnapshot(key, revision, read, { revalidateOnMount: true, dedupingInterval: 0 });
      return { data: snapshot.data, error: snapshot.error };
    }, { initialProps: { revision: '0' }, wrapper });
    await waitFor(() => expect(hook.result.current.data?.privateValue).toBe('visible only while authorized'));

    denied = true;
    hook.rerender({ revision: '1' });
    await waitFor(() => expect(hook.result.current.error?.message).toBe('permission denied'));
    expect(hook.result.current.data).toBeUndefined();

    hook.unmount();
    const remount = renderHook(() => {
      const snapshot = useRevisionedSnapshot(key, '1', read, { revalidateOnMount: false });
      return snapshot.data;
    }, { wrapper });
    expect(remount.result.current).toBeUndefined();
  });
});
