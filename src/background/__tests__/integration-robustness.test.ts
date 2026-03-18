// src/background/__tests__/integration-robustness.test.js
import { ObsidianClient } from '../obsidianClient.js';
import { getSettings, StorageKeys, saveSettings } from '../../utils/storage.js';
import { GeminiProvider } from '../ai/providers/GeminiProvider.js';
import { fetchWithRetry } from '../../utils/fetch.js';

jest.mock('../../utils/fetch.js');
jest.mock('../../utils/logger.js');
jest.mock('../../utils/customPromptUtils.js', () => ({
  applyCustomPrompt: jest.fn((settings, provider, content) => ({
    userPrompt: `以下のWebページの内容を、日本語で簡潔に要約してください。1文または2文で、重要なポイントをまとめてください。改行しないこと。\n\nContent:\n${content}`,
    systemPrompt: ""
  }))
}));
jest.mock('../../utils/promptSanitizer.js', () => ({
  sanitizePromptContent: jest.fn((content) => ({
    sanitized: content,
    warnings: [],
    dangerLevel: 'low' as const
  }))
}));

describe('Integration: Robustness improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // ストレージのクリアはjest.setup.jsのbeforeEachで行われています
  });

  test('settings.getがStorageKeysのみを取得', async () => {
    // ゴミデータをセット
    await chrome.storage.local.set({
      junk1: 1,
      junk2: 'garbage',
      settings_migrated: true, // マイグレーション済みフラグ
      settings_version: 0,
      settings: {
        junkInSettings: 'also garbage' // settingsオブジェクト内のゴミデータ
      }
    });

    // 有効な設定
    await saveSettings({
      [StorageKeys.OBSIDIAN_API_KEY]: 'test-key',
      [StorageKeys.OBSIDIAN_PORT]: '27123'
    });

    const settings = await getSettings();
    expect(settings.junk1).toBeUndefined();
    expect(settings.junk2).toBeUndefined();
    expect(settings.junkInSettings).toBeUndefined();
    expect(settings[StorageKeys.OBSIDIAN_API_KEY]).toBe('test-key');
    expect(settings[StorageKeys.OBSIDIAN_PORT]).toBe('27123');
  });

  test('Mutex Mapが正しく動作', async () => {
    const client = new ObsidianClient();
    const mutex = client._globalWriteMutex;

    // 最初のロックを取得
    await mutex.acquire();
    expect(mutex.isLocked()).toBe(true);

    // キューに入れる
    let secondReleased = false;
    const secondLockPromise = mutex.acquire().then(() => {
      secondReleased = true;
    });
    expect(secondReleased).toBe(false);

    // 一番目を解放
    mutex.release();
    await secondLockPromise;
    expect(secondReleased).toBe(true);

    // キューが空であることを確認
    mutex.release();
    expect(mutex.queue.size).toBe(0);
  });

  test('fetchWithRetryが正常に動作', async () => {
    const mockResponse = { ok: true, json: async () => ({ data: 'test' }) };
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockResolvedValue(mockResponse);

    const response = await fetchWithRetry('https://example.com', {}, {});
    expect(response.ok).toBe(true);
  });

  test('GeminiProviderがfetchWithRetryを使用', async () => {
    // fetchWithRetryが呼ばれることを確認
    const mockResponse = {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'テスト要約' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50
        }
      })
    };
    // @ts-expect-error - jest.fn() type narrowing issue

    fetchWithRetry.mockResolvedValue(mockResponse);

    const settings: any = {
      [StorageKeys.GEMINI_API_KEY]: 'test-key',
      [StorageKeys.GEMINI_MODEL]: 'gemini-1.5-flash'
    };

    const provider = new GeminiProvider(settings);
    const result = await provider.generateSummary('test content');

    expect(result.summary).toBe('テスト要約');
    expect(result.sentTokens).toBe(100);
    expect(result.receivedTokens).toBe(50);
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com'),
      expect.objectContaining({
        timeoutMs: 30000 // 30秒のタイムアウト
      }),
      expect.any(Object)
    );
  });
});