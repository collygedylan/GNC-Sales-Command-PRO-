import { fetchInventoryPage } from './api';
import type { InventoryRow, PageResult } from '../types';

export const DRIVE_INVENTORY_PAGE_SIZE = 100;

export type DriveInventoryPrefetch = {
  promise: Promise<PageResult<InventoryRow>>;
  abort: () => void;
  retain: () => () => void;
};

/** Start the first Drive page only after the user selects Drive. */
export function createDriveInventoryPrefetch(): DriveInventoryPrefetch {
  const controller = new AbortController();
  const promise = fetchInventoryPage({ page: 0, pageSize: DRIVE_INVENTORY_PAGE_SIZE, search: '', signal: controller.signal });
  // Navigation may be superseded before the lazy component mounts. Mark the
  // original promise handled without replacing the promise passed to Drive.
  void promise.catch(() => undefined);
  let retained = 0;
  let releaseVersion = 0;
  return {
    promise,
    abort: () => controller.abort(),
    retain: () => {
      retained += 1;
      releaseVersion += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retained = Math.max(0, retained - 1);
        const version = ++releaseVersion;
        queueMicrotask(() => {
          if (!retained && releaseVersion === version) controller.abort();
        });
      };
    }
  };
}
