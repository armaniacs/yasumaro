import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDailyPurgeAlarm, sweepExpiredLocalExportBuffers } from '../dailyPurgeHandler.js';
import { LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS } from '../localMarkdownExportRetention.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { logInfo } from '../../utils/logger/api.js';

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
  }),
);

describe('handleDailyPurgeAlarm', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    storageData = {};
    settingsRepository.clearCache();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys: unknown) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') {
              // Chrome returns the exact key plus every key sharing it as a
              // prefix — the sweep relies on the prefix half of that.
              const out: Record<string, unknown> = {};
              if (keys in storageData) out[keys] = storageData[keys];
              for (const k of Object.keys(storageData)) {
                if (k !== keys && k.startsWith(keys)) out[k] = storageData[k];
              }
              return Promise.resolve(out);
            }
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
      downloads: {
        erase: vi.fn(() => Promise.resolve([])),
        removeFile: vi.fn(() => Promise.resolve()),
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

    const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
    await handleDailyPurgeAlarm(purgeFn);

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([`legacy_settings_backup_${now - THIRTY_ONE_DAYS_MS}`]);
  });

  it('logs the purged count when purge succeeds', async () => {
    storageData = { sqlite_retention_days: 30 };

    const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 4 } });
    await handleDailyPurgeAlarm(purgeFn);

    expect(logInfo).toHaveBeenCalledWith('daily-purge completed', { purged: 4 }, 'dailyPurgeHandler');
  });

  it('logs -1 when purge fails instead of hiding the failure as 0 purged', async () => {
    storageData = { sqlite_retention_days: 30 };

    const purgeFn = vi.fn().mockResolvedValue({ success: false, error: new Error('disk I/O error') });
    await handleDailyPurgeAlarm(purgeFn);

    expect(logInfo).toHaveBeenCalledWith('daily-purge completed', { purged: -1 }, 'dailyPurgeHandler');
  });

  it('VULN-004: erases local-export download records older than the retention window', async () => {
    const now = Date.now();
    const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;
    storageData = {
      local_md_export_download_ids: [
        { downloadId: 11, date: 'old', createdAt: now - FORTY_DAYS_MS },
        { downloadId: 22, date: 'recent', createdAt: now - 1000 },
      ],
    };

    const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
    await handleDailyPurgeAlarm(purgeFn);

    expect(chrome.downloads.erase).toHaveBeenCalledWith({ id: 11 });
    expect(chrome.downloads.erase).not.toHaveBeenCalledWith({ id: 22 });
    expect(storageData.local_md_export_download_ids).toEqual([
      { downloadId: 22, date: 'recent', createdAt: now - 1000 },
    ]);
  });

  // A buffer key is orphaned whenever its download failed or export mode was
  // 'manual' that day: flushBufferedExports removes a key only after a
  // successful download. Reclaiming it is the sweep's job, not the failure
  // branch's.
  describe('local_export_ buffer retention sweep', () => {
    const dayOffset = (days: number, from: Date = new Date()): string => {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
      const month = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, '0')}`;
    };

    it('reclaims a buffer key past the retention window and keeps the ones inside it', async () => {
      storageData = {
        [`local_export_${dayOffset(-10)}`]: ['# orphan'],
        [`local_export_${dayOffset(-6)}`]: ['# in window'],
        [`local_export_${dayOffset(-1)}`]: ['# yesterday'],
        [`local_export_${dayOffset(0)}`]: ['# today'],
      };

      const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
      await handleDailyPurgeAlarm(purgeFn);

      expect(storageData).not.toHaveProperty(`local_export_${dayOffset(-10)}`);
      expect(storageData).toHaveProperty(`local_export_${dayOffset(-6)}`);
      expect(storageData).toHaveProperty(`local_export_${dayOffset(-1)}`);
      expect(storageData).toHaveProperty(`local_export_${dayOffset(0)}`);
    });

    it('reclaims a key sitting exactly on the retention boundary', async () => {
      const now = new Date(2026, 2, 20, 9, 0, 0);
      storageData = {
        [`local_export_${dayOffset(-LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS, now)}`]: ['# boundary'],
        [`local_export_${dayOffset(-LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS + 1, now)}`]: ['# one day newer'],
      };

      const swept = await sweepExpiredLocalExportBuffers(now);

      expect(swept).toBe(1);
      expect(storageData).not.toHaveProperty(
        `local_export_${dayOffset(-LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS, now)}`,
      );
      expect(storageData).toHaveProperty(
        `local_export_${dayOffset(-LOCAL_MARKDOWN_BUFFER_RETENTION_DAYS + 1, now)}`,
      );
    });

    it('leaves keys it cannot date, and keys outside the prefix, alone', async () => {
      const undated = [`local_export_${dayOffset(-30)}corrupt`, 'local_export_', 'unrelated_key'];
      storageData = {
        [undated[0] as string]: ['# unparseable'],
        [undated[1] as string]: ['# bare prefix'],
        [undated[2] as string]: 'keep me',
      };

      const swept = await sweepExpiredLocalExportBuffers();

      expect(swept).toBe(0);
      expect(chrome.storage.local.remove).not.toHaveBeenCalled();
      for (const key of undated) expect(storageData).toHaveProperty(key);
    });

    it('does not touch chrome.downloads while reclaiming buffers', async () => {
      storageData = { [`local_export_${dayOffset(-10)}`]: ['# orphan'] };

      const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
      await handleDailyPurgeAlarm(purgeFn);

      expect(storageData).not.toHaveProperty(`local_export_${dayOffset(-10)}`);
      expect(chrome.downloads.removeFile).not.toHaveBeenCalled();
      expect(chrome.downloads.erase).not.toHaveBeenCalled();
    });

    it('logs the swept count so a silent retention failure cannot hide', async () => {
      storageData = { [`local_export_${dayOffset(-10)}`]: ['# orphan'] };

      const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
      await handleDailyPurgeAlarm(purgeFn);

      expect(logInfo).toHaveBeenCalledWith(
        'local-export buffer sweep completed',
        { swept: 1 },
        'dailyPurgeHandler',
      );
    });
  });
});
