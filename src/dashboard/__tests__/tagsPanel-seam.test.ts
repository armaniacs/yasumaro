// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initTagsPanel } from '../tagsPanel.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

describe('tagsPanel — SettingsRepository seam', () => {
  it('initTagsPanel reads from injected repo', async () => {
    document.body.innerHTML = `
      <input id="tagSummaryMode" type="checkbox" />
      <div id="defaultCategoriesList"></div>
      <input id="newCategoryInput" />
      <button id="addCategoryBtn"></button>
      <button id="saveTagsBtn"></button>
      <div id="userCategoriesList"></div>
      <input id="normFromInput" />
      <input id="normToInput" />
      <button id="addNormEntryBtn"></button>
      <div id="normalizationEntriesList"></div>
      <div id="exportImportStatus"></div>
    `;
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({
        [StorageKeys.TAG_SUMMARY_MODE]: true,
        [StorageKeys.TAG_CATEGORIES]: [],
        [StorageKeys.TAG_NORMALIZATION_DICT]: [],
      }),
      getAll: vi.fn(),
    };

    await initTagsPanel(repo);

    expect(repo.getMany).toHaveBeenCalled();
    expect((document.getElementById('tagSummaryMode') as HTMLInputElement).checked).toBe(true);
  });
});
