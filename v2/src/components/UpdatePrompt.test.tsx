// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pwa = vi.hoisted(() => ({
  needRefresh: false,
  options: null as null | Record<string, (...args: never[]) => unknown>,
  updateServiceWorker: vi.fn(async (_reloadPage?: boolean) => {})
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: Record<string, (...args: never[]) => unknown>) => {
    pwa.options = options;
    return {
      needRefresh: [pwa.needRefresh, vi.fn()],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: pwa.updateServiceWorker
    };
  }
}));

import { UpdatePrompt } from './UpdatePrompt';

let controller: ServiceWorker | null;
let serviceWorkerListeners: Map<string, EventListener>;
let reload: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
  controller = null;
  serviceWorkerListeners = new Map();
  pwa.needRefresh = false;
  pwa.options = null;
  pwa.updateServiceWorker.mockClear();
  reload = vi.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      get controller() { return controller; },
      addEventListener: (name: string, listener: EventListener) => serviceWorkerListeners.set(name, listener),
      removeEventListener: (name: string) => serviceWorkerListeners.delete(name)
    }
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PWA update lifecycle', () => {
  it('polls the registered worker while foregrounded and checks again on focus', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const update = vi.fn(async () => {});
    render(<UpdatePrompt />);
    await act(async () => {
      (pwa.options?.onRegisteredSW as ((url: string, registration: ServiceWorkerRegistration) => void) | undefined)?.(
        '/sw.js', { update, waiting: null } as unknown as ServiceWorkerRegistration
      );
    });
    expect(update).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(update).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(update).toHaveBeenCalledOnce();
  });

  it('asks the Workbox adapter to activate a waiting update without its automatic reload', async () => {
    pwa.needRefresh = true;
    render(<UpdatePrompt />);
    expect(pwa.options?.onNeedReload).toBeTypeOf('function');
    expect(pwa.updateServiceWorker).toHaveBeenCalledWith(false);
  });

  it('ignores first install, then shows an update toast and reloads once without clearing saved data', async () => {
    window.localStorage.setItem('gnc:v2:sandbox-session', 'auth-session');
    window.localStorage.setItem('gnc:v2:theme:dylan', 'dark');
    window.localStorage.setItem('gnc:v2:request-columns:dylan', '["status"]');
    window.localStorage.setItem('gnc:v2:display-mode:dylan', 'grid');
    const { unmount } = render(<UpdatePrompt reloadPage={reload} />);
    const controllerChange = serviceWorkerListeners.get('controllerchange');
    expect(controllerChange).toBeTruthy();

    act(() => controllerChange?.(new Event('controllerchange')));
    expect(screen.queryByRole('status')).toBeNull();
    expect(reload).not.toHaveBeenCalled();

    controller = {} as ServiceWorker;
    act(() => controllerChange?.(new Event('controllerchange')));
    expect(screen.getByRole('status').textContent).toContain('New version detected. Updating...');
    expect(reload).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('gnc:v2:sandbox-session')).toBe('auth-session');
    expect(window.localStorage.getItem('gnc:v2:theme:dylan')).toBe('dark');
    expect(window.localStorage.getItem('gnc:v2:request-columns:dylan')).toBe('["status"]');
    expect(window.localStorage.getItem('gnc:v2:display-mode:dylan')).toBe('grid');

    act(() => vi.advanceTimersByTime(700));
    expect(reload).toHaveBeenCalledOnce();
    act(() => controllerChange?.(new Event('controllerchange')));
    expect(reload).toHaveBeenCalledOnce();
    unmount();
  });

  it('cancels a delayed reload when the update prompt unmounts', () => {
    controller = {} as ServiceWorker;
    const { unmount } = render(<UpdatePrompt reloadPage={reload} />);
    const controllerChange = serviceWorkerListeners.get('controllerchange');
    act(() => controllerChange?.(new Event('controllerchange')));
    expect(screen.getByRole('status').textContent).toContain('New version detected. Updating...');
    unmount();
    act(() => vi.advanceTimersByTime(700));
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when an update takes control of a page that already had a controller', () => {
    controller = {} as ServiceWorker;
    render(<UpdatePrompt reloadPage={reload} />);
    const controllerChange = serviceWorkerListeners.get('controllerchange');
    act(() => controllerChange?.(new Event('controllerchange')));
    expect(screen.getByRole('status').textContent).toContain('New version detected. Updating...');
    act(() => vi.advanceTimersByTime(700));
    expect(reload).toHaveBeenCalledOnce();
  });
});
