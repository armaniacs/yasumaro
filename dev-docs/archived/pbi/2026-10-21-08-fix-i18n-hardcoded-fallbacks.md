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

## 実装記録（2026-10-21）

- 静的 aria-label 2 箇所 → data-i18n-aria-label + 静的フォールバック（models-dev-dialog.ts:114 の tablist、researchSessionsPanel.ts の subtree チェック。JS 生成要素は setAttribute + applyI18n(listEl) 再適用パターン）
- 動的補間 aria-label 5 箇所 → getMessageWithSubstitutions 経由（researchSessionsPanel.ts:76・203、priorityListView.ts:139・164・170 を名前付き置換に統一）
- 新キー 7 個を en/ja 両方に追加（modelsDevCategoriesAriaLabel・researchSessions_selectPage/Subtree/SessionAriaLabel・aiProviderPrioritySelect/MoveUp/MoveDownAriaLabel。locale parity ゲート通過）
- 英語化（dead branch の言語統一・キー追加なし）: settingsPipeline saveErrorText → 'Save error'、trustSettings permissionSuggest* → ' visits' / '🔓 Allow' / 'Dismiss (hide for 14 days)'
- pin 更新（PBI の意図した契約変更として PBI コメント付き）: connectionTests.test.ts 4 箇所・trustSettings-r3.test.ts 3 箇所
- 追加発見（改修せず報告のみ・PBI 候補）: checkSourceI18nKeys が data-i18n-aria-label を missing-key チェック対象にしていない。getMessageWithSubstitutions 経由のキーは静的走査で「potentially unused」warn インベントリに入る
- 検証: 担当 8 テストファイル 330 tests 全 green、locale parity 3 green、check-i18n ALL CHECKS PASSED、check-docs-chars 0 violations、type-check 通過、validate:fast green
