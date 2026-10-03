/**
 * Shared factory for the `chrome.storage` area mocks in vitest.setup.ts.
 *
 * `clone` mirrors the real API split: `chrome.storage.local` hands out a
 * structured clone on both `get` and `set`, while the session and sync
 * mocks in this suite keep references. `remove` / `clear` / `getBytesInUse`
 * are optional because the sync mock predates them and some suites pin the
 * narrower surface.
 */
import { vi } from 'vitest';
import { cloneAtStorageBoundary } from '../src/utils/storage/structuredCloneBoundary.js';

type StorageAreaMockOptions = {
  clone: boolean;
  remove?: boolean;
  clear?: boolean;
  getBytesInUse?: boolean;
};

export type StorageAreaMock = {
  get: ReturnType<typeof buildGet>;
  set: ReturnType<typeof buildSet>;
  remove?: ReturnType<typeof buildRemove>;
  clear?: ReturnType<typeof buildClear>;
  getBytesInUse?: ReturnType<typeof buildGetBytesInUse>;
};

function buildGet(store: Record<string, any>, clone: boolean) {
  return vi.fn<(keys?: string | string[] | null) => Promise<Record<string, any>>>((keys) => {
    let result: Record<string, any> = {};

    if (keys === null || keys === undefined) {
      result = { ...store };
    } else if (Array.isArray(keys)) {
      keys.forEach((key) => {
        if (key in store) {
          result[key] = store[key];
        }
      });
    } else if (typeof keys === 'string') {
      if (keys in store) {
        result[keys] = store[keys];
      }
    }

    if (clone) {
      for (const key of Object.keys(result)) result[key] = cloneAtStorageBoundary(result[key]);
    }
    return Promise.resolve(result);
  });
}

function buildSet(store: Record<string, any>, clone: boolean) {
  return vi.fn<(items: Record<string, any>) => Promise<void>>((items) => {
    if (clone) {
      for (const [key, value] of Object.entries(items)) store[key] = cloneAtStorageBoundary(value);
    } else {
      Object.assign(store, items);
    }
    return Promise.resolve();
  });
}

function buildRemove(store: Record<string, any>) {
  return vi.fn<(keys: string | string[]) => Promise<void>>((keys) => {
    if (Array.isArray(keys)) {
      keys.forEach((key) => delete store[key]);
    } else {
      delete store[keys];
    }
    return Promise.resolve();
  });
}

function buildClear(store: Record<string, any>) {
  return vi.fn<() => Promise<void>>(() => {
    Object.keys(store).forEach((key) => delete store[key]);
    return Promise.resolve();
  });
}

function buildGetBytesInUse() {
  return vi.fn<() => Promise<number>>(() => Promise.resolve(1024));
}

export function createStorageAreaMock(
  store: Record<string, any>,
  options: StorageAreaMockOptions,
): StorageAreaMock {
  const { clone, remove = false, clear = false, getBytesInUse = false } = options;
  const area: StorageAreaMock = {
    get: buildGet(store, clone),
    set: buildSet(store, clone),
  };
  if (remove) area.remove = buildRemove(store);
  if (clear) area.clear = buildClear(store);
  if (getBytesInUse) area.getBytesInUse = buildGetBytesInUse();
  return area;
}
