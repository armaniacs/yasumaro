# PBI: i18n 直書きの解消と日本語固定フォールバックの英語化

## ユーザーストーリー

en ロケールで拡張を使っているユーザーとして、aria-label が英語直書きではなく i18n キーから供給され、日本語フォールバックが露出しないことがほしい、なぜなら直書きはロケール切り替えで壊れ、日本語フォールバックは en ユーザーに意味不明な文字列を見せるから。

## 優先度

- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🔴なし（キー追加は en/ja 両方で行い locale parity ゲートを通す。日本語フォールバックは現行では dead branch ― 必要キーは en/ja 両方に存在済み ― のため文言契約の実質変化はない）
- 出典: [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md) 対象外 12・13。なぜなぜ分析 /tmp/whywhy/outofscope-C.md（分析 4-8・現在地実測）2026-10-21

## 実装内容

1. （対象外 12a）静的 aria-label 2 箇所に data-i18n-aria-label + 静的フォールバックを付ける（既存パターン: models-dev-dialog の dialogCloseAriaLabel と同型）。キーは en/ja 両方に追加する
2. （対象外 12b）動的補間 aria-label 5 箇所を getMessageWithSubstitutions 経由に変更する（動的要素に data-i18n 属性は使えないため既存パターンと整合）
3. （対象外 13a/13b）settingsPipeline の saveErrorText と trustSettings の permissionSuggest* の日本語フォールバックを英語に統一する（キー追加不要。dead branch の言語統一）
4. 追加発見: checkSourceI18nKeys が data-i18n-aria-label を missing-key チェック対象にしていないゲート隙間は、本 PBI では改修せず PBI 候補として記録する

## 受け入れ基準（BDD）

```gherkin
Scenario: aria-label がロケールから供給される
  Given ダッシュボードのパネルを開く
  When aria-label を読む
  Then 直書きの英語ではなく i18n キーの値が出る

Scenario: en ロケールで日本語フォールバックが露出しない
  Given en ロケールでエラーが発生する
  When エラー文言を表示する
  Then 英語の文言が出る
```

## テスト戦略

- check-docs-chars / i18n ゲート（locale parity）を通す
- aria-label 変更は既存の DOM テストで pin されている箇所を fixture として確認する

## 関連

- [pbi/2026-10-20-00-backlog-refactor-scan.md](2026-10-20-00-backlog-refactor-scan.md)（対象外 12・13・処理記録）
- docs/i18n-guide.md（data-i18n 契約）
