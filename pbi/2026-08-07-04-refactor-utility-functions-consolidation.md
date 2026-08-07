# PBI: 重複ユーティリティ関数（escapeHtml, base64, showStatus等）を共通化する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（内部実装変更。外部API・UIへの影響なし）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、同一目的のユーティリティ関数が複数ファイルに散在することが発見された。

### 重複1: `escapeHtml()` — 5つの独立した実装

| ファイル | 実装 |
|---------|------|
| `popup/errorUtils.ts:150-156` | 文字マップ: `&<>"'/ → エンティティ` |
| `popup/domUtils.ts:1-5` | DOMベース: `div.textContent = text; return div.innerHTML` |
| `privacy/privacy.ts:14-19` | `& < >` のみ（`"`, `'`, `/` が未エスケープ） |
| `dashboard/panels/asyncData/sqliteHistoryPanel.ts:56-63` | `& < > " '` |
| `dashboard/panels/asyncData/domainSearchPanel.ts:7-8` | `& < >` のみ |

**リスク**: `privacy/privacy.ts` と `domainSearchPanel.ts` のバージョンは不完全。属性コンテキストで使用した場合、属性インジェクションの可能性がある。

### 重複2: `bytesToBase64()` / `base64ToBytes()` — 4つの完全コピー

| ファイル | 行 |
|---------|---|
| `background/handlers/dashboardSqliteHandlers.ts` | 16-31 |
| `dashboard/dashboardSqliteService.ts` | 364-379 |
| `dashboard/encryptedBackupService.ts` | 24-39 |
| `utils/crypto/index.ts` | 720-735 |

全てbyte-for-byte同一。`crypto/index.ts` にはprivate関数として既に存在。

### 重複3: `showStatus()` — 5つの同一パターン

| ファイル | 実装 |
|---------|------|
| `popup/settingsUiHelper.ts:6-20` | カノニカル: `getElementById`, text/class設定, `setTimeout(3000)` |
| `popup/customPromptManager.ts:559-572` | キャプチャした要素へのクロージャ |
| `popup/trustSettings.ts:64-72` | キャプチャした要素へのクロージャ |
| `dashboard/markdownTemplateManager.ts:415-427` | キャプチャした要素へのクロージャ |
| `dashboard/panels/diagnostic/exportLogsPanel.ts:17-23` | インライン |

### 重複4: `shouldRetry` リトライポリシー — 2箇所

| ファイル | 内容 |
|---------|------|
| `utils/fetch.ts:439-463` (`defaultShouldRetry`) | 429→リトライ不可, 5xx→冪等のみ, AbortError→1回まで, NetworkError→リトライ |
| `background/ai/providers/OpenAIProvider.ts:187-200` | 同一ロジック（`method` パラメータ追加のみ） |

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "function escapeHtml\|export function escapeHtml\|const escapeHtml" src/ --include="*.ts" | grep -v __tests__ | grep -v test
grep -rn "function bytesToBase64\|function base64ToBytes" src/ --include="*.ts" | grep -v __tests__
grep -rn "function showStatus" src/ --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: escapeHtmlが単一の共通関数として利用される
  Given src/utils/htmlEscape.tsにエクスポートされたescapeHtml関数
  When popup, dashboard, privacyの各モジュールがインポートする
  Then 全て同一の完全なエスケープ（& < > " ' /）が適用される

Scenario: bytesToBase64/base64ToBytesがcryptoモジュールから利用される
  Given src/utils/crypto/index.tsにエクスポートされた関数
  When dashboardSqliteHandlers, dashboardSqliteService, encryptedBackupServiceがインポートする
  Then 同一の変換が行われる

Scenario: showStatusがsettingsUiHelperから利用される
  Given settingsUiHelper.tsのshowStatus(elementId | HTMLElement, message, type)
  When 各モジュールがインポートする
  Then 3秒（エラーは5秒）後にクリアされる
```

## 受け入れ基準
- [ ] `src/utils/htmlEscape.ts` に `escapeHtml()` を作成し、全5ファイルからインポートを切り替える
- [ ] `utils/crypto/index.ts` の `bytesToBase64()` / `base64ToBytes()` をexportし、3ファイルからインポートを切り替える
- [ ] `popup/settingsUiHelper.ts` の `showStatus()` に `HTMLElement` オーバーロードを追加し、4ファイルからインポートを切り替える
- [ ] `defaultShouldRetry` を `method` パラメータ対応に拡張し、OpenAIProviderのインラインコピーパスケージ
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `htmlEscape.ts` の `escapeHtml()` の単体テストを追加（全エスケープ文字、null/undefined入力）
- `crypto/index.ts` の `bytesToBase64`/`base64ToBytes` のラウンドトリップテスト

### 回帰テスト
- 既存の `errorUtils.test.ts`, `privacy.test.ts` がパスすることを確認

## 実装アプローチ
- 各ユーティリティを単一ソースに統合し、呼び出し元をインポート切り替え
- 段階的移行: まず `escapeHtml` → 次に `base64` → 最後に `showStatus` + `shouldRetry`

## 見積もり
1pt（ユーティリティ作成 + 12ファイルのインポート切り替え + テスト追加）

## 技術的考慮事項
- `escapeHtml`: 最も完全なバージョン（`popup/errorUtils.ts` の文字マップ）を採用。`privacy/privacy.ts` の不完全版はXSSリスクがあるため、置換必須
- `showStatus`: `settingsUiHelper.ts` に `HTMLElement` オーバーロードを追加し、既存の `elementId` 版との後方互換性を維持
- Content Script（`content/`）からはインポート不可のため、`loader.ts` の `matchesPattern` 等は別PBI（ドメインマッチング統合）のスコープ

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 6, 8, 9, 12, 15, 16）
- 対象ファイル: `src/popup/errorUtils.ts`, `src/popup/domUtils.ts`, `src/privacy/privacy.ts`, `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`, `src/dashboard/panels/asyncData/domainSearchPanel.ts`, `src/background/handlers/dashboardSqliteHandlers.ts`, `src/dashboard/dashboardSqliteService.ts`, `src/dashboard/encryptedBackupService.ts`, `src/utils/crypto/index.ts`, `src/popup/settingsUiHelper.ts`, `src/popup/customPromptManager.ts`, `src/popup/trustSettings.ts`, `src/dashboard/markdownTemplateManager.ts`, `src/dashboard/panels/diagnostic/exportLogsPanel.ts`, `src/utils/fetch.ts`, `src/background/ai/providers/OpenAIProvider.ts`
