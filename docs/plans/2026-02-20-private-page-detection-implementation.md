# Private Page Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** HTTPヘッダー情報を使用してプライベートページを自動検出し、保存前に警告を表示する機能を実装する

**Architecture:** webRequest APIでメインフレームのHTMLレスポンスヘッダーを監視し、Cache-Control/Set-Cookie/Authorizationの存在を判定。結果を5分間キャッシュし、RecordingLogicで参照してPRIVATE_PAGE_DETECTEDエラーを返す。Content Script/Popupで警告ダイアログを表示し、force flagで保存可能にする。

**Tech Stack:** TypeScript, Chrome Extension APIs (webRequest, storage), Jest

---

## Task 1: Privacy Checker - 型定義とヘッダー判定関数

**Files:**
- Create: `src/utils/privacyChecker.ts`
- Create: `src/utils/__tests__/privacyChecker.test.ts`

### Step 1: Write the failing test for PrivacyInfo type and checkPrivacy function

```typescript
// src/utils/__tests__/privacyChecker.test.ts
import { describe, test, expect } from '@jest/globals';
import { checkPrivacy, PrivacyInfo } from '../privacyChecker.js';

describe('privacyChecker', () => {
  describe('checkPrivacy - Cache-Control detection', () => {
    test('Cache-Control: private を検出できる', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'private, max-age=0' },
        { name: 'Content-Type', value: 'text/html' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
      expect(result.headers?.cacheControl).toBe('private, max-age=0');
    });

    test('Cache-Control: no-store を検出できる', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'no-store' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
    });

    test('Cache-Control: no-cache を検出できる', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'cache-control', value: 'no-cache, must-revalidate' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
    });
  });

  describe('checkPrivacy - Set-Cookie detection', () => {
    test('Set-Cookie ヘッダーを検出できる', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Set-Cookie', value: 'session=abc123; HttpOnly' },
        { name: 'Content-Type', value: 'text/html' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('set-cookie');
      expect(result.headers?.hasCookie).toBe(true);
    });
  });

  describe('checkPrivacy - Authorization detection', () => {
    test('Authorization ヘッダーを検出できる', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Authorization', value: 'Bearer token123' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('authorization');
      expect(result.headers?.hasAuth).toBe(true);
    });
  });

  describe('checkPrivacy - 複数条件の優先順位', () => {
    test('Cache-Control が最優先される', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Cache-Control', value: 'private' },
        { name: 'Set-Cookie', value: 'session=abc' },
        { name: 'Authorization', value: 'Bearer token' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('cache-control');
    });

    test('Set-Cookie が Authorization より優先される', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Set-Cookie', value: 'session=abc' },
        { name: 'Authorization', value: 'Bearer token' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(true);
      expect(result.reason).toBe('set-cookie');
    });
  });

  describe('checkPrivacy - 非プライベートページ', () => {
    test('プライベートヘッダーがない場合は isPrivate: false', () => {
      const headers: chrome.webRequest.HttpHeader[] = [
        { name: 'Content-Type', value: 'text/html' },
        { name: 'Cache-Control', value: 'public, max-age=3600' }
      ];

      const result = checkPrivacy(headers);

      expect(result.isPrivate).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    test('空ヘッダー配列の場合は isPrivate: false', () => {
      const result = checkPrivacy([]);

      expect(result.isPrivate).toBe(false);
      expect(result.timestamp).toBeDefined();
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- src/utils/__tests__/privacyChecker.test.ts`

Expected: FAIL with "Cannot find module '../privacyChecker.js'"

### Step 3: Write minimal implementation

```typescript
// src/utils/privacyChecker.ts
export interface PrivacyInfo {
  isPrivate: boolean;
  reason?: 'cache-control' | 'set-cookie' | 'authorization';
  timestamp: number;
  headers?: {
    cacheControl?: string;
    hasCookie: boolean;
    hasAuth: boolean;
  };
}

export function checkPrivacy(headers: chrome.webRequest.HttpHeader[]): PrivacyInfo {
  const timestamp = Date.now();

  // 1. Cache-Control チェック（最優先）
  const cacheControl = findHeader(headers, 'cache-control');
  if (cacheControl) {
    const value = cacheControl.value?.toLowerCase() || '';
    if (value.includes('private') || value.includes('no-store') || value.includes('no-cache')) {
      return {
        isPrivate: true,
        reason: 'cache-control',
        timestamp,
        headers: {
          cacheControl: cacheControl.value,
          hasCookie: hasHeader(headers, 'set-cookie'),
          hasAuth: hasHeader(headers, 'authorization')
        }
      };
    }
  }

  // 2. Set-Cookie チェック（準優先）
  if (hasHeader(headers, 'set-cookie')) {
    return {
      isPrivate: true,
      reason: 'set-cookie',
      timestamp,
      headers: {
        cacheControl: cacheControl?.value,
        hasCookie: true,
        hasAuth: hasHeader(headers, 'authorization')
      }
    };
  }

  // 3. Authorization チェック
  if (hasHeader(headers, 'authorization')) {
    return {
      isPrivate: true,
      reason: 'authorization',
      timestamp,
      headers: {
        cacheControl: cacheControl?.value,
        hasCookie: false,
        hasAuth: true
      }
    };
  }

  // 4. いずれも該当しない
  return {
    isPrivate: false,
    timestamp,
    headers: {
      cacheControl: cacheControl?.value,
      hasCookie: false,
      hasAuth: false
    }
  };
}

function findHeader(headers: chrome.webRequest.HttpHeader[], name: string): chrome.webRequest.HttpHeader | undefined {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
}

function hasHeader(headers: chrome.webRequest.HttpHeader[], name: string): boolean {
  return findHeader(headers, name) !== undefined;
}
```

### Step 4: Run test to verify it passes

Run: `npm test -- src/utils/__tests__/privacyChecker.test.ts`

Expected: PASS (all 10 tests)

### Step 5: Commit

```bash
git add src/utils/privacyChecker.ts src/utils/__tests__/privacyChecker.test.ts
git commit -m "feat(privacy): add privacy checker with header detection logic

- Implement checkPrivacy() function to detect private pages
- Support Cache-Control (private/no-store/no-cache)
- Support Set-Cookie and Authorization headers
- Add priority order: cache-control > set-cookie > authorization
- Add comprehensive unit tests (10 test cases)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: RecordingLogic - CacheState拡張とPrivacy Cache管理

**Files:**
- Modify: `src/background/recordingLogic.ts:16-22` (CacheState interface)
- Modify: `src/background/recordingLogic.ts:55-61` (static cacheState initialization)
- Test: `src/background/__tests__/recordingLogic.test.ts`

### Step 1: Write the failing test for privacy cache

```typescript
// src/background/__tests__/recordingLogic.test.ts の既存テストに追加
import { RecordingLogic } from '../recordingLogic.js';

describe('RecordingLogic - Privacy Cache', () => {
  beforeEach(() => {
    // キャッシュをクリア
    RecordingLogic.invalidatePrivacyCache();
  });

  test('getPrivacyInfoWithCache - キャッシュヒット時にPrivacyInfoを返す', async () => {
    const url = 'https://example.com/private';
    const mockInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };

    // キャッシュに手動で追加
    RecordingLogic.cacheState.privacyCache = new Map([[url, mockInfo]]);
    RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();

    const obsidian = {} as any;
    const aiClient = {} as any;
    const logic = new RecordingLogic(obsidian, aiClient);

    const result = await logic.getPrivacyInfoWithCache(url);

    expect(result).toEqual(mockInfo);
  });

  test('getPrivacyInfoWithCache - キャッシュミス時にnullを返す', async () => {
    const url = 'https://example.com/unknown';

    RecordingLogic.cacheState.privacyCache = new Map();

    const obsidian = {} as any;
    const aiClient = {} as any;
    const logic = new RecordingLogic(obsidian, aiClient);

    const result = await logic.getPrivacyInfoWithCache(url);

    expect(result).toBeNull();
  });

  test('getPrivacyInfoWithCache - TTL期限切れ時にnullを返す', async () => {
    const url = 'https://example.com/expired';
    const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6分前
    const mockInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: oldTimestamp
    };

    RecordingLogic.cacheState.privacyCache = new Map([[url, mockInfo]]);
    RecordingLogic.cacheState.privacyCacheTimestamp = oldTimestamp;

    const obsidian = {} as any;
    const aiClient = {} as any;
    const logic = new RecordingLogic(obsidian, aiClient);

    const result = await logic.getPrivacyInfoWithCache(url);

    expect(result).toBeNull();
  });

  test('invalidatePrivacyCache - キャッシュを無効化できる', () => {
    RecordingLogic.cacheState.privacyCache = new Map([['test', {} as any]]);
    RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();

    RecordingLogic.invalidatePrivacyCache();

    expect(RecordingLogic.cacheState.privacyCache).toBeNull();
    expect(RecordingLogic.cacheState.privacyCacheTimestamp).toBeNull();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- src/background/__tests__/recordingLogic.test.ts -t "Privacy Cache"`

Expected: FAIL with "Property 'privacyCache' does not exist on type 'CacheState'"

### Step 3: Implement CacheState extension and cache methods

```typescript
// src/background/recordingLogic.ts

// CacheState interface拡張 (line 16-22)
interface CacheState {
  settingsCache: Settings | null;
  cacheTimestamp: number | null;
  cacheVersion: number;
  urlCache: Map<string, number> | null;
  urlCacheTimestamp: number | null;
  // 新規追加
  privacyCache: Map<string, PrivacyInfo> | null;
  privacyCacheTimestamp: number | null;
}

// Import追加 (ファイル先頭)
import type { PrivacyInfo } from '../utils/privacyChecker.js';

// static cacheState初期化 (line 55-61)
static cacheState: CacheState = {
  settingsCache: null,
  cacheTimestamp: null,
  cacheVersion: 0,
  urlCache: null,
  urlCacheTimestamp: null,
  privacyCache: null,
  privacyCacheTimestamp: null
};

// 新規メソッド追加 (line 170の前に追加)
/**
 * URLのプライバシー情報をキャッシュから取得する
 * TTL: 5分
 */
async getPrivacyInfoWithCache(url: string): Promise<PrivacyInfo | null> {
  const now = Date.now();
  const PRIVACY_CACHE_TTL = 5 * 60 * 1000; // 5分

  if (RecordingLogic.cacheState.privacyCache) {
    const cached = RecordingLogic.cacheState.privacyCache.get(url);
    if (cached && (now - cached.timestamp) < PRIVACY_CACHE_TTL) {
      addLog(LogType.DEBUG, 'Privacy cache hit', { url });
      return cached;
    }
  }

  // キャッシュミス: ヘッダー情報がまだ収集されていない
  addLog(LogType.DEBUG, 'Privacy check skipped: no header data', { url });
  return null;
}

/**
 * プライバシーキャッシュを無効化する
 */
static invalidatePrivacyCache(): void {
  addLog(LogType.DEBUG, 'Privacy cache invalidated');
  RecordingLogic.cacheState.privacyCache = null;
  RecordingLogic.cacheState.privacyCacheTimestamp = null;
}
```

### Step 4: Run test to verify it passes

Run: `npm test -- src/background/__tests__/recordingLogic.test.ts -t "Privacy Cache"`

Expected: PASS (4 tests)

### Step 5: Commit

```bash
git add src/background/recordingLogic.ts src/background/__tests__/recordingLogic.test.ts
git commit -m "feat(privacy): add privacy cache to RecordingLogic

- Extend CacheState with privacyCache and privacyCacheTimestamp
- Add getPrivacyInfoWithCache() method with 5-min TTL
- Add invalidatePrivacyCache() static method
- Add unit tests for cache hit/miss/expiry

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Header Detector - webRequest監視とキャッシュ保存

**Files:**
- Create: `src/background/headerDetector.ts`
- Create: `src/background/__tests__/headerDetector.test.ts`

### Step 1: Write the failing test for HeaderDetector

```typescript
// src/background/__tests__/headerDetector.test.ts
import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { HeaderDetector } from '../headerDetector.js';
import { RecordingLogic } from '../recordingLogic.js';

describe('HeaderDetector', () => {
  beforeEach(() => {
    RecordingLogic.invalidatePrivacyCache();
  });

  describe('cachePrivacyInfo', () => {
    test('プライベート情報をキャッシュに保存できる', () => {
      const url = 'https://example.com/test';
      const info = {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      };

      HeaderDetector['cachePrivacyInfo'](url, info);

      expect(RecordingLogic.cacheState.privacyCache).not.toBeNull();
      expect(RecordingLogic.cacheState.privacyCache?.get(url)).toEqual(info);
    });

    test('キャッシュサイズが100を超えたら最も古いエントリを削除する', () => {
      // 100エントリを追加
      for (let i = 0; i < 100; i++) {
        HeaderDetector['cachePrivacyInfo'](`https://example.com/test${i}`, {
          isPrivate: false,
          timestamp: Date.now() + i
        });
      }

      expect(RecordingLogic.cacheState.privacyCache?.size).toBe(100);

      // 101個目を追加
      HeaderDetector['cachePrivacyInfo']('https://example.com/test100', {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now() + 1000
      });

      // サイズは100のまま（最も古いエントリが削除される）
      expect(RecordingLogic.cacheState.privacyCache?.size).toBe(100);
      // 最古のエントリ(test0)が削除されている
      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/test0')).toBe(false);
      // 最新のエントリ(test100)は存在する
      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/test100')).toBe(true);
    });
  });

  describe('onHeadersReceived', () => {
    test('メインフレームのHTMLレスポンスを処理できる', () => {
      const details = {
        url: 'https://example.com/page',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      const cached = RecordingLogic.cacheState.privacyCache?.get('https://example.com/page');
      expect(cached).toBeDefined();
      expect(cached?.isPrivate).toBe(true);
      expect(cached?.reason).toBe('cache-control');
    });

    test('サブフレームは無視する', () => {
      const details = {
        url: 'https://example.com/iframe',
        type: 'sub_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/iframe')).toBe(false);
    });

    test('非HTMLリソースは無視する', () => {
      const details = {
        url: 'https://example.com/image.png',
        type: 'main_frame' as chrome.webRequest.ResourceType,
        responseHeaders: [
          { name: 'Content-Type', value: 'image/png' },
          { name: 'Cache-Control', value: 'private' }
        ]
      } as chrome.webRequest.WebResponseHeadersDetails;

      HeaderDetector['onHeadersReceived'](details);

      expect(RecordingLogic.cacheState.privacyCache?.has('https://example.com/image.png')).toBe(false);
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- src/background/__tests__/headerDetector.test.ts`

Expected: FAIL with "Cannot find module '../headerDetector.js'"

### Step 3: Write minimal implementation

```typescript
// src/background/headerDetector.ts
import { checkPrivacy, PrivacyInfo } from '../utils/privacyChecker.js';
import { RecordingLogic } from './recordingLogic.js';
import { addLog, LogType } from '../utils/logger.js';

const MAX_CACHE_SIZE = 100;

export class HeaderDetector {
  /**
   * webRequest.onHeadersReceivedリスナーを初期化する
   */
  static initialize(): void {
    if (!chrome.webRequest) {
      addLog(LogType.ERROR, 'webRequest API not available');
      return;
    }

    chrome.webRequest.onHeadersReceived.addListener(
      HeaderDetector.onHeadersReceived,
      {
        urls: ['<all_urls>'],
        types: ['main_frame']
      },
      ['responseHeaders']
    );

    addLog(LogType.INFO, 'HeaderDetector initialized');
  }

  /**
   * HTTPレスポンスヘッダーを受信した際の処理
   */
  private static onHeadersReceived(details: chrome.webRequest.WebResponseHeadersDetails): void {
    try {
      // メインフレームのHTMLのみ処理
      if (details.type !== 'main_frame') {
        return;
      }

      // Content-Typeチェック（HTMLのみ）
      const contentType = details.responseHeaders?.find(
        h => h.name?.toLowerCase() === 'content-type'
      );
      if (!contentType?.value?.includes('text/html')) {
        return;
      }

      // プライバシー判定
      const headers = details.responseHeaders || [];
      const privacyInfo = checkPrivacy(headers);

      // キャッシュに保存
      HeaderDetector.cachePrivacyInfo(details.url, privacyInfo);

      if (privacyInfo.isPrivate) {
        addLog(LogType.DEBUG, 'Privacy info cached', {
          url: details.url,
          reason: privacyInfo.reason
        });
      }
    } catch (error: any) {
      // エラーは握りつぶしてログのみ記録
      addLog(LogType.ERROR, 'HeaderDetector error', {
        error: error.message,
        url: details.url
      });
    }
  }

  /**
   * プライバシー情報をキャッシュに保存する
   * キャッシュサイズが上限を超えたら最も古いエントリを削除
   */
  private static cachePrivacyInfo(url: string, info: PrivacyInfo): void {
    if (!RecordingLogic.cacheState.privacyCache) {
      RecordingLogic.cacheState.privacyCache = new Map();
      RecordingLogic.cacheState.privacyCacheTimestamp = Date.now();
    }

    // キャッシュサイズ制限チェック
    if (RecordingLogic.cacheState.privacyCache.size >= MAX_CACHE_SIZE) {
      HeaderDetector.evictOldestEntry();
    }

    RecordingLogic.cacheState.privacyCache.set(url, info);
  }

  /**
   * 最も古いキャッシュエントリを削除する（LRU実装）
   */
  private static evictOldestEntry(): void {
    const cache = RecordingLogic.cacheState.privacyCache;
    if (!cache || cache.size === 0) {
      return;
    }

    // timestampが最小のエントリを見つけて削除
    let oldestUrl: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [url, info] of cache.entries()) {
      if (info.timestamp < oldestTimestamp) {
        oldestTimestamp = info.timestamp;
        oldestUrl = url;
      }
    }

    if (oldestUrl) {
      cache.delete(oldestUrl);
      addLog(LogType.DEBUG, 'Evicted oldest privacy cache entry', { url: oldestUrl });
    }
  }
}
```

### Step 4: Run test to verify it passes

Run: `npm test -- src/background/__tests__/headerDetector.test.ts`

Expected: PASS (5 tests)

### Step 5: Commit

```bash
git add src/background/headerDetector.ts src/background/__tests__/headerDetector.test.ts
git commit -m "feat(privacy): add HeaderDetector with webRequest monitoring

- Implement HeaderDetector.initialize() for webRequest listener
- Monitor main_frame HTML responses only
- Cache privacy info with 100-entry LRU eviction
- Add unit tests for caching and filtering logic

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: RecordingLogic - プライバシーチェック統合

**Files:**
- Modify: `src/background/recordingLogic.ts:171-196`
- Modify: `src/background/recordingLogic.ts:34-49` (RecordingResult interface)
- Test: `src/background/__tests__/recordingLogic.test.ts`

### Step 1: Write the failing test for PRIVATE_PAGE_DETECTED error

```typescript
// src/background/__tests__/recordingLogic.test.ts に追加

describe('RecordingLogic - Privacy Check Integration', () => {
  beforeEach(() => {
    RecordingLogic.invalidatePrivacyCache();
    // 既存のmock setupをここにコピー
  });

  test('プライベートページの場合 PRIVATE_PAGE_DETECTED エラーを返す', async () => {
    const url = 'https://example.com/private';
    const mockPrivacyInfo = {
      isPrivate: true,
      reason: 'cache-control' as const,
      timestamp: Date.now()
    };

    // キャッシュに追加
    RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

    // mock setup (既存のテストコードを参考)
    const mockObsidian = { appendToDailyNote: jest.fn() } as any;
    const mockAiClient = {} as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Test',
      url,
      content: 'content'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    expect(result.reason).toBe('cache-control');
  });

  test('force=true の場合はプライバシーチェックをスキップする', async () => {
    const url = 'https://example.com/private';
    const mockPrivacyInfo = {
      isPrivate: true,
      reason: 'set-cookie' as const,
      timestamp: Date.now()
    };

    RecordingLogic.cacheState.privacyCache = new Map([[url, mockPrivacyInfo]]);

    // mock setup
    const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
    const mockAiClient = {
      generateSummary: jest.fn().mockResolvedValue('summary')
    } as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Test',
      url,
      content: 'content',
      force: true
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  test('キャッシュミス時は通常通り保存を続行する', async () => {
    const url = 'https://example.com/unknown';

    RecordingLogic.cacheState.privacyCache = new Map();

    const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
    const mockAiClient = {
      generateSummary: jest.fn().mockResolvedValue('summary')
    } as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Test',
      url,
      content: 'content'
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify it fails

Run: `npm test -- src/background/__tests__/recordingLogic.test.ts -t "Privacy Check Integration"`

Expected: FAIL with "Property 'reason' does not exist on type 'RecordingResult'"

### Step 3: Implement privacy check in record() method

```typescript
// src/background/recordingLogic.ts

// RecordingResult interface拡張 (line 34-49)
export interface RecordingResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string; // 新規追加: PRIVATE_PAGE_DETECTEDの理由
  summary?: string;
  title?: string;
  url?: string;
  preview?: boolean;
  processedContent?: string;
  mode?: string;
  maskedCount?: number;
  maskedItems?: any[];
  aiDuration?: number;
}

// record()メソッド内にプライバシーチェックを追加 (line 171-196)
async record(data: RecordingData): Promise<RecordingResult> {
  let { title, url, content, force = false, skipDuplicateCheck = false, alreadyProcessed = false, previewOnly = false } = data;
  const MAX_RECORD_SIZE = 64 * 1024;

  try {
    // 0. Content Truncation
    if (content && content.length > MAX_RECORD_SIZE) {
      addLog(LogType.WARN, 'Content truncated for recording', {
        originalLength: content.length,
        truncatedLength: MAX_RECORD_SIZE,
        url
      });
      content = content.substring(0, MAX_RECORD_SIZE);
    }

    // 1. Check domain filter (既存)
    const isAllowed = await isDomainAllowed(url);

    if (!isAllowed && !force) {
      return { success: false, error: 'DOMAIN_BLOCKED' };
    }

    if (!isAllowed && force) {
      addLog(LogType.WARN, 'Force recording blocked domain', { url });
    }

    // 1.5. Check privacy headers (新規)
    const privacyInfo = await this.getPrivacyInfoWithCache(url);
    if (privacyInfo?.isPrivate && !force) {
      addLog(LogType.WARN, 'Private page detected', {
        url,
        reason: privacyInfo.reason
      });
      return {
        success: false,
        error: 'PRIVATE_PAGE_DETECTED',
        reason: privacyInfo.reason
      };
    }

    if (privacyInfo?.isPrivate && force) {
      addLog(LogType.WARN, 'Force recording private page', {
        url,
        reason: privacyInfo.reason
      });
    }

    // 2. Check for duplicates (既存の処理)
    // ... 以降は既存コードのまま ...
  }
}
```

### Step 4: Run test to verify it passes

Run: `npm test -- src/background/__tests__/recordingLogic.test.ts -t "Privacy Check Integration"`

Expected: PASS (3 tests)

### Step 5: Commit

```bash
git add src/background/recordingLogic.ts src/background/__tests__/recordingLogic.test.ts
git commit -m "feat(privacy): integrate privacy check into RecordingLogic

- Add privacy check after domain filter in record()
- Return PRIVATE_PAGE_DETECTED error with reason
- Support force flag to override privacy check
- Continue saving on cache miss (no header data)
- Add unit tests for integration scenarios

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Service Worker - HeaderDetector初期化

**Files:**
- Modify: `src/background/service-worker.ts` (import and initialization)

### Step 1: No test needed for service worker initialization

(Service worker initialization is typically tested manually or with E2E tests)

### Step 2: Add HeaderDetector initialization to service-worker

```typescript
// src/background/service-worker.ts

// Import追加 (ファイル先頭)
import { HeaderDetector } from './headerDetector.js';

// chrome.runtime.onInstalled リスナー内に追加
chrome.runtime.onInstalled.addListener((details) => {
  // ... 既存の初期化処理 ...

  // HeaderDetector初期化
  HeaderDetector.initialize();

  // ... 既存のログ出力など ...
});

// chrome.runtime.onStartup リスナー内に追加
chrome.runtime.onStartup.addListener(() => {
  // HeaderDetector初期化
  HeaderDetector.initialize();

  // ... 既存の初期化処理 ...
});
```

### Step 3: Build and verify no TypeScript errors

Run: `npm run build`

Expected: SUCCESS (no compilation errors)

### Step 4: Commit

```bash
git add src/background/service-worker.ts
git commit -m "feat(privacy): initialize HeaderDetector in service worker

- Add HeaderDetector.initialize() to onInstalled listener
- Add HeaderDetector.initialize() to onStartup listener
- Ensure webRequest listener is registered on extension startup

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: manifest.json - webRequest permission追加

**Files:**
- Modify: `manifest.json:15-24` (permissions array)

### Step 1: No test needed for manifest changes

(Manifest changes are validated by Chrome during extension load)

### Step 2: Add webRequest permission

```json
// manifest.json
{
  "permissions": [
    "tabs",
    "storage",
    "scripting",
    "identity",
    "notifications",
    "offscreen",
    "favicon",
    "unlimitedStorage",
    "webRequest"
  ]
}
```

### Step 3: Verify manifest is valid JSON

Run: `npx jsonlint manifest.json`

Expected: Valid JSON

### Step 4: Commit

```bash
git add manifest.json
git commit -m "feat(privacy): add webRequest permission to manifest

- Add webRequest to permissions array
- Required for HeaderDetector to monitor HTTP response headers
- Read-only usage, no blocking behavior

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: i18n - 警告メッセージの多言語対応

**Files:**
- Modify: `_locales/en/messages.json`
- Modify: `_locales/ja/messages.json`

### Step 1: No test needed for i18n messages

(i18n messages are tested manually or with UI tests)

### Step 2: Add English messages

```json
// _locales/en/messages.json に追加
{
  "privatePageWarning": {
    "message": "This page may contain private information (detected: $REASON$). Save anyway?",
    "placeholders": {
      "reason": {
        "content": "$1"
      }
    }
  },
  "privatePageReason_cacheControl": {
    "message": "private cache headers"
  },
  "privatePageReason_setCookie": {
    "message": "authentication cookies"
  },
  "privatePageReason_authorization": {
    "message": "authorization headers"
  }
}
```

### Step 3: Add Japanese messages

```json
// _locales/ja/messages.json に追加
{
  "privatePageWarning": {
    "message": "このページには個人情報が含まれている可能性があります（検出理由: $REASON$）。それでも保存しますか?",
    "placeholders": {
      "reason": {
        "content": "$1"
      }
    }
  },
  "privatePageReason_cacheControl": {
    "message": "プライベートキャッシュヘッダー"
  },
  "privatePageReason_setCookie": {
    "message": "認証Cookie"
  },
  "privatePageReason_authorization": {
    "message": "認証ヘッダー"
  }
}
```

### Step 4: Verify JSON is valid

Run: `npx jsonlint _locales/en/messages.json && npx jsonlint _locales/ja/messages.json`

Expected: Valid JSON

### Step 5: Commit

```bash
git add _locales/en/messages.json _locales/ja/messages.json
git commit -m "feat(i18n): add private page warning messages

- Add privatePageWarning message with reason placeholder
- Add reason-specific messages (cache-control, set-cookie, authorization)
- Support both English and Japanese locales

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Content Script - PRIVATE_PAGE_DETECTED処理

**Files:**
- Modify: `src/content/extractor.ts` (error handling in record flow)

### Step 1: No automated test (requires browser environment)

(Content script error handling is tested manually or with E2E tests)

### Step 2: Add PRIVATE_PAGE_DETECTED handling

```typescript
// src/content/extractor.ts
// recordボタンのクリックハンドラー、または自動記録処理の中に追加

// 既存のrecordメッセージ送信部分を探して、その後に追加
const result = await chrome.runtime.sendMessage({
  action: 'record',
  data: { title, url, content }
});

// エラーハンドリング追加
if (result.error === 'DOMAIN_BLOCKED') {
  // 既存のDOMAIN_BLOCKED処理...
}

// 新規追加: PRIVATE_PAGE_DETECTED処理
if (result.error === 'PRIVATE_PAGE_DETECTED') {
  const reasonKey = `privatePageReason_${result.reason}`;
  const reason = chrome.i18n.getMessage(reasonKey) || result.reason || 'unknown';
  const message = chrome.i18n.getMessage('privatePageWarning', [reason]);

  const userConfirmed = confirm(message);

  if (userConfirmed) {
    // force flagを立てて再送信
    await chrome.runtime.sendMessage({
      action: 'record',
      data: { title, url, content, force: true }
    });
  }
  return;
}
```

### Step 3: Build and verify no TypeScript errors

Run: `npm run build`

Expected: SUCCESS

### Step 4: Commit

```bash
git add src/content/extractor.ts
git commit -m "feat(privacy): handle PRIVATE_PAGE_DETECTED in content script

- Add error handling for PRIVATE_PAGE_DETECTED
- Show i18n warning dialog with detected reason
- Retry with force=true if user confirms
- Use chrome.i18n.getMessage for localized messages

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Popup - 手動保存時のPRIVATE_PAGE_DETECTED処理

**Files:**
- Modify: `src/popup/popup.ts` (manual save button handler)

### Step 1: No automated test (requires browser environment)

(Popup script is tested manually or with E2E tests)

### Step 2: Add PRIVATE_PAGE_DETECTED handling to popup

```typescript
// src/popup/popup.ts
// 手動保存ボタンのクリックハンドラー内に追加

// 既存の保存処理を探して、結果ハンドリングに追加
const result = await chrome.runtime.sendMessage({
  action: 'record',
  data: { title, url, content }
});

if (result.success) {
  // 既存の成功処理...
}

// エラーハンドリング
if (result.error === 'DOMAIN_BLOCKED') {
  // 既存のDOMAIN_BLOCKED処理...
}

// 新規追加: PRIVATE_PAGE_DETECTED処理
if (result.error === 'PRIVATE_PAGE_DETECTED') {
  const reasonKey = `privatePageReason_${result.reason}`;
  const reason = chrome.i18n.getMessage(reasonKey) || result.reason || 'unknown';
  const message = chrome.i18n.getMessage('privatePageWarning', [reason]);

  const userConfirmed = confirm(message);

  if (userConfirmed) {
    // force flagを立てて再送信
    const retryResult = await chrome.runtime.sendMessage({
      action: 'record',
      data: { title, url, content, force: true }
    });

    if (retryResult.success) {
      // 成功時の処理（既存コードを再利用）
    }
  }
  return;
}
```

### Step 3: Build and verify no TypeScript errors

Run: `npm run build`

Expected: SUCCESS

### Step 4: Commit

```bash
git add src/popup/popup.ts
git commit -m "feat(privacy): handle PRIVATE_PAGE_DETECTED in popup

- Add error handling for manual save button
- Show i18n warning dialog with detected reason
- Retry with force=true if user confirms
- Consistent UX with content script handling

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Integration Tests - RecordingLogic全体フロー

**Files:**
- Modify: `src/background/__tests__/recordingLogic.test.ts`

### Step 1: Write integration test scenarios

```typescript
// src/background/__tests__/recordingLogic.test.ts に追加

describe('RecordingLogic - Privacy Integration (Full Flow)', () => {
  beforeEach(() => {
    RecordingLogic.invalidatePrivacyCache();
    RecordingLogic.invalidateSettingsCache();
    RecordingLogic.invalidateUrlCache();
  });

  test('プライベートページ → 警告 → キャンセル → 保存されない', async () => {
    const url = 'https://bank.example.com/account';

    // ヘッダー検出をシミュレート
    RecordingLogic.cacheState.privacyCache = new Map([
      [url, {
        isPrivate: true,
        reason: 'cache-control' as const,
        timestamp: Date.now()
      }]
    ]);

    const mockObsidian = { appendToDailyNote: jest.fn() } as any;
    const mockAiClient = {} as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Bank Account',
      url,
      content: 'private data'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('PRIVATE_PAGE_DETECTED');
    expect(result.reason).toBe('cache-control');
    expect(mockObsidian.appendToDailyNote).not.toHaveBeenCalled();
  });

  test('プライベートページ → 警告 → 強制保存 → 保存される', async () => {
    const url = 'https://bank.example.com/account';

    RecordingLogic.cacheState.privacyCache = new Map([
      [url, {
        isPrivate: true,
        reason: 'set-cookie' as const,
        timestamp: Date.now()
      }]
    ]);

    const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
    const mockAiClient = {
      generateSummary: jest.fn().mockResolvedValue('summary')
    } as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    // force=true で再試行
    const result = await logic.record({
      title: 'Bank Account',
      url,
      content: 'private data',
      force: true
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  test('通常ページ → 警告なし → 保存される', async () => {
    const url = 'https://public.example.com/article';

    RecordingLogic.cacheState.privacyCache = new Map([
      [url, {
        isPrivate: false,
        timestamp: Date.now()
      }]
    ]);

    const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
    const mockAiClient = {
      generateSummary: jest.fn().mockResolvedValue('summary')
    } as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Public Article',
      url,
      content: 'public content'
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });

  test('キャッシュなし(ヘッダー未取得) → 保存継続', async () => {
    const url = 'https://unknown.example.com/page';

    RecordingLogic.cacheState.privacyCache = new Map();

    const mockObsidian = { appendToDailyNote: jest.fn().mockResolvedValue(undefined) } as any;
    const mockAiClient = {
      generateSummary: jest.fn().mockResolvedValue('summary')
    } as any;
    const logic = new RecordingLogic(mockObsidian, mockAiClient);

    const result = await logic.record({
      title: 'Unknown Page',
      url,
      content: 'content'
    });

    expect(result.success).toBe(true);
    expect(mockObsidian.appendToDailyNote).toHaveBeenCalled();
  });
});
```

### Step 2: Run tests to verify they pass

Run: `npm test -- src/background/__tests__/recordingLogic.test.ts -t "Privacy Integration"`

Expected: PASS (4 tests)

### Step 3: Commit

```bash
git add src/background/__tests__/recordingLogic.test.ts
git commit -m "test(privacy): add integration tests for full privacy flow

- Test private page detection with cancel scenario
- Test private page detection with force save scenario
- Test public page (no warning) scenario
- Test cache miss (header not yet fetched) scenario

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Documentation - CHANGELOG更新

**Files:**
- Modify: `CHANGELOG.md`

### Step 1: No test needed for documentation

### Step 2: Add CHANGELOG entry

```markdown
<!-- CHANGELOG.md の先頭に追加 -->

## [Unreleased]

### Added
- **Private Page Detection**: Automatic detection of private pages using HTTP headers
  - Monitor Cache-Control (private/no-store/no-cache)
  - Monitor Set-Cookie headers
  - Monitor Authorization headers
  - Show warning dialog before saving private pages
  - Support force save with user confirmation
  - 5-minute cache with 100-entry LRU eviction
- Add `webRequest` permission to manifest.json
- Add i18n messages for privacy warnings (en/ja)

### Changed
- RecordingLogic now checks privacy headers after domain filter
- Return `PRIVATE_PAGE_DETECTED` error with reason for private pages

### Technical Details
- New modules: `privacyChecker.ts`, `headerDetector.ts`
- Extended `RecordingLogic.cacheState` with privacy cache
- HeaderDetector initialized in service worker startup
- Content script and popup handle `PRIVATE_PAGE_DETECTED` error
```

### Step 3: Commit

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for private page detection feature

- Document new privacy detection feature
- List added modules and API changes
- Note new webRequest permission requirement

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Manual Testing - 動作確認

**Manual Testing Checklist:**

1. **拡張機能のビルドとロード**
   ```bash
   npm run build
   # Chrome -> 拡張機能 -> デベロッパーモード -> パッケージ化されていない拡張機能を読み込む
   # dist/ フォルダを選択
   ```

2. **webRequest permission確認**
   - 拡張機能の詳細 -> 権限 -> "ウェブリクエストの監視" が表示されることを確認

3. **Cache-Control: private ページのテスト**
   - 銀行サイトや会員制サイトにアクセス
   - 自動記録または手動保存を試行
   - 警告ダイアログが表示されることを確認
   - キャンセル → 保存されないことを確認
   - 再度保存 → "保存する" → 保存されることを確認

4. **Set-Cookie ページのテスト**
   - ログイン後のページにアクセス
   - DevTools -> Network -> Headers で Set-Cookie を確認
   - 保存試行 → 警告表示を確認

5. **通常ページ(パブリック)のテスト**
   - Wikipedia や公開ブログにアクセス
   - 警告なしで保存されることを確認

6. **キャッシュTTLのテスト**
   - プライベートページにアクセス
   - 5分待機
   - 再度保存試行 → キャッシュ期限切れでログに "Privacy check skipped" が出力されることを確認

7. **i18nメッセージのテスト**
   - Chrome言語設定を英語に変更 → 英語メッセージ表示を確認
   - 日本語に変更 → 日本語メッセージ表示を確認

**Expected Results:**
- すべてのシナリオで期待通りの動作
- エラーログなし
- パフォーマンス劣化なし

---

## Summary

以上で、Private Page Detection機能の実装が完了します。

**実装したコンポーネント:**
1. Privacy Checker (型定義とヘッダー判定ロジック)
2. RecordingLogic (キャッシュ管理とプライバシーチェック統合)
3. HeaderDetector (webRequest監視とキャッシュ保存)
4. Service Worker初期化
5. manifest.json (webRequest permission)
6. i18n メッセージ (en/ja)
7. Content Script/Popup (エラーハンドリング)
8. 統合テスト
9. ドキュメント更新

**テスト戦略:**
- ユニットテスト: Privacy Checker, HeaderDetector, RecordingLogic (45+ tests)
- 統合テスト: Full privacy flow (4 scenarios)
- 手動テスト: ブラウザ環境での動作確認

**次のステップ:**
- 手動テストの実施
- 必要に応じてバグ修正
- バージョン番号の更新
- リリース準備
