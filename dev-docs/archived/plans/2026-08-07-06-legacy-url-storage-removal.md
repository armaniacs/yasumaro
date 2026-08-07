# レガシーurlStorage削除 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レガシー `urlStorage.ts` を `savedUrlStore.ts` に統合し、削除する

**Architecture:** `storageUrls.ts` のインポートを `urlStorage.js` → `storage/savedUrlStore.js` に切り替え、`urlStorage.ts` を削除。テストファイルをリネームして維持。

**Tech Stack:** TypeScript, Vitest

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 変更 | `src/utils/storageUrls.ts` |
| 削除 | `src/utils/urlStorage.ts` |
| 変更 | `src/utils/__tests__/urlStorage.test.ts` |

---

### Task 1: `storageUrls.ts` のインポートを切り替え

**Files:**
- Modify: `src/utils/storageUrls.ts`

- [ ] **Step 1: インポートを変更**

`storageUrls.ts` 内の:
```typescript
import { ... } from './urlStorage.js';
```
を以下に変更:
```typescript
import { ... } from './storage/savedUrlStore.js';
```

- [ ] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/utils/storageUrls.ts
git commit -m "refactor(storage): switch storageUrls.ts import to savedUrlStore"
```

---

### Task 2: `urlStorage.ts` を削除

**Files:**
- Delete: `src/utils/urlStorage.ts`

- [ ] **Step 1: ファイルを削除**

```bash
git rm src/utils/urlStorage.ts
```

- [ ] **Step 2: 他からインポートされていないことを確認**

```bash
grep -rn "from.*urlStorage" src/ --include="*.ts" | grep -v __tests__
```

Expected: なし（`storageUrls.ts` のインポートは既に切り替え済み）

- [ ] **Step 3: コミット**

```bash
git add -u src/utils/urlStorage.ts
git commit -m "refactor(storage): remove legacy urlStorage.ts"
```

---

### Task 3: テストファイルを更新

**Files:**
- Modify: `src/utils/__tests__/urlStorage.test.ts`

- [ ] **Step 1: インポートを `savedUrlStore` に切り替え**

`urlStorage.test.ts` 内の:
```typescript
import { ... } from '../urlStorage.js';
```
を以下に変更:
```typescript
import { ... } from '../storage/savedUrlStore.js';
```

- [ ] **Step 2: テストがパスすることを確認**

Run: `npx vitest run src/utils/__tests__/urlStorage.test.ts`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add src/utils/__tests__/urlStorage.test.ts
git commit -m "refactor(storage): update urlStorage test to import from savedUrlStore"
```

---

### Task 4: 全テスト実行

- [ ] **Step 1:** `npx tsc --noEmit` → PASS
- [ ] **Step 2:** `npx vitest run` → PASS

---

## 検証チェックリスト

- [ ] `urlStorage.ts` が存在しない
- [ ] `storageUrls.ts` が `savedUrlStore.ts` からインポートしている
- [ ] `urlStorage.test.ts` が `savedUrlStore.ts` からインポートしている
- [ ] 他に `urlStorage` を参照するファイルがない
- [ ] 既存テストが全てパスする
