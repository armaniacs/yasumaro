// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { loadGeneralSettings } from '../settingsForm.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

describe('settingsForm — SettingsRepository seam', () => {
  it('loadGeneralSettings reads form settings from injected repo', async () => {
    const repo: SettingsReader = {
      getAll: vi.fn().mockResolvedValue({
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai', model: 'gpt-4o' }],
      }),
      getMany: vi.fn(),
    };

    await loadGeneralSettings(repo);

    expect(repo.getAll).toHaveBeenCalledTimes(1);
  });
});
