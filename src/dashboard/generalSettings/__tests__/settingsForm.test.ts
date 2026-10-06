// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { loadGeneralSettings, VISIBLE_WHEN, applyVisibilityToggles, setupVisibilityToggles } from '../settingsForm.js';
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

  it('loadGeneralSettings reuses a passed snapshot without fetching', async () => {
    const repo: SettingsReader = {
      getAll: vi.fn().mockResolvedValue({ should: 'not-be-read' }),
      getMany: vi.fn(),
    };

    await loadGeneralSettings(repo, {
      [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai', model: 'gpt-4o' }],
    });

    expect(repo.getAll).not.toHaveBeenCalled();
  });

  it('loadGeneralSettings accepts a bare snapshot', async () => {
    await expect(loadGeneralSettings({
      [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai', model: 'gpt-4o' }],
    })).resolves.not.toThrow();
  });
});

describe('settingsForm — VISIBLE_WHEN table', () => {
  const MARKUP = `
    <details id="obsidianSettingsDetails"><input type="checkbox" id="obsidianEnabled"></details>
    <input type="checkbox" id="localMarkdownExportEnabled"><div id="localMarkdownExportSettings" class="hidden"></div>
    <input type="checkbox" id="reviewSummaryEnabled"><div id="reviewSummaryManualActions" class="hidden"></div>`;

  it('covers the three checkbox rules', () => {
    expect(VISIBLE_WHEN.map((r) => r.inputId).sort()).toEqual(
      ['localMarkdownExportEnabled', 'obsidianEnabled', 'reviewSummaryEnabled'].sort(),
    );
  });

  it('load-time apply and change-time wiring agree on all rules', () => {
    document.body.innerHTML = MARKUP;
    const root = document.body;
    setupVisibilityToggles(root);
    for (const rule of VISIBLE_WHEN) {
      const input = document.getElementById(rule.inputId) as HTMLInputElement;
      const target = document.getElementById(rule.targetId) as HTMLElement;
      for (const checked of [true, false]) {
        input.checked = checked;
        input.dispatchEvent(new Event('change'));
        const afterChange = rule.inputId === 'obsidianEnabled'
          ? String((target as HTMLDetailsElement).open)
          : String(!target.classList.contains('hidden'));
        applyVisibilityToggles(root);
        const afterApply = rule.inputId === 'obsidianEnabled'
          ? String((target as HTMLDetailsElement).open)
          : String(!target.classList.contains('hidden'));
        expect(afterApply).toBe(afterChange);
        expect(afterApply).toBe(String(checked));
      }
    }
  });
});
