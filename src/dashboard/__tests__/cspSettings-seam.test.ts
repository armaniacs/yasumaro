// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { CspSettingsController } from '../cspSettings.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

describe('cspSettings — SettingsRepository seam', () => {
  it('loadCSPSettings reads from injected repo', async () => {
    const repo: SettingsReader = {
      getAll: vi.fn().mockResolvedValue({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: ['huggingface'],
      }),
      getMany: vi.fn(),
    };

    const controller = new CspSettingsController(undefined, repo);
    await controller.loadCSPSettings();

    expect(repo.getAll).toHaveBeenCalledTimes(1);
  });
});
