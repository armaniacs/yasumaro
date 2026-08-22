// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { loadExportConfig } from '../markdownExport.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

describe('markdownExport — SettingsRepository seam', () => {
  it('loadExportConfig reads from injected repo', async () => {
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({
        [StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH]: 'ExportDir',
        [StorageKeys.MARKDOWN_EXPORT_TEMPLATES]: [],
        [StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID]: undefined,
      }),
      getAll: vi.fn(),
    };

    const config = await loadExportConfig(repo);

    expect(repo.getMany).toHaveBeenCalledWith([
      StorageKeys.LOCAL_MARKDOWN_EXPORT_PATH,
      StorageKeys.MARKDOWN_EXPORT_TEMPLATES,
      StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID,
    ]);
    expect(config.exportPath).toBe('ExportDir');
  });
});
