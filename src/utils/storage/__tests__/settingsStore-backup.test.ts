import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateToSingleSettingsObject, LEGACY_SETTINGS_BACKUP_KEY } from '../settingsStore.js';

describe('getSettings — recovery from backup on corruption', () => {
  it('restores from the most recent backup when settings object is empty/corrupted', async () => {
    const now = Date.now();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            const all = {
              settings: {}, // corrupted: empty object despite migration flag set
              settings_migrated: true,
              [`legacy_settings_backup_${now - 1000}`]: {
                data: { obsidian_api_key: 'recovered-key' },
                createdAt: now - 1000,
              },
            };
            if (keys === null) return Promise.resolve(all);
            if (typeof keys === 'string') return Promise.resolve({ [keys]: all[keys] });
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const k of keys) out[k] = all[k];
              return Promise.resolve(out);
            }
            return Promise.resolve({});
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as typeof chrome;

    const { getSettings } = await import('../settingsStore.js');
    const settings = await getSettings();
    expect(settings['obsidian_api_key']).toBe('recovered-key');
  });
});

describe('migrateToSingleSettingsObject — non-destructive backup', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {
      obsidian_api_key: 'test-key',
      obsidian_protocol: 'https',
    };
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const k of keys) out[k] = storageData[k];
              return Promise.resolve(out);
            }
            return Promise.resolve({});
          }),
          set: vi.fn((obj: Record<string, unknown>) => { Object.assign(storageData, obj); return Promise.resolve(); }),
          remove: vi.fn((keys: string[]) => { for (const k of keys) delete storageData[k]; return Promise.resolve(); }),
        },
      },
    } as unknown as typeof chrome;
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
