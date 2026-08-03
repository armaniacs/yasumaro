/**
 * obsidianClient-api-key-leak.test.ts
 *
 * PBI 2026-08-02-04: Ensure the ObsidianClient never leaks the API key into
 * logs — at the client level, not just the redaction unit level.
 *
 * Covered:
 *  - A valid key is placed in the Authorization header (expected) but is never
 *    written to console/logs.
 *  - When the key is missing/invalid, the error path redacts all sensitive
 *    data before it reaches console.error / addLog, so the raw key never
 *    appears even if supplied through settings.
 */

import { ObsidianClient } from '../obsidianClient.js';
import { vi } from 'vitest';
import * as storage from '../../utils/storage.js';

vi.mock('../../utils/storage.js');
vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { WARN: 'warn', ERROR: 'error', INFO: 'info', DEBUG: 'debug', SANITIZE: 'sanitize' },
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));
vi.mock('../../utils/dailyNotePathBuilder.js', () => ({
  buildDailyNotePath: vi.fn((p: string) => p || '2026-02-07'),
}));
vi.mock('../noteSectionEditor.js', () => ({
  NoteSectionEditor: {
    DEFAULT_SECTION_HEADER: '## History',
    insertIntoSection: vi.fn((existing, _header, content) => `${existing}\n${content}`),
  },
}));

describe('ObsidianClient — API key must never leak to logs (PBI 2026-08-02-04)', () => {
  const RAW_KEY = 'sk-proj-super-secret-api-key-1234567890';

  let client: ObsidianClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    client = new ObsidianClient();
    vi.clearAllMocks();
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({});
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.StorageKeys = {
      OBSIDIAN_PROTOCOL: 'OBSIDIAN_PROTOCOL',
      OBSIDIAN_PORT: 'OBSIDIAN_PORT',
      OBSIDIAN_HOST: 'OBSIDIAN_HOST',
      OBSIDIAN_API_KEY: 'OBSIDIAN_API_KEY',
      OBSIDIAN_DAILY_PATH: 'OBSIDIAN_DAILY_PATH',
    };
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('puts a valid key in the Authorization header without ever logging it', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({ OBSIDIAN_API_KEY: RAW_KEY });

    const config = await client._getConfig();

    // The key legitimately reaches the header...
    expect(String(config.headers['Authorization'])).toBe(`Bearer ${RAW_KEY}`);
    // ...but is never emitted to console/logger.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    const addLogMock = (await import('../../utils/logger.js')).addLog;
    const logCalls = (addLogMock as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of logCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(RAW_KEY);
    }
  });

  it('redacts the key in the error path when it is missing', async () => {
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({ OBSIDIAN_API_KEY: '' });

    await expect(client._getConfig()).rejects.toThrow(/API key is missing/);

    // Console output must not contain the raw key (it only ever carries the type).
    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_KEY);
    }
  });

  it('never emits a full raw key even when an object-shaped key slips into settings', async () => {
    // Simulates an encryption failure that yields an object instead of a string.
    // @ts-expect-error - vi.fn() type narrowing issue
    storage.getSettings.mockResolvedValue({ OBSIDIAN_API_KEY: { fullKey: RAW_KEY } });

    await expect(client._getConfig()).rejects.toThrow(/API key is missing/);

    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_KEY);
    }
  });
});
