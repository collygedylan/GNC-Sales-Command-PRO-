/** Share a route's on-demand import between navigation and React.lazy. */
export function createDeferredModule<Module>(importModule: () => Promise<Module>) {
  let pending: Promise<Module> | undefined;
  let committed = false;
  const load = () => pending ??= importModule();
  return {
    load,
    hasCommitted: () => committed,
    markCommitted() { committed = true; },
    preload() {
      // Starting a selected route early must not create an unhandled rejection.
      // Keep the original promise so the existing lazy error boundary sees it.
      void load().catch(() => undefined);
    },
  };
}
