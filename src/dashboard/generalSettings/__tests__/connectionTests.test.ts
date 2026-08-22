// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { handleTestLocalMarkdown } from '../connectionTests.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

vi.mock('../../settingsPipeline.js', () => ({
  saveDashboardSettings: vi.fn().mockResolvedValue({ success: true }),
}));

describe('connectionTests — SettingsRepository seam', () => {
  it('handleTestLocalMarkdown reads export settings from injected repo', async () => {
    document.body.innerHTML = `
      <button id="testLocalMarkdownBtnTop"></button>
      <div id="statusTop"></div>
      <form id="panel-general"></form>
    `;

    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({
        [StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED]: false,
        [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'ExportDir',
      }),
      getAll: vi.fn(),
    };

    await handleTestLocalMarkdown(repo);

    expect(repo.getMany).toHaveBeenCalledWith([
      StorageKeys.LOCAL_MARKDOWN_EXPORT_ENABLED,
      StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH,
    ]);
  });
});
