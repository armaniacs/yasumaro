/**
 * storageUrls-setters.test.ts
 * updateSavedUrlEntry とタグ操作関数のテスト
 * カバレッジ向上のため、updateSavedUrlEntry の updater パターンを網羅
 */

import { vi } from 'vitest';
import type { SavedUrlEntry } from '../storageUrls.js';
import { updateSavedUrlEntry, setUrlTags, addUrlTag, removeUrlTag } from '../storageUrls.js';

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

(global as any).chrome = {
  storage: { local: mockChromeStorageLocal },
};

// ヘルパー: テスト用エントリを作成
function createTestEntry(url: string, overrides: Partial<SavedUrlEntry> = {}): SavedUrlEntry {
  return {
    url,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('updateSavedUrlEntry', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  it('既存エントリの単一フィールドを更新する', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await updateSavedUrlEntry('https://example.com', (entry) => ({ ...entry, recordType: 'manual' as const }));

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.recordType).toBe('manual');
  });

  it('存在しないURLの場合は変更しない', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await updateSavedUrlEntry('https://other.com', (entry) => ({ ...entry, recordType: 'auto' as const }));

    const result = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    expect(result).toHaveLength(1);
    expect(result[0].recordType).toBeUndefined();
  });

  it('複数フィールドを同時に更新する', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await updateSavedUrlEntry('https://example.com', (entry) => ({
      ...entry,
      aiSummary: 'Summary text',
      sentTokens: 150,
    }));

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.aiSummary).toBe('Summary text');
    expect(entry?.sentTokens).toBe(150);
  });

  it('content フィールドを更新する', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await updateSavedUrlEntry('https://example.com', (entry) => ({ ...entry, content: 'extracted content' }));

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.content).toBe('extracted content');
  });

  it('tags を undefined に設定する（空配列の場合）', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await updateSavedUrlEntry('https://example.com', (entry) => ({ ...entry, tags: undefined }));

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toBeUndefined();
  });

  it('バージョンキーを介して楽観的ロックで更新する', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);
    mockStorage.set('savedUrlsWithTimestamps_version', 3);

    await updateSavedUrlEntry('https://example.com', (entry) => ({ ...entry, fallbackTriggered: true }));

    expect(mockStorage.get('savedUrlsWithTimestamps_version')).toBe(4);
    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    expect(updated.find(e => e.url === 'https://example.com')?.fallbackTriggered).toBe(true);
  });
});

describe('setUrlTags / addUrlTag / removeUrlTag', () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.clearAllMocks();
  });

  it('setUrlTags でタグリストを設定する', async () => {
    const entries = [createTestEntry('https://example.com')];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await setUrlTags('https://example.com', ['tech', 'news']);

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toEqual(['tech', 'news']);
  });

  it('setUrlTags で空配列を設定するとundefinedになる', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await setUrlTags('https://example.com', []);

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toBeUndefined();
  });

  it('addUrlTag でタグを追加する', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await addUrlTag('https://example.com', 'new-tag');

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toContain('new-tag');
    expect(entry?.tags).toContain('existing');
  });

  it('addUrlTag で重複タグは追加しない', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['existing'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await addUrlTag('https://example.com', 'existing');

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toEqual(['existing']);
  });

  it('removeUrlTag でタグを削除する', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['tag1', 'tag2'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await removeUrlTag('https://example.com', 'tag1');

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toEqual(['tag2']);
  });

  it('removeUrlTag で最後のタグを削除するとundefinedになる', async () => {
    const entries = [createTestEntry('https://example.com', { tags: ['only-tag'] })];
    mockStorage.set('savedUrlsWithTimestamps', entries);

    await removeUrlTag('https://example.com', 'only-tag');

    const updated = mockStorage.get('savedUrlsWithTimestamps') as SavedUrlEntry[];
    const entry = updated.find(e => e.url === 'https://example.com');
    expect(entry?.tags).toBeUndefined();
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
