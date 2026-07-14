# Domain Whitelist Extraction Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Togetter・5chまとめブログ・ガールズちゃんねる・Yahoo!知恵袋・小説投稿サイト（なろう/カクヨム）・レシピサイト（クックパッド/クラシル）向けに、「引き算方式」とは独立した「ホワイトリスト（狙い撃ち）抽出モード」を実装し、AI要約の精度を大幅に改善する。

**Architecture:** 新規モジュール `src/utils/contentExtractor/whitelistAdapters.ts` に6つのサイトアダプタ（`domains`, `detectSelector`, `contentSelectors` を持つ定義オブジェクト）と、共通の `extractWhitelistedContent()` 実行エンジンを実装する。`extractMainContent()`（`src/utils/contentExtractor/index.ts`）の冒頭で `matchWhitelistAdapter()` を呼び出し、一致すればホワイトリスト抽出を実行して即座に結果を返す。0件抽出時は自動的に既存の `findMainContentCandidates()` パスにフォールバックする。ホワイトリスト抽出後のテキストにはCategory A/Bのstrip処理を適用しない。

**Tech Stack:** TypeScript, Vitest (`@vitest-environment jsdom`), Chrome Extension (Manifest V3)

---

## Task 1: whitelistAdapters.ts の型定義とアダプタ定義配列

**Files:**
- Create: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く（型とアダプタ配列の存在確認）**

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { WHITELIST_ADAPTERS } from '../whitelistAdapters.js';

describe('WHITELIST_ADAPTERS definitions', () => {
  it('defines exactly 6 adapters', () => {
    expect(WHITELIST_ADAPTERS).toHaveLength(6);
  });

  it('each adapter has required fields', () => {
    for (const adapter of WHITELIST_ADAPTERS) {
      expect(typeof adapter.name).toBe('string');
      expect(Array.isArray(adapter.domains)).toBe(true);
      expect(typeof adapter.detectSelector).toBe('string');
      expect(Array.isArray(adapter.contentSelectors)).toBe(true);
      expect(adapter.contentSelectors.length).toBeGreaterThan(0);
    }
  });

  it('includes the Togetter adapter with correct selectors', () => {
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter');
    expect(togetter).toBeDefined();
    expect(togetter?.domains).toContain('togetter.com');
    expect(togetter?.contentSelectors).toContain('.tweet_body');
  });

  it('includes the 5ch matome adapter with empty domains (domain-independent)', () => {
    const matome = WHITELIST_ADAPTERS.find(a => a.name === '5ch-matome');
    expect(matome).toBeDefined();
    expect(matome?.domains).toEqual([]);
  });

  it('includes the naro/kakuyomu adapter', () => {
    const novel = WHITELIST_ADAPTERS.find(a => a.name === 'novel-site');
    expect(novel).toBeDefined();
    expect(novel?.domains).toEqual(expect.arrayContaining(['syosetu.com', 'kakuyomu.jp']));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`
Expected: FAIL — モジュール `../whitelistAdapters.js` が存在しない

- [ ] **Step 3: 最小実装を書く**

`src/utils/contentExtractor/whitelistAdapters.ts` を新規作成する。

```typescript
/**
 * Domain Whitelist Extraction — サイト別ホワイトリスト抽出アダプタ定義
 * ノイズ比率が極端に高いサイト向けに、特定クラスの中身だけを狙い撃ちで抽出する
 */

export interface WhitelistAdapter {
    /** アダプタ識別名（ログ・デバッグ用） */
    name: string;
    /** hostname完全一致またはサフィックス一致で判定。空配列は「ドメイン判定なし」を意味する */
    domains: string[];
    /** このセレクタがDOM上に1件でも存在すればアダプタを適用（ドメイン不一致でも発火） */
    detectSelector: string;
    /** 抽出対象のクラス/ID（複数要素をDOM出現順に結合） */
    contentSelectors: string[];
    /** contentSelectors内でさらに除外したい要素（メタ情報等） */
    excludeSelectors?: string[];
}

export const WHITELIST_ADAPTERS: WhitelistAdapter[] = [
    {
        name: 'togetter',
        domains: ['togetter.com'],
        detectSelector: '.tweet_body',
        contentSelectors: ['.tweet_body', '.item_text'],
    },
    {
        name: '5ch-matome',
        domains: [],
        detectSelector: '.t_b, .res, .reply_body',
        contentSelectors: ['.t_b', '.res', '.reply_body'],
    },
    {
        name: 'girlschannel',
        domains: ['girlschannel.net'],
        detectSelector: '.comment-body',
        contentSelectors: ['.comment-body'],
    },
    {
        name: 'chiebukuro',
        domains: ['chiebukuro.yahoo.co.jp'],
        detectSelector: '[class*="Chie-ItemAnswer"]',
        contentSelectors: ['[class*="Chie-Item"]', '[class*="Chie-ItemAnswer"]'],
    },
    {
        name: 'novel-site',
        domains: ['syosetu.com', 'kakuyomu.jp'],
        detectSelector: '#novel_honbun',
        contentSelectors: ['#novel_honbun'],
    },
    {
        name: 'recipe-site',
        domains: ['cookpad.com', 'kurashiru.com'],
        detectSelector: '.ingredient',
        contentSelectors: ['.ingredient', '.step'],
    },
];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`
Expected: PASS（5件全て）

- [ ] **Step 5: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): WhitelistAdapter 型と6アダプタ定義を追加"
```

---

## Task 2: matchWhitelistAdapter — 検知ロジック（ドメイン判定 + DOMクラス検知）

**Files:**
- Modify: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` の import 文を更新し、以下のテストを追記する。

```typescript
import { WHITELIST_ADAPTERS, matchWhitelistAdapter } from '../whitelistAdapters.js';
```

```typescript
describe('matchWhitelistAdapter', () => {
  it('matches by exact hostname', () => {
    const adapter = matchWhitelistAdapter('togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
  });

  it('matches by hostname suffix (subdomain)', () => {
    const adapter = matchWhitelistAdapter('www.togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
  });

  it('matches by detectSelector even when hostname is unknown (5ch matome)', () => {
    document.body.innerHTML = '<div class="res">レス本文</div>';
    const adapter = matchWhitelistAdapter('random-matome-blog.example.com', document.body);
    expect(adapter?.name).toBe('5ch-matome');
    document.body.innerHTML = '';
  });

  it('matches by detectSelector even when hostname is unrelated (novel site structure)', () => {
    document.body.innerHTML = '<div id="novel_honbun">小説本文</div>';
    const adapter = matchWhitelistAdapter('some-mirror-site.example.com', document.body);
    expect(adapter?.name).toBe('novel-site');
    document.body.innerHTML = '';
  });

  it('returns null when neither domain nor detectSelector matches', () => {
    document.body.innerHTML = '<p>Normal content</p>';
    const adapter = matchWhitelistAdapter('example.com', document.body);
    expect(adapter).toBeNull();
    document.body.innerHTML = '';
  });

  it('domain match takes priority even without detectSelector present', () => {
    document.body.innerHTML = '<p>No tweet_body here</p>';
    const adapter = matchWhitelistAdapter('togetter.com', document.body);
    expect(adapter?.name).toBe('togetter');
    document.body.innerHTML = '';
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "matchWhitelistAdapter"`
Expected: FAIL — `matchWhitelistAdapter is not a function`

- [ ] **Step 3: 最小実装を書く**

`src/utils/contentExtractor/whitelistAdapters.ts` の末尾に追加する。

```typescript
/**
 * hostnameが対象ドメインに一致するか判定（完全一致またはサブドメイン一致）
 */
function matchesDomain(hostname: string, domains: string[]): boolean {
    return domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * hostnameとDOM構造から適用すべきホワイトリストアダプタを判定する
 * 1. domainsに一致するアダプタがあれば即座に返す
 * 2. なければ、detectSelectorがDOM上に存在するアダプタを探して返す
 * 3. どちらもなければ null（ホワイトリストモードを発動しない）
 * @param hostname - location.hostname
 * @param root - 検索対象のルート要素（通常は document.body）
 * @returns 一致したアダプタ、または null
 */
export function matchWhitelistAdapter(hostname: string, root: Element): WhitelistAdapter | null {
    for (const adapter of WHITELIST_ADAPTERS) {
        if (adapter.domains.length > 0 && matchesDomain(hostname, adapter.domains)) {
            return adapter;
        }
    }

    for (const adapter of WHITELIST_ADAPTERS) {
        if (root.querySelector(adapter.detectSelector)) {
            return adapter;
        }
    }

    return null;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "matchWhitelistAdapter"`
Expected: PASS（6件全て）

- [ ] **Step 5: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): matchWhitelistAdapter 検知ロジックを追加"
```

---

## Task 3: extractWhitelistedContent — 抽出エンジン

**Files:**
- Modify: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

import 文を更新し、以下のテストを追記する。

```typescript
import { WHITELIST_ADAPTERS, matchWhitelistAdapter, extractWhitelistedContent } from '../whitelistAdapters.js';
```

```typescript
describe('extractWhitelistedContent', () => {
  it('extracts and joins text from contentSelectors in DOM order', () => {
    document.body.innerHTML = `
      <div class="tweet_body">最初のツイート本文</div>
      <div class="item_text">まとめ主のコメント</div>
      <div class="tweet_body">2番目のツイート本文</div>
    `;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('最初のツイート本文');
    expect(result).toContain('まとめ主のコメント');
    expect(result).toContain('2番目のツイート本文');
    expect(result.indexOf('最初のツイート本文')).toBeLessThan(result.indexOf('まとめ主のコメント'));
    document.body.innerHTML = '';
  });

  it('returns empty string when no contentSelectors match', () => {
    document.body.innerHTML = '<p>Unrelated content</p>';
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toBe('');
    document.body.innerHTML = '';
  });

  it('strips retweet count and @username metadata patterns from extracted text', () => {
    document.body.innerHTML = `<div class="tweet_body">これは本文です @some_user RT(123)</div>`;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('これは本文です');
    expect(result).not.toContain('@some_user');
    expect(result).not.toContain('RT(123)');
    document.body.innerHTML = '';
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "extractWhitelistedContent"`
Expected: FAIL — `extractWhitelistedContent is not a function`

- [ ] **Step 3: 最小実装を書く**

`src/utils/contentExtractor/whitelistAdapters.ts` の末尾に追加する。

```typescript
/**
 * @username 形式のメンション表記を除去する正規表現
 */
const USERNAME_MENTION_PATTERN = /@[A-Za-z0-9_]+/g;

/**
 * RT(数字) 形式のリツイート数表記を除去する正規表現
 */
const RETWEET_COUNT_PATTERN = /RT\(\d+\)/g;

/**
 * 抽出後テキストからメタデータ文字列（メンション・リツイート数）を除去する
 */
function stripExtractionMetadata(text: string): string {
    return text
        .replace(USERNAME_MENTION_PATTERN, '')
        .replace(RETWEET_COUNT_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * ホワイトリストアダプタに従い、contentSelectorsにマッチする要素のテキストを
 * DOM出現順に結合して抽出する
 * @param root - 抽出対象のルート要素（通常は document.body）
 * @param adapter - 適用するアダプタ
 * @returns 抽出・整形されたテキスト。1件もマッチしなければ空文字列
 */
export function extractWhitelistedContent(root: Element, adapter: WhitelistAdapter): string {
    const selector = adapter.contentSelectors.join(', ');
    const elements = root.querySelectorAll(selector);

    if (elements.length === 0) {
        return '';
    }

    const parts: string[] = [];
    elements.forEach(elem => {
        const text = (elem.textContent || '').trim();
        if (text) {
            parts.push(stripExtractionMetadata(text));
        }
    });

    return parts.filter(p => p.length > 0).join('\n\n');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "extractWhitelistedContent"`
Expected: PASS（3件全て）

- [ ] **Step 5: 全アダプタテストを実行**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): extractWhitelistedContent 抽出エンジンを追加"
```

---

## Task 4: ExtractResult 型にホワイトリストモード関連フィールドを追加

**Files:**
- Modify: `src/utils/contentExtractor/types.ts`

- [ ] **Step 1: ExtractResult に3フィールドを追加**

`src/utils/contentExtractor/types.ts` の `fallbackReason?: FallbackReason;` の行の直後に追加する。

```typescript
    whitelistAdapterUsed?: string;       // 発動したホワイトリストアダプタ名（未発動時はundefined）
    whitelistFallbackTriggered?: boolean; // ホワイトリスト抽出0件によりブラックリスト方式にフォールバックしたか
```

- [ ] **Step 2: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし（オプショナルフィールド追加のため既存コードへの影響なし）

- [ ] **Step 3: Commit**

```bash
git add src/utils/contentExtractor/types.ts
git commit -m "feat(whitelist-extraction): ExtractResult にホワイトリストモード関連フィールドを追加"
```

---

## Task 5: extractMainContent への分岐ロジック組み込み

**Files:**
- Modify: `src/utils/contentExtractor/index.ts`
- Test: `src/utils/contentExtractor/__tests__/index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/contentExtractor/__tests__/index.test.ts` の import 文を更新する。

```typescript
import { extractMainContent, isExcludedElement, isAsianContentElement, calculateTextScore } from '../index.js';
```

ファイル末尾に以下のテストブロックを追加する。`location.hostname` のモックには `vi.stubGlobal` は使わず、jsdom の `Object.defineProperty` でオーバーライドする（jsdomの`location`は再定義可能ではないため、`configurable: true` を明示する）。

```typescript
describe('extractMainContent — whitelist extraction mode', () => {
  const originalHostname = window.location.hostname;

  function setHostname(hostname: string) {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    setHostname(originalHostname);
    document.body.innerHTML = '';
  });

  it('uses whitelist extraction when hostname matches togetter.com', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <div class="tweet_body">これはツイート本文です。十分な長さのテキストを含みます。</div>
      <div class="item_text">まとめ主のコメントです。</div>
      <nav>ノイズナビゲーション</nav>
      <div class="ad-banner">広告バナー</div>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('これはツイート本文です');
    expect(result).toContain('まとめ主のコメントです');
    expect(result).not.toContain('ノイズナビゲーション');
    expect(result).not.toContain('広告バナー');
  });

  it('falls back to blacklist extraction when whitelist adapter matches but yields 0 elements', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <article>
        <h1>Fallback Article</h1>
        <p>This is fallback content because no .tweet_body elements exist on this page.</p>
      </article>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('Fallback Article');
  });

  it('does not use whitelist extraction for unrelated domains without matching DOM structure', () => {
    setHostname('example.com');
    document.body.innerHTML = `
      <article>
        <h1>Normal Article</h1>
        <p>This is a normal article on an unrelated domain with sufficient content length.</p>
      </article>
    `;
    const result = extractMainContent(10000, {}, {}, {}) as string;
    expect(result).toContain('Normal Article');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/index.test.ts -t "whitelist extraction mode"`
Expected: FAIL — ホワイトリスト抽出が未実装のため、1件目のテストで `nav`/`ad-banner` のテキストも含まれてしまいFAIL

- [ ] **Step 3: extractMainContent に分岐ロジックを実装**

`src/utils/contentExtractor/index.ts` の import 文に追加する。

```typescript
import { matchWhitelistAdapter, extractWhitelistedContent } from './whitelistAdapters.js';
```

`extractMainContent` 関数内、`try {` ブロックの直後（`pageBytes` 計測の前）に以下を追加する。

```typescript
    try {
        // ホワイトリスト抽出モード判定: ドメイン一致 or DOM構造検知
        if (document.body) {
            const adapter = matchWhitelistAdapter(window.location.hostname, document.body);
            if (adapter) {
                const whitelistedText = extractWhitelistedContent(document.body, adapter);
                if (whitelistedText.length > 0) {
                    const truncated = whitelistedText.length > maxChars
                        ? whitelistedText.slice(0, maxChars)
                        : whitelistedText;
                    if (cleanseOptions.returnInfo) {
                        return {
                            content: truncated,
                            whitelistAdapterUsed: adapter.name,
                        };
                    }
                    return truncated;
                }
                // 0件抽出 — 通常のブラックリスト方式へフォールバック（whitelistFallbackTriggeredは returnInfo 時のみ記録）
            }
        }
```

既存の `pageBytes` 計測処理より前に上記ブロックが実行されるよう配置し、既存コードはそのまま残す（`if (document.body) { pageBytes = ... }` 以降は変更しない）。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/index.test.ts -t "whitelist extraction mode"`
Expected: PASS（3件全て）

- [ ] **Step 5: 既存の contentExtractor テストが壊れていないことを確認**

Run: `npx vitest run src/utils/contentExtractor/__tests__/`
Expected: PASS（全件、既存テストの回帰なし）

- [ ] **Step 6: Commit**

```bash
git add src/utils/contentExtractor/index.ts src/utils/contentExtractor/__tests__/index.test.ts
git commit -m "feat(whitelist-extraction): extractMainContent にホワイトリスト分岐ロジックを組み込み"
```

---

## Task 6: whitelistExtractionEnabled の StorageKey 追加

**Files:**
- Modify: `src/utils/storage/types.ts`
- Modify: `src/utils/storage/defaults.ts`

- [ ] **Step 1: StorageKeys に1キーを追加**

`src/utils/storage/types.ts` の `AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS: 'ai_summary_cleansing_custom_patterns', // カスタムパターン列表` の行の直後に追加する。

```typescript
    // Domain Whitelist Extraction Mode
    WHITELIST_EXTRACTION_ENABLED: 'whitelist_extraction_enabled', // ホワイトリスト抽出モード有効フラグ（デフォルト: true、新規ユーザーのみ）
    MIGRATION_WHITELIST_EXTRACTION_DEFAULT_DONE: 'migration_whitelist_extraction_default_done', // 既存ユーザー移行完了フラグ
```

- [ ] **Step 2: StorageKeyValues に型を追加**

`[StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS]: string[];` の行の直後に追加する。

```typescript
    [StorageKeys.WHITELIST_EXTRACTION_ENABLED]: boolean;
    [StorageKeys.MIGRATION_WHITELIST_EXTRACTION_DEFAULT_DONE]: boolean;
```

- [ ] **Step 3: DEFAULT_SETTINGS に追加**

`src/utils/storage/defaults.ts` の `[StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS]: [],` の行の直後に追加する。

```typescript
    // Domain Whitelist Extraction Mode — default true for new users (existing users migrated to false)
    [StorageKeys.WHITELIST_EXTRACTION_ENABLED]: true,
```

- [ ] **Step 4: TypeScriptビルドと既存テストを確認**

Run: `npm run type-check`
Expected: エラーなし

Run: `npx jest src/utils/__tests__/storage-keys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/storage/types.ts src/utils/storage/defaults.ts
git commit -m "feat(whitelist-extraction): whitelistExtractionEnabled の StorageKey を追加"
```

---

## Task 7: 既存ユーザー向け移行処理

**Files:**
- Modify: `src/utils/migration.ts`

- [ ] **Step 1: migrateWhitelistExtractionDefault 関数を追加**

`src/utils/migration.ts` の `migrateJpLayoutDefault` 関数（または Category B 実装計画で追加した `migrateCategoryBDefault` があればその直後）に、同じロジック構造で以下を追加する。

```typescript
/**
 * Whitelist Extraction デフォルト移行
 * 既存ユーザー（すでにインストール済み）には whitelistExtractionEnabled を明示的に false に設定し、
 * 挙動が突然変わるのを防ぐ。新規ユーザーは DEFAULT_SETTINGS から true を取得する。
 * @returns 移行が実行された場合は true
 */
export async function migrateWhitelistExtractionDefault(): Promise<boolean> {
  const MIGRATION_DONE_KEY = 'migration_whitelist_extraction_default_done';
  const WHITELIST_KEY = 'whitelist_extraction_enabled';

  const result = await chrome.storage.local.get([MIGRATION_DONE_KEY, WHITELIST_KEY]);

  if (result[MIGRATION_DONE_KEY]) {
    return false;
  }

  const hasExistingSetting = result[WHITELIST_KEY] !== undefined;

  if (!hasExistingSetting) {
    const allKeys = await chrome.storage.local.get(null);
    const hasAnyExistingSetting = Object.keys(allKeys).some(k =>
      k !== MIGRATION_DONE_KEY && k !== WHITELIST_KEY
    );

    if (hasAnyExistingSetting) {
      await chrome.storage.local.set({ [WHITELIST_KEY]: false });
      console.log('[Migration] Whitelist extraction default: existing user → set to false');
    }
  }

  await chrome.storage.local.set({ [MIGRATION_DONE_KEY]: true });

  return true;
}
```

- [ ] **Step 2: 移行処理の呼び出し元に追加**

Run: `grep -rn "migrateJpLayoutDefault" src/ --include="*.ts" -l`

呼び出し元ファイルの `await migrateJpLayoutDefault();`（または `migrateCategoryBDefault()`）の直後に以下を追加し、importにも追加する。

```typescript
    await migrateWhitelistExtractionDefault();
```

- [ ] **Step 3: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add src/utils/migration.ts
git commit -m "feat(whitelist-extraction): 既存ユーザー向け移行処理を追加"
```

---

## Task 8: content script（extractor.ts）への配線

**Files:**
- Modify: `src/content/extractor.ts`

- [ ] **Step 1: フラグ変数を追加**

`src/content/extractor.ts` のクレンジング設定フラグ群の末尾（Category B実装済みなら `aiSummaryCleansingVideoSite` の直後、未実装なら `aiSummaryCleansingSpeechBubble` の直後）に追加する。

```typescript
// Domain Whitelist Extraction Mode
let whitelistExtractionEnabled = true;
```

- [ ] **Step 2: 設定読み込み処理に追加**

Run: `grep -n "aiSummaryCleansingSpeechBubble\s*=" src/content/extractor.ts`

出力箇所と同様のパターンで、設定読み込み処理に以下を追加する。

```typescript
        whitelistExtractionEnabled = settings[StorageKeys.WHITELIST_EXTRACTION_ENABLED] ?? true;
```

- [ ] **Step 3: extractMainContent 呼び出し時のオプション渡し処理を確認**

Run: `grep -n "extractMainContent(" src/content/extractor.ts`

`extractMainContent` の第2引数（`cleanseOptions`）に `whitelistExtractionEnabled` フラグを渡す。この値は `extractMainContent` 内部の分岐判定では直接使わず（Task 5 の実装は常時判定するため）、ユーザーが機能を無効化した場合に分岐自体をスキップできるよう、`cleanseOptions` に以下を追加する。

```typescript
                whitelistExtractionEnabled,
```

Task 5 で実装した `extractMainContent` 内の分岐条件を以下のように修正する必要がある（`src/utils/contentExtractor/index.ts` の該当箇所を再度開いて修正する）。

```typescript
        if (document.body && cleanseOptions.whitelistExtractionEnabled !== false) {
            const adapter = matchWhitelistAdapter(window.location.hostname, document.body);
```

`cleanseOptions` の型（`CleanseOptions & { cleanseEnabled?: boolean; returnInfo?: boolean }`）に `whitelistExtractionEnabled?: boolean` を追加する必要があるため、`src/utils/contentExtractor/index.ts` の `extractMainContent` 関数シグネチャの第2引数型を以下のように変更する。

```typescript
export function extractMainContent(
    maxChars: number = 10000,
    cleanseOptions: CleanseOptions & { cleanseEnabled?: boolean; returnInfo?: boolean; whitelistExtractionEnabled?: boolean } = { cleanseEnabled: false },
    aiSummaryCleanseOptions: AiSummaryCleanseOptions & { aiSummaryCleanseEnabled?: boolean } = { aiSummaryCleanseEnabled: false },
    dedupOptions: { dedupEnabled?: boolean; dedupThreshold?: number } = {}
): ExtractResult | string {
```

- [ ] **Step 4: Task 5 のテストが引き続き通ることを確認（デフォルト値がtrue相当で動作すること）**

Run: `npx vitest run src/utils/contentExtractor/__tests__/index.test.ts -t "whitelist extraction mode"`
Expected: PASS（`whitelistExtractionEnabled` を明示的に渡していないテストケースでも `!== false` によりデフォルトで有効化されるため、既存の3テストはそのままPASSする）

- [ ] **Step 5: 無効化テストを追加**

`src/utils/contentExtractor/__tests__/index.test.ts` の `describe('extractMainContent — whitelist extraction mode', ...)` ブロック内に以下を追記する。

```typescript
  it('skips whitelist extraction when whitelistExtractionEnabled is false', () => {
    setHostname('togetter.com');
    document.body.innerHTML = `
      <article>
        <h1>Should use blacklist path</h1>
        <div class="tweet_body">This would be picked up by whitelist mode if enabled.</div>
        <p>Sufficient additional article content to pass scoring thresholds for extraction.</p>
      </article>
    `;
    const result = extractMainContent(10000, { whitelistExtractionEnabled: false }, {}, {}) as string;
    expect(result).toContain('Should use blacklist path');
  });
```

- [ ] **Step 6: テストを実行**

Run: `npx vitest run src/utils/contentExtractor/__tests__/index.test.ts -t "whitelist extraction mode"`
Expected: PASS（4件全て）

- [ ] **Step 7: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 8: Commit**

```bash
git add src/content/extractor.ts src/utils/contentExtractor/index.ts src/utils/contentExtractor/__tests__/index.test.ts
git commit -m "feat(whitelist-extraction): content script に whitelistExtractionEnabled を配線し、無効化を可能にする"
```

---

## Task 9: popup設定UI（aiSummaryCleansingSettingsV2.ts）に全体トグルを追加

**Files:**
- Modify: `src/popup/aiSummaryCleansingSettingsV2.ts`

- [ ] **Step 1: AiSummaryCleansingSettings interface に1フィールドを追加**

`src/popup/aiSummaryCleansingSettingsV2.ts` の interface 定義の末尾（Category B実装済みなら `videoSiteEnabled` の直後、未実装なら `speechBubbleEnabled` の直後）に追加する。

```typescript
    // Domain Whitelist Extraction Mode
    whitelistExtractionEnabled: boolean; // ホワイトリスト抽出モード（デフォルト: true）
```

- [ ] **Step 2: getAiSummaryCleansingSettings に取得処理を追加**

対応する `settings[StorageKeys...] ?? ...` の行の直後に追加する。

```typescript
        whitelistExtractionEnabled: settings[StorageKeys.WHITELIST_EXTRACTION_ENABLED] ?? true,
```

- [ ] **Step 3: saveAiSummaryCleansingSettings への書き込み処理を追加**

Run: `grep -n "AI_SUMMARY_CLEANSING_SPEECH_BUBBLE\] = settings" src/popup/aiSummaryCleansingSettingsV2.ts`

出力箇所（または Category B 実装済みなら `AI_SUMMARY_CLEANSING_VIDEO_SITE` の行）の直後に追加する。

```typescript
    currentSettings[StorageKeys.WHITELIST_EXTRACTION_ENABLED] = settings.whitelistExtractionEnabled;
```

- [ ] **Step 4: DOM要素取得・状態反映・値取得・disabled制御の4箇所に追加**

Run: `grep -n "getElementById('ai-summary-cleansing-speech-bubble')" src/popup/aiSummaryCleansingSettingsV2.ts`

このgrepがヒットする各箇所（DOM取得、チェック状態反映、フォーム送信時取得、disabled制御）それぞれの直後に、以下のパターンで追加する。

DOM要素取得:
```typescript
    const whitelistExtractionCheckbox = document.getElementById('whitelist-extraction-enabled') as HTMLInputElement;
```

チェック状態反映（読み込み時）:
```typescript
    if (whitelistExtractionCheckbox) whitelistExtractionCheckbox.checked = settings.whitelistExtractionEnabled;
```

フォーム送信時の値取得:
```typescript
        whitelistExtractionEnabled: (document.getElementById('whitelist-extraction-enabled') as HTMLInputElement)?.checked ?? true,
```

disabled制御:
```typescript
    if (whitelistExtractionCheckbox) whitelistExtractionCheckbox.disabled = !enabled;
```

- [ ] **Step 5: チェックボックスIDリスト（一括操作用配列）に追加**

`'ai-summary-cleansing-affiliate',` を含む配列（Category B実装済みなら `'ai-summary-cleansing-video-site',` の行）の直後に追加する。

```typescript
        'whitelist-extraction-enabled',
```

- [ ] **Step 6: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add src/popup/aiSummaryCleansingSettingsV2.ts
git commit -m "feat(whitelist-extraction): popup設定UIロジックに全体トグルを追加"
```

---

## Task 10: 設定画面HTML・i18nメッセージの追加

**Files:**
- Modify: `entrypoints/options/index.html`
- Modify: `public/_locales/ja/messages.json`
- Modify: `public/_locales/en/messages.json`

- [ ] **Step 1: 既存チェックボックスのHTML構造を確認**

Run: `grep -n -B 2 -A 3 "ai-summary-cleansing-jp-layout" entrypoints/options/index.html`

この構造をテンプレートとして使う。AI要約クレンジング設定セクションの末尾（他のチェックボックス群の後）に配置する。

- [ ] **Step 2: HTMLにチェックボックスを追加**

Category B実装済みなら `ai-summary-cleansing-video-site` の行の直後、未実装なら `ai-summary-cleansing-speech-bubble` の行の直後に追加する。

```html
            <input type="checkbox" id="whitelist-extraction-enabled">
            <label for="whitelist-extraction-enabled" class="inline-label" data-i18n="whitelistExtractionEnabledDesc">ドメイン別ホワイトリスト抽出モード（Togetter・5chまとめ・知恵袋・小説投稿サイト等でノイズ除去精度を大幅向上）。</label>
```

- [ ] **Step 3: 日本語i18nメッセージを追加**

Run: `grep -n -A 3 "aiSummaryCleansingSpeechBubbleDesc" public/_locales/ja/messages.json`

出力箇所（またはCategory B実装済みなら `aiSummaryCleansingVideoSiteDesc`）の直後に追加する。

```json
  "whitelistExtractionEnabledDesc": {
    "message": "ドメイン別ホワイトリスト抽出モード（Togetter・5chまとめ・知恵袋・小説投稿サイト等でノイズ除去精度を大幅向上）。"
  },
```

- [ ] **Step 4: 英語i18nメッセージを追加**

Run: `grep -n -A 3 "aiSummaryCleansingSpeechBubbleDesc" public/_locales/en/messages.json`

出力箇所の直後に追加する。

```json
  "whitelistExtractionEnabledDesc": {
    "message": "Domain whitelist extraction mode (dramatically improves noise removal accuracy for Togetter, 5ch matome blogs, Q&A sites, novel platforms, etc.)."
  },
```

- [ ] **Step 5: JSON構文を確認**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/_locales/ja/messages.json', 'utf8')); console.log('OK')"`
Expected: `OK`

Run: `node -e "JSON.parse(require('fs').readFileSync('public/_locales/en/messages.json', 'utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add entrypoints/options/index.html public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(whitelist-extraction): 設定画面と i18n メッセージを追加"
```

---

## Task 11: 全体テスト実行とビルド確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行**

Run: `npm test`
Expected: 全テストPASS（既存テストの回帰なし、Task 1〜8で追加したテストが含まれる）

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: `dist/chromium-mv3` にビルド成果物が生成され、エラーなし

- [ ] **Step 4: manifest.test.ts を実行**

Run: `npx jest src/__tests__/manifest.test.ts`
Expected: PASS（今回の変更は新規ファイル `whitelistAdapters.ts` を追加するが、`contentExtractor/` 配下のモジュール分割は既存の `web_accessible_resources` 定義に既に包含されているか確認。含まれていなければ manifest 定義に追記する）

Run: `grep -n "contentExtractor" manifest.json 2>/dev/null || grep -rn "contentExtractor" scripts/update-manifest-from-preset.ts`

もし `contentExtractor/*.js` が個別列挙されておらずワイルドカードや親ディレクトリ単位でカバーされていない場合、`scripts/update-manifest-from-preset.ts` またはマニフェスト定義ソースに `utils/contentExtractor/whitelistAdapters.js` を追加する。

- [ ] **Step 5: CHANGELOG.md にエントリを追加**

`CHANGELOG.md` の最新バージョンエントリの直前（またはUnreleasedセクション）に追記する。

```markdown
### Added
- ドメイン別ホワイトリスト抽出モードを追加（Togetter・5chまとめブログ・ガールズちゃんねる・Yahoo!知恵袋・なろう/カクヨム・クックパッド/クラシル対応）
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG に Domain Whitelist Extraction Mode 追加を記録"
```

---

## E2E Verification Notes（本計画のスコープ外の手動確認事項）

以下は自動テストではカバーしきれないため、実装完了後に手動で確認することを推奨する（設計書 Test Strategy 記載の通り）:

- 実際の Togetter ページで拡張機能を動作させ、`.tweet_body` / `.item_text` が正しく抽出されることを確認
- 実際の Yahoo!知恵袋ページで `[class*="Chie-ItemAnswer"]` セレクタが現行DOM構造と一致するか確認（本計画のセレクタは設計時点の推定であり、実装時に実DOM構造との差異があれば `whitelistAdapters.ts` のセレクタを調整する）
- なろう（syosetu.com）・カクヨム（kakuyomu.jp）はDOM構造が異なるため、`novel-site` アダプタが両サイトで機能するか個別に確認し、必要であればカクヨム専用の `detectSelector`/`contentSelectors` を追加したアダプタに分割する
- クックパッド（cookpad.com）・クラシル（kurashiru.com）も同様に、実際のセレクタ名を確認して調整する

## Self-Review Notes

- **Spec coverage:** 検知ロジック（ドメイン+DOMクラス）、6アダプタ定義、抽出エンジン、`extractMainContent`への完全分岐、0件フォールバック、全体トグル1つでの制御、既存ユーザー移行を全てタスク化した。ページネーション追跡とアダプタ単位個別トグルは設計書で明示的にスコープ外としたため対象外。
- **Placeholder scan:** 全ステップに具体的なコード・テスト・grepコマンドを記載。実サイトのセレクタ精査はE2E Verification Notesとして明示的に切り出し、プレースホルダーではなく既知の制約として記載。
- **Type consistency:** `WhitelistAdapter`（Task 1）→ `matchWhitelistAdapter`/`extractWhitelistedContent`（Task 2-3）→ `ExtractResult.whitelistAdapterUsed`（Task 4）→ `extractMainContent`の`cleanseOptions.whitelistExtractionEnabled`（Task 8）まで、型・関数名を一貫して使用している。
