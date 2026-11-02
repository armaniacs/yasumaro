# PBI: history-list の multi-clause 本実行 (延期可)

## ユーザーストーリー

ダッシュボード利用者として、複数条件や pin 留めのコレクションを履歴一覧に適用したい。現行は v2 が history list に届かず、recall しても単一条件か空に化けるから。

## 優先度

- 順位: 7 / 7 (延期可)
- RICEスコア: 0.28（Reach=0.2 / Impact=2 / Confidence=70% / Effort=1.0人週）
- 根拠: PBI 03 の規約固定後に実施する。合算 cap と一体でないと出せない。

## BDD受け入れシナリオ

Scenario: 複数句コレクションを履歴一覧に適用する
  Given OR の2句コレクションがある
  When 履歴一覧に適用する
  Then 両句に合う記録が一覧に並び、total は合算件数になる

Scenario:  clause が多すぎると先頭句のみになる
  Given 上限超の clause 数のコレクションがある
  When 履歴一覧に適用する
  Then 先頭句のみで表示し、上限超えの警告が出る

Scenario: pin 留めが履歴一覧に出る
  Given ids 付きコレクションがある
  When 履歴一覧に適用する
  Then pin 留め記録が一覧に並ぶ (削除済みは除外表示)

## 受け入れ基準

- [ ] `applyCollection` を `parseCollectionQueryV2` + `resolveCollectionQueries` ベースに切り替える
- [ ] 実行は clause 毎の複数 query → `mergeClauseResults` → ids 指定の再取得によるページングとする (N+1 を許容し、clause 数上限で抑える)
- [ ] clause 数上限 (`MAX_COLLECTION_FANOUT=8` を `utils/limits.ts` に新設。超過時は先頭 clause + 警告表示)
- [ ] 合算行数上限 (`MAX_COLLECTION_ROWS=200` を新設。超過分は打ち切り表示)
- [ ] 並べ替えは `created_at` 基準とし、`relevance` の横断比較はしない (rank は clause 横断で無意味のため)
- [ ] 削除済み欠けは除外表示する (エラーにしない)
- [ ] PBI 03 の recall 規約と矛盾しないこと (適用先・表示の整合)

## テスト戦略

- 単体: fan-out と merge のテスト (上限・打ち切り・欠け除外)
- 単体: cap 定数の pin テスト
- 統合: 履歴一覧への適用 E2E (複数句・ids・上限超)
- 回帰: 履歴パネル E2E の既存通し

## 見積もり

1.0人週

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (本 PBI 範囲のみ)
