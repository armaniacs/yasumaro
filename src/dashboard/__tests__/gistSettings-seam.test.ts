// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initGistSettings } from '../gistSettings.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

describe('gistSettings — SettingsRepository seam', () => {
  it('initGistSettings reads from injected repo', async () => {
    document.body.innerHTML = '<input id="gistEnabled" type="checkbox" /><input id="githubPat" />';
    const repo: SettingsReader = {
      getAll: vi.fn().mockResolvedValue({
        [StorageKeys.GIST_ENABLED]: true,
        [StorageKeys.GITHUB_PAT]: 'secret',
      }),
      getMany: vi.fn(),
    };

    await initGistSettings(repo);

    expect(repo.getAll).toHaveBeenCalledTimes(1);
    expect((document.getElementById('gistEnabled') as HTMLInputElement).checked).toBe(true);
  });
});
