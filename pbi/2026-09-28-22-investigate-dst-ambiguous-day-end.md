# PBI: DST 曖昧時刻における「その日の終端」の意味論の裁定

## ユーザーストーリー

保守者として、夜中をまたぐ DST 遷移ゾーンで「その日の終端」をどの値にするかを裁定したい。なぜなら `endOfLocalDayMs` は曖昧なローカル時刻を `setHours` に渡すため、JS が最初の出現を選ぶ結果、23:00-23:59 が 2 回現れる日では 2 回目の 1 時間が日レンジの範囲外になるからだ。

## ビジネス価値

- DST 遷移日の日レンジが 1 時間ぶんの取りこぼしになる意味論上の未決着を、コードに残ったままにしない。
- 代替 3 案（現状維持 / 後続の出現を採用 / 翌日子刻 − 1ms）の差分を実際に計算した値同士で比較し、影響範囲（既存 pin・翌日の重複・排他契約）を裁定の根拠として固定する。
- 「archiveGuards の厳格契約は別物」という境界を裁定に明記し、後続実装が SSOT 統合を誤って行うことを防ぐ。
- 実害が「範囲フィルタの網羅性のみ」であることを確認し、年数日の漏れの緊急度を正しく評価する。

## 優先度

- 種別: investigate
- 順位: 22 / 23
- RICEスコア: 1.6（Reach=1 / Impact=1 / Confidence=80% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: DST 曖昧時刻で 3 案の終端値を比較した裁定が記録される
  Given 夜中をまたぐ DST 遷移ゾーン（例: America/Santiago の春移行）にいる
  And その日はローカル時刻 23:00-23:59 が 2 回現れる
  When 3 案の終端値（最初の出現 / 2 つの候補の大きい方 / 翌日子刻 − 1ms）を実際に計算して比較する
  Then 採用案の終端値が 23:00-23:59 の 2 回目の区間を含むか否かが判定される
  And 採用・保留の区分と理由が裁定記録として保存される

Scenario: 影響を受ける消費者と既存 pin が裁定に列挙される
  Given localDayRangeFromDateString を消費する日レンジの経路が複数ある
  And endOfLocalDayMs の返り値そのものを pin する既存テストが存在する
  When 採用案を既存 pin へ当てはめる
  Then 影響を受ける消費者と書き換えが必要な pin の一覧が裁定に記録される
  And 次日の重複防止の契約（until + 1 == 次日 since）が維持されるか判定される

Scenario: 実害の範囲が「範囲フィルタの網羅性のみ」と判定される
  Given Chrome の storage に保存される timestamp は UTC である
  And 漏れるのは 23:00-23:59 の反復区間の行だけである
  When 保存側のデータ欠落が起きていないかを確認する
  Then 実害が「日レンジの終端が早すぎる」ことだけであると判定が記録される
  And archiveGuards の厳格契約が本裁定の対象外であることが明記される
```

## 受け入れ基準

- [ ] America/Santiago（春移行）と Lord Howe（30 分オフセット）の遷移日で、3 案の終端値を実際に計算した比較表が記録に残っている（throwaway スクリプトは `/tmp` に置き、コミットしない）。
- [ ] 影響を受ける消費者（`localDayRangeFromDateString` 経由の日レンジ経路と `endOfLocalDayMs` 直呼びの経路）が列挙されている。
- [ ] `until` の排他／包含契約と「翌日の重複なし」契約が各案でどう変わるかが判定されている。
- [ ] 「漏れの実害は範囲フィルタの網羅性のみで、保存データに欠落はない」ことが確認として記録されている。
- [ ] `archiveGuards.cutoffMsFromLocalDate` 等の厳格契約が本裁定の対象外である理由（別ポリシー境界）が明記されている。
- [ ] 採用案・保留案・却下案の区分と理由が裁定記録として保存されている。
- [ ] 裁定は `dev-docs/ADR/2026-09-28-dst-ambiguous-day-end.md` として ADR 化されている。
- [ ] 本 PBI は実装変更を伴わない（`src/` / `entrypoints/` / `testDir/` 配下一切を変更していない）。

## 調査手順

本 PBI は実装を行わない。完了条件は裁定記録の作成と、採用案・保留案の区分の確定である。テスト戦略セクションは置かず、裁定までに実施する調査手順を以下に列挙する。

1. **現状の終端計算の確認**: `src/utils/localDate.ts:83-87` の `endOfLocalDayMs` が `d.setHours(23, 59, 59, 999)` で終端を作ることを確認する。ECMAScript の `setHours` は曖昧なローカル時刻に対して**最初の出現**を選ぶため、23:00-23:59 が 2 回現れる日では 2 回目の区間が終端より後ろになる。この事実を実装ではなく言語仕様として切り分ける。
2. **3 案の終端値の実測比較**: `/tmp` に throwaway スクリプトを置き、America/Santiago（春移行で 23:59:59.998 の次が 01:00 になる）と Lord Howe（30 分 DST）の遷移日で、(a) 現行の `setHours(23,59,59,999)`、(b) 2 つの候補の大きい方（`23:59:59.999` の 2 回目の出現を選ぶ）、(c) `startOfLocalDayMs(翌日子刻) - 1` の 3 値を計算し、ローカル日付・時刻・長さ（ms）を並べた比較表を作る。秋移行（25h の日）と春移行（23h の日）の両方で行う。
3. **消費者の列挙と影響評価**: `src/utils/localDate.ts:95` の `localDayRangeFromDateString` を通る経路（`src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:148`、`src/dashboard/panels/asyncData/sqliteHistoryModel.ts:756`、`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:781`）と、`endOfLocalDayMs` を直接使う経路（`src/dashboard/components/periodFilter.ts:72`）を洗い出す。別意味論の `until`（`src/dashboard/markdownExport.ts:221-224` の T23:59:59）は PBI 11 で意図的に現状維持とされた契約であり、対象外である旨を確認する。
4. **既存 pin への影響の列挙**: `src/utils/__tests__/localDate.test.ts:140-185`（23:59:59.999 / 翌日に漏れない / 23h-25h 範囲）と `:98-103`、`:266-274`（`day.until` を `endOfLocalDayMs(day.since)` と比べる parity）、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:233-251`（`until` と `day.until + 1 === next.since`）を各案に当て、どの assert が書き換え対象になり、どの assert が成立し続けるかを表にする。
5. **排他／包含契約の確認**: `until` は inclusive な終端として渡され、SQL の `timestamp <= until` 相当の条件で使われる。案 (b) は 23:59:59.999 より大きい値（翌日子刻未満）になり得るため、翌日 00:00:00.000 の行が取り込み得る。案 (c) も同様に 23:59:59.999 を超える表現になり得る。`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:250` の `day.until! + 1 === next.since!` が成立するかを 3 案それぞれで確認する。
6. **実害の範囲の確認**: Chrome の storage に保存される timestamp は UTC の epoch ms であり、ローカル日付は表示・フィルタの時点で初めて付与される。したがって「漏れ」は記録の欠落ではなく、範囲フィルタが 1 時間の行を取りこぼすことだけである。保存側の行が残っていることを既存の経路（sqlite の行が残ること）で確認し、緊急度を評価する。
7. **境界の確認**: `src/utils/archiveGuards.ts:91` の `cutoffMsFromLocalDate` はオペレータ入力の strict 契約（往復検証して throw）であり、`src/utils/localDate.ts:16-20` に「意図的なポリシー境界での重複であり統合候補ではない」と明記されている。archive 経路は本裁定の対象外である旨を記録する。
8. **裁定の記録**: 採否・理由・実測表・影響 pin 一覧・除外した契約と除外理由を `dev-docs/ADR/2026-09-28-dst-ambiguous-day-end.md` にまとめ、本 PBI の裁定結果欄へ記入する。実装の follow-up が必要な場合は起票基準（どの pin をどう書き換えるか）を ADR に列挙する。

## 実装アプローチ

本 PBI は調査のみであり実装は行わない。

- **Outside-In**: まず「遷移日の日レンジが最後の 1 時間を取りこぼす」という観測点（実際の終端値の計算）を確認し、その後に代替案を評価する。
- **実測優先**: 3 案の比較は理屈ではなく、実際に計算した値で表にする。JS の `setHours` の曖昧時刻解決は仕様であり、実測なしで議論すると誤った前提に立つ。
- **境界の維持**: `archiveGuards` の厳格契約と `markdownExport` の T23:59:59 契約は対象外であることを裁定に明記し、統合を誘発しない。
- **裁定の可追従性**: 採用・保留・却下の 3 区分に理由を残し、後続 PBI が同じ調査をやり直さないようにする。

## 見積もり

**0.5 SP**

内訳:
- 遷移日での 3 案の実測と比較表の作成（`/tmp` の throwaway スクリプト）: 0.2 SP
- 消費者と既存 pin の影響調査: 0.2 SP
- ADR 化と裁定結果の記入: 0.1 SP

コード変更とテスト追加は含まない。

## 技術的考慮事項

- `src/utils/localDate.ts:83-87` の `endOfLocalDayMs` は `new Date(ts)` に対して `setHours(23, 59, 59, 999)` を呼ぶ。ECMAScript では曖昧なローカル時刻に対して**最初の出現**が選ばれるため、23:00-23:59 が 2 回現れる遷移日では 2 回目の区間が終端より後ろに落ちる。
- `src/utils/localDate.ts:75-82` のコメントは「固定オフセット（`start + 86_400_000 - 1`）を使うと 23h の日で翌日はみ出し、25h の日で最後の 1 時間を切り落とす」と書いている。この固定オフセットの 2 つのバグは解消済みだが、**曖昧時刻の最初の出現を選ぶこと自体は未処理**の残留である。
- `src/utils/localDate.ts:93-96` の `localDayRangeFromDateString` は `since = parseLocalDateStart(value)`、`until = endOfLocalDayMs(since)` を返す。遷移日の 00:00 が存在しないゾーン（春移行で 00:00 が飛ばされる地域）では `parseLocalDateStart` 自身が曖昧時刻に直面しうるため、終端の裁定と同時に確認対象とする。
- 消費者は 4 経路: `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:146-149`（日付選択 → 日レンジ）、`src/dashboard/panels/asyncData/sqliteHistoryModel.ts:756`、`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:781`（クイックボタンの範囲選択）、`src/dashboard/components/periodFilter.ts:70-73`（プリセットの終端）。
- 別意味論の `until`: `src/dashboard/markdownExport.ts:218-225` の `dateRangeToTimestamps` は `new Date(endDate + 'T23:59:59')` を使う。コメントに「歴史的な markdownExport 契約であり 23:59:59.999 へ広げると既存の export 対象が変わる」と明記されている。PBI 11 で意図的に現状維持とされたもので、本裁定の対象外である。
- 別契約: `src/utils/archiveGuards.ts:91` の `cutoffMsFromLocalDate` はオペレータ入力に対する strict 検証（往復検証して throw）で、`src/utils/localDate.ts:16-20` に「意図的な重複であり統合候補ではない」と明記されている。`src/dashboard/panels/diagnostic/archivePanel.ts:19,437` が利用している。archive の cutoff 日は 00:00:00 で締め、終端の曖昧時刻問題とは別軸である。
- 既存 pin: `src/utils/__tests__/localDate.test.ts:140-148` は「全ローカル日で until が 23:59:59.999 になる」ことを要求しており、案 (b) では移行日に反復側の値になるため成立しない。`:150-159` の「翌日に漏れない」は 3 案いずれでも成立すると期待される（要確認）。`:161-168` の 23h-25h 範囲は案 (b) で 25h 日が 25h ちょうどに近づく。`:266-274` の parity は `day.until === endOfLocalDayMs(day.since)` を比較しているため、両者を同時に変えれば機械的には通る。
- `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:233-245` は TZ 非依存になるように `new Date(2026, 7, 8, ...)` で期待値を組み立てている。`:247-251` は `day.until! + 1 === next.since!` で連続性を要求している。案 (b) / (c) ではこの等式が成立するかが裁定の分岐点になる。
- CI はタイムゾーンを固定していないが、`src/utils/__tests__/localDate.test.ts:120-129` のコメントが「ランナーのゾーンがどの日が日長が変わるかを決め、00:00 が存在しないゾーンでは cursor 方式が破れる」と明記し、`:170-172` が「UTC / JST / IST のような固定オフセットゾーンでは日長が変わる日のアサーションが空振り（vacuous）になる」と書いている。したがって本件は CI では観測できず、`/tmp` の throwaway でタイムゾーンを切り替えた手計算で裁定する。
- 保存される timestamp は UTC epoch ms であり、ローカル日付は表示・フィルタ時に付与される。したがって「漏れ」の実害は範囲フィルタの網羅性のみで、保存データそのものの欠落ではない（保存行が失われるわけではない）。影響を受ける日は DST 遷移日のみ（年数日）であり、緊急度は高くない。
- 案 (b) の実装は「2 つの候補の大きい方を採用」になる。候補は `23:59:59.999` の 1 回目と 2 回目で、`setHours` を 1 通りのみで 1 回戻しても 2 回目の出現は取れない。オフセット差（`d.getTimezoneOffset()`）の変化を検知してから `setHours(23,59,59,999)` を再実行する方法が現実的である。計算コストと実装の複雑さが裁定の判断材料になる。
- 案 (c) は `startOfLocalDayMs(翌日の 00:00) - 1` だが、00:00 自体が存在しないゾーン（春移行で 00:00 が飛ばされる地域）では `startOfLocalDayMs` が 01:00 に寄るため、「-1ms」で 24h になる保証がない。この点は実装前に実測で詰める必要がある（`src/utils/__tests__/localDate.test.ts:121-129` のコメントはこの問題を指摘している）。
- 案 (c) は最も単純だが、`endOfLocalDayMs` の返り値そのものを pin する既存テスト（`src/utils/__tests__/localDate.test.ts:179`、`:272`、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:244`）の意味が変わる（23:59:59.999 でなくなる可能性）。

## 実装者向け注記

### 現状コードの確認

- `src/utils/localDate.ts:83-87` が `endOfLocalDayMs`、`src/utils/localDate.ts:93-96` が `localDayRangeFromDateString`。SSOT の担当範囲は `:1-30` のヘッダコメントで 3 責務に限定されている。
- 消費側は `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:146-149`、`src/dashboard/panels/asyncData/sqliteHistoryModel.ts:756`、`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:781`、`src/dashboard/components/periodFilter.ts:70-73`。
- 対象外契約は `src/dashboard/markdownExport.ts:218-225`（T23:59:59 の export 契約）と `src/utils/archiveGuards.ts:91`（strict な archive cutoff）。
- 既存 pin は `src/utils/__tests__/localDate.test.ts:98-103,140-185,266-274` と `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:233-251`。
- 本 PBI の成果物は裁定記録（ADR）であり、コード変更は発生しない。

### 実装手順

1. `src/utils/localDate.ts:75-87` のコメントと実装を読み、「固定オフセットの 2 バグは解けたが、曖昧時刻の最初の出現を選ぶ残留がある」ことを確認する。
2. `/tmp` に throwaway スクリプトを作り、タイムゾーンを `America/Santiago` と `Australia/Lord_Howe` に切り替えて 2026 年の遷移日を列挙する（コミットしない）。
3. 各遷移日で 3 案の終端値を計算し、日付・現地時刻・`until - since`（ms）・「23:00-23:59 の 2 回目の区間を含むか」を並べた比較表を作る。
4. 案 (c) について、00:00 が存在しない移行日（春移行で日付が飛ぶゾーン）で `startOfLocalDayMs` が意図しない値にならないかを確認する。なる場合は案 (c) を却下する材料とする。
5. 4 つの消費経路に 3 案を当て、`since` / `until` がどう変わるかを表にする。`src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:143-144` の「DST day はちょうど 1 回カバーし、隣接日に混ざらない」というコメントとの整合も確認する。
6. 既存 pin（`src/utils/__tests__/localDate.test.ts:140-148,161-168,179,272`、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:244,250`）に 3 案を当て、成立／不一致／書き換え対象を判定する。
7. `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:250` の連続性等式（`until + 1 === next.since`）が各案で成立するかを明示的に確認する。
8. 保存 timestamp が UTC であり漏れの実害が範囲フィルタの網羅性のみであることを確認する。archive 経路（`src/dashboard/panels/diagnostic/archivePanel.ts`）が対象外の strict 契約である理由を記録する。
9. 採否・理由・実測表・影響 pin 一覧・除外契約と除外理由を `dev-docs/ADR/2026-09-28-dst-ambiguous-day-end.md` にまとめる。
10. 本 PBI の裁定結果欄へ裁定内容と起票基準（必要なら後続 fix PBI）を記入する。

### 落とし穴

- 案 (b) の終端は 23:59:59.999 より大きい値（翌日子刻未満）になり得るため、`until` の排他／包含契約を確認する。翌日の 00:00:00.000 の行が取り込まれれば「1 日の重複」になり、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:250` の連続性等式が壊れる。
- 案 (c) は最も単純だが `endOfLocalDayMs` の返り値そのものを pin する既存テスト（`src/utils/__tests__/localDate.test.ts:179,272`、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:244`）の意味が変わる。テストの書き換え規模も裁定の判断材料になる。
- 案 (c) の前提「00:00 が存在する」は春移行で日付を飛ばすゾーン（例: 午前 00:00 が飛ばされる地域）で成立しない。`src/utils/__tests__/localDate.test.ts:121-129` のコメントはこの cursor 方式の破綻を指摘しているため、案 (c) の実現性をまず確認すること。
- `archiveGuards.cutoffMsFromLocalDate` を SSOT に統合しようとして `src/utils/localDate.ts:16-20` の記載に反する判断をしない。あれは意図的なポリシー境界である。
- `src/dashboard/markdownExport.ts:221-224` の T23:59:59 契約を「同じく DST の問題」として触ると、既存の export 対象が変わる。本裁定はそれらには適用しない。
- CI では UTC / JST / IST のような固定オフセットゾーンで走るため、日長が変わる日のアサーションは空振りになる。実測は必ず `/tmp` の throwaway で行い、リポジトリにテストを足さない。
- 「1 時間の漏れ」を過大評価して緊急 bug として扱うと、年数日によるフィルタ網羅性の問題への過剰な設計になる。実害が範囲フィルタの網羅性のみであることを裁定に明記する。
- 裁定を口頭の合意で済ませると、後続 PBI が同じ調査をやり直す。判断理由と除外契約を ADR として残す。

## 決定事項

1. 取りこぼしの原因は、`endOfLocalDayMs`（`src/utils/localDate.ts:83-87`）が `setHours(23, 59, 59, 999)` を使い、ECMAScript が曖昧なローカル時刻に対して最初の出現を選ぶため、23:00-23:59 が 2 回現れる日の 2 回目の区間が終端より後ろに落ちることである。
2. この残留は固定オフセット（`+ 86_400_000 - 1`）の 2 バグとは別問題であり、PBI 11 で前者だけを解消した結果として明示的な裁定が必要なまま残っている。
3. 実害は「日レンジの終端が早すぎて、その日の最後の 1 時間の行がフィルタで取りこぼされる」ことだけである。保存 timestamp は UTC であり、行の欠落は起きない。影響日は DST 遷移日のみ（年数日）である。
4. 検討する代替は 3 案に固定する: (a) 現状維持（最初の出現）、(b) 2 つの候補の大きい方を採用、(c) `startOfLocalDayMs(翌日子刻) - 1`。各案の終端値・当日包含性・翌日の連続性・既存 pin の書き換え規模を実測で並べて裁定する。
5. 案 (b) は反復する 1 時間（秋移行の 25h 日）を含むが、`until` が 23:59:59.999 を超える可能性があるため、包含／排他契約と翌日の重複防止を明示的に確認する。
6. 案 (c) は最も単純だが、00:00 が存在しない移行日で `startOfLocalDayMs` が意図しない値になりうるため、実現性の実測を経てから採否を決める。既存の pin（`endOfLocalDayMs` の返り値そのもの）の意味が変わる点も裁定材料とする。
7. 裁定は「採用 1 案 / 保留その他」の形で記録し、保留案には再評価の条件（夏時間前移行日と冬時間後移行日の実測、画面の日レンジ表示との整合）を明記する。
8. `src/utils/archiveGuards.ts:91` の `cutoffMsFromLocalDate` および `src/dashboard/markdownExport.ts:221-224` の T23:59:59 契約は対象外とする。別のポリシー境界であり、本裁定の変更はそれに及ばない。
9. 本 PBI は裁定のみで実装を行わない。裁定は `dev-docs/ADR/2026-09-28-dst-ambiguous-day-end.md` として ADR 化し、採否と理由を本 PBI の裁定結果欄へ記入する。

## Definition of Done

- [ ] 3 案の終端値が遷移日（春移行・秋移行・30 分オフセットゾーン）で実際に計算され、比較表が裁定記録に残っている。
- [ ] 影響を受ける消費者と既存 pin の一覧が裁定記録に列挙されている。
- [ ] `until` の排他／包含契約と翌日の重複防止（`until + 1 === next.since`）が各案でどう変わるかが判定されている。
- [ ] 実害が「範囲フィルタの網羅性のみで、保存データの欠落ではない」ことが確認として記録されている。
- [ ] `archiveGuards` の strict 契約と `markdownExport` の T23:59:59 契約が対象外である理由が明記されている。
- [ ] 採用・保留・却下の区分と理由が裁定記録にまとめられている。
- [ ] 裁定が `dev-docs/ADR/2026-09-28-dst-ambiguous-day-end.md` として ADR 化されている。
- [ ] 本 PBI の裁定結果欄へ裁定内容と必要なら後続 fix PBI の起票基準が記入されている。
- [ ] 本 PBI でコード変更（`src/` / `entrypoints/` / `testDir/` を含む）が発生していない。throwaway スクリプトは `/tmp` に置き、コミットしていない。
- [ ] BDD 受け入れシナリオの検証が完了している。
