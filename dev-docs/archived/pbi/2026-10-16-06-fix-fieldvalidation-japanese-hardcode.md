# PBI: fieldValidation の日本語直書きエラーメッセージを i18n 化

## ユーザーストーリー
英語ロケールの利用者として、AI プロバイダーのベース URL 検証エラーが英語で表示されてほしい。なぜなら日本語のエラーは内容が理解できず、正しい URL の入力に進めないから。

## 優先度
- 順位: 06 / 11
- RICEスコア: 4.0（Reach=4 / Impact=1 / Confidence=1.0 / Effort=1.0）
- 根拠: 非日本語ユーザーへの直接実害。辞書キー追加（ja/en）＋置換＋テストで SP 1.0。

## 背景
`src/dashboard/settings/fieldValidation.ts:240` 付近のドメインホワイトリストエラー（「このドメインは許可リストにありません…」＋動的プロバイダー一覧）が日本語直書き。レビュー指摘 Low #4（i18n）。NN02 と同じく `public/_locales/{ja,en}/messages.json` を触るため、**NN02 とは直列**（本 PBI を NN02 の後に実施）。

## BDD受け入れシナリオ
Scenario: 英語ロケールで英語のエラーが出る
  Given 許可外ドメインのベース URL を入力する
  When 英語ロケールで検証する
  Then 英語のエラーメッセージが表示される

Scenario: 日本語ロケールの表示は変わらない
  Given 同上の入力
  When 日本語ロケールで検証する
  Then 従来どおりの日本語メッセージが表示される

Scenario: 動的一覧（プロバイダー数・ドメイン）は維持される
  Given 同上の入力
  When いずれのロケールでも検証する
  Then プロバイダー数・ドメイン一覧の情報が欠落しない

## 受け入れ基準
- [x] 日本語直書きが i18n キー経由になる（ja/en 双側にキー追加、動的部分は substitutions）
- [x] `npm run check-i18n` 緑（対称性維持）
- [x] fieldValidation 系テストが全緑（新規テスト1件以上）

## テスト戦略
- 単体: ロケール別のメッセージ検証テスト
- 既存: `npx vitest run src/dashboard/settings/` 全緑
- i18n: `npm run check-i18n`

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：キー化＋ja/en双側追加）
- [x] ドキュメント更新済み（不要ならその旨を記録）
