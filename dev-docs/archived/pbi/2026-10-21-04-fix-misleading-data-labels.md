# PBI: 誤データ・誤ラベル・latent guard の修正（statusPanel・confirmDialog・checkPermissionStep）

## ユーザーストーリー

拡張の UI を使っているユーザーとして、エラーデータに popup 自身の HTML が混入したり、インポート許可の確認が「Delete」と表示されたりしないことがほしい、なぜなら誤データはフィードバック経路の意味を壊し、誤ラベルは危険な操作の確認画面での判断を誤らせるから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴あり（statusPanel の fallback 削除は chrome:// ページで報告できなくなる方向。pin 1 件の書き換えが不可避）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 4・5・14。なぜなぜ分析 /tmp/whywhy/outofscope-A.md（分析 14-15）・outofscope-C.md（分析 9）2026-10-21

## 実装内容（owner 判断済み 2026-10-21）

1. （対象外 4）statusPanel の outerHTML fallback を削除し、cleaning 後コンテンツが空ならエラー表示にする。誤データをゼロにする代わりに、コンテンツスクリプトが動かないページ（chrome:// 等）では報告できなくなる
2. （対象外 5）checkPermissionStep の domain 導出重複を解消し、new URL に guard を追加する（isHostPermitted が無効 URL で false を返すため現状到達不能だが、実装変更で即 raw TypeError になる latent bug）
3. （対象外 14）confirmDialog の非削除確認 2 箇所に confirmLabel を明示する。settingsExportImportUiCore は既存 'confirmImport' キー、popup/pendingPages は保留ページ破棄用ラベル（i18n 契約に合わせる）。デフォルト 'Delete' の pin は維持

## 受け入れ基準（BDD）

```gherkin
Scenario: エラーデータに popup 自身の HTML が入らない
  Given コンテンツスクリプトが動かないページを開いている
  When cleansing フィードバックを送る
  Then popup 自身の HTML は送信されない
    And コンテンツが空の場合はエラーが表示される

Scenario: インポート許可の確認が「Delete」にならない
  Given 暗号化インポートの許可確認を開く
  When ダイアログが表示される
  Then 確認ラベルはインポート用の文言である
```

## テスト戦略

- statusPanel-cleansingFeedback.test.ts の enqueueFeedback pin を新しい契約（fallback なし）に更新する
- confirmDialog.test.ts のデフォルト pin は維持し、呼び出し側 2 箇所の contract テストを追加する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 4・5・14・処理記録）
- src/utils/htmlEscape.ts（escapeHtml canonical）

## 実装記録（2026-10-21）

- statusPanel: outerHTML fallback を削除し throw new Error('NO_CONTENT') に変更（catch が既存の reportCleansingFeedbackError 表示 + logError を担う。誤データゼロ）
- checkPermissionStep: domain 導出を isHostPermitted の直後に 1 箇所へ集約し、success result 側の無防備な new URL を廃止（latent TypeError 解消。decideGate の INVALID_URL 分岐は維持）
- confirmDialog 呼び出し側 2 箇所を明示: settingsExportImportUiCore は getMessageOr('confirmImport', 'Import')（既存キー en/ja 存在）、pendingPages は getMessageOr('btnDiscard', 'Discard')（既存キー）。i18n キー追加なし・デフォルト 'Delete' pin 維持
- pin 書き換え: statusPanel-cleansingFeedback.test.ts（enqueue pin → エラー表示 + not.toHaveBeenCalled 契約、resp=null → 有効 content）、pendingPages.test.ts（strict toHaveBeenCalledWith に confirmLabel 追加）。新規: settingsExportImportUiCore.test.ts（呼び出し側 contract pin）
- 検証: 担当 10 ファイル 207 tests 全 green、type-check 通過、eslint 通過、validate:fast green
