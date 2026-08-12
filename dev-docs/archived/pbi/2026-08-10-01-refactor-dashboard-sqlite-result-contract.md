# PBI: ダッシュボードSQLiteの失敗結果を統一する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー
ダッシュボード利用者として、SQLite操作が失敗したときに空結果や成功と誤表示されないことがほしい。なぜなら、障害を正しく認識し、再試行や復旧判断ができる必要があるから。

## 調査結果
着手前のキーワード検索で既存実装を確認した。本PBIは新機能追加ではなく、既存の `ServiceResult` への移行漏れを解消する改善である。

対象:
- `src/dashboard/dashboardSqliteService.ts`
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- `src/dashboard/exportLogsService.ts`
- `src/dashboard/markdownExport.ts`
- 関連テスト

## 5 Whys
1. なぜ利用者が障害を空結果として見るのか。`queryLogs`、`searchLogs`、`queryAuditLogs` が `null` を返す場合があるから。
2. なぜ `null` が障害と空結果を区別できないのか。成功値と失敗値の表現が関数ごとに異なるから。
3. なぜ関数ごとに表現が異なるのか。`ServiceResult` 移行が一部の操作だけで止まっているから。
4. なぜ移行漏れが見逃されたのか。公開関数全体に同じ戻り値契約を検査するテストがないから。
5. なぜ契約テストがないのか。dashboard SQLite moduleの失敗を共通のtest surfaceとして扱う設計が明文化されていないから。

根本原因: SQLite操作の失敗分類と結果変換が公開関数ごとに分散している。

## BDD受け入れシナリオ

```gherkin
Scenario: 履歴検索が成功すると空結果と成功を区別できる
  Given SQLiteが利用可能で検索結果が0件である
  When 利用者が履歴検索を実行する
  Then システムは成功した空結果を返す
  And 失敗として扱わない

Scenario: SQLite障害時に検索を成功扱いしない
  Given SQLite通信がタイムアウトする
  When 利用者が履歴検索またはMarkdown出力を実行する
  Then システムは失敗結果を返す
  And 空のファイルや成功通知を返さない

Scenario: 再試行可能な障害が伝播する
  Given SQLite操作が再試行可能な通信障害で失敗する
  When dashboard SQLite moduleが結果を返す
  Then 呼び出し側は再試行可能であることを判定できる
```

## 受け入れ基準
- [ ] 対象の公開SQLite操作がすべて同じ結果契約を使う。
- [ ] 成功した0件と通信・DB障害を型とテストで区別できる。
- [ ] タイムアウト、offscreen消失、認証失敗の失敗理由が失われない。
- [ ] Markdown出力はSQLite失敗時にダウンロード成功を通知しない。
- [ ] 既存の成功時UI表示と空結果表示が変わらない。
- [ ] `npm run type-check` と関連テストが成功する。

## テスト戦略（TDD）

### Outside-In手順
1. dashboardの利用者シナリオテストを先に追加し、現状の誤成功をRedで確認する。
2. dashboard SQLite serviceの契約テストを追加する。
3. 個別関数の失敗変換テストを追加する。
4. 実装を最小変更してGreenにする。
5. 重複した失敗変換を整理し、Greenを維持する。

### 統合テスト
- dashboard serviceからpanel/export moduleへ失敗結果が伝播する。
- 0件成功が空表示となり、障害がエラー表示となる。
- timeout結果が成功通知へ変換されない。

### 単体テスト
- `queryLogs` の成功・0件・失敗。
- `searchLogs` の成功・0件・失敗。
- `queryAuditLogs` の成功・0件・失敗。
- `getLogCount` の成功・0件・失敗。
- `getSqliteStatus` の初期化成功・失敗。
- `retriable` の保持。
- 未知の例外の安全な分類。

## 実装手順
1. `dashboardSqliteService.ts` の公開関数と現行戻り値を一覧化する。
2. 既存の `ServiceResult` と既存テストを読み、成功・失敗キーを確認する。
3. まず呼び出し側のBDDテストを追加する。
4. 各対象関数の失敗ケースをRedで追加する。
5. 共通の失敗変換を利用して対象関数を統一する。
6. panel/export側の `null`、`-1`、成功値内包の分岐を、結果契約に合わせて更新する。
7. テストをGreenにする。
8. 関数ごとの重複分岐を削除し、型チェックを実行する。
9. 既存のエラー文言、i18nキー、成功表示を変更していないことを確認する。

## 落とし穴
- `null` は空結果ではなく通信失敗を表していた箇所があるため、機械的な置換をしない。
- `getLogCount` の `-1` を0へ変換すると障害を隠す。
- dashboardのuser-facing textは既存i18nを再利用する。

## 見積もり
3ポイント。PBI単独で完了可能だが、PBI-02のSqliteClient整理後に実施すると重複変更が減る。

## Definition of Done
- [ ] BDDシナリオが自動テスト化される。
- [ ] 統合・単体テストが追加される。
- [ ] `npm run type-check` と関連テストが成功する。
- [ ] Green後の重複整理が完了する。
- [ ] 変更範囲と結果契約がコードコメントまたは開発者文書で説明される。
- [ ] コードレビューが完了する。
