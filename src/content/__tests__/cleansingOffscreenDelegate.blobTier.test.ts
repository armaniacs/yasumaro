import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isCleansingOffscreenEnabled, __resetCleansingFlagCacheForTesting } from '../cleansingOffscreenDelegate.js';
import { StorageKeys } from '../../utils/storage/types.js';

type Listener = (changes: Record<string, unknown>, area: string) => void;

describe('cleansing offscreen flag: blob-first read and blob-write refresh', () => {
  let store: Record<string, unknown>;
  let listeners: Listener[];

  beforeEach(() => {
    __resetCleansingFlagCacheForTesting();
    store = {};
    listeners = [];
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))),
        },
        onChanged: { addListener: (l: Listener) => listeners.push(l) },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the flag from the folded blob when the top-level copy is gone', async () => {
    store = { settings: { [StorageKeys.CLEANSING_OFFSCREEN_ENABLED]: true } };
    expect(await isCleansingOffscreenEnabled()).toBe(true);
  });

  it('falls back to the top-level copy of an unfolded legacy profile', async () => {
    store = { [StorageKeys.CLEANSING_OFFSCREEN_ENABLED]: true };
    expect(await isCleansingOffscreenEnabled()).toBe(true);
  });

  it('re-reads after a settings blob write, not only after a top-level key change', async () => {
    store = { settings: { [StorageKeys.CLEANSING_OFFSCREEN_ENABLED]: false } };
    expect(await isCleansingOffscreenEnabled()).toBe(false);

    store = { settings: { [StorageKeys.CLEANSING_OFFSCREEN_ENABLED]: true } };
    for (const l of listeners) l({ settings: { newValue: store.settings } }, 'local');

    expect(await isCleansingOffscreenEnabled()).toBe(true);
  });
});
