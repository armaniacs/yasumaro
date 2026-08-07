# ドメインマッチング関数統合 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wildcardToRegex` パターン（7箇所）、`extractDomain`/`matchesPattern`/`isDomainInList`（4ファイル）を統合する

**Architecture:** `wildcardToRegex.ts` にReDoSガード付きの共通関数を作成。`domainUtils.ts` の `matchesPattern` を `wildcardToRegex` を使うように書き換え。Content Script（`loader.ts`, `urlSkipper.ts`）はバンドル制約からインポート不可のため、`urlSkipper.ts` を正のソースとして `loader.ts` は `urlSkipper.ts` からインポート。

**Tech Stack:** TypeScript, Vitest

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 作成 | `src/utils/wildcardToRegex.ts` |
| 作成 | `src/utils/__tests__/wildcardToRegex.test.ts` |
| 変更 | `src/utils/domainUtils.ts` |
| 変更 | `src/utils/storage/domainFilterCache.ts` |
| 変更 | `src/dashboard/cspSettings.ts` |
| 変更 | `src/popup/statusChecker.ts` |
| 変更 | `src/popup/pendingPages.ts` |
| 変更 | `src/content/urlSkipper.ts` |
| 変更 | `src/content/loader.ts` |

---

### Task 1: `wildcardToRegex.ts` を作成

**Files:**
- Create: `src/utils/wildcardToRegex.ts`
- Create: `src/utils/__tests__/wildcardToRegex.test.ts`

- [ ] **Step 1: テストを書く**

```typescript
import { describe, test, expect } from 'vitest';
import { wildcardToRegex } from '../wildcardToRegex.js';

describe('wildcardToRegex', () => {
    test('ワイルドカードなしの場合は完全一致の正規表現を返す', () => {
        const re = wildcardToRegex('example.com');
        expect(re?.test('example.com')).toBe(true);
        expect(re?.test('other.com')).toBe(false);
    });
    test('ワイルドカードを .* に変換する', () => {
        const re = wildcardToRegex('*.example.com');
        expect(re?.test('sub.example.com')).toBe(true);
        expect(re?.test('example.com')).toBe(false);
    });
    test('大文字小文字を区別しない', () => {
        const re = wildcardToRegex('Example.COM');
        expect(re?.test('example.com')).toBe(true);
    });
    test('ワイルドカード数が上限を超える場合はnullを返す', () => {
        const re = wildcardToRegex('*.*.*.*.*.*.com');
        expect(re).toBeNull();
    });
    test('空文字列の場合はnullを返す', () => {
        expect(wildcardToRegex('')).toBeNull();
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/wildcardToRegex.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装を書く**

```typescript
const MAX_WILDCARDS_PER_PATTERN = 5;

export function wildcardToRegex(pattern: string): RegExp | null {
    if (!pattern || !pattern.includes('*')) {
        return pattern ? new RegExp(`^${escapeRegex(pattern)}$`, 'i') : null;
    }
    const wildcardCount = (pattern.match(/\*/g) || []).length;
    if (wildcardCount > MAX_WILDCARDS_PER_PATTERN) return null;
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escaped.replace(/\\\*/g, '.*');
    return new RegExp(`^${regexPattern}$`, 'i');
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/utils/__tests__/wildcardToRegex.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/utils/wildcardToRegex.ts src/utils/__tests__/wildcardToRegex.test.ts
git commit -m "refactor(utils): add wildcardToRegex with ReDoS guard"
```

---

### Task 2: `domainUtils.ts` を `wildcardToRegex` に書き換え

**Files:**
- Modify: `src/utils/domainUtils.ts`

- [ ] **Step 1: インポート追加、`matchesPattern` を書き換え**

```typescript
import { wildcardToRegex } from './wildcardToRegex.js';

export function matchesPattern(domain: string, pattern: string): boolean {
    const re = wildcardToRegex(pattern);
    if (!re) return false;
    return re.test(domain);
}
```

`MAX_WILDCARDS_PER_PATTERN` 定数とインラインの正規表現変換を削除。

- [ ] **Step 2: 既存テストがパスすることを確認**

Run: `npx vitest run src/utils/__tests__/domainUtils.test.ts`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/utils/domainUtils.ts
git commit -m "refactor(utils): use wildcardToRegex in domainUtils.matchesPattern"
```

---

### Task 3: `domainFilterCache.ts` を `wildcardToRegex` に書き換え

**Files:**
- Modify: `src/utils/storage/domainFilterCache.ts`

- [ ] **Step 1: インポート追加、`matchesWildcardPattern` を書き換え**

```typescript
import { wildcardToRegex } from '../wildcardToRegex.js';

export function matchesWildcardPattern(domain: string, pattern: string): boolean {
    const re = wildcardToRegex(pattern);
    if (!re) return false;
    return re.test(domain);
}
```

- [ ] **Step 2: コミット**

```bash
git add src/utils/storage/domainFilterCache.ts
git commit -m "refactor(utils): use wildcardToRegex in domainFilterCache"
```

---

### Task 4: 残り4ファイルのインライン `wildcardToRegex` パターンを置換

**Files:**
- Modify: `src/dashboard/cspSettings.ts`
- Modify: `src/popup/statusChecker.ts`
- Modify: `src/popup/pendingPages.ts`

- [ ] **Step 1: 各ファイルのインラインパターンを `wildcardToRegex` に置換**

各ファイルで:
1. `import { wildcardToRegex } from '../../utils/wildcardToRegex.js';` を追加
2. `pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')` のインラインコードを `wildcardToRegex(pattern)` に置換

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/dashboard/cspSettings.ts src/popup/statusChecker.ts src/popup/pendingPages.ts
git commit -m "refactor(utils): use wildcardToRegex in remaining inline copies"
```

---

### Task 5: Content Script の `loader.ts` を `urlSkipper.ts` からインポート

**Files:**
- Modify: `src/content/loader.ts`

- [ ] **Step 1: `loader.ts` の関数定義を削除し、`urlSkipper.ts` からインポート**

`loader.ts` の `SKIPPED_PROTOCOLS`, `shouldSkipUrl`, `extractDomain`, `matchesPattern`, `isDomainInList` の定義を削除し:

```typescript
import { SKIPPED_PROTOCOLS, shouldSkipUrl, extractDomain, matchesPattern, isDomainInList } from './urlSkipper.js';
```

**注意:** Content ScriptバンドルがESMインポートに対応しているか、WXTのバンドル設定を確認してから着手すること。対応していない場合は `urlSkipper.ts` を正のソースとして維持し、`loader.ts` のコピーに "urlSkipper.ts と同期すること" というコメントを残す。

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/content/loader.ts
git commit -m "refactor(content): import from urlSkipper instead of duplicating"
```

---

### Task 6: 全テスト実行

- [ ] **Step 1:** `npx tsc --noEmit` → PASS
- [ ] **Step 2:** `npx vitest run` → PASS

---

## 検証チェックリスト

- [ ] `wildcardToRegex.ts` が作成され、ReDoSガード付き
- [ ] `domainUtils.ts` が `wildcardToRegex` を使用している
- [ ] `domainFilterCache.ts` が `wildcardToRegex` を使用している
- [ ] 残り3ファイルのインラインパターンが `wildcardToRegex` に置換された
- [ ] `loader.ts` が `urlSkipper.ts` からインポートしている（またはコメントで同期を明記）
- [ ] 既存テストが全てパスする
