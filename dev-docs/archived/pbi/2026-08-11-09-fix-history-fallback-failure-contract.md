# PBI: fallback検索失敗時の履歴結果を安全に扱う

## ユーザーストーリー

開発者として、tag fallback検索が失敗したときに過剰な未フィルタ履歴を返さないようにしたい。なぜなら、検索失敗を成功として表示すると最大5000行の不要な描画、totalとの不整合、誤った検索結果表示が発生するから。

## ビジネス価値

- 履歴画面が検索障害時に誤った成功結果を表示しない。
- 大量行描画によるDashboardの負荷を防ぐ。
- 空結果、検索失敗、tag未一致を利用者が区別できる。

## 実装済み確認

fallback検索とtag fallback noticeは既に実装されている。一方、fallback検索失敗時は元のover-fetchした行とtotalを返す既存挙動が残っている。本PBIはその失敗契約を明示的で安全な結果へ改善する。

```bash
rg -n "fallbackTerm|searchResult|raw over-fetched|TAG_FILTER_FETCH_LIMIT" src/dashboard/panels/asyncData/sqliteHistoryQuery.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: tag fallback検索が成功する
  Given tag filterに一致する履歴がない
  And fallbackの全文検索に一致する履歴がある
  When 履歴を検索する
  Then fallback検索結果だけが返される
  And fallback通知に検索結果件数が表示される
  And 最大5000行のtag取得用行は表示結果へ漏れない

Scenario: tag fallback検索が失敗する
  Given tag filterに一致する履歴がない
  And fallbackの全文検索が失敗する
  When 履歴を検索する
  Then 元の未フィルタ行を成功結果として返さない
  And totalと表示行数が不整合にならない
  And 呼び出し側が検索失敗として表示できる結果を返す

Scenario: fallback検索結果が空である
  Given tag filterに一致する履歴がない
  And fallbackの全文検索が成功するが0件である
  When 履歴を検索する
  Then空の履歴結果が返される
  And fallback通知は表示されない
  And通常の空結果表示が行われる

Scenario: fallback検索が短い検索語で実行できない
  Given tag名が全文検索の最小長未満である
  When fallback検索を実行する
  Then既存の検索制約に従って安全に処理される
  And大量の未フィルタ行を返さない
```

## 受け入れ基準

- [ ] fallback検索失敗時に未フィルタのover-fetch行を成功結果として返さない。
- [ ] 失敗と0件を統一query resultで区別できる。
- [ ] totalとrowsの不整合が発生しない。
- [ ] fallback成功時の通知と結果表示を維持する。
- [ ] fallback空結果時に通知を表示しない既存仕様を維持する。
- [ ] TAG_FILTER_FETCH_LIMITの大量行がpanelへ漏れない。
- [ ] tag、検索語、timestamp境界のテストがある。
- [ ] type-check、関連テスト、buildが成功する。

## テスト戦略（Outside-In）

### E2Eテスト

- tag filterからfallback検索へ遷移した際の成功、0件、失敗表示を確認する。

### 統合テスト

- SQLite query failureがpanelのerror stateへ伝播することを検証する。
- fallback結果のrows/total契約とlegacy enrichmentを検証する。

### 単体テスト

- fallback success、empty、failureの分岐を検証する。
- over-fetch行が返却されないことを検証する。
- 短い語、offset、limit、同一bucketの境界値を検証する。

## 実装アプローチ

- `queryHistory`のfallback失敗結果を明示的なServiceErrorへ変換する方針を第一候補とする。
- panelは既存のerror表示経路を利用し、空結果へ変換しない。
- fallback成功時だけtagFallback metadataを付与する。
- TAG_FILTER_FETCH_LIMITはstorage query内部に閉じ込め、panelへ露出させない。

## 見積もり

2pt（中）

## 技術的考慮事項

- 既存のlegacy panelとduplicate checkのquery経路は変更しない。
- SQLite障害を成功・0件へ変換しない。
- HTML sanitizationとtag fallbackのi18n表示を維持する。
- panelのrequest generation guardと整合させる。

## Definition of Done

- [ ] BDDシナリオが自動テスト化されパスする。
- [ ] fallback failure、empty、successの結果契約が固定される。
- [ ] 最大5000行のover-fetch漏れがない。
- [ ] panelのerror/loading表示が維持される。
- [ ] type-check、validate、buildが成功する。
- [ ] コードレビューが完了する。
