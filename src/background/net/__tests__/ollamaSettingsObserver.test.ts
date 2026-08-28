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

  it('OLLAMA_BASE_URLの変更があればsyncFnを新しい値で呼ぶ', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://new-host:11434/v1' });

    expect(syncFn).toHaveBeenCalledWith('http://new-host:11434/v1');
  });

  it('OLLAMA_BASE_URL以外のキー変更ではsyncFnを呼ばない', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.LM_STUDIO_BASE_URL]: 'http://127.0.0.1:1234/v1' });

    expect(syncFn).not.toHaveBeenCalled();
  });

  it('changesが空オブジェクトならsyncFnを呼ばない', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({});

    expect(syncFn).not.toHaveBeenCalled();
  });

  it('syncFnが失敗してもコールバック自体は例外を投げず、logWarnが呼ばれる', async () => {
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

  it('同一のOLLAMA_BASE_URL値で再呼び出ししてもsyncFnは呼ばれない', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1' });
    expect(syncFn).toHaveBeenCalledTimes(1);

    // Same value again — should not fire
    observer({ [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1' });
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it('設定値がundefinedの場合はsyncFnを呼ばない（前回値と同一のためスキップ）', () => {
    const syncFn = vi.fn().mockResolvedValue(undefined);
    const observer = createOllamaSettingsObserver(syncFn);

    // undefined (initial) — prev is also undefined, so no change
    observer({});
    expect(syncFn).not.toHaveBeenCalled();
  });
});
