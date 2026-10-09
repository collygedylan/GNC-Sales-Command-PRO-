import { describe, expect, it, vi } from 'vitest';
import { createDriveRoutePreparation } from './driveRoutePreparation';

function fixture() {
  const preloadModule = vi.fn();
  const created: Array<{ abort: ReturnType<typeof vi.fn> }> = [];
  const createPrefetch = vi.fn(() => {
    const prefetch = { abort: vi.fn() };
    created.push(prefetch);
    return prefetch;
  });
  const publish = vi.fn();
  const route = createDriveRoutePreparation({ preloadModule, createPrefetch, publish });
  return { route, preloadModule, createPrefetch, publish, created };
}

describe('Drive route preparation', () => {
  it('starts module and data preparation once and reuses it across click and hash navigation', () => {
    const f = fixture();
    const fromClick = f.route.prepare(true);
    const fromHashChange = f.route.prepare(true);

    expect(fromHashChange).toBe(fromClick);
    expect(f.preloadModule).toHaveBeenCalledOnce();
    expect(f.createPrefetch).toHaveBeenCalledOnce();
    expect(f.publish).toHaveBeenCalledOnce();
    expect(f.route.current()).toBe(f.created[0]);
  });

  it('aborts the active prefetch when hash navigation leaves Drive', () => {
    const f = fixture();
    f.route.prepare(true);
    f.route.cancel();

    expect(f.created[0]?.abort).toHaveBeenCalledOnce();
    expect(f.publish).toHaveBeenLastCalledWith(null);
    expect(f.route.current()).toBeNull();
  });

  it('does not start a request while neither an authenticated nor demo route is available', () => {
    const f = fixture();
    expect(f.route.prepare(false)).toBeNull();

    expect(f.preloadModule).not.toHaveBeenCalled();
    expect(f.createPrefetch).not.toHaveBeenCalled();
    expect(f.publish).toHaveBeenCalledWith(null);
  });

  it('aborts old work before preparing again after account scope changes', () => {
    const f = fixture();
    const oldScope = f.route.prepare(true);
    f.route.cancel();
    const newScope = f.route.prepare(true);

    expect(newScope).not.toBe(oldScope);
    expect(f.created[0]?.abort).toHaveBeenCalledOnce();
    expect(f.createPrefetch).toHaveBeenCalledTimes(2);
  });
});
