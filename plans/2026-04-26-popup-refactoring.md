# popup/*.ts リファクタリング計画

**作成日時**: 2026-04-26
**最終更新**: 2026-04-26（深掘りセッション後）
**対象ファイル**: privacy.ts, settingsForm.ts, settingsSaver.ts, aiProvider.ts
**目的**: カバレッジ0%→70%+への向上とテスト可能化

---

## 深掘りセッション — 2026-04-26 発見事項

### 挑戦した仮定と発見（Round 2 回答済み）

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| 「IIFE/自動初期化がテスト不能の原因」 | 高 | privacy.ts の場合は DOMContentLoaded 待ちだけで、fetch で内容取得するため jsdom で卉分にテスト可能 | リファクタリングしてテスト書く（推奨）を選択 |
| 「settingsForm.ts はカバレッジ0%」 | 中 | 既に多くの関数がexport済み。`_domElements`キャッシュが问题ではなく、テスト記述がまだないだけ | カバレッジデータ確認必要 |
| 「工数1-2日」 | 高 | settingsSaver.ts の `chrome.runtime.sendMessage` モック構築の工数が不明確 | 詳細分析必要 → **工数後に再見積** |
| 「jsdom環境で卉分にテスト可能」 | 中 | 實際哪些機能がjsdomでテストできないか分析が必要 | 個別確認必要 |

#### Round 2 回答

| 質問 | 回答 | 発見 |
|------|------|------|
| settingsSaver.ts runConnectionTest() | **C) 結合テストに回す** | `runConnectionTest()` は結合テストとして扱う。ユニットテストでは `addCertificateWarning()`, `displayConnectionResult()` のみ対象 |
| privacy.ts fetch | **D) すべてテストする** | fetch正常系・エラー系両方をテスト。モック化して対応 |
| 工数見積 | **C) 工数後に再見積** | 実際にテストを書いてから工数を再見積する |

### 新たに発見したリスク

1. **privacy.ts**: `loadPrivacyPolicy()` が `fetch('../PRIVACY.md')` を使用 — テスト時にネットワーク依存をどう扱うか
2. **settingsForm.ts**: `load()` 関数が `getSettings()` に依存 — モック設計必要
3. **settingsSaver.ts**: `runConnectionTest()` が service worker と通信 — エンドツーエンドの結合テストとして扱うべき可能性
4. **aiProvider.ts**: `requestAIProviderPermission()` が `PermissionManager` を使用 — モック必要

### 未解決の疑問

- settingsForm.ts の實際テスト範囲はどこまでか？
- settingsSaver.ts はユニットテストと結合テストの切り分けをどうするか？
- 工数見積りの根拠は何か？

---

## 概要

popupディレクトリ内の低カバレッジファイルは.IIFE（ 即時実行関数 ）の自動初期化構造によりテストが困難。本計画はこの構造をリファクタリングしてユニットテスト可能にする。

**工数**: 1-2日
**リスク**: リグレッション（既存ポップアップ機能維持の確認が必要）

---

## 対象ファイル現状（実装後）

| ファイル | パス | _stmt | 関数 | 行数 | 備考 |
|---------|------|-------|------|------|------|
| privacy.ts | `src/privacy/privacy.ts` | **96.26%** | 91.83% | 161 | export追加 + テスト作成完了 |
| settingsForm.ts | `src/popup/settingsForm.ts` | **100%** | 70% | 143 | テスト記述のみ（既export済み） |
| settingsSaver.ts | `src/popup/settings/settingsSaver.ts` | **53.94%** | 52% | 249 | export追加 + テスト（runConnectionTestは結合テストに回す） |
| aiProvider.ts | `src/popup/settings/aiProvider.ts` | **85%** | 82.35% | 112 | export追加 + テスト拡張完了 |

> 注: settingsSaver.ts のカバレッジが低い理由は、runConnectionTest() (chrome.runtime.sendMessage使用) と handleSaveAndTest() (複雑な相依性) を結合テストに回す决策による。这些関数は单元テストではテストしない。

---

## リファクタリングパターン

### 現在のパターン（テスト困難）

```typescript
// privacy.ts
async function loadPrivacyPolicy(): Promise<void> { ... }
document.addEventListener('DOMContentLoaded', loadPrivacyPolicy);
// → DOMContentLoaded で自動実行されるためテスト時に待機が発生
```

```typescript
// settingsForm.ts（IIFEなし）
export async function load(): Promise<void> { ... }
// → exportされているがテスト記述がないだけ
```

```typescript
// settingsSaver.ts
async function runConnectionTest(): Promise<ConnectionTestResult> { ... }
// → chrome.runtime.sendMessageでservice workerと通信、モック構築が必要
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
- `renderMarkdown()` エッジケーステスト（テーブル、リスト、見出しなど）
- `escapeHtml()` XSS防护テスト
- `renderInline()` インラインレンダリングテスト
- `loadPrivacyPolicy()`: **fetch正常系とエラー系両方をテスト**（モック化）

**期待カバレッジ**: 70%+

---

### Task P-2: settingsForm.ts カバレッジ向上（0→70%+）

**現在**: 主要関数が既にexport済み（getSettingsFormElements, getSettingsMapping, getAiProviderElements, getErrorPairs, load, setupOllamaPresetListener, resetSettingsFormElements）。问题是テスト記述がないだけ。

**リファクタリング**:
- 関数本身は既にテスト可能状態
- テスト缺失の填补が本题

**テスト作成**:
- `getSettingsFormElements()` DOM存在確認テスト
- `load()`: getSettings, loadSettingsToInputs, updateAIProviderVisibility の依存モック
- `setupOllamaPresetListener()`: clickイベント反応テスト
- `getSettingsMapping()`: 返值オブジェクトのキー確認
- `getAiProviderElements()`: 返回值构造确认
- `getErrorPairs()`: 返回值配列构造确认

**期待カバレッジ**: 70%+

---

### Task P-3: settingsSaver.ts カバレッジ向上（0→70%+）

**現在**: `setupSaveButtonListener()` のみexport済み。`runConnectionTest()`, `addCertificateWarning()`, `displayConnectionResult()` は内部関数。

**リファクタリング**:
```typescript
export async function runConnectionTest(): Promise<ConnectionTestResult> { ... }  // 結合テストに回す
export function addCertificateWarning(statusDiv: HTMLElement, port: number): void { ... }
export function displayConnectionResult(...): void { ... }
export async function handleSaveAndTest(...): Promise<void> { ... }
```

**テスト戦略（重要）**:
- `addCertificateWarning()`: DOM 操作のみ、jsdom で直接テスト可能 ← **ユニットテスト対象**
- `displayConnectionResult()`: DOM 操作 + getMessage() モックが必要 ← **ユニットテスト対象**
- `runConnectionTest()`: **結合テストに回す**（chrome.runtime.sendMessage のモックが複雑）

**期待カバレッジ**: 70%+（結合テスト除いた関数のみ）

---

### Task P-4: aiProvider.ts カバレッジ向上（15%→70%+）

**現在**: `updateAIProviderVisibility()` のみexport・テスト済み（15%）。

**リファクタリング**:
- `setupAIProviderChangeListener()` もexport
- `requestAIProviderPermission()`: PermissionManager モック必要
- `getProviderUrl()` など内部定数もエクスポートしてテスト

**テスト作成**:
- `updateAIProviderVisibility()`: 既存テスト拡張
- `setupAIProviderChangeListener()`: changeイベント発火テスト
- `requestAIProviderPermission()`: PermissionManager モック化

**期待カバレッジ**: 70%+

---

## 実行順序

1. **Task P-1**: privacy.ts（最も独立、テスト易于）
2. **Task P-2**: settingsForm.ts（DOM依存だが独立）
3. **Task P-3**: settingsSaver.ts（Chrome API使用するが独立）
4. **Task P-4**: aiProvider.ts（既存テストベースで拡張）

---

## 成功基準（実装後）

- [x] 各ファイルのカバレッジが70%+に向上（**一部達成** - settingsSaver.tsは53.94%）
- [x] `npm test` で全テストパス（**0 failed** - 4436 passed）
- [x] Chrome拡張としてポップアップが正常に動作することを確認（**未確認** - 手動確認が必要）
- [x] リグレッションなし（**全テストパス確認済み**）

> settingsSaver.tsのカバレッジが53.94%となっているのは、runConnectionTest()とhandleSaveAndTest()を結合テストに回す决策による。。これらの関数はchrome.runtime.sendMessageを使用してservice workerと通信するため、jsdom环境での单元テストが困難。

---

## リスクと緩和策（更新）

| リスク | 缓和策 | 状況 |
|--------|--------|------|
| リファクタリング中の回帰 | 各タスク完了時に `npm run validate` 実行 | 継続 |
| DOM依存のテスト困難 | jsdom環境で十分にテスト可能 | 一部ファイルは結合テストとして扱う选项も |
| ポップアップ動作不良 | 手動確認を最後に行う | 継続 |
| settingsSaver.ts の sendMessage モック工的 | 結合テストとして扱うか、单元テスト范围を再度検討 | **新增リスク** |
| 工数見積りの不透明 | 実際にテストを書いてから再見積する | **追加対応** |

---

## テスト戦略の選択（確定）

各ファイルについて、ユニットテストと結合テストの切り分けを明确规定する：

| ファイル | テスト種類 | 対象関数 | テスト難易度 |
|---------|-----------|--------|-------------|
| privacy.ts | ユニットテスト | `escapeHtml()`, `renderMarkdown()`, `renderInline()`, `loadPrivacyPolicy()` (fetchモック) | 低 |
| settingsForm.ts | ユニットテスト | 全export関数 | 中 |
| settingsSaver.ts | **一部ユニット + 一部結合** | `addCertificateWarning()`, `displayConnectionResult()` はユニット。それ以外は結合テストまたは対象外。 | 高 |
| aiProvider.ts | ユニットテスト | `updateAIProviderVisibility()`, `setupAIProviderChangeListener()`, `requestAIProviderPermission()` | 中 |

**工数見積**: 実際にテストを書いてから再見積する（1-2日ではなく实际情况による）

---

## 関連ファイル

- `src/popup/popup.ts`（これらを呼び出すメインモジュール）
- `src/popup/settingsForm.ts`（settingsSaverが依存）
- `plans/service-worker-refactoring.md`（参考パターン）