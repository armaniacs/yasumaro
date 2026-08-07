# PBI: 設定エクスポート/インポートUIのpopup/dashboard間重複を統合する

**作成日**: 2026-08-07
**優先度**: 高
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（UI構造変更。検証は手動必須）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで `popup/settingsExportImportUi.ts`（248行）と `dashboard/exportImport.ts`（268行）がほぼ同一のエクスポート/インポートフローを含むことが発見された。

### 重複箇所

| 項目 | 一致度 |
|------|--------|
| エクスポートボタンハンドラ | 同一（マスターパスワード暗号化分岐 → `exportSettings` or `exportEncryptedSettings`） |
| ファイル入力 `change` ハンドラ | 同一（`isEncryptedExport` → `importEncryptedSettings` or `validateExportData` → プレビュー → モーダル） |
| インポート確認ハンドラ | 同一（`importSettings` + `reloadFn` + `loadDomainSettings`/`loadPrivacySettings`…） |
| `showImportPreview()` | 同一（サマリーJSON構築） |
| 状態変数 | 同一（`_pendingImportData`, `pendingImportJson`） |

### 主な差異

| 項目 | popup | dashboard |
|------|-------|-----------|
| ステータス要素ID | `exportImportStatus` | `status` |
| モーダル表示 | `<dialog>` | div + `focusTrapManager` |
| プレビュー表示 | 少し追加フィールド | 標準 |
| ダッシュボード追加機能 | なし | `importLogsBtn`、ログインポート機能 |

### 共有ユーティリティ

既に `src/utils/settingsExportImport.ts` にビジネスロジック（`exportSettings`, `importSettings`, `validateExportData` 等）が抽出済み。UIオーケストレーションのみが重複。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/popup/settingsExportImportUi.ts src/dashboard/exportImport.ts src/utils/settingsExportImport.ts
grep -n "importSettings\|exportSettings\|validateExportData" src/popup/settingsExportImportUi.ts src/dashboard/exportImport.ts
```

## 受け入れ基準（BDD）

```gherkin
Scenario: エクスポートフローが共有ロジックで動作する
  Given popupまたはdashboardの設定画面
  When エクスポートボタンをクリックする
  Then マスターパスワード設定に応じたエクスポートが実行される

Scenario: インポートフローが共有ロジックで動作する
  Given popupまたはdashboardの設定画面
  When インポートファイルを選択する
  Then 検証 → プレビュー → 確認モーダルのフローが実行される

Scenario: dashboardのログインポート機能に回帰がない
  Given dashboardのインポート画面
  When ログインポートを実行する
  Then 既存の動作が維持される
```

## 受け入れ基準
- [ ] `src/utils/settingsExportImportUiCore.ts` に共有UIオーケストレーション（エクスポートハンドラ、ファイル入力ハンドラ、インポート確認ハンドラ、`showImportPreview`）を抽出
- [ ] 各UI（popup, dashboard）はDOM操作とモーダル表示の差異分のみを担当する薄いアダプターになる
- [ ] popupの `<dialog>` API使用と dashboardの `focusTrapManager` 使用は各々維持
- [ ] dashboardのログインポート機能（`importLogsBtn`）はdashboardアダプターに残す
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- 抽出した `settingsExportImportUiCore.ts` の各関数の単体テストを追加
- ファイル検証、プレビュー生成、インポート確認ロジックの検証

### 手動テスト
- popup: 設定のエクスポート → インポートフロー
- dashboard: 設定のエクスポート → インポートフロー + ログインポート
- 暗号化エクスポート/インポートの動作確認

## 実装アプローチ
- 共有コアモジュール作成 → 各UIを薄いラッパーにリファクタ
- DOM操作は各UIに委譲（コアはDOM依存なし）
- 既存の `settingsExportImport.ts`（ビジネスロジック）と新規の `settingsExportImportUiCore.ts`（UIロジック）を分離

## 見積もり
2pt（コア抽出 + 2UIのリファクタ + 手動テスト）

## 技術的考慮事項
- 依存: `src/popup/settingsExportImportUi.ts`, `src/dashboard/exportImport.ts`, `src/utils/settingsExportImport.ts`
- `settingsExportImport.ts` は既に共有済み。UIオーケストレーション層の統合が本PBIのスコープ
- テスタビリティ: DOM操作はコアから分離し、テスト容易性を維持

## 関連
- コードレビューレポート: 本セッションの重複レビュー（Cluster 2）
- 対象ファイル: `src/popup/settingsExportImportUi.ts`, `src/dashboard/exportImport.ts`
