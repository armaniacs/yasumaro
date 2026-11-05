# PBI: base差分レビュー残件の処理（correctness MED以下＋security Info）

## ユーザーストーリー

開発者として、土台 collection 差分のレビューで出た非ブロッカー指摘を漏れなく処理したい。HIGH 2件・Low-spoof 1件・ids 上限は先行修正済みで、残りは開示文言・上限・微性能・境界表示だから。

## 優先度

- 順位: 低（フォロー、急ぎなし）
- RICEスコア: 1.2（Reach=0.5 / Impact=1 / Confidence=60% / Effort=0.25人週）
- 根拠: いずれも表示・上限・微性能で、データ喪失や誤回答の主経路ではない。確信度を下げたのは件数が多く見積もり幅があるため。

## BDD受け入れシナリオ

Scenario: ask回答で落としたテキスト条件を開示する
  Given search＋ids のコレクションがある
  When ask が pins のみで回答する
  Then 落としたテキスト条件の旨が回答か suggestion に出る

Scenario: handoff競合が黙って捨てない
  Given 未処理の handoff 要求がある
  When 2件目の handoff 要求が来る
  Then queue されるか dropped-previous が返る

Scenario: 古いpreviewが再マウント後に描画しない
  Given countForClause が飛行中である
  When リージョンが破棄され再マウントする
  Then 旧世代の結果は描画されない

## 受け入れ基準

- [ ] C-#4: searchDropped 相当の note 開示（文言は owner 確認）
- [ ] C-#6: handoff bus の queue 化か dropped 応答
- [ ] C-#7: destroy() 時の previewGeneration++（再マウント塗り防止）
- [ ] C-#8: validators＋canonical の ids 整数・非負チェック（parse 側は先行済み）
- [ ] C-#9: collection-mode paging の上限 clamp
- [ ] C-#10: truncated フラグの過報告修正（全 union で判定か近似表示）
- [ ] S-#3: ExportResearchReportValidator の ids 長上限（吸収設計の文書化でも可）
- [ ] S-#4: readClause の clause 文字列上限＋tag 正規表現 cache（計測付き）
- [ ] 各件に単体 pin（既存テストの隣に配置）

## テスト戦略

- 単体: 各件の pin（開示文言・queue・世代・整数・clamp・flag・上限・cache）
- 回帰: dashboard／messaging 帯の既存全緑

## 見積もり

0.25人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ)

## 出典

- correctness レビュー 10件（HIGH 2件は先行修正: pins-only `askEvidence.ts`・AND窓 `collectionHistoryQuery.ts`）
- security レビュー 4件（Low-spoof の report title・ids 上限は先行修正）
