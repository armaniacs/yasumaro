# PBI: Unified history query moduleを深深化する

## 実装状況

**完了** — 2026-08-11。SQLite history panelへ統一query moduleを適用し、最新row限定enrichmentと既存tag fallbackを実装済み。

## 親PBI

`2026-08-11-01-architecture-deepening-epic.md`

## ユーザーストーリー

開発者として、履歴表示側からSQLiteとlegacy storageの構造差を隠したい。これにより、履歴の取得・enrichment・field mappingを一つのinterface越しに扱い、変更のlocalityとtestabilityを高めたい。

## スコープ

- SQLite履歴とlegacy `chrome.storage.local`情報の取得を一つのmoduleへ集約する。
- SQLite行とlegacy metadataのenrichment規則を集約する。
- snake_case / camelCase変換、分単位bucket matching、欠損値処理を集約する。
- history panelが二つのstorage schemaを直接知らない構造にする。
- SQLite adapterとlegacy storage adapterの役割を明確化する。
- 子PBI 1の保存契約と整合させる。

## 非スコープ

- SQLite schema変更
- legacy storage即時削除
- history panel全体のDOM刷新
- paginationやfilter仕様変更
- Saved URL entry書き込み処理
- 第三の保存先への対応

## 依存関係

子PBI 1完了後に開始し、子PBI 3に先行して完了する。

## 受け入れ条件

```gherkin
Scenario: SQLite履歴を取得する
  Given SQLiteに履歴行が存在する
  When history query moduleで履歴を検索する
  Then SQLite履歴が統一された履歴形式で返される
  And 呼び出し側はSQLite固有のrow schemaを知らない

Scenario: legacy metadataでenrichmentする
  Given SQLite履歴行と対応するlegacy metadataが存在する
  When history query moduleで履歴を検索する
  Then 対応するlegacy metadataが履歴へenrichmentされる
  And snake_caseとcamelCaseの差異はmodule内部で吸収される
  And 呼び出し側は二つのschemaを直接結合しない

Scenario: legacy metadataが欠損している
  Given SQLite履歴行に対応するlegacy metadataが存在しない
  When history query moduleで履歴を検索する
  Then SQLite履歴は失われずに返される
  And 欠損metadataは定義済みの空値または未設定値として扱われる
  And query全体は失敗しない

Scenario: bucket matchingが適用される
  Given SQLite履歴とlegacy metadataのtimestampが完全一致しない
  When history query moduleでenrichmentを実行する
  Then 既存の分単位bucket matching規則が適用される
  And 別の履歴へmetadataが誤って結合されない

Scenario: panelが統一interfaceだけを利用する
  Given SQLite history panelが履歴を表示する
  When panelが履歴データを読み込む
  Then panelはhistory query moduleの統一interfaceだけを呼び出す
  And SQLiteまたはlegacy storageの直接参照を行わない
  And 既存の履歴表示、検索、tag filterの結果が維持される
```

## テスト観点

- SQLite行変換、legacy enrichment、schema変換、bucket matching
- timestamp境界値、欠損metadata、duplicate URL、同一bucket内の複数履歴
- tag filter、日付範囲、pagination
- SQLite adapter障害、legacy storage adapter障害
- 両adapterのfakeを使ったinterface越しテスト
- panelからのstorage schema直接参照防止

## 完了条件

- 履歴表示側がSQLiteとlegacy storageのschemaを直接扱わない。
- enrichmentとmappingの知識がhistory query moduleに集中している。
- SQLite adapterとlegacy storage adapterを通じてテストできる。
- legacy metadata欠損時の履歴表示が維持される。
- 子PBI 3が利用できる安定したquery interfaceが確立される。
- 既存ADRのlegacy履歴保持方針と矛盾しない。

## 実装結果

- `queryHistory`へSQLite取得、legacy enrichment、tag fallbackを集約した。
- 同一URL・同一bucketでは最新SQLite rowだけをenrichment対象にした。
- panelからSQLite/legacy storageの直接参照を除去した。
- legacy panelとduplicate checkは既存経路を維持した。
- 関連テスト、type-check、validate、buildが成功した。
