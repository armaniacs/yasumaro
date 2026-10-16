# PBI: `getMessageOr` の日本語直書きフォールバックを i18n キー化

## ユーザーストーリー
英語ロケールの利用者として、メッセージキーが欠損したときに日本語が表示されないでほしい。なぜなら原因不明の日本語表示はバグに見え、サポート問い合わせの原因になるから。

## 優先度
- 順位: 02 / 11
- RICEスコア: 6.0（Reach=3 / Impact=1 / Confidence=1.0 / Effort=0.5）
- 根拠: 発火はキー欠損時のみだが、英語ユーザーへの実害は直接的。修正はフォールバック文字列の置換のみ。

## 背景
`src/dashboard/settings/ublockImport/sourceManager.ts` の `getMessageOr('ublockSourceDeleted', 'ソースを削除しました')` 等（約10箇所：91, 105, 109, 111, 121, 164, 171, 172 行付近）に日本語フォールバックが直書きされている。レビュー指摘 Low #3（i18n）。

## BDD受け入れシナリオ
Scenario: 英語ロケールでキー欠損時は英語フォールバックが出る
  Given 存在しないメッセージキーでの `getMessageOr` 呼び出し
  When 英語ロケールで評価する
  Then 日本語ではなく英語フォールバック文字列が返る

Scenario: 既存キーの表示は変わらない
  Given 既存の全 `getMessageOr` 呼び出し
  When ja/en 両ロケールで評価する
  Then 従来どおりの表示になる（既存テスト緑）

## 受け入れ基準
- [x] `sourceManager.ts` 内の日本語直書きフォールバックが英語フォールバック（または対応する en キー）に置換される
- [x] `public/_locales/{ja,en}/messages.json` の対称性が保たれる（`npm run check-i18n` 緑）
- [x] `src/dashboard/settings/__tests__/ublockImport.test.ts` 系が全緑

## テスト戦略
- 単体: フォールバック言語のテストを1件追加（en 指定時に日本語が出ないこと）
- 既存: `npx vitest run src/dashboard/settings/` 全緑
- i18n: `npm run check-i18n`

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：フォールバック置換のみ、キー不変）
- [x] ドキュメント更新済み（不要ならその旨を記録）
