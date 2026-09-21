# PBI: FTS/LIKE 検索の実行スケルトンを helper に骨格統一する

種別: refactor
見積もり: 1pt
優先度: 順位 7 / RICE 10（Reach 5 / Impact 1 / Confidence 1.0 / Effort 0.5 週）
根拠: 検索パス修正の波及構造化

## ユーザーストーリー

検索機能を保守する開発者として、FTS 検索と LIKE 検索の実行手順（count 取得と rows 取得のスケルトン）を単一の helper に統一してほしい、なぜなら検索系の修正（params 順序・tag と text の組み合わせ・deleted フィルタ）が 2 から 3 箇所のスケルトンへ個別適用になり、取りこぼしが発生するから。

## ビジネス価値

検索パスへの修正適用漏れを構造的に防ぐ。params 順序や tag 条件や deleted フィルタといった検索系の変更が単一箇所の修正で全パスへ波及するため、回帰の混入確率とレビュー負荷が下がる。挙動自体は不変であり、利用者への影響はない。

## BDD受け入れシナリオ

```gherkin
Scenario: FTS 検索の結果が helper 経由でも同一である
  Given FTS パスで text と tag を指定した検索クエリがある
  When  統一後の helper 経由で count と rows を取得する
  Then  統一前と byte 等価の SQL 文・params 順序・rows・total が返る

Scenario: LIKE 検索の結果が helper 経由でも同一である
  Given LIKE パスで text と tag を指定した検索クエリがある
  When  統一後の helper 経由で count と rows を取得する
  Then  統一前と byte 等価の SQL 文・params 順序・rows・total が返る

Scenario: 不正な order 指定の policy が caller ごとに保たれる
  Given orderBy と orderDir に範囲外の値を含む検索クエリがある
  When  offscreen 経路と IDB 経路でそれぞれ検索を実行する
  Then  offscreen 経路は DESC への coerce を維持し IDB 経路は従来の error 扱いを維持する
```

## 受け入れ基準

- [x] FTS と LIKE の実行スケルトン（extraWhere 構築から count 取得・rows 取得まで）が単一 helper に統一されている
- [x] FTS と LIKE の差分が builder 選択と tag-path（`fts` / `like`）の 2 要素に限定されている
- [x] 不正 order 指定の扱い（error と coerce）が caller ごとに引数で保持され、既存の差異が変わっていない
- [x] SQL 文・params 順序・rows・total が統一前と byte 等価である（挙動不変）
- [x] IDB 側への拡張有無を実装時に判定し、その判断と理由を PBI に記録した（S で止めるか M に伸ばすか）
- [x] 全 BDD シナリオが実装されパスしている

## テスト戦略

t_wada スタイル（Outside-In TDD）で進める。まず受け入れレベルのテストとして、FTS と LIKE の各パスについて統一前後での SQL 文・params 順序・rows・total の byte 等価を検証するテストを書く（Red）。次に helper を実装して Green にする。単体テストでは path から builder と tagPath を選ぶ対応表（`fts` / `like` の 2 行テーブル相当）の分岐と、error 扱いと coerce 扱いの policy 引数の切り分けを検証する。tag と text の組み合わせ条件と deleted フィルタの有無の行列を通し、既存の検索系テスト一式が全て Green であることを確認する。

## 実装アプローチ

offscreen 側に `runCountAndRows` helper（または path から builder と tagPath を引く 2 行テーブル）を新設する。helper は `buildExtraWhereSql` の構築・`selectTagFilter` の選択・`buildSearchOrderClause` の適用・`build*SearchStatements` による文組立・count SQL の実行・rows SQL の実行・行 mapping（`pushSearchRow`）の各手順を受け持ち、caller は path（FTS か LIKE か）と error policy（error か coerce か）だけを渡す。SQL 文の組立自体は `queryPlan.ts` の `buildFtsSearchStatements` と `buildLikeSearchStatements` に PBI-34 で統一済みのため触らない。IDB 側（`IdbVfsBackend.ts`）への拡張は実装時に判定し、S の範囲で止めるか M に伸ばすかを PBI に記録する。

## 見積もり

1pt（0.5 週想定）。挙動不変のリファクタであり、新規機能や SQL 文自体の変更は含まない。IDB 側へ拡張する場合は別途見積もりを見直す。

## 技術的考慮事項

- SQL 文組立は `queryPlan.ts` の `buildFtsSearchStatements` と `buildLikeSearchStatements` に PBI-34 で統一済みであり、今回の対象はその周囲の実行手順（extra 構築・tag 選択・order 適用・count 実行・rows 実行・行 mapping）のみである
- offscreen 経路は不正 order を DESC に coerce し、IDB 経路は error 扱いとする既存の意図的な差異があるため、helper は error policy を引数化して caller ごとの差異を消さないこと
- 行 mapping は offscreen が `mapNamed`、IDB が `mapPositional` と異なるため、共通化する場合は codec の差異を吸収する層を設けるか、IDB 拡張を見送って S に留める判断があり得る
- 失敗時の放置構造として、params 順序・tag と text の組み合わせ・deleted フィルタの修正が 2 から 3 スケルトンへ個別適用になり取りこぼす問題があり、本 PBI で単一適用点にする

## 実装者向け注記

- Evidence 1: `src/offscreen/opfsWorker/searchHandlers.ts:49-76` 付近の `handleSearchFts` と `src/offscreen/opfsWorker/searchHandlers.ts:78-106` 付近の `handleSearchLike` は、`buildExtraWhereSql` から `selectTagFilter`、`buildSearchOrderClause`、`build*SearchStatements`、count SQL、rows SQL、`pushSearchRow` までの同一スケルトンであり、差分は builder と tag-path の `fts` / `like` のみである
- Evidence 2: `src/offscreen/IdbVfsBackend.ts:100-120` 付近の FTS branch に第 3 のコピーがあり、LIKE と plain も同型である。差分は `mapPositional` と `mapNamed` の codec 差異と、order policy の error 扱いと coerce 扱いの差異である
- Evidence 3: SQL 文組立は `src/offscreen/queryPlan.ts:470-531` の `buildFtsSearchStatements` と `buildLikeSearchStatements` に PBI-34 で統一済みであり、残る重複は周囲の実行手順である
- 既知の意図的差異: `src/offscreen/opfsWorker/searchHandlers.ts:61-64` のコメントにある通り、不正 order の coerce（offscreen）と error 扱い（IDB）は意図的な差異であり、統一時に消さないこと

## Definition of Done

- [x] 全 BDD シナリオが実装されパスしている
- [x] コードレビューが完了している
- [x] 統合検証が green である
