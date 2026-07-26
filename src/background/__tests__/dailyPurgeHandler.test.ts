import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';

describe('handleDailyPurgeAlarm', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {};
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

  it('removes legacy_settings_backup_* entries older than 30 days', async () => {
    const now = Date.now();
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    storageData = {
      [`legacy_settings_backup_${now - THIRTY_ONE_DAYS_MS}`]: { data: {}, createdAt: now - THIRTY_ONE_DAYS_MS },
      [`legacy_settings_backup_${now - 1000}`]: { data: {}, createdAt: now - 1000 },
    };

    const purgeFn = vi.fn().mockResolvedValue({ purged: 0 });
    await handleDailyPurgeAlarm(purgeFn);

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([`legacy_settings_backup_${now - THIRTY_ONE_DAYS_MS}`]);
  });
});
