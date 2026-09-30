import { describe, it, expect, vi } from 'vitest';
import { StorageKeys } from '../../utils/storage/types.js';
import { EncryptionLockedError } from '../../utils/storage/encryptionLockedError.js';

vi.mock('../../utils/storage/SettingsRepository.js', () => ({
  settingsRepository: { getAll: vi.fn(), get: vi.fn() },
}));

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { buildObsidianConfig } from '../../utils/obsidianConfigBuilder.js';

describe('obsidianConfigBuilder — locked session', () => {
  it('buildFromSettings rejects an undecrypted API key with a lock error', async () => {
    vi.mocked(settingsRepository.getAll).mockResolvedValue({
      [StorageKeys.OBSIDIAN_HOST]: '127.0.0.1',
      [StorageKeys.OBSIDIAN_PROTOCOL]: 'http',
      [StorageKeys.OBSIDIAN_PORT]: '27123',
      [StorageKeys.OBSIDIAN_API_KEY]: { iv: 'a', ciphertext: 'b' },
    } as never);

    const promise = buildObsidianConfig();
    await expect(promise).rejects.toBeInstanceOf(EncryptionLockedError);
    await expect(promise).rejects.not.toThrow(/API key is missing/);
  });

  it('buildFromOverride rejects a stored undecrypted API key with a lock error', async () => {
    vi.mocked(settingsRepository.get).mockImplementation(async (key: never) => {
      if (key === StorageKeys.OBSIDIAN_HOST) return '127.0.0.1' as never;
      if (key === StorageKeys.OBSIDIAN_API_KEY) return { iv: 'a', ciphertext: 'b' } as never;
      return undefined as never;
    });

    const promise = buildObsidianConfig({ protocol: 'http', host: '127.0.0.1', port: '27123' });
    await expect(promise).rejects.toBeInstanceOf(EncryptionLockedError);
    await expect(promise).rejects.not.toThrow(/API key is missing/);
  });
});
