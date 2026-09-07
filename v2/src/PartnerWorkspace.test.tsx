// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartnerWorkspace, isPartnerReady, partnerWorkspaceUrl } from './PartnerWorkspace';
import { App, viewFromHash } from './App';

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/v2/');
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('authenticated partner workspace integration', () => {
  it('uses a relative app path without passing prototype identity or credentials', () => {
    expect(partnerWorkspaceUrl('av')).toBe('partner/nursery/?embedded=1&view=av');
    expect(partnerWorkspaceUrl('orders', false)).toBe('partner/nursery/?view=orders');
  });

  it('accepts readiness only from this exact frame and origin', () => {
    const frame = {} as Window;
    const ready = { source: frame, origin: 'https://agmetricapp.com', data: { type: 'bloomscapes:ready' } };
    expect(isPartnerReady(ready as MessageEvent, frame, ready.origin)).toBe(true);
    expect(isPartnerReady({ ...ready, origin: 'https://other.invalid' } as MessageEvent, frame, ready.origin)).toBe(false);
    expect(isPartnerReady({ ...ready, source: {} } as MessageEvent, frame, ready.origin)).toBe(false);
    expect(isPartnerReady({ ...ready, data: { type: 'logged-in', user: 'dylan_collyge' } } as MessageEvent, frame, ready.origin)).toBe(false);
  });

  it('offers loading, timeout, retry, and a full-page fallback without writing any data', () => {
    render(<PartnerWorkspace view="av" />);
    const firstFrame = screen.getByTitle('BloomScapes nursery workspace');
    expect(screen.getByRole('status').textContent).toContain('Opening the secure nursery');
    expect(screen.getByText(/test profile does not grant access/)).toBeTruthy();
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByRole('alert').textContent).toContain('could not be opened');
    expect(screen.getByRole('link', { name: 'Open full page' }).getAttribute('href')).toBe('partner/nursery/?view=av');
    fireEvent.click(screen.getByRole('button', { name: 'Retry workspace' }));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByTitle('BloomScapes nursery workspace')).not.toBe(firstFrame);
  });

  it('does not unlock the frame for unrelated messages or a plain load event', () => {
    render(<PartnerWorkspace view="orders" />);
    const frame = screen.getByTitle('BloomScapes nursery workspace') as HTMLIFrameElement;
    fireEvent.load(frame);
    expect(frame.className).not.toContain('partner-frame-ready');
    fireEvent(window, new MessageEvent('message', { origin: 'https://other.invalid', source: frame.contentWindow, data: { type: 'bloomscapes:ready' } }));
    expect(frame.className).not.toContain('partner-frame-ready');
    fireEvent(window, new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { type: 'bloomscapes:ready' } }));
    expect(frame.className).toContain('partner-frame-ready');
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('maps persistent partner hash routes and rejects unknown values', () => {
    expect(viewFromHash('#bloom')).toBe('bloom');
    expect(viewFromHash('#partner-av')).toBe('partner-av');
    expect(viewFromHash('#/partner-av')).toBe('partner-av');
    expect(viewFromHash('#//evil.invalid')).toBe('home');
  });

  it('opens AV from Home and Bloom from navigation, including browser history changes', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'AV' }));
    expect(window.location.hash).toBe('#partner-av');
    expect(screen.getByTitle('BloomScapes nursery workspace').getAttribute('src')).toContain('view=av');
    fireEvent.click(screen.getByRole('button', { name: 'Bloom' }));
    expect(window.location.hash).toBe('#bloom');
    expect(screen.getByTitle('BloomScapes nursery workspace').getAttribute('src')).toContain('view=orders');
    act(() => {
      window.history.replaceState(null, '', '/v2/#partner-av');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByTitle('BloomScapes nursery workspace').getAttribute('src')).toContain('view=av');
  });

  it.each(['bloom', 'partner-av'])('restores #%s after app remount', hash => {
    window.history.replaceState(null, '', `/v2/#${hash}`);
    const first = render(<App />);
    expect(screen.getByTitle('BloomScapes nursery workspace').getAttribute('src')).toContain(hash === 'bloom' ? 'view=orders' : 'view=av');
    first.unmount();
    render(<App />);
    expect(screen.getByTitle('BloomScapes nursery workspace').getAttribute('src')).toContain(hash === 'bloom' ? 'view=orders' : 'view=av');
  });
});
