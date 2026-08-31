import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSettings, clearSettingsCache } from '../../storage';

vi.mock('../../logger.js', () => ({
  logInfo: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(() => Promise.resolve()),
  logError: vi.fn(() => Promise.resolve()),
  logDebug: vi.fn(() => Promise.resolve()),
  logSanitize: vi.fn(() => Promise.resolve()),
  ErrorCode: {
    INTERNAL_ERROR: 'INT_001',
    API_REQUEST_FAILURE: 'API_REQ_001',
    CRYPTO_DECRYPTION_FAILURE: 'CRYPTO_002',
    CRYPTO_KEY_DERIVE_FAILURE: 'CRYPTO_001',
    CRYPTO_ENCRYPTION_FAILURE: 'CRYPTO_003',
    STORAGE_QUOTA_EXCEEDED: 'STO_001',
    STORAGE_WRITE_FAILURE: 'STO_003',
  },
}));

describe('storage — plaintext API key detection', () => {
  let storageData: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    storageData = {
      settings: {
        openai_api_key: 'sk-plaintext-key',
      },
      settings_migrated: true,
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
          set: vi.fn((obj: Record<string, unknown>) => {
            Object.assign(storageData, obj);
            return Promise.resolve();
          }),
        },
      },
    } as unknown as typeof chrome;
  });

  it('warns when an API key field is stored as plaintext', async () => {
    const { logWarn } = await import('../../logger.js');
    clearSettingsCache();

    const settings = await getSettings();

    expect(settings['openai_api_key']).toBe('sk-plaintext-key');
    expect(logWarn).toHaveBeenCalledTimes(1);
    const warnCall = vi.mocked(logWarn).mock.calls[0];
    expect(warnCall[0]).toContain('openai_api_key');
    expect(warnCall[0]).toContain('Plaintext');
  });

  it('does not warn when API key fields are absent', async () => {
    storageData.settings = {};
    const { logWarn } = await import('../../logger.js');
    clearSettingsCache();

    await getSettings();

    expect(logWarn).not.toHaveBeenCalled();
  });

  it('VULN-015: re-encrypts plaintext API keys at rest during migration', async () => {
    clearSettingsCache();

    const settings = await getSettings();

    // In-memory settings still expose the decrypted value for the session.
    expect(settings['openai_api_key']).toBe('sk-plaintext-key');
    // Storage must no longer hold the plaintext.
    const persisted = (storageData.settings as Record<string, unknown>)['openai_api_key'] as Record<string, unknown>;
    expect(persisted).not.toBe('sk-plaintext-key');
    expect(persisted).toMatchObject({
      ciphertext: expect.any(String),
      iv: expect.any(String),
    });
    expect((persisted.ciphertext as string).length).toBeGreaterThan(0);
  });
});
