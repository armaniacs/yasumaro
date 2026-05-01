/**
 * storageUrls-setters.test.ts
 * storageUrls.ts の setter 関数群のテスト
 * カバレッジ向上のため、未テストの setter を網羅
 */

import { vi } from 'vitest';;
import type { SavedUrlEntry } from '../storageUrls.js';

// chrome.storage.local のモック
const mockStorage: Map<string, unknown> = new Map();

const mockChromeStorageLocal = {
  get: vi.fn((keys: string | string[] | null) => {
    const result: Record<string, unknown> = {};
    if (keys === null || Array.isArray(keys)) {
      const keysToGet = keys === null ? Array.from(mockStorage.keys()) : keys;
      for (const key of keysToGet) {
        if (mockStorage.has(key)) {
          result[key] = mockStorage.get(key);
        }
      }
    } else {
      if (mockStorage.has(keys)) {
        result[keys] = mockStorage.get(keys);
      }
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(items)) {
      mockStorage.set(key, value);
    }
    return Promise.resolve();
  }),
  getBytesInUse: vi.fn(() => Promise.resolve(0)),
};

global.chrome = {
  storage: { local: mockChromeStorageLocal },
} as any;

// ヘルパー: テスト用エントリを作成
function createTestEntry(url: string, overrides: Partial<SavedUrlEntry> = {}): SavedUrlEntry {
  return {
    url,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('storageUrls setter functions', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  describe('setUrlRecordType', () => {
    it('既存エントリのrecordTypeを更新する', async () => {
      const { setUrlRecordType } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlRecordType('https://example.com', 'manual');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.recordType).toBe('manual');
    });

    it('存在しないURLの場合は変更しない', async () => {
      const { setUrlRecordType } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlRecordType('https://other.com', 'auto');

      const result = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(result).toHaveLength(1);
      expect(result[0].recordType).toBeUndefined();
    });
  });

  describe('setUrlContent', () => {
    it('既存エントリのcontentを設定する', async () => {
      const { setUrlContent } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlContent('https://example.com', 'extracted content');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.content).toBe('extracted content');
    });
  });

  describe('setUrlMaskedCount', () => {
    it('既存エントリのmaskedCountを設定する', async () => {
      const { setUrlMaskedCount } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlMaskedCount('https://example.com', 5);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.maskedCount).toBe(5);
    });
  });

  describe('setUrlTags', () => {
    it('タグリストを設定する', async () => {
      const { setUrlTags } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlTags('https://example.com', ['tech', 'news']);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toEqual(['tech', 'news']);
    });

    it('空配列を設定するとundefinedになる', async () => {
      const { setUrlTags } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlTags('https://example.com', []);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toBeUndefined();
    });
  });

  describe('addUrlTag / removeUrlTag', () => {
    it('タグを追加する', async () => {
      const { addUrlTag } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await addUrlTag('https://example.com', 'new-tag');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toContain('new-tag');
      expect(entry?.tags).toContain('existing');
    });

    it('重複タグは追加しない', async () => {
      const { addUrlTag } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await addUrlTag('https://example.com', 'existing');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toEqual(['existing']);
    });

    it('タグを削除する', async () => {
      const { removeUrlTag } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com', { tags: ['tag1', 'tag2'] })];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await removeUrlTag('https://example.com', 'tag1');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toEqual(['tag2']);
    });

    it('最後のタグを削除するとundefinedになる', async () => {
      const { removeUrlTag } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com', { tags: ['only-tag'] })];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await removeUrlTag('https://example.com', 'only-tag');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.tags).toBeUndefined();
    });
  });

  describe('setUrlAiSummary', () => {
    it('AI要約を設定する', async () => {
      const { setUrlAiSummary } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiSummary('https://example.com', 'This is a summary.');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiSummary).toBe('This is a summary.');
    });
  });

  describe('setUrlSentTokens / setUrlReceivedTokens', () => {
    it('送信トークン数を設定する', async () => {
      const { setUrlSentTokens } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlSentTokens('https://example.com', 1500);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.sentTokens).toBe(1500);
    });

    it('受信トークン数を設定する', async () => {
      const { setUrlReceivedTokens } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlReceivedTokens('https://example.com', 800);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.receivedTokens).toBe(800);
    });
  });

  describe('setUrlOriginalTokens / setCleansedTokens', () => {
    it('元のトークン数を設定する', async () => {
      const { setUrlOriginalTokens } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlOriginalTokens('https://example.com', 2000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.originalTokens).toBe(2000);
    });

    it('クレンジング後のトークン数を設定する', async () => {
      const { setUrlCleansedTokens } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlCleansedTokens('https://example.com', 1500);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.cleansedTokens).toBe(1500);
    });
  });

  describe('setUrlPageBytes / setUrlCandidateBytes', () => {
    it('ページバイト数を設定する', async () => {
      const { setUrlPageBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlPageBytes('https://example.com', 50000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.pageBytes).toBe(50000);
    });

    it('候補バイト数を設定する', async () => {
      const { setUrlCandidateBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlCandidateBytes('https://example.com', 30000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.candidateBytes).toBe(30000);
    });
  });

  describe('setUrlOriginalBytes / setUrlCleansedBytes', () => {
    it('元のバイト数を設定する', async () => {
      const { setUrlOriginalBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlOriginalBytes('https://example.com', 40000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.originalBytes).toBe(40000);
    });

    it('クレンジング後のバイト数を設定する', async () => {
      const { setUrlCleansedBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlCleansedBytes('https://example.com', 25000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.cleansedBytes).toBe(25000);
    });
  });

  describe('setUrlAiSummaryOriginalBytes / setUrlAiSummaryCleansedBytes', () => {
    it('AI要約クレンジング前のバイト数を設定する', async () => {
      const { setUrlAiSummaryOriginalBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiSummaryOriginalBytes('https://example.com', 10000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiSummaryOriginalBytes).toBe(10000);
    });

    it('AI要約クレンジング後のバイト数を設定する', async () => {
      const { setUrlAiSummaryCleansedBytes } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiSummaryCleansedBytes('https://example.com', 8000);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiSummaryCleansedBytes).toBe(8000);
    });
  });

  describe('setUrlAiSummaryCleansedElements / setUrlAiSummaryCleansedReason', () => {
    it('AI要約クレンジング削除要素数を設定する', async () => {
      const { setUrlAiSummaryCleansedElements } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiSummaryCleansedElements('https://example.com', 15);

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiSummaryCleansedElements).toBe(15);
    });

    it('AI要約クレンジング実行理由を設定する', async () => {
      const { setUrlAiSummaryCleansedReason } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiSummaryCleansedReason('https://example.com', 'alt');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiSummaryCleansedReason).toBe('alt');
    });
  });

  describe('setUrlCleansedReason', () => {
    it('クレンジング実行理由を設定する', async () => {
      const { setUrlCleansedReason } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlCleansedReason('https://example.com', 'keyword');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.cleansedReason).toBe('keyword');
    });
  });

  describe('buildAllowedUrls', () => {
    it('基本的なURLリストを構築する', async () => {
      const { buildAllowedUrls } = await import('../storageUrls.js');

      const whitelist = (url: string) => true;
      const settings = {
        obsidian_protocol: 'https',
        obsidian_port: '27123',
        openai_base_url: 'https://api.openai.com/v1',
        openai_2_base_url: '',
        ublock_sources: []
      };

      const urls = buildAllowedUrls(settings, whitelist);

      expect(urls.has('https://generativelanguage.googleapis.com')).toBe(true);
      expect(urls.has('https://raw.githubusercontent.com')).toBe(true);
    });

    it('ホワイトリストにないURLは除外する', async () => {
      const { buildAllowedUrls } = await import('../storageUrls.js');

      const whitelist = (url: string) => url.includes('openai.com');
      const settings = {
        obsidian_protocol: 'https',
        obsidian_port: '27123',
        openai_base_url: 'https://evil.com/v1',
        openai_2_base_url: '',
        ublock_sources: []
      };

      const urls = buildAllowedUrls(settings, whitelist);

      expect(urls.has('https://evil.com/v1')).toBe(false);
    });
  });

  describe('setUrlAiProvider', () => {
    it('既存エントリのaiProviderを設定する', async () => {
      const { setUrlAiProvider } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiProvider('https://example.com', 'lm-studio');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiProvider).toBe('lm-studio');
    });

    it('存在しないURLの場合は変更しない', async () => {
      const { setUrlAiProvider } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiProvider('https://other.com', 'gemini');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated[0].aiProvider).toBeUndefined();
    });
  });

  describe('setUrlAiModel', () => {
    it('既存エントリのaiModelを設定する', async () => {
      const { setUrlAiModel } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiModel('https://example.com', 'gemma-4-e4b-it');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      const entry = updated.find(e => e.url === 'https://example.com');
      expect(entry?.aiModel).toBe('gemma-4-e4b-it');
    });

    it('存在しないURLの場合は変更しない', async () => {
      const { setUrlAiModel } = await import('../storageUrls.js');

      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);

      await setUrlAiModel('https://other.com', 'gpt-4');

      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated[0].aiModel).toBeUndefined();
    });
  });

  describe('setUrlAiDuration', () => {
    it('既存エントリのaiDurationを設定する', async () => {
      const { setUrlAiDuration } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlAiDuration('https://example.com', 1200);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.aiDuration).toBe(1200);
    });
  });

  describe('setUrlObsidianDuration', () => {
    it('既存エントリのobsidianDurationを設定する', async () => {
      const { setUrlObsidianDuration } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlObsidianDuration('https://example.com', 350);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.obsidianDuration).toBe(350);
    });
  });

  describe('setUrlAiSummaryCleansedReasons', () => {
    it('既存エントリのaiSummaryCleansedReasonsを設定する', async () => {
      const { setUrlAiSummaryCleansedReasons } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlAiSummaryCleansedReasons('https://example.com', ['ads', 'nav']);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.aiSummaryCleansedReasons).toEqual(['ads', 'nav']);
    });
  });

  describe('setUrlExtractedSentencesBytes', () => {
    it('既存エントリのextractedSentencesBytesを設定する', async () => {
      const { setUrlExtractedSentencesBytes } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlExtractedSentencesBytes('https://example.com', 4096);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.extractedSentencesBytes).toBe(4096);
    });
  });

  describe('setUrlExtractedSentencesOriginalBytes', () => {
    it('既存エントリのextractedSentencesOriginalBytesを設定する', async () => {
      const { setUrlExtractedSentencesOriginalBytes } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlExtractedSentencesOriginalBytes('https://example.com', 8192);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.extractedSentencesOriginalBytes).toBe(8192);
    });
  });

  describe('setUrlFallbackTriggered', () => {
    it('既存エントリのfallbackTriggeredを設定する', async () => {
      const { setUrlFallbackTriggered } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlFallbackTriggered('https://example.com', true);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.fallbackTriggered).toBe(true);
    });

    it('ハッシュ付きURLも正規化して設定する', async () => {
      const { setUrlFallbackTriggered } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlFallbackTriggered('https://example.com#section', true);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.fallbackTriggered).toBe(true);
    });

    it('存在しないURLは変更しない', async () => {
      const { setUrlFallbackTriggered } = await import('../storageUrls.js');
      const entries = [createTestEntry('https://example.com')];
      mockStorage.set('savedUrlsWithTimestamps', entries);
      await setUrlFallbackTriggered('https://other.com', true);
      const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
      expect(updated.find(e => e.url === 'https://example.com')?.fallbackTriggered).toBeUndefined();
    });
  });

  describe('computeUrlsHash', () => {
    it('URLのハッシュを計算する', async () => {
      const { computeUrlsHash } = await import('../storageUrls.js');

      const urls = new Set(['https://b.com', 'https://a.com']);
      const hash = computeUrlsHash(urls);

      expect(hash).toBe('https://a.com|https://b.com');
    });

    it('空セットの場合は空文字列', async () => {
      const { computeUrlsHash } = await import('../storageUrls.js');

      const hash = computeUrlsHash(new Set());
      expect(hash).toBe('');
    });
  });
});
