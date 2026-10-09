// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler, lazy, useEffect, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredView } from './DeferredView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred view boundary', () => {
  it('shows the compact loading state until the route chunk resolves', async () => {
    const ready = vi.fn();
    let resolveChunk!: (module: { default: () => ReactElement }) => void;
    const chunk = new Promise<{ default: () => ReactElement }>(resolve => { resolveChunk = resolve; });
    const DeferredContent = lazy(() => chunk);

    render(<DeferredView label="Que" onContentReady={ready}><DeferredContent /></DeferredView>);
    expect(screen.getByRole('status').textContent).toContain('Loading Que');
    expect(ready).not.toHaveBeenCalled();
    resolveChunk({ default: () => <div>Que ready</div> });
    expect(await screen.findByText('Que ready')).toBeTruthy();
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  });

  it('mounts an already loaded route in one commit without replaying the fallback', async () => {
    const chunk = Promise.resolve({ default: () => <div>Warm Drive ready</div> });
    const WarmContent = lazy(() => chunk);
    const phases: string[] = [];
    const { unmount } = render(<DeferredView label="Drive"><WarmContent /></DeferredView>);
    expect(await screen.findByText('Warm Drive ready')).toBeTruthy();
    unmount();

    render(
      <Profiler id="deferred-view" onRender={(_id, phase) => phases.push(phase)}>
        <DeferredView label="Drive" loaded><WarmContent /></DeferredView>
      </Profiler>
    );
    expect(screen.getByText('Warm Drive ready')).toBeTruthy();
    expect(phases).toEqual(['mount']);
  });

  it('keeps a resolved but never committed chunk on the cold route path', async () => {
    const ready = vi.fn();
    const chunk = Promise.resolve({ default: () => <div>Preloaded Drive</div> });
    await chunk;
    const PreloadedContent = lazy(() => chunk);
    const committedContent: string[] = [];
    render(
      <Profiler id="cold-preload" onRender={() => committedContent.push(document.body.textContent || '')}>
        <DeferredView label="Drive" onContentReady={ready}><PreloadedContent /></DeferredView>
      </Profiler>
    );
    expect(committedContent[0]).toContain('Loading Drive');
    expect(committedContent[0]).not.toContain('Preloaded Drive');
    expect(await screen.findByText('Preloaded Drive')).toBeTruthy();
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  });

  it('offers a retry action after a route chunk fails', async () => {
    const retry = vi.fn();
    const loadError = vi.fn();
    const ready = vi.fn();
    const FailedContent = lazy(async () => { throw new Error('chunk unavailable'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<DeferredView label="Drive" onRetry={retry} onLoadError={loadError} onContentReady={ready}><FailedContent /></DeferredView>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(loadError).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload app to retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('unmounts the departed route immediately and ignores a superseded chunk', async () => {
    const cleanupDepartedRoute = vi.fn();
    const mountSupersededRoute = vi.fn();
    const readySupersededRoute = vi.fn();
    function DepartedRoute() {
      useEffect(() => cleanupDepartedRoute, []);
      return <div>Departed route</div>;
    }
    let resolveChunk!: (module: { default: () => ReactElement }) => void;
    const DeferredContent = lazy(() => new Promise<{ default: () => ReactElement }>(resolve => { resolveChunk = resolve; }));
    const { rerender } = render(<DeferredView key="old" label="Drive"><DepartedRoute /></DeferredView>);
    expect(await screen.findByText('Departed route')).toBeTruthy();

    rerender(<DeferredView key="pending" label="Que" onContentReady={readySupersededRoute}><DeferredContent /></DeferredView>);
    expect(cleanupDepartedRoute).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Loading Que');
    rerender(<DeferredView key="home" label="Home"><div>Home ready</div></DeferredView>);
    expect(await screen.findByText('Home ready')).toBeTruthy();
    resolveChunk({ default: () => { mountSupersededRoute(); return <div>Late route</div>; } });
    await Promise.resolve();
    expect(mountSupersededRoute).not.toHaveBeenCalled();
    expect(readySupersededRoute).not.toHaveBeenCalled();
    expect(screen.queryByText('Late route')).toBeNull();
  });
});
