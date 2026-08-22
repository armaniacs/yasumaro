// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { initRecordingConditionsSettings } from '../recordingConditionsSettings.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { SettingsReader } from '../../utils/storage/SettingsRepository.js';

describe('recordingConditionsSettings — SettingsRepository seam', () => {
  it('initRecordingConditionsSettings reads from injected repo', async () => {
    document.body.innerHTML = '<div id="recording-conditions-settings"></div>';
    const repo: SettingsReader = {
      getMany: vi.fn().mockResolvedValue({
        [StorageKeys.MIN_VISIT_DURATION]: 10,
        [StorageKeys.MIN_SCROLL_DEPTH]: 75,
        [StorageKeys.MAX_TOKENS_PER_PROMPT]: 2000,
        [StorageKeys.AI_TIMEOUT_MS]: 30000,
        [StorageKeys.MAX_MONTHLY_TOKENS]: 500000,
        [StorageKeys.AI_RATE_LIMIT_MAX]: 20,
        [StorageKeys.OPENAI_CONTENT_CHARS]: 5000,
        [StorageKeys.GEMINI_CONTENT_CHARS]: 15000,
      }),
      getAll: vi.fn(),
    };

    await initRecordingConditionsSettings(repo);

    expect(repo.getMany).toHaveBeenCalled();
  });
});
