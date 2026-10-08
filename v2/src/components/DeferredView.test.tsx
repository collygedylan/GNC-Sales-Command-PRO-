// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { lazy, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredView } from './DeferredView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred view boundary', () => {
  it('shows the compact loading state until the route chunk resolves', async () => {
    let resolveChunk!: (module: { default: () => ReactElement }) => void;
    const chunk = new Promise<{ default: () => ReactElement }>(resolve => { resolveChunk = resolve; });
    const DeferredContent = lazy(() => chunk);

    render(<DeferredView label="Que"><DeferredContent /></DeferredView>);
    expect(screen.getByRole('status').textContent).toContain('Loading Que');
    resolveChunk({ default: () => <div>Que ready</div> });
    expect(await screen.findByText('Que ready')).toBeTruthy();
  });

  it('offers a retry action after a route chunk fails', async () => {
    const retry = vi.fn();
    const FailedContent = lazy(async () => { throw new Error('chunk unavailable'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<DeferredView label="Drive" onRetry={retry}><FailedContent /></DeferredView>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload app to retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
