// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchInventoryPage: vi.fn(),
  driveProps: [] as Array<{ initialPage?: { abort: () => void; promise: Promise<unknown> } | null }>,
  driveMounts: 0
}));

vi.mock('../services/api', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/api')>();
  return { ...actual, fetchInventoryPage: mocks.fetchInventoryPage };
});

vi.mock('../components/DriveInventory', async () => {
  const React = await import('react');
  return {
    DriveInventory: (props: { initialPage?: { abort: () => void; promise: Promise<unknown> } | null }) => {
      React.useEffect(() => { mocks.driveMounts += 1; }, []);
      mocks.driveProps.push(props);
      return React.createElement('div', { 'data-testid': 'drive-route-mounted' });
    }
  };
});

import { App, isCurrentAccountSession } from './App';

describe('account-scoped asynchronous UI effects', () => {
  it('allows same-account token refreshes but rejects late effects after an identity or role change', () => {
    const first = { token: 'sandbox:one', username: 'operator', role: 'Admin' };
    expect(isCurrentAccountSession(first, { ...first, token: 'sandbox:one:rotated' })).toBe(true);
    expect(isCurrentAccountSession(first, { ...first, username: 'other' })).toBe(false);
    expect(isCurrentAccountSession(first, { ...first, role: 'Eval' })).toBe(false);
  });
});

beforeEach(() => {
  window.history.replaceState(null, '', '/v2/#home');
  window.localStorage.clear();
  mocks.fetchInventoryPage.mockReset().mockImplementation(() => new Promise(() => {}));
  mocks.driveProps.length = 0;
  mocks.driveMounts = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App Drive route navigation', () => {
  it('synchronizes the mounted app after another tab changes the sandbox account', async () => {
    window.localStorage.setItem('gnc:v2:sandbox-session', JSON.stringify({
      token: 'sandbox:dylan_collyge', username: 'dylan_collyge', role: 'Admin', displayName: 'Dylan Admin'
    }));
    render(<App />);
    expect(screen.getByText('Dylan Admin')).toBeTruthy();

    act(() => {
      window.localStorage.setItem('gnc:v2:sandbox-session', JSON.stringify({
        token: 'sandbox:eval_user', username: 'eval_user', role: 'Eval', displayName: 'Eval User'
      }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'gnc:v2:sandbox-session' }));
    });

    expect(await screen.findByText('Eval User')).toBeTruthy();
    expect(screen.queryByText('Dylan Admin')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Company Directory' })).toBeNull();
  });

  it('keeps same-account route state mounted when its session token refreshes', async () => {
    window.localStorage.setItem('gnc:v2:sandbox-session', JSON.stringify({
      token: 'sandbox:dylan_collyge', username: 'dylan_collyge', role: 'Admin', displayName: 'Dylan Admin'
    }));
    render(<App />);
    navigateToHash('drive');
    expect(await screen.findByTestId('drive-route-mounted')).toBeTruthy();
    await waitFor(() => expect(mocks.driveMounts).toBe(1));

    act(() => {
      window.localStorage.setItem('gnc:v2:sandbox-session', JSON.stringify({
        token: 'sandbox:dylan_collyge:rotated', username: 'dylan_collyge', role: 'Admin', displayName: 'Dylan Admin'
      }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'gnc:v2:sandbox-session' }));
    });

    await waitFor(() => expect(mocks.driveMounts).toBe(1));
    expect(screen.getByTestId('drive-route-mounted')).toBeTruthy();
  });

  it('does not prefetch on Home, prepares on hash navigation, aborts on departure, and creates fresh work on revisit', async () => {
    render(<App />);
    expect(mocks.fetchInventoryPage).not.toHaveBeenCalled();

    navigateToHash('drive');

    expect(mocks.fetchInventoryPage).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('drive-route-mounted')).toBeTruthy();
    const prefetch = mocks.driveProps.at(-1)?.initialPage;
    expect(prefetch).toBeTruthy();

    navigateToHash('home');

    expect(mocks.fetchInventoryPage).toHaveBeenCalledOnce();
    const firstSignal = (mocks.fetchInventoryPage.mock.calls[0]?.[0] as { signal?: AbortSignal }).signal;
    expect(firstSignal?.aborted).toBe(true);

    navigateToHash('drive');
    expect(mocks.fetchInventoryPage).toHaveBeenCalledTimes(2);
    expect(mocks.fetchInventoryPage.mock.calls[1]?.[0].signal?.aborted).toBe(false);
    expect(await screen.findByTestId('drive-route-mounted')).toBeTruthy();
    expect(mocks.driveProps.at(-1)?.initialPage).not.toBe(prefetch);
  });

  it('shares the click-started prefetch with the resulting hash change', async () => {
    render(<App />);
    expect(mocks.fetchInventoryPage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Drive' }));
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));

    expect(mocks.fetchInventoryPage).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('drive-route-mounted')).toBeTruthy();
    expect(mocks.driveProps.at(-1)?.initialPage).toBeTruthy();
    expect(mocks.fetchInventoryPage).toHaveBeenCalledOnce();
  });

  it('passes the original rejected request promise through the selected route prefetch', async () => {
    const rejected = Promise.reject(new Error('fixture offline'));
    mocks.fetchInventoryPage.mockReturnValue(rejected);
    render(<App />);

    navigateToHash('drive');

    expect(mocks.fetchInventoryPage).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('drive-route-mounted')).toBeTruthy();
    expect(mocks.driveProps.at(-1)?.initialPage?.promise).toBe(rejected);
    await expect(rejected).rejects.toThrow('fixture offline');
  });
});

function navigateToHash(view: 'home' | 'drive') {
  act(() => {
    window.history.replaceState(null, '', `/v2/#${view}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
