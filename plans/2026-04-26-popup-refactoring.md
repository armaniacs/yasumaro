# popup/*.ts リファクタリング計画

**作成日時**: 2026-04-26
**対象ファイル**: privacy.ts, settingsForm.ts, settingsSaver.ts, aiProvider.ts
**目的**: カバレッジ0%→70%+への向上とテスト可能化

---

## 概要

popupディレクトリ内の低カバレッジファイルは.IIFE（ 即時実行関数 ）の自動初期化構造によりテストが困難。本計画はこの構造をリファクタリングしてユニットテスト可能にする。

**工数**: 1-2日
**リスク**: リグレッション（既存ポップアップ機能維持の確認が必要）

---

## 対象ファイル現状

| ファイル | パス | カバレッジ | 行数 | 問題点 |
|---------|------|-----------|------|--------|
| privacy.ts | `src/privacy/privacy.ts` | 0% | 161 | IIFE + DOMContentLoaded |
| settingsForm.ts | `src/popup/settingsForm.ts` | 0% | 143 | IIFE + DOM参照 |
| settingsSaver.ts | `src/popup/settings/settingsSaver.ts` | 0% | 249 | IIFE + DOM参照 |
| aiProvider.ts | `src/popup/settings/aiProvider.ts` | 15% | 112 | export関数あるが他が未テスト |

---

## リファクタリングパターン

### 現在のパターン（テスト不可能）

```typescript
// privacy.ts, settingsForm.ts 等
async function initSomething() { ... }

document.addEventListener('DOMContentLoaded', initSomething);
```

### リファクタリング後（テスト可能）

```typescript
// 関数としてexport
export async function initSomething(): Promise<void> { ... }

// initXXX をまとめるexport関数
export function initAllSettings(): void {
    document.addEventListener('DOMContentLoaded', () => {
        initSomething().catch(console.error);
    });
}

// テスト可能的: 直接関数を呼べる
// initSomething() - awaitで実行可能
```

---

## タスク一覧

### Task P-1: privacy.ts リファクタリング（0→70%+）

**現在**:
```typescript
// src/privacy/privacy.ts
async function loadPrivacyPolicy(): Promise<void> { ... }
document.addEventListener('DOMContentLoaded', loadPrivacyPolicy);
```

**リファクタリング**:
```typescript
export async function loadPrivacyPolicy(): Promise<void> { ... }
export async function renderPrivacyContent(containerId: string): Promise<void> { ... }
export function initPrivacyPage(): void {
    document.addEventListener('DOMContentLoaded', () => loadPrivacyPolicy());
}
```

**テスト作成**:
- `renderMarkdown()` エッジケーステスト
- `escapeHtml()` XSS防护テスト
- `loadPrivacyPolicy()` fetch失敗時のエラーハンドリングテスト

**期待カバレッジ**: 70%+

---

### Task P-2: settingsForm.ts リファクタリング（0→70%+）

**現在**: ファイル全体が一つの `getSettingsFormElements()` と `load()` を持つが、IIFEなし。問題は `_domElements` キャッシュと相依性。

**確認事項**:
- `load()` がいつどこから呼ばれるか
- `settingsForm.ts` と `popup.ts` の関係

**リファクタリング方向**:
- `_domElements` の代わりに `resetSettingsFormElements()` の明示的エクスポート
- `load()` と `getSettingsFormElements()` の依存関係を明確化

**期待カバレッジ**: 70%+

---

### Task P-3: settingsSaver.ts リファクタリング（0→70%+）

**現在**: `setupSaveButtonListener()` のみexportされ、他は内部関数。

**リファクタリング**:
```typescript
export async function setupSaveButtonListener(...): Promise<void> { ... }
export async function runConnectionTest(): Promise<ConnectionTestResult> { ... }
export function addCertificateWarning(statusDiv: HTMLElement, port: number): void { ... }
```

**テスト作成**:
- `runConnectionTest()` モック Chrome API
- `addCertificateWarning()` DOM操作テスト
- エラーハンドリングテスト

**期待カバレッジ**: 70%+

---

### Task P-4: aiProvider.ts カバレッジ向上（15%→70%+）

**現在**: `updateAIProviderVisibility()` のみexport・テスト済み。

**リファクタリング**:
- `setupAIProviderChangeListener()` もexport
- `getProviderUrl()` など内部関数もエクスポートしてテスト

**期待カバレッジ**: 70%+

---

## 実行順序

1. **Task P-1**: privacy.ts（最も独立、テスト易于）
2. **Task P-2**: settingsForm.ts（DOM依存だが独立）
3. **Task P-3**: settingsSaver.ts（Chrome API使用するが独立）
4. **Task P-4**: aiProvider.ts（既存テストベースで拡張）

---

## 成功基準

- [ ] 各ファイルのカバレッジが70%+に向上
- [ ] `npm test` で全テストパス（0 failed）
- [ ] Chrome拡張としてポップアップが正常に動作することを確認
- [ ] リグレッションなし

---

## リスクと緩和策

| リスク | 緩和策 |
|--------|--------|
| リファクタリング中の回帰 | 各タスク完了時に `npm run validate` 実行 |
| DOM依存のテスト困難 | jsdom環境で 충분히テスト可能 |
| ポップアップ動作不良 | 手動確認を最後に行う |

---

## 関連ファイル

- `src/popup/popup.ts`（これらを呼び出すメインモジュール）
- `src/popup/settingsForm.ts`（settingsSaverが依存）
- `plans/service-worker-refactoring.md`（参考パターン）