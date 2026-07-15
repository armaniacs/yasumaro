# Whitelist Extraction New Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domain Whitelist Extraction Mode に、はてなブックマーク・食べログの2アダプタを追加し、サイト固有のメタデータ除去パターンを持てるよう `WhitelistAdapter` を拡張する。

**Architecture:** `WhitelistAdapter` インターフェースに任意フィールド `metadataPatterns?: RegExp[]` を追加する。`extractWhitelistedContent` 内のメタデータ除去処理は、`adapter.metadataPatterns` が指定されていればそれを使い、`undefined` なら既存のTogetter向けデフォルト（`@username`/`RT(数字)`）を適用する後方互換設計とする。`WHITELIST_ADAPTERS` 配列に `hatena-bookmark`（`metadataPatterns: []` で除去処理明示的スキップ）と `tabelog`（星評価・訪問日付除去）の2エントリを追加する。

**Tech Stack:** TypeScript, Vitest (`@vitest-environment jsdom`), Chrome Extension (Manifest V3)

---

## Task 1: `WhitelistAdapter` に `metadataPatterns` フィールドを追加し、`extractWhitelistedContent` を対応させる

**Files:**
- Modify: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く（`metadataPatterns` 指定時・未指定時・空配列時の3パターン）**

`src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` の `describe('extractWhitelistedContent', ...)` ブロックの末尾（`it('strips retweet count and @username metadata patterns from extracted text', ...)` の後）に以下を追記する。

```typescript
  it('uses default metadata patterns when adapter.metadataPatterns is undefined', () => {
    document.body.innerHTML = `<div class="tweet_body">本文です @some_user RT(5)</div>`;
    const togetter = WHITELIST_ADAPTERS.find(a => a.name === 'togetter')!;
    expect(togetter.metadataPatterns).toBeUndefined();
    const result = extractWhitelistedContent(document.body, togetter);
    expect(result).toContain('本文です');
    expect(result).not.toContain('@some_user');
    expect(result).not.toContain('RT(5)');
    document.body.innerHTML = '';
  });

  it('applies adapter-specific metadataPatterns instead of the default when specified', () => {
    document.body.innerHTML = `<div class="custom-review">とても美味しい ★4.5 でした</div>`;
    const customAdapter = {
      name: 'test-custom',
      domains: [],
      detectSelector: '.custom-review',
      contentSelectors: ['.custom-review'],
      metadataPatterns: [/★\s*[\d.]+/g],
    };
    const result = extractWhitelistedContent(document.body, customAdapter);
    expect(result).toContain('とても美味しい');
    expect(result).toContain('でした');
    expect(result).not.toContain('★4.5');
    document.body.innerHTML = '';
  });

  it('applies no metadata removal when adapter.metadataPatterns is an empty array', () => {
    document.body.innerHTML = `<div class="custom-comment">@mention はそのまま残る RT(1) も残る</div>`;
    const customAdapter = {
      name: 'test-no-strip',
      domains: [],
      detectSelector: '.custom-comment',
      contentSelectors: ['.custom-comment'],
      metadataPatterns: [],
    };
    const result = extractWhitelistedContent(document.body, customAdapter);
    expect(result).toContain('@mention はそのまま残る');
    expect(result).toContain('RT(1) も残る');
    document.body.innerHTML = '';
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "metadataPatterns"`
Expected: FAIL — 2番目のテスト（`applies adapter-specific metadataPatterns instead of the default`）が、現状の実装では常にデフォルトパターンを適用するため `★4.5` が除去されず残る。3番目のテスト（`empty array`）も同様に、現状は空配列を無視してデフォルトパターンを適用してしまうため `@mention`/`RT(1)` が除去されてFAILする。1番目のテスト（`undefined` 時にデフォルト適用）は現状の実装でもPASSする想定（型定義に `metadataPatterns` フィールドがまだ存在しないため、この時点ではTypeScriptの型エラーが先に出る可能性がある。その場合はStep 2の実行結果としてコンパイルエラーも許容する）

- [ ] **Step 3: `WhitelistAdapter` に `metadataPatterns` フィールドを追加する**

`src/utils/contentExtractor/whitelistAdapters.ts` の `WhitelistAdapter` インターフェース定義を以下に変更する。

```typescript
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
    /** サイト固有のメタデータ除去パターン。未指定時は既存デフォルト（@username/RT）を適用。空配列は「除去処理なし」を明示 */
    metadataPatterns?: RegExp[];
}
```

- [ ] **Step 4: `extractWhitelistedContent` のメタデータ除去処理をadapter単位で切り替える**

`src/utils/contentExtractor/whitelistAdapters.ts` の以下の部分を変更する。

変更前:
```typescript
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
```

変更後:
```typescript
/**
 * 既定のメタデータ除去パターン（Togetter等、metadataPatterns未指定のアダプタに適用）
 */
const DEFAULT_METADATA_PATTERNS: RegExp[] = [USERNAME_MENTION_PATTERN, RETWEET_COUNT_PATTERN];

/**
 * 抽出後テキストからメタデータ文字列を除去する
 * @param text - 除去対象のテキスト
 * @param patterns - 適用する正規表現パターンの配列
 */
function stripExtractionMetadata(text: string, patterns: RegExp[]): string {
    let result = text;
    for (const pattern of patterns) {
        result = result.replace(pattern, '');
    }
    return result.replace(/\s+/g, ' ').trim();
}
```

次に `extractWhitelistedContent` 関数内の呼び出し箇所を変更する。

変更前:
```typescript
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

変更後:
```typescript
export function extractWhitelistedContent(root: Element, adapter: WhitelistAdapter): string {
    const selector = adapter.contentSelectors.join(', ');
    const elements = root.querySelectorAll(selector);

    if (elements.length === 0) {
        return '';
    }

    const patterns = adapter.metadataPatterns !== undefined
        ? adapter.metadataPatterns
        : DEFAULT_METADATA_PATTERNS;

    const parts: string[] = [];
    elements.forEach(elem => {
        const text = (elem.textContent || '').trim();
        if (text) {
            parts.push(stripExtractionMetadata(text, patterns));
        }
    });

    return parts.filter(p => p.length > 0).join('\n\n');
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`
Expected: PASS（全件。既存14件 + 新規3件 = 17件）

- [ ] **Step 6: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 7: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): WhitelistAdapter に metadataPatterns フィールドを追加"
```

---

## Task 2: はてなブックマークアダプタを追加する

**Files:**
- Modify: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` の `describe('WHITELIST_ADAPTERS definitions', ...)` ブロック内、`it('includes the naro/kakuyomu adapter', ...)` の後に以下を追記する。同じブロック内の `it('defines exactly 6 adapters', ...)` は Task 3 完了時点（アダプタ数8件）に合わせて更新するため、このタスクでは変更しない。

```typescript
  it('includes the hatena-bookmark adapter', () => {
    const hatena = WHITELIST_ADAPTERS.find(a => a.name === 'hatena-bookmark');
    expect(hatena).toBeDefined();
    expect(hatena?.domains).toContain('b.hatena.ne.jp');
    expect(hatena?.contentSelectors).toContain('.entry-comment-text');
    expect(hatena?.metadataPatterns).toEqual([]);
  });
```

`describe('matchWhitelistAdapter', ...)` ブロック内、`it('domain match takes priority even without detectSelector present', ...)` の後に以下を追記する。

```typescript
  it('matches hatena-bookmark by exact hostname', () => {
    const adapter = matchWhitelistAdapter('b.hatena.ne.jp', document.body);
    expect(adapter?.name).toBe('hatena-bookmark');
  });
```

`describe('extractWhitelistedContent', ...)` ブロック内、Task 1 で追加した3件の後に以下を追記する。

```typescript
  it('extracts hatena-bookmark comment text without metadata stripping', () => {
    document.body.innerHTML = `<div class="entry-comment-text">これは@mentionを含むコメントです RT(9)も含む</div>`;
    const hatena = WHITELIST_ADAPTERS.find(a => a.name === 'hatena-bookmark')!;
    const result = extractWhitelistedContent(document.body, hatena);
    expect(result).toContain('@mentionを含むコメントです');
    expect(result).toContain('RT(9)も含む');
    document.body.innerHTML = '';
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "hatena-bookmark"`
Expected: FAIL — `hatena-bookmark` アダプタがまだ `WHITELIST_ADAPTERS` に存在しないため、`find` の結果が `undefined` になり `adapter?.domains` 等が `undefined` になってアサーションが失敗する

- [ ] **Step 3: `WHITELIST_ADAPTERS` にはてなブックマークアダプタを追加する**

`src/utils/contentExtractor/whitelistAdapters.ts` の `WHITELIST_ADAPTERS` 配列の末尾（`recipe-site` エントリの後）に以下を追加する。

```typescript
    {
        name: 'hatena-bookmark',
        domains: ['b.hatena.ne.jp'],
        detectSelector: '.entry-comment-text',
        contentSelectors: ['.entry-comment-text'],
        metadataPatterns: [],
    },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "hatena-bookmark"`
Expected: PASS（3件全て）

- [ ] **Step 5: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): はてなブックマークアダプタを追加"
```

---

## Task 3: 食べログアダプタを追加する

**Files:**
- Modify: `src/utils/contentExtractor/whitelistAdapters.ts`
- Test: `src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts` の `describe('WHITELIST_ADAPTERS definitions', ...)` ブロック内、Task 2 で追加した `it('includes the hatena-bookmark adapter', ...)` の後に以下を追記する。

```typescript
  it('includes the tabelog adapter with rating/date metadata patterns', () => {
    const tabelog = WHITELIST_ADAPTERS.find(a => a.name === 'tabelog');
    expect(tabelog).toBeDefined();
    expect(tabelog?.domains).toContain('tabelog.com');
    expect(tabelog?.contentSelectors).toContain('.rvw-item__rvw-comment');
    expect(tabelog?.metadataPatterns?.length).toBe(2);
  });
```

同じブロック内、`it('defines exactly 6 adapters', ...)` を以下に置き換える（アダプタ数が8件になったため）。

```typescript
  it('defines exactly 8 adapters', () => {
    expect(WHITELIST_ADAPTERS).toHaveLength(8);
  });
```

`describe('matchWhitelistAdapter', ...)` ブロック内、Task 2 で追加した `it('matches hatena-bookmark by exact hostname', ...)` の後に以下を追記する。

```typescript
  it('matches tabelog by exact hostname', () => {
    const adapter = matchWhitelistAdapter('tabelog.com', document.body);
    expect(adapter?.name).toBe('tabelog');
  });
```

`describe('extractWhitelistedContent', ...)` ブロック内、Task 2 で追加した `it('extracts hatena-bookmark comment text without metadata stripping', ...)` の後に以下を追記する。

```typescript
  it('strips star rating and visit date metadata from tabelog review text', () => {
    document.body.innerHTML = `<div class="rvw-item__rvw-comment">とても美味しかったです ★4.5 2026/3/15訪問 また行きたい</div>`;
    const tabelog = WHITELIST_ADAPTERS.find(a => a.name === 'tabelog')!;
    const result = extractWhitelistedContent(document.body, tabelog);
    expect(result).toContain('とても美味しかったです');
    expect(result).toContain('また行きたい');
    expect(result).not.toContain('★4.5');
    expect(result).not.toContain('2026/3/15訪問');
    document.body.innerHTML = '';
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "tabelog"`
Expected: FAIL — `tabelog` アダプタが `WHITELIST_ADAPTERS` に存在しないため

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts -t "defines exactly 8 adapters"`
Expected: FAIL — 現時点でのアダプタ数は7件（既存6件 + Task 2で追加したhatena-bookmark）

- [ ] **Step 3: `WHITELIST_ADAPTERS` に食べログアダプタを追加する**

`src/utils/contentExtractor/whitelistAdapters.ts` の `WHITELIST_ADAPTERS` 配列の末尾（`hatena-bookmark` エントリの後）に以下を追加する。

```typescript
    {
        name: 'tabelog',
        domains: ['tabelog.com'],
        detectSelector: '.rvw-item__rvw-comment',
        contentSelectors: ['.rvw-item__rvw-comment'],
        metadataPatterns: [/★\s*[\d.]+/g, /\d{4}\/\d{1,2}\/\d{1,2}訪問/g],
    },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts`
Expected: PASS（全件。17件 + 新規4件 = 21件）

- [ ] **Step 5: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/utils/contentExtractor/whitelistAdapters.ts src/utils/contentExtractor/__tests__/whitelistAdapters.test.ts
git commit -m "feat(whitelist-extraction): 食べログアダプタを追加"
```

---

## Task 4: 全体テスト実行とビルド確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: contentExtractor配下の全テストを実行する**

Run: `npx vitest run src/utils/contentExtractor/`
Expected: PASS（全件、既存テストの回帰なし）

- [ ] **Step 3: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テストPASS（既存の無関係な `versionConsistency.test.ts` の `package-lock.json` バージョン不整合を除く）

- [ ] **Step 4: ビルドを実行する**

Run: `npm run build`
Expected: `dist/chromium-mv3` にビルド成果物が生成され、エラーなし

- [ ] **Step 5: CHANGELOG.md にエントリを追加する**

`CHANGELOG.md` の `## [Unreleased]` セクション内、既存の「ドメイン別ホワイトリスト抽出モードを追加」の行の直後に以下を追加する。

```markdown
- ドメイン別ホワイトリスト抽出モードにはてなブックマーク・食べログアダプタを追加
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG にはてなブックマーク・食べログアダプタ追加を記録"
```

---

## E2E Verification Notes（本計画のスコープ外の手動確認事項）

以下は自動テストではカバーしきれないため、実装完了後に手動で確認することを推奨する（設計書 Test Strategy 記載の通り）:

- 実際のはてなブックマークコメントページ（`b.hatena.ne.jp/entry/...`）で `.entry-comment-text` セレクタが現行DOM構造と一致するか確認。本計画のセレクタは設計時点の推定であり、実装時に実DOM構造との差異があれば `whitelistAdapters.ts` のセレクタを調整する
- 実際の食べログレビューページ（`tabelog.com/.../dtlrvwlst/`）で `.rvw-item__rvw-comment` セレクタと `metadataPatterns` の正規表現（星評価・訪問日付の実際の表記ゆれ）が一致するか確認

## Self-Review Notes

- **Spec coverage:** `metadataPatterns` フィールド追加（`undefined`/指定あり/空配列の3パターン）、はてなブックマーク・食べログの2アダプタ追加、既存6アダプタへの非影響確認を全てタスク化した。note/Qiita/Zenn等の除外は設計書のOut of Scopeで明記済みのため対象外。
- **Placeholder scan:** 全ステップに具体的なコード・grep相当のテスト・実行コマンドを記載。実サイトのセレクタ精査はE2E Verification Notesとして明示的に切り出し済み。
- **Type consistency:** `WhitelistAdapter.metadataPatterns`（Task 1）→ `extractWhitelistedContent` 内の `DEFAULT_METADATA_PATTERNS` 判定ロジック（Task 1）→ `hatena-bookmark`/`tabelog` エントリでの実際の指定（Task 2, 3）まで、型・フィールド名を一貫して使用している。
