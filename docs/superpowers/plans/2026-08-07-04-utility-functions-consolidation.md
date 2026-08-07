# ユーティリティ関数共通化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `escapeHtml`（5実装）、`bytesToBase64`/`base64ToBytes`（4実装）、`showStatus`（5実装）を単一ソースに統合する

**Architecture:** 各ユーティリティを単一モジュールに集約し、呼び出し元をインポート切り替え。`escapeHtml` は最も完全な実装（文字マップ）を採用。`bytesToBase64`/`base64ToBytes` は `crypto/index.ts` からexport。`showStatus` は `settingsUiHelper.ts` に `HTMLElement` オーバーロードを追加。

**Tech Stack:** TypeScript, Vitest

---

## ファイルマッピング

| 操作 | ファイル |
|------|---------|
| 作成 | `src/utils/htmlEscape.ts` |
| 作成 | `src/utils/__tests__/htmlEscape.test.ts` |
| 変更 | `src/utils/crypto/index.ts`（export追加） |
| 変更 | `src/popup/settingsUiHelper.ts`（オーバーロード追加） |
| 変更 | 呼び出し元 12+ ファイル（インポート切り替え） |

---

### Task 1: `htmlEscape.ts` を作成

**Files:**
- Create: `src/utils/htmlEscape.ts`
- Create: `src/utils/__tests__/htmlEscape.test.ts`

- [x] **Step 1: テストを書く**

```typescript
import { describe, test, expect } from 'vitest';
import { escapeHtml } from '../htmlEscape.js';

describe('escapeHtml', () => {
    test('特殊文字をHTMLエンティティに変換する', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#039;');
        expect(escapeHtml('/')).toBe('&#x2F;');
    });
    test('複数の特殊文字を含む文字列を変換する', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });
    test('特殊文字がない場合はそのまま返す', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });
    test('空文字列を返す', () => {
        expect(escapeHtml('')).toBe('');
    });
    test('文字列以外の入力は空文字列を返す', () => {
        expect(escapeHtml(null as any)).toBe('');
        expect(escapeHtml(undefined as any)).toBe('');
    });
});
```

- [x] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/__tests__/htmlEscape.test.ts`
Expected: FAIL

- [x] **Step 3: 実装を書く**

```typescript
const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;', '/': '&#x2F;'
};
export function escapeHtml(unsafe: unknown): string {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[&<>"'/]/g, (match) => HTML_ESCAPE_MAP[match]);
}
```

- [x] **Step 4: テストがパスすることを確認**

Run: `npx vitest run src/utils/__tests__/htmlEscape.test.ts`
Expected: PASS

- [x] **Step 5: コミット**

```bash
git add src/utils/htmlEscape.ts src/utils/__tests__/htmlEscape.test.ts
git commit -m "refactor(utils): add canonical escapeHtml in htmlEscape.ts"
```

---

### Task 2: `escapeHtml` の呼び出し元を切り替え（5ファイル）

**Files:**
- Modify: `src/popup/domUtils.ts`
- Modify: `src/privacy/privacy.ts`
- Modify: `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- Modify: `src/dashboard/panels/asyncData/domainSearchPanel.ts`
- Modify: `src/popup/errorUtils.ts`（re-exportに変更）

- [x] **Step 1: 各ファイルのインライン `escapeHtml` を削除し、`htmlEscape.ts` からインポート**

各ファイルで:
1. `import { escapeHtml } from '../../utils/htmlEscape.js';` を追加（パスは調整）
2. ファイル内の `escapeHtml` 関数定義を削除

`popup/errorUtils.ts` は既存の `escapeHtml` を re-export に変更:
```typescript
export { escapeHtml } from '../utils/htmlEscape.js';
```

- [x] **Step 2: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [x] **Step 3: コミット**

```bash
git add src/popup/domUtils.ts src/privacy/privacy.ts src/dashboard/panels/asyncData/sqliteHistoryPanel.ts src/dashboard/panels/asyncData/domainSearchPanel.ts src/popup/errorUtils.ts
git commit -m "refactor(utils): consolidate escapeHtml to single implementation"
```

---

### Task 3: `bytesToBase64`/`base64ToBytes` を export し、呼び出し元を切り替え（3ファイル）

**Files:**
- Modify: `src/utils/crypto/index.ts`
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts`
- Modify: `src/dashboard/dashboardSqliteService.ts`
- Modify: `src/dashboard/encryptedBackupService.ts`

- [x] **Step 1: `crypto/index.ts` の `bytesToBase64`/`base64ToBytes` に `export` を追加**

- [x] **Step 2: 各ファイルのインライン関数を削除し、`crypto/index.ts` からインポート**

```typescript
import { bytesToBase64, base64ToBytes } from '../../utils/crypto/index.js';
```

- [x] **Step 3: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [x] **Step 4: コミット**

```bash
git add src/utils/crypto/index.ts src/background/handlers/dashboardSqliteHandlers.ts src/dashboard/dashboardSqliteService.ts src/dashboard/encryptedBackupService.ts
git commit -m "refactor(utils): consolidate bytesToBase64/base64ToBytes to crypto module"
```

---

### Task 4: `showStatus` に HTMLElement オーバーロードを追加し、呼び出し元を切り替え（4ファイル）

**Files:**
- Modify: `src/popup/settingsUiHelper.ts`
- Modify: `src/popup/customPromptManager.ts`
- Modify: `src/popup/trustSettings.ts`
- Modify: `src/dashboard/markdownTemplateManager.ts`
- Modify: `src/dashboard/panels/diagnostic/exportLogsPanel.ts`

- [x] **Step 1: `settingsUiHelper.ts` に HTMLElement オーバーロードを追加**

```typescript
export function showStatus(elementOrId: string | HTMLElement, message: string, type: 'success' | 'error'): void {
    const el = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
    if (!el) return;
    el.textContent = message;
    el.className = type;
    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
        if (el) { el.textContent = ''; el.className = ''; }
    }, timeout);
}
```

- [x] **Step 2: 各ファイルのインライン `showStatus` を削除し、`settingsUiHelper.ts` からインポート**

```typescript
import { showStatus } from '../popup/settingsUiHelper.js';
```

- [x] **Step 3: 型チェックを実行**

Run: `npx tsc --noEmit`
Expected: PASS

- [x] **Step 4: コミット**

```bash
git add src/popup/settingsUiHelper.ts src/popup/customPromptManager.ts src/popup/trustSettings.ts src/dashboard/markdownTemplateManager.ts src/dashboard/panels/diagnostic/exportLogsPanel.ts
git commit -m "refactor(utils): consolidate showStatus to settingsUiHelper"
```

---

### Task 5: 全テスト実行

- [x] **Step 1:** `npx tsc --noEmit` → PASS
- [x] **Step 2:** `npx vitest run` → PASS

---

## 検証チェックリスト

- [x] `htmlEscape.ts` に `escapeHtml` が存在し、5ファイルからインポートされている
- [x] `crypto/index.ts` から `bytesToBase64`/`base64ToBytes` がexportされ、3ファイルからインポートされている
- [x] `settingsUiHelper.ts` の `showStatus` が `string | HTMLElement` オーバーロードを持ち、4ファイルからインポートされている
- [x] 既存テストが全てパスする
