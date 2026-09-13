/**
 * ollamaSettingsObserver.test.ts
 * createOllamaSettingsObserver が生成するコールバックの単体テスト。
 * service-worker.ts のcomposition root外でOLLAMA_BASE_URL変更監視ロジックを検証する。
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createOllamaSettingsObserver } from '../ollamaSettingsObserver.js';
import { StorageKeys } from '../../../utils/storage/types.js';

vi.mock('../../../utils/logger.js', () => ({
  logWarn: vi.fn(),
}));

import { logWarn } from '../../../utils/logger.js';
const mockLogWarn = vi.mocked(logWarn);

describe('createOllamaSettingsObserver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls syncFn with the new value when OLLAMA_BASE_URL changes', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://new-host:11434/v1' });

    expect(syncFn).toHaveBeenCalledWith('http://new-host:11434/v1');
  });

  it('does not call syncFn for changes to keys other than OLLAMA_BASE_URL', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.LM_STUDIO_BASE_URL]: 'http://127.0.0.1:1234/v1' });

    expect(syncFn).not.toHaveBeenCalled();
  });

  it('does not call syncFn when changes is an empty object', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({});

    expect(syncFn).not.toHaveBeenCalled();
  });

  it('does not throw when syncFn fails and calls logWarn instead', async () => {
    const syncFn = vi.fn().mockRejectedValue(new Error('updateDynamicRules failed'));
    const observer = createOllamaSettingsObserver(syncFn);

    expect(() => observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1' })).not.toThrow();

    await vi.waitFor(() => {
      expect(mockLogWarn).toHaveBeenCalledWith(
        'Ollama Origin header rule sync failed on settings change',
        { error: 'Error: updateDynamicRules failed' },
        undefined,
        'service-worker',
      );
    });
  });

  it('does not call syncFn again for the same OLLAMA_BASE_URL value', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1' });
    expect(syncFn).toHaveBeenCalledTimes(1);

    // Same value again — should not fire
    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1' });
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it('does not call syncFn when the setting is undefined (skips as identical to the previous value)', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    // undefined (initial) — prev is also undefined, so no change
    observer({});
    expect(syncFn).not.toHaveBeenCalled();
  });
});
