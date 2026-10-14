# PBI: SQLite検索文ビルダ双子の統一

## ユーザーストーリー
拡張機能の保守担当者として、FTS／LIKEの文ビルダ双子とORDER 3兄弟を統一してほしい、なぜなら列追加のたびに複数ファイルの同期が必要で、修正漏れがSQL実行時エラーになるから

## 優先度
- 順位: 04 / 5
- RICEスコア: 2.4（Reach=3 / Impact=2 / Confidence=0.8 / Effort=2.0）
- 根拠: 検索・履歴表示に波及するが変更頻度は低め（R3）。SQL等価性の設計判断が残る（C0.8）。wire表自体は壊さない。依存なし（`messaging/` 内でもNN02とは別ファイル）。

## 背景（holistic-code-review テーマ2）
`queryPlan.ts:484-513` vs `:521-542` は骨格同一でSELECT列のみ相違。ORDERも `sqliteQueryBuilder.ts:92-105` vs `:110-118` vs `:123-128` に分散（`resolveOrderDir:24-30` のみ共有）。cap適用点も3箇所に分散（値は `QUERY_CAPS` にSSOT済み）。read decode（`rowCodec`）とwrite encode（`browsingLogCodec`）＋insert-param 3系統の同期も残る。

## BDD受け入れシナリオ
Scenario: FTS検索が同一結果になる
  Given FTS検索クエリがある
  When 統一後のビルダでSQLを組み立てる
  Then 従来と同一のcount／rows SQLとparamsになる

Scenario: LIKE検索が同一結果になる
  Given LIKE検索クエリがある
  When 統一後のビルダでSQLを組み立てる
  Then 従来と同一のcount／rows SQLとparamsになる

Scenario: 列追加が1箇所で済む
  Given 新しい列を足す
  When 文ビルダの列リストを更新する
  Then FTS／LIKE両経路に反映され、テストが検出できる

## 受け入れ基準
- [x] SELECT列リストとORDER列写像だけを引数化し、SQL骨格が1関数になる（`assembleSearchStatements`＋`buildUnifiedOrderClause` の2 seam。`buildSearchOrderClause` のdispatchは維持）
- [x] 既存のorderby／search-orderテスト群が無修正で緑（変更前後74件緑＋新規等価性テスト `search-statement-twins-equivalence.test.ts` 10件で全文バイト等価＋bind順をpin。`src/offscreen` 98 files / 1254 tests passed、`dashboardSqlite` 65件も緑）
- [x] `sqliteWireTable.ts`／`archiveWireTable.ts`／`dashboardSqliteProtocol.ts` 自体は本PBIでは触らない
- [x] 外部挙動不変（FTS 12列＋rank vs LIKE 11列の差だけを残す。plain の `|| 'created_at'` 意味・エラー優先順・LIKE強制 `created_at DESC` を厳密温存）

## テスト戦略
- E2E: 履歴検索（FTS／LIKE両経路）の表示が変わらないこと
- 統合: offscreen検索ハンドラの順序テスト
- 単体: FTS／LIKEのSQL等価性テスト（新旧比較）、ORDER分岐テスト

## 見積もり
2.0（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
