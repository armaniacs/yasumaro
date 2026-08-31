import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSettings } from '../../storage';
import { migrateToSingleSettingsObject, LEGACY_SETTINGS_BACKUP_KEY } from '../settingsMigration.js';

describe('getSettings — recovery from backup on corruption', () => {
  it('restores from the most recent backup when settings object is empty/corrupted', async () => {
    const now = Date.now();
    const store: Record<string, unknown> = {
      settings: {}, // corrupted: empty object despite migration flag set
      settings_migrated: true,
      [`legacy_settings_backup_${now - 1000}`]: {
        data: { obsidian_api_key: 'recovered-key' },
        createdAt: now - 1000,
      },
      settings_version: 0,
    };
    const originalGet = (globalThis.chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>);
    const originalSet = (globalThis.chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>);
    const mockGet = vi.fn((keys: unknown) => {
      if (keys === null) return Promise.resolve({ ...store });
      if (typeof keys === 'string') return Promise.resolve({ [keys]: store[keys] });
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = store[k];
        return Promise.resolve(out);
      }
      return Promise.resolve({});
    });
    const mockSet = vi.fn((obj: Record<string, unknown>) => {
      Object.assign(store, obj);
      return Promise.resolve();
    });
    (globalThis.chrome.storage.local.get as unknown) = mockGet;
    (globalThis.chrome.storage.local.set as unknown) = mockSet;

    const settings = await getSettings();
    expect(settings['obsidian_api_key']).toBe('recovered-key');

    (globalThis.chrome.storage.local.get as unknown) = originalGet;
    (globalThis.chrome.storage.local.set as unknown) = originalSet;
  });
});

describe('migrateToSingleSettingsObject — non-destructive backup', () => {
  let storageData: Record<string, unknown>;
  let originalGet: unknown;
  let originalSet: unknown;
  let originalRemove: unknown;

  beforeEach(() => {
    storageData = {
      obsidian_api_key: 'test-key',
      obsidian_protocol: 'https',
    };
    originalGet = globalThis.chrome.storage.local.get;
    originalSet = globalThis.chrome.storage.local.set;
    originalRemove = (globalThis.chrome.storage.local as unknown as Record<string, unknown>).remove;
    (globalThis.chrome.storage.local.get as unknown) = vi.fn((keys: unknown) => {
      if (keys === null) return Promise.resolve({ ...storageData });
      if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = storageData[k];
        return Promise.resolve(out);
      }
      return Promise.resolve({});
    });
    (globalThis.chrome.storage.local.set as unknown) = vi.fn((obj: Record<string, unknown>) => {
      Object.assign(storageData, obj);
      return Promise.resolve();
    });
    (globalThis.chrome.storage.local as unknown as Record<string, unknown>).remove = vi.fn((keys: string[]) => {
      for (const k of keys) delete storageData[k];
      return Promise.resolve();
    });
  });

  afterEach(() => {
    (globalThis.chrome.storage.local.get as unknown) = originalGet;
    (globalThis.chrome.storage.local.set as unknown) = originalSet;
    (globalThis.chrome.storage.local as unknown as Record<string, unknown>).remove = originalRemove;
  });

  it('does not immediately remove legacy per-key data — stores it as a backup instead', async () => {
    await migrateToSingleSettingsObject();

    // Legacy keys should be gone from their original location...
    expect(storageData['obsidian_api_key']).toBeUndefined();
    // ...but preserved in a timestamped backup key
    const backupKeys = Object.keys(storageData).filter((k) => k.startsWith(LEGACY_SETTINGS_BACKUP_KEY));
    expect(backupKeys.length).toBe(1);
    const backup = storageData[backupKeys[0]] as { data: Record<string, unknown>; createdAt: number };
    expect(backup.data['obsidian_api_key']).toBe('test-key');
    expect(typeof backup.createdAt).toBe('number');
  });
});
