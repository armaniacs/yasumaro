# PBI 2026-11-07-12: sqliteQueryBuilder.ts の三役分離

## メタ情報

- ランク: 3/5 (holistic improvement diff round)
- RICE: 0.96 (Reach 3 / Impact 2 / Confidence 0.8 / Effort 5)
- 依存: なし (単独で着手可能)
- 種別: refactor
- 見積: 5SP

## ユーザーストーリー

開発者として、SQL組み立てと面外の責務を分離したい。なぜなら `sqliteQueryBuilder.ts` が845行で三役を抱え、変更時の影響範囲が見えにくいから。

## 背景

`src/offscreen/sqliteQueryBuilder.ts` (全845行) は次の三役を混在させている。

- 役a (SQL組み立て): `buildWhereClause` (:57)、`buildFtsSearchStatements` (:461)、`buildPlainListStatements` (:528)。
- 役b (非SQL parity述語): `matchesExtraWhere` (:283)。`rowMatchesTagLike` の import (:20) を引き連れている。
- 役c (purge実行): `runPurgeSequence` (:746)。内部で `await withTransaction` (:754) を行い、`withTransaction` を import (:21) している。一方でファイル先頭コメント (:11-13) は policy層が transaction を持たない方針を宣言しており、実行責務が builder に残る形になっている。

関連する移動対象は `purgeCutoffMs` (:680)、`PurgeExecutor` (:707)、`PurgeSequenceStatements` と `PurgeSequencePolicy` である。

健全な対照例は次のとおり。`rowCodec.ts:136-150` の `mapNamed` / `mapPositional` は純粋な写像のみ、`browsingLogCodec.ts:29-32` の `toFiniteNumber` は純粋な値変換のみ、`recordsRepo.ts:96-107` の `getStatus` は backend への薄い委譲のみで、組み立てと実行を混ぜていない。

方針は機械的移動のみとする。新規モジュール `queryParityPredicate.ts` に `matchesExtraWhere` (+ `rowMatchesTagLike` 依存) を移し、新規モジュール `purgeRunner.ts` に `runPurgeSequence` (+ `PurgeExecutor` + `purgeCutoffMs`) を移す。builder には SQL組み立てだけを残す。`buildAuditLogStatements` (:835) の caps-divergence コメントは仕様として残し、INTENTIONAL の扱いを変えない。移動前に現行 SQL 出力を golden として固定し、TDD の順序 (先に固定、後に移動) を守る。

## BDD受け入れシナリオ

```gherkin
Scenario: SQL組み立て出力が移動前後で同一になる
  Given リファクタ前の golden スナップショットが記録されている
  When builder だけに残った SQL組み立て関数で同条件のクエリを組み立てる
  Then where句とbind順序とFTS文とplain文が golden と完全一致する

Scenario: purgeシーケンスが単一トランザクションで同一件数を返す
  Given retentionDays と maxRecords を含む purge方針が与えられている
  When purgeRunner の runPurgeSequence が同一 executor と同一文で実行される
  Then withTransaction による一括実行と changes() 合算の件数が移動前と一致する

Scenario: parity述語がSQL条件と一致し続ける
  Given tag と domain と日付範囲を含む同一クエリが与えられている
  When queryParityPredicate の matchesExtraWhere でレコードを判定する
  Then SQL側の抽出結果と in-memory 判定結果が一致する
```

## 受け入れ基準

- [x] `matchesExtraWhere` と `rowMatchesTagLike` 依存が `queryParityPredicate.ts` に機械的に移動し、旧来の import パスは互換 re-export に留める
- [x] `runPurgeSequence` と `PurgeExecutor` と `purgeCutoffMs` が `purgeRunner.ts` に機械的に移動し、`withTransaction` の import が builder から消える
- [x] 移動後の `sqliteQueryBuilder.ts` が縮小し、SQL組み立てのみを持つ (実績845→741行。約600行の見積りに対し残りは純粋なSQL組み立てであり残留が正しいとレビューで承認)
- [x] 移動前に golden で固定した SQL出力 (where/FTS/plain/purge/audit) が移動後も完全一致する
- [x] `buildAuditLogStatements` の caps-divergence コメントを INTENTIONAL 仕様として維持する
- [x] 振る舞い変更なし (purge件数、cap gate、skip guard、countPolicy の分岐が不変)

## テスト戦略 (t_wada スタイル)

### ゴールデンファースト (TEST_RULE 準拠)

- 先に現行 SQL 出力の golden テストを追加する (buildWhereClause / buildFtsSearchStatements / buildPlainListStatements / purge文 / audit文)。
- golden がグリーンであることを確認してから移動を開始する。移動中は golden を壊さない。
- `purgeCutoffMs` の境界値 (retentionDays が null / 0 / 負 / 正) を単体で pin する。

### 統合テスト

- offscreen 関連スイートを実行する (query-backends-parametric、search-sort-parametric を含む)。
- purge の両 countPolicy (always / when-max-records) の分岐が回帰しないことを確認する。

### 単体テスト

- `matchesExtraWhere` の parity ケース (domain/starred/gistSynced/dateFrom/dateTo/ids/tag) を新モジュール側で維持する。
- `runPurgeSequence` の skip guard と changes() 合算ルールを新モジュール側で維持する。

### 型チェック

- `npm run type-check` が通ること。移動時の import 拡張子 (.js) と型参照 (ExtraWhere/QuerySpec) の扱いに注意する。

## 実装アプローチ

- Outside-In ではなく、機械的移動 (move-only) とする。ロジック変更は禁止。
- 手順は golden 追加 -> 移動 -> re-export 整理 -> 行数と出力一致の確認の順とする。
- `buildAuditLogStatements` の INTENTIONAL コメントは原文のまま残す。

## 技術的考慮事項

- 依存関係: なし
- 非互換の可能性: import パス変更のため、呼び出し側の更新と互換 re-export の要否に注意する
- 非機能要件: SQL文字列と実行順序とトランザクション境界を変えない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] golden テストが移動前後で一致する
- [x] offscreen 関連スイートがパスする
- [x] `npm run type-check` がパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
