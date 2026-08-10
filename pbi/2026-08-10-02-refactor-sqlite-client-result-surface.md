# PBI: SqliteClientの重複結果メソッドを削除する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー
開発者として、SQLite操作の結果を1つの結果経路で扱いたい。なぜなら、失敗理由を失う薄いwrapperと重複したテスト配線をなくし、障害時のデータ保全を高めたいから。

## 調査結果
キーワード検索で `SqliteClient`、`*Result` メソッド、テストハーネスを確認した。本PBIは既存のResult側へ整理する改善であり、SQLite機能の追加ではない。

対象:
- `src/background/sqliteClient.ts`
- `src/background/handlers/__tests__/dashboardSqliteTestHarness.ts`
- recording pipeline、migration、purge、dashboard handlerのcaller
- `src/background/__tests__/sqliteClient-unit.test.ts` など

## 5 Whys
1. なぜ失敗時の情報が失われるのか。`insert`、`query`、`getCount` などが `null` やbooleanへ変換するから。
2. なぜ情報を変換するのか。同じ操作にResult版と簡易版の2つの公開面があるから。
3. なぜ2つの公開面が残ったのか。既存callerを壊さず段階移行するためのwrapperが恒久化したから。
4. なぜ恒久化したのか。どのcallerが情報を必要とするかを整理せず、テストハーネスにも二重APIの対応表を持たせたから。
5. なぜ対応表が問題になるのか。moduleの本当のtest surfaceが1つではなく、実装とテストで別々に複製されているから。

根本原因: `SqliteClient` のInterfaceが成功値中心と理由付き結果中心に二分され、情報を捨てる変換がcallerへ漏れている。

## BDD受け入れシナリオ

```gherkin
Scenario: SQLite操作の成功結果をcallerが利用する
  Given SQLiteが利用可能である
  When recording pipelineがレコードを保存する
  Then 保存成功の結果を受け取る
  And 既存の保存フローが完了する

Scenario: SQLite障害時に失敗理由が失われない
  Given SQLite操作が失敗する
  When recording pipelineまたはpurge処理が結果を受け取る
  Then 処理は失敗として扱う
  And 空件数や成功として扱わない
  And 失敗理由をログ・再試行判断へ渡せる

Scenario: 新しいSQLite操作を追加してもテスト対応表が不要である
  Given SqliteClientに操作を追加する
  When その操作のResultをテストする
  Then 個別の結果メソッド対応表を更新せずにテストできる
```

## 受け入れ基準
- [ ] 対象操作についてResult側を唯一の公開結果経路にする。
- [ ] `null`、boolean、`-1`へ情報を捨てる公開wrapperを削除または内部限定化する。
- [ ] `RESULT_METHOD_SOURCES` と派生メソッド合成が不要になる。
- [ ] recording、migration、dashboard、purgeのcallerが新しい結果経路を明示的に処理する。
- [ ] 失敗と0件・0件数を区別できる。
- [ ] 既存の成功フローと再試行方針を維持する。

## テスト戦略（TDD）

### Outside-In手順
1. recording保存とpurgeの統合テストで「失敗が0件成功になる」期待を先に固定する。
2. 各callerをResult経路へ切り替えるテストをRedで追加する。
3. SqliteClientの操作ごとに成功・失敗・境界値を追加する。
4. wrapper削除後にテストハーネスが壊れることを確認し、直接Resultを返す形へ直す。
5. Green後に不要な変換と型を削除する。

### 統合テスト
- recording保存失敗がoffline queueまたは失敗結果になる。
- count失敗が0件として表示されない。
- purge失敗が「0件削除」と報告されない。
- dashboard handlerの全操作で失敗理由が維持される。

### 単体テスト
- insert/query/search/update/delete/toggleStar/getCountの成功。
- 各操作のDBエラー・タイムアウト・初期化失敗。
- 0件検索と0件countの成功。
- retryableの保持。
- `categorizeError` の既存分類境界。
- test harnessが結果メソッドを手動合成しないこと。

## 実装手順
1. `sqliteClient.ts` のResult版と簡易版を表にする。
2. 全callerを検索し、簡易版を使う箇所を分類する。
3. まずcallerの失敗テストを追加する。
4. callerをResult版へ移行し、情報を捨てる判断はcaller内で明示する。
5. テストハーネスの `RESULT_METHOD_SOURCES` 依存を直接Result実装へ置き換える。
6. すべてのcallerが移行したことを検索で確認する。
7. 簡易wrapperを削除する。外部利用が残る場合は内部限定にして、削除条件をテストで固定する。
8. コンパイルエラーを移行漏れ検出に利用する。
9. 全テストと型チェックを実行する。

## 落とし穴
- `?? 0`、`|| 0` は障害を隠す可能性がある。
- 成功結果のshapeを変更する場合、dashboard handlerのprotocol型と整合させる。
- `lastError`の共有可変状態を復活させない。
- テスト用mockだけResultを実装し、本番callerを簡易版に残さない。

## 見積もり
3ポイント。PBI-01とは関連するが、SqliteClientからcallerへ結果経路を整えるため、PBI-02を先に実施する。

## Definition of Done
- [ ] 主要callerがResult経路へ移行する。
- [ ] 重複wrapperと結果メソッド対応表が削除される。
- [ ] BDD、統合、単体テストが成功する。
- [ ] `npm run type-check` が成功する。
- [ ] 既存の失敗分類と再試行挙動が維持される。
- [ ] コードレビューが完了する。
