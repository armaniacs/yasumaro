import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageData, setCalls } = vi.hoisted(() => ({
  storageData: {} as Record<string, unknown>,
  setCalls: [] as Array<Record<string, unknown>>,
}));

type ChangeListener = (changes: Record<string, unknown>, area: string) => void;
const changeListeners: ChangeListener[] = [];

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: {
    getAll: vi.fn(async () => (storageData['settings'] ?? {}) as never),
  },
}));

beforeEach(() => {
  // Minimal chrome.storage.local + onChanged harness per test file.
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: unknown) => {
          if (keys === null) return { ...storageData };
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.filter((k) => k in storageData).map((k) => [k, storageData[k as string]]));
          }
          return { ...storageData };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          setCalls.push(items);
          Object.assign(storageData, items);
        }),
      },
      onChanged: {
        addListener: vi.fn((fn: ChangeListener) => changeListeners.push(fn)),
      },
    },
  };
});

import { syncAllowedUrlsFromSettings, initAllowedUrlsSync } from '../allowedUrlsSync.js';
import { StorageKeys, type Settings } from '../../utils/storage/types.js';
import { deriveRequiredDomains } from '../../utils/storage/providerAllowlist.js';

describe('allowedUrlsSync — ALLOWED_URLS persistence (VULN-003 writer)', () => {
  beforeEach(() => {
    // getAll takes the migrated-settings path (no scattered fallback write).
    storageData['settings'] = {};
    storageData['settings_migrated'] = true;
    setCalls.length = 0;
    changeListeners.length = 0;
  });

  it('persists the computed allowlist and its hash', async () => {
    const settings = {
      [StorageKeys.OBSIDIAN_PROTOCOL]: 'https',
      [StorageKeys.OBSIDIAN_PORT]: '27124',
    } as unknown as Settings;

    await syncAllowedUrlsFromSettings(settings);

    const written = setCalls[0];
    const urls = written?.[StorageKeys.ALLOWED_URLS] as string[];
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.length).toBeGreaterThan(0);
    // Pinned provider domains are always present.
    expect(urls).toContain(`https://${deriveRequiredDomains()[0]}`);
    // The hash matches the written URL list (change detection contract).
    const hash = written?.[StorageKeys.ALLOWED_URLS_HASH] as string;
    const expected = [...urls].sort().join('|');
    expect(hash).toBe(expected);
  });

  it('seeds at init and re-syncs when the settings blob changes', async () => {
    await initAllowedUrlsSync();
    expect(setCalls.length).toBe(1);

    expect(changeListeners.length).toBe(1);
    const listener = changeListeners[0] as ChangeListener;

    // An unrelated area change is ignored.
    await listener({ [StorageKeys.ALLOWED_URLS]: { newValue: [] } }, 'sync');
    expect(setCalls.length).toBe(1);

    // A settings write triggers a fresh sync.
    await listener({ settings: { newValue: {} } }, 'local');
    expect(setCalls.length).toBe(2);
  });

  it('does not recurse when its own write lands', async () => {
    await initAllowedUrlsSync();
    const listener = changeListeners[0] as ChangeListener;
    const before = setCalls.length;
    // allowed_urls changes are not settings changes — ignored.
    await listener({ [StorageKeys.ALLOWED_URLS]: { newValue: [] } }, 'local');
    expect(setCalls.length).toBe(before);
  });
});
