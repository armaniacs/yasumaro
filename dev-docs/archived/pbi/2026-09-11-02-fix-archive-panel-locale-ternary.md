# PBI 02: archivePanel 復元プレビューの dead ternary を i18n キー化

## ユーザーストーリー

日本語ロケールで archive 復元プレビューを使う利用者として、プレビュー完了メッセージが日本語で表示されてほしい。なぜなら現状は三項演算子の両分岐が同一のハードコード英語 `'Preview ready.'` で、ja ロケールでも常に英語が表示されるから。

## 優先度

- 順位: 02 / 9
- RICE スコア: 60.0（Reach=3 / Impact=1 / Confidence=100% / Effort=0.05 人週）
- 根拠: `src/dashboard/panels/diagnostic/archivePanel.ts:485` —
  `localized('archiveStatusWorking') === 'Working… …' ? 'Preview ready.' : 'Preview ready.'`
  比較は常に false（ja では左辺が日本語、en でも意味を持たない死んだ比較）で、表示は常に英語固定文字列。

## BDD 受け入れシナリオ

```gherkin
Scenario: ja ロケールで復元プレビュー完了時に日本語メッセージが出る
  Given ロケールが ja
  When  復元プレビューが完了する
  Then  ステータスに i18n キー archiveRestorePreviewReady の日本語文言が表示される

Scenario: en ロケールでも対応する英語文言が出る
  Given ロケールが en
  When  復元プレビューが完了する
  Then  ステータスに archiveRestorePreviewReady の英語文言が表示される
```

## 受け入れ基準

- [x] `archiveRestorePreviewReady` キーを `public/_locales/ja/messages.json` と `en/messages.json` に新設（同数・check-i18n PASS）
- [x] archivePanel.ts:485 の dead ternary を `localized('archiveRestorePreviewReady')` に置換
- [x] 既存 archivePanel テスト green

## テスト戦略

- check-i18n スクリプト PASS（ja/en 同数）
- archivePanel 関連テスト green

## 見積もり

XS（0.05 人週）。種別: fix（i18n）。

## 実装アプローチ

1. ロケール 2 ファイルにキー追加（ja: 「プレビューを準備しました。」en: "Preview ready."）
2. dead ternary 削除・置換

## 実装メモ（2026-09-11）

- `archiveRestorePreviewReady`（ja: プレビューを準備しました。/ en: Preview ready.）を新設し、dead ternary を `localized('archiveRestorePreviewReady')` に置換。
- check-i18n PASS（ja/en 同数）。
