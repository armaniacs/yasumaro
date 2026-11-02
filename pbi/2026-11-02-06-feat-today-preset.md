# PBI: today プリセット (草稿注入)

## ユーザーストーリー

ダッシュボード利用者として、コレクションの初回条件を空から作りたくない。今日の記録を見る preset があれば、1クリックで編集を始められるから。

## 優先度

- 順位: 6 / 7
- RICEスコア: 0.36（Reach=0.3 / Impact=1 / Confidence=80% / Effort=0.33人週）
- 根拠: 依存なし。単日 date clause 1行で表せる。

## BDD受け入れシナリオ

Scenario: today プリセットで編集を始める
  Given コレクションが空の editor である
  When 「今日」を押す
  Then editor に今日の日付 clause が入り、件数プレビューが出る (保存はされない)

Scenario: preset 適用は上書きする
  Given editor に条件が入っている
  When 「今日」を押す
  Then editor の内容が今日の日付 clause に置き換わる (追記ではなく置換)

## 受け入れ基準

- [ ] コレクション editor の冒頭に preset 行を置き、「今日」押下で単日 date clause を editor 草稿に注入する
- [ ] 注入は草稿のみとし、直接保存や自動保存はしない
- [ ] starred/unread/last7 等の preset は作らない (別 PBI の前提が揃ってから)
- [ ] 新規文言キーは日英両 locale に追加し、`npm run check-i18n` が通る

## テスト戦略

- 単体: 注入テスト (空 editor・既存条件の置換・保存が起きないこと)
- 回帰: コレクションパネル E2E の既存通し

## 見積もり

0.33人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ)
