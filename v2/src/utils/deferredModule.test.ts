import { describe, expect, it, vi } from 'vitest';
import { createDeferredModule } from './deferredModule';

describe('on-demand route modules', () => {
  it('does not import during setup and shares one promise after route selection', async () => {
    let resolve!: (module: { default: string }) => void;
    const promise = new Promise<{ default: string }>(done => { resolve = done; });
    const importer = vi.fn(() => promise);
    const selected = createDeferredModule(importer);
    const unrelatedImporter = vi.fn(async () => ({ default: 'other' }));
    createDeferredModule(unrelatedImporter);
    expect(importer).not.toHaveBeenCalled();
    selected.preload();
    expect(importer).toHaveBeenCalledOnce();
    expect(selected.load()).toBe(promise);
    selected.preload();
    expect(importer).toHaveBeenCalledOnce();
    expect(unrelatedImporter).not.toHaveBeenCalled();
    resolve({ default: 'Drive' });
    expect(await selected.load()).toEqual({ default: 'Drive' });
  });

  it('loads normally for direct entry and preserves rejection for the lazy boundary', async () => {
    const error = new Error('chunk unavailable');
    const importer = vi.fn(() => Promise.reject(error));
    const route = createDeferredModule(importer);
    route.preload();
    await expect(route.load()).rejects.toBe(error);
    expect(importer).toHaveBeenCalledOnce();

    const direct = createDeferredModule(async () => ({ default: 'Que' }));
    expect(await direct.load()).toEqual({ default: 'Que' });
  });
});
