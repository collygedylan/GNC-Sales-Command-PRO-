/** Keep selected-route module and first-page preparation shared across click and hash navigation. */
export type AbortableRoutePrefetch = { abort: () => void };

export function createDriveRoutePreparation<Prefetch extends AbortableRoutePrefetch>(options: {
  preloadModule: () => void;
  createPrefetch: () => Prefetch;
  publish: (prefetch: Prefetch | null) => void;
}) {
  let active: Prefetch | null = null;

  const cancel = () => {
    const previous = active;
    active = null;
    previous?.abort();
    options.publish(null);
  };

  return {
    prepare(enabled: boolean): Prefetch | null {
      if (!enabled) {
        cancel();
        return null;
      }
      if (active) return active;
      options.preloadModule();
      active = options.createPrefetch();
      options.publish(active);
      return active;
    },
    cancel,
    current: () => active
  };
}
