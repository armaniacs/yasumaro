# PBI: ask の collection V2 対応

## ユーザーストーリー

ダッシュボード利用者として、保存済みコレクションを指定した質問で、そのコレクションの条件が効いた回答を得たい。現行は tag/date しか読まず、v2 形では無制限検索に縮退して誤った安心を与えるから。

## 優先度

- 順位: 2 / 7
- RICEスコア: 0.90（Reach=0.5 / Impact=2 / Confidence=90% / Effort=0.5人週）
- 根拠: fail-open の解消。PBI 01 の scope 型を流用する。

## BDD受け入れシナリオ

Scenario: コレクションの tag が質問に効く
  Given tag 付きコレクションを指定した
  When 質問する
  Then その tag の記録だけを証拠候補にし、根拠つきで答えるか「分かりません」と言う

Scenario: 未対応の scope は明示エラーになる
  Given 解決できない条件のコレクションを指定した
  When 質問する
  Then 無制限の回答ではなく、対応範囲外の旨が suggestion に出る

Scenario: タグの部分一致が report と一致する
  Given scope.tag が記録タグの部分文字列に一致する
  When 質問する
  Then report と同じ母集団で証拠を選ぶ (完全一致の取りこぼしをしない)

## 受け入れ基準

- [ ] `normalizeCollectionScope` が V2 形 (`clauses/op/ids`) を読み、単一 tag/date への縮退はやめる (V2 解決は `parseCollectionQueryV2` + per-clause 扱い)
- [ ] `AskCollectionScope` に clauses 解決結果を持たせ、`assembleAskEvidence` の後段フィルタを clauses/op 対応にする
- [ ] per-clause fan-out はやらない (単一 question 検索 + V2 post-hoc を維持)。件数を見て別 PBI で検討
- [ ] 未解決 scope は fail-closed (無制限回答を作らず、対応範囲外の旨を suggestion に出す)
- [ ] `matchesCollectionScope` の tag 判定を SQL と同じ部分一致 (`rowMatchesTagLike` 相当) に直す (import ban に注意し `utils/` への hoist か parity test 付き複写)
- [ ] `askHistoryEvidence.realEngine.test.ts` の seam 呼び出し pin を更新する
- [ ] offscreen 側の変更はしない

## テスト戦略

- 単体: V2 scope の正規化テスト (単一 tag/date、複数 clause、ids、未知 shape の fail-closed)
- 単体: tag 部分一致の parity テスト (SQL 意味論との一致)
- 統合: ask-history E2E の既存通し (質問→回答/分かりません) の回帰
- 回帰: `askHistoryHandlers.test.ts` 全緑

## 見積もり

0.5人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ)
