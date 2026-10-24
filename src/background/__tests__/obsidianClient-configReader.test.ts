/**
 * obsidianClient-configReader.test.ts
 *
 * PBI 2026-10-24-08: the config source travels through a constructor seam.
 * The injected reader replaces the global read on every path, while the
 * default reader keeps production behavior unchanged. No path here touches
 * retryable statuses or timers, so every case runs without real-time waits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObsidianClient } from '../obsidianClient.js';
import type { ObsidianConfig } from '../../utils/obsidianConfigBuilder.js';
import * as storage from '../../utils/storage/types.js';

const mockGetSettings = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/types.js');
vi.mock('../../utils/storage/defaults.js');
vi.mock('../../utils/storage/encryptionSession.js');
vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      ...(actual.settingsRepository as Record<string, unknown>),
      getAll: mockGetSettings,
      get: vi.fn(async (key: string) => (await mockGetSettings())?.[key]),
      getMany: vi.fn(async (keys: readonly string[]) => {
        const all = (await mockGetSettings()) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = all?.[k];
        return out;
      }),
      clearCache: vi.fn(),
      set: vi.fn(),
      setAll: vi.fn(),
    },
  };
});
vi.mock('../../utils/storage/savedUrlRepository.js');
vi.mock('../../utils/storage/domainFilterCache.js');
vi.mock('../../utils/storage/quota.js');

function testConfig(baseUrl: string): ObsidianConfig {
  return {
    baseUrl,
    headers: { Authorization: 'Bearer injected-key' },
    settings: {} as ObsidianConfig['settings'],
  };
}

describe('ObsidianClient', () => {
  describe('configReader', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetSettings.mockResolvedValue({});
      (storage as { StorageKeys: Record<string, string> }).StorageKeys = {
        OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
        OBSIDIAN_PORT: 'OBSIDIAN_PORT',
        OBSIDIAN_HOST: 'OBSIDIAN_HOST',
        OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
        OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH',
      };
      global.fetch = vi.fn();
    });

    afterEach(() => {
      vi.mocked(global.fetch).mockRestore();
    });

    it.each([
      {
        name: 'reads getConfig through the injected reader',
        baseUrl: 'http://127.0.0.1:27123',
        override: undefined,
      },
      {
        name: 'fetches the injected baseUrl when no override is given',
        baseUrl: 'https://127.0.0.1:27124',
        override: undefined,
      },
      {
        name: 'forwards an override to the reader and fetches its answer',
        baseUrl: 'http://127.0.0.1:27123',
        override: { protocol: 'http', port: 27123, apiKey: 'typed-key', host: '127.0.0.1' },
      },
      {
        name: 'forwards an https override to the reader and fetches its answer',
        baseUrl: 'https://127.0.0.1:27124',
        override: { protocol: 'https', port: '27124', apiKey: 'typed-key', host: '127.0.0.1' },
      },
    ])('$name', async ({ baseUrl, override }) => {
      const reader = vi.fn().mockResolvedValue(testConfig(baseUrl));
      const client = new ObsidianClient({ configReader: reader, sleep: async () => {} });
      vi.mocked(global.fetch).mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response);

      const result = await client.testConnection(override);

      expect(result.success).toBe(true);
      expect(reader).toHaveBeenCalledTimes(1);
      expect(reader.mock.calls[0]?.[0]).toEqual(override);
      expect(global.fetch).toHaveBeenCalledWith(`${baseUrl}/`, expect.any(Object));
    });

    it('reads the stored settings through the default reader', async () => {
      mockGetSettings.mockResolvedValue({
        OBSIDIAN_API_KEY: 'stored-key',
        OBSIDIAN_PROTOCOL: 'http',
        OBSIDIAN_PORT: '27123',
        OBSIDIAN_HOST: '127.0.0.1',
        OBSIDIAN_DAILY_PATH: '',
      });

      const config = await new ObsidianClient().getConfig();

      expect(config.baseUrl).toBe('http://127.0.0.1:27123');
      expect(config.headers).toMatchObject({ Authorization: 'Bearer stored-key' });
    });

    it('maps an injected reader rejection on the override path to a configuration failure', async () => {
      const reader = vi.fn().mockRejectedValue(new Error('API key is missing'));
      const client = new ObsidianClient({ configReader: reader, sleep: async () => {} });

      const result = await client.testConnection({ protocol: 'http', port: 27123, apiKey: '' });

      expect(result.success).toBe(false);
      expect(result.message).toContain('API key is missing');
      expect(result.failure?.kind).toBe('configuration');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
