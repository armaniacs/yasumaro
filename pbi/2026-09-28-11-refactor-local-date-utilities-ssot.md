# PBI: ローカル日付 utilities の SSOT 化

## ユーザーストーリー

保守者として、ローカル日付の format / parse / 1 日レンジ生成を 1 モジュールに集約したい。なぜなら 16 箇所の再実装が、2 つの実害 drift（日付正規化の 2 ポリシー併存と、DST 遷移日の 1 時間取り込み漏れ）を生んでいるからだ。

## ビジネス価値

- format の正規形 1 か所と再実装 7 か所、parse の正規形 1 か所と再実装 5 か所、1 日レンジ計算の 3 重複を 1 モジュールへ寄せ、日付ロジックの変更点を 1 箇所に閉じる。
- 実害 1 を解消する: `2026-02-30` のような存在しない日付が、archive 検証経路（strict）では throw される一方、5 つのインライン経路では `new Date` が 2026-03-02 へ暗黙正規化して受理される。同一入力に対して 2 ポリシーが併存している。
- 実害 2 を解消する: `+ 86400000 - 1` による 1 日レンジは、DST 遷移日（23h / 25h の日）で 1 時間ぶんの取り込み漏れまたは取りこぼしになる。
- `<input type="date">` の value 契約が format 側と parse 側に分断されている状態を 1 モジュールへ隣接させ、date 入力の往復不整合（入力値と内部 ts のずれ）を防ぐ。
- daily note path の出力（ユーザー設定値に埋め込まれる）は変えないという判断を本 PBI 内で確定させ、「zero padding を足せば常に正解」という誤解の混入を防ぐ。

## 優先度（refactor / 順位 11 / 17 / RICEスコア 4.8（Reach=4 / Impact=2 / Confidence=90% / Effort=1.5 SP））

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: ローカル日付の format が単一の実装を通る
  Given 履歴のエクスポート・タイムラインのバケット・archive 一覧・idle flush・markdown buffer・daily note path がそれぞれ独自の format を持つ
  And 同一のローカル日、代表的な月日、年をまたぐ日付、午前 0 時のタイムスタンプが対象である
  When 各経路がローカルの日付文字列を生成する
  Then すべての経路が単一モジュールの関数を経由し、同じ入力に対して同じ出力を返す
  And タイムゾーンに依存せず、実行環境の TZ がローカル日付の判定を左右しない

Scenario: 存在しない日付の扱いが文脈ごとに明示され、現行動作が変わらない
  Given 存在しない日付 '2026-02-30' が入力される
  When archive 検証経路が cut-off を計算する
  Then strict な検証として throw する（現行の archive 契約を維持する）
  And 一方、日付のラウンドトリップ整形だけを行うインライン経路は暗黙正規化を許容した結果を返す（この経路は throw にしない）
  And 2 つのポリシーが 1 つの関数に畳み込まれていない

Scenario: DST 遷移日の 1 日レンジが終端を過不足なく含む
  Given DST の前方への遷移で 1 日が 23 時間になる地域と、後方への遷移で 1 日が 25 時間になる地域にいる
  And ある 1 日の開始タイムスタンプと、同じ日の date 入力値がある
  When 1 日レンジの終端を計算する
  Then 終端はローカル時刻 23:59:59.999 となり、25 時間になる日の場合は翌 1 日の 00:00 を超えて伸びない
  And 23 時間になる日の場合は 24 時間分の milliseconds 未満になり、取り込み漏れが発生しない

Scenario: daily note path の出力が変わらない
  Given ユーザーが daily note path に月日を含むテンプレートを設定している
  When 記録がバッファされる
  Then 生成されるパス文字列が本 PBI の前と byte 同一である
  And zero padding の有無に関する変更は行われていない
```

## 受け入れ基準（4-8件）

- [ ] Layer 0 の純関数モジュール（`chrome` / DOM 依存なし）を新規作成し、ローカル日付 format・parse・1 日レンジの 3 責務だけを持つ。format は timestamp 入力の 1 形と、日付文字列の 0 padding 規約を 1 箇所に定義している。
- [ ] format の再実装 7 箇所（`tagFrequencyTimeline.ts:107`、`tagClusterTimeSliderPanel.ts:73`、`sqliteHistoryPanelView.ts:26`、`archivePanel.ts:60`、`localMarkdownIdleFlusher.ts:23`、`MarkdownBufferManager.ts:80`、`dailyNotePathBuilder.ts:66`）が新モジュールへ置き換わっている。
- [ ] parse の再実装 5 箇所（`markdownExport.ts:219`、`sqliteHistoryModel.ts:755`、`sqliteHistoryPanelView.ts:204` と `:773`、`sqliteHistoryQuery.ts:145`）が新モジュールへ置き換わっている。`Date` を受け取る異形（`sqliteHistoryPanelView.ts:26`）は薄い wrapper で 1 関数に寄せている。
- [ ] archive 検証の strict な日付処理（`archiveGuards.ts:85-106`）は archive validation の契約として維持し、新モジュールへ統合していない。差異は docstring に明記されている。
- [ ] 1 日レンジはローカルの終端（`endOfLocalDay` 相当）で計算され、`+ 86400000 - 1` の 3 重複（`sqliteHistoryQuery.ts:146`、`sqliteHistoryModel.ts:756-757`、`sqliteHistoryPanelView.ts:774-775`）が解消されている。
- [ ] 誤った挙動を固定していた既存テスト（`sqliteHistoryQuery.test.ts:237`）が、ローカル終端計算の期待へ更新されている。更新理由がテストコメントに残されている。
- [ ] `dailyNotePathBuilder.ts:66` の zero padding なし出力は現行のまま保持され（パス文字列の観測挙動不変）、padding 正規化は別裁定事項として文書化されている。
- [ ] `npm run validate` が成功し、既存のビルド・テスト・ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 設定画面の履歴エクスポートと、archive 一覧の表示で日付が正しく出ることを Outside-In の観測点とする。内部の format 関数そのものは観測点にしない。
- daily note path に月日テンプレートを設定した状態で記録を行い、生成パスが本 PBI 前と同一であることを観測する。
- DST 遷移日を含む日付で履歴が 1 日欠け／重複しないことを、利用者のタイムゾーン環境で観測する（CI の固定 TZ では判定できないため）。
- 新規のユーザー機能は追加しない。

### 統合テスト

- 移行した各経路（markdown export、timeline バケット、sqlite history の query / model / view、archive 一覧、idle flusher、markdown buffer、daily note path）が新モジュールを import し、インライン再実装が残っていないことを確認する。
- `archiveGuards` の strict 検証と新モジュールが同じ入力に対して異なる結果を返すこと（throw する／しない）を対で検証し、意図したポリシー差が維持されていることを確認する。
- date 入力の往復（format → 入力値 → parse → 同一ローカル日）を 1 テストで検証する。

### 単体テスト

- 新モジュール単体で、ローカル日境界（午前 0 時）、年をまたぐ日、月末、0 padding の規約を検証する。assert は TZ に依存しない形式（固定 TZ、あるいはローカル日付の組み立てに依存しない比較）にする。
- DST 遷移日（23h / 25h の日）で 1 日レンジの終端がローカル 23:59:59.999 になることを、テスト内で日付計算を組み立てて検証する。実時間 sleep は使わない。
- 移行前に取得していた各現行実装の出力を parity テストとして pin する（特に「昨日」計算を持つ `localMarkdownIdleFlusher.ts:23` と、timestamp / `Date` の 2 形を持つ `sqliteHistoryPanelView.ts:26`）。
- 既存テスト `sqliteHistoryQuery.test.ts:237` の固定している `+ 86400000 - 1` の期待を、ローカル終端の期待へ書き換える。書き換え時に「誤った挙動の pin だった」ことをコメントで残す。
- TZ に依存するテストを書かない（実行環境で結果が変わるテストは作らない）。フィクスチャは明示的なローカル日付の組み立てで構成する。

## 実装アプローチ

- **Outside-In**: まず「エクスポートされた日付文字列」「sqlite history の期間境界」「daily note path」が現状どおりの値を返すことを外側から固定し、そのうえで内部を 1 モジュールへ寄せる。
- **Red-Green-Refactor**: DST の 1 日レンジ取り込み漏れを Red（`+ 86400000 - 1` の期待）として再現し、ローカル終端計算で Green にする。形式統合（16 箇所の置換）は Green 固定後の refactor として行う。
- **モジュール境界**: Layer 0 の純関数 3 責務に限定する。format / parse / 1 日レンジ以外の「日付っぽい処理」（相対表記、週次バケット、fiscal 月、locale 変換、時計の表示整形）は移さない。
- **YAGNI 遵守**: options 引数で format 種別（RFC3339、年月、曜日付き等）の option を増やさない。`Date` 版は薄い wrapper 1 行に留める。`<input type="date">` 以外（datetime-local、week、month）対応が必要になるまで追加しない。タイムゾーンライブラリや Intl 依存の導入も行わない（`src/utils` の純関数という前提を守る）。
- **2 ポリシーの明示的維持**: strict な archive 検証を「同じ処理の重複」と見立て、新モジュールへ畳まない。docstring に「文脈が異なる重複」と記載し、統合しない判断を追跡可能にする。
- **挙動不変を既定とする**: 置換は等価である前提で進め、出力が変わる候補（`dailyNotePathBuilder.ts:66` の padding）を検出した場合は「触らない」で pin する。

## 見積もり（**1.5 SP** + 内訳）

- 新規 Layer 0 モジュールの設計と実装（format / parse / 1 日レンジの 3 関数と docstring）: 0.5 SP
- format 再実装 7 箇所の置換と parity テスト: 0.4 SP
- parse 再実装 5 箇所＋ 1 日レンジ 3 重複の置換と DST 修正（pin テスト更新を含む）: 0.4 SP
- `dailyNotePathBuilder.ts:66` の挙動保持確認と裁定の文書化、TZ 非依存テストの書き換え: 0.2 SP
- 合計: **1.5 SP**

## 技術的考慮事項（file:line 付き）

- format の正規形: `src/dashboard/markdownExport.ts:49-55` の `getLocalDateString`（非テスト呼び出しは 2 箇所のみ）。7 箇所の再実装と並ぶため、これを 1 関数の仕様として定義する。
- format の再実装: `tagFrequencyTimeline.ts:107`（`formatBucketDate`）、`tagClusterTimeSliderPanel.ts:73`（`toDateInputValue`）、`sqliteHistoryPanelView.ts:26`（`Date` 受けの異形）、`archivePanel.ts:60`（`isoToday`）、`localMarkdownIdleFlusher.ts:23`（`getYesterdayDateString`）、`MarkdownBufferManager.ts:80`（`getTodayDateString`）、`dailyNotePathBuilder.ts:66`（inline・year の padStart なし）。
- parse の正規形: `src/dashboard/components/periodFilter.ts:89` の `parseDateInput`。再実装 5 箇所（`markdownExport.ts:219`、`sqliteHistoryModel.ts:755`、`sqliteHistoryPanelView.ts:204` と `:773`、`sqliteHistoryQuery.ts:145`）は `new Date(x + 'T00:00:00')` の逐語コピーである。
- strict 版（別ポリシー）: `src/utils/archiveGuards.ts:85-106` の `cutoffMsFromLocalDate` は regex + round-trip + 範囲 check を行い、`2026-02-30` を throw する。インライン 5 経路は `new Date` が 2026-03-02 へ暗黙正規化して受理する。
- 1 日レンジ drift: `+ 86400000 - 1` の 3 重複は `sqliteHistoryQuery.ts:146`、`sqliteHistoryModel.ts:756-757`、`sqliteHistoryPanelView.ts:774-775`。ローカルの終端（`periodFilter.ts:62-66` の `endOfLocalDay`、`setHours(23, 59, 59, 999)`）は 1 箇所のみ。
- pin テスト: `sqliteHistoryQuery.test.ts:237` の `expect(range.until).toBe(start + 86_400_000 - 1)` は誤った挙動を固定している。
- date 入力契約の分断: parse は `periodFilter.ts:89`、format は `tagClusterTimeSliderPanel.ts:73` に別々に存在する。1 モジュールで隣接させる。
- PBI `2026-09-28-09`（asyncData lifecycle）と `tagClusterTimeSliderPanel.ts` を共有するため、本 PBI は 09 の完了後に着手する。
- `src/utils` は Layer 0 の配置先であるため（`eslint/rules/utils-layer-boundary.mjs` の Layer 0 定義）、新モジュールは `chrome` / DOM / storage に依存してはならない。

## 実装者向け注記

### 現状コードの確認

- format は「正規形 1 + 再実装 7」、parse は「正規形 1 + 再実装 5」、1 日レンジは 3 重複という形で計 16 箇所の再実装がある。
- `getLocalDateString` の非テスト呼び出しは 2 箇所のみのため、正規形として採用する副作用は小さい。
- `periodFilter.ts` は既に `startOfLocalDay` / `endOfLocalDay` / `presetToRange` / `parseDateInput` / `customRangeToBounds` を持っている。新モジュールはこの責務を dashboard から Layer 0 へ移す位置づけであり、dashboard 側が import 元になる。
- `archiveGuards.ts:85-106` は意図的に厳しい実装で、merge 対象に含めない。
- `sqliteHistoryQuery.test.ts:237` が 1 日レンジの pin であり、24 時間前提を固定している。
- `dailyNotePathBuilder.ts:66` は year に padStart を適用しないため、出力が `2026-1-5` 系の形になる（zero padding 正規化は本 PBI の対象外）。

### 実装手順

1. 移行対象 16 箇所の現行出力（format・parse・1 日レンジ）を parity テストとして先に pin する。
2. Layer 0 に純関数モジュールを新設する（format: timestamp → ローカル日付文字列 / parse: 日付文字列 → ローカル 0 時 / 1 日レンジ: ローカル 0 時 → ローカル終端）。`Date` を受け取る版は薄い wrapper とする。
3. archive 検証の strict 版は置換せず、docstring で「archive validation 固有の契約であり共通モジュールと統合しない」と明記する。
4. parse 再実装 5 箇所 → format 再実装 7 箇所の順に置換し、各段階で `npm run validate` を通してから次へ進む。
5. 1 日レンジ 3 重複をローカル終端計算へ置き換え、`sqliteHistoryQuery.test.ts:237` の pin を更新する（理由コメントを付ける）。
6. TZ に依存するテストを洗い出し、固定 TZ または日付組み立てベースの比較へ書き換える。
7. `dailyNotePathBuilder.ts:66` の出力が変わっていないことを parity テストで確認し、padding 正規化を別裁定として記録する。
8. 全置換後にインライン再実装（`new Date(x + 'T00:00:00')` 相当、`86400000` による 1 日加算）が残っていないことを検索で確認する。

### 落とし穴

- 「昨日」計算（`localMarkdownIdleFlusher.ts:23`）が `ts - 86400000` ベースではなく `new Date(y, m, d - 1)` ベースである場合、統合で DST 日の挙動が変わる。parity テストで現行出力を pin してから置き換える。
- format の引数が timestamp と `Date` の 2 系統に分かれている（`sqliteHistoryPanelView.ts:26`）。1 関数に寄せても `Date` 版を削除すると、呼び出し側が `Date` を使い続ける。
- strict 版と lenient 版の統合は、archive 検証の拒否契約を失わせる。1 モジュールへ畳むと `2026-02-30` の扱いが archive 側だけ変わる。
- DST 遷移日（23h / 25h）のテストを実時間 sleep や 1 日の wait でやると、テストスイート全体が不安定になる。待ちを注入したうえで日付組み立てにより再現する。
- `dailyNotePathBuilder` の padding を同時修正すると、既存ユーザーの daily note path が変わる（ユーザー設定値に埋め込まれるため追跡不能）。触らない。
- タイムゾーンに依存するアサーションを書くと、開発機と CI で結果が変わるテストが残る。
- `periodFilter.ts` の既存 export を削除すると dashboard 側が大面積で壊れる。旧 export は移行完了まで維持し、PBI 09 側の変更と競合させない。
- 置換の機械的な一致性だけを追うと、`86400000` を使う別用途（期間分割、バケット幅）まで一括置換する。1 日レンジに該当する 3 箇所だけを置換する。

## 決定事項

1. 新規モジュールの配置先は Layer 0 の `src/utils` 配下（純関数、`chrome` / DOM 依存なし）とする。
2. 公開責務は 3 つに限定する: ローカル日付文字列の format、日付文字列の parse、ローカル 1 日レンジ。format 種別の options 化された API は作らない。
3. ポリシーは現行多数派（lenient、`new Date(x + 'T00:00:00')` の暗黙正規化を許容）を正とする。
4. `archiveGuards` の strict 版は archive validation の契約として維持し、共通モジュールと統合しない。差異を docstring に明記する。
5. DST の 1 日取り込み漏れはバグ修正として扱い、ローカル終端計算へ置換する。`sqliteHistoryQuery.test.ts:237` の pin は期待を更新し、修正理由をテストコメントに残す。
6. `Date` を受け取る format 変種は薄い wrapper で残す（呼び出し側が `Date` を持つため）。
7. `dailyNotePathBuilder` の zero padding 出力は変更しない。padding 正規化は別裁定事項とする。
8. `<input type="date">` の value 契約（format と parse）を 1 モジュールで隣接させる。
9. 本 PBI は PBI `2026-09-28-09` の完了後に着手し、`tagClusterTimeSliderPanel.ts` の編集を競合させない。

## Definition of Done

- [ ] Layer 0 の純関数モジュールに format / parse / 1 日レンジの 3 関数が存在し、`chrome` / DOM / storage への依存がない。
- [ ] format 再実装 7 箇所と parse 再実装 5 箇所が新モジュールへ置換され、インライン再実装が残っていない。
- [ ] 1 日レンジの `+ 86400000 - 1` 3 重複がローカルの終端計算へ置き換えられ、DST 遷移日（23h / 25h）で取り込み漏れ・取りこぼしが発生しない。
- [ ] 観測挙動が不変である: date 文字列の出力、日付入力の往復、archive 検証の throw 契約、daily note path の文字列が本 PBI 前と一致する（DST の 1 日レンジ終端のみ意図的な修正であり、DoD に明記した唯一の挙動差である）。`dailyNotePathBuilder.ts:66` の zero padding なし出力も維持され、正規化を行わない判断が記録されている。
- [ ] 誤った挙動を固定していた `sqliteHistoryQuery.test.ts:237` の期待が更新され、理由がコメントに残っている。
- [ ] `archiveGuards` の strict 検証が維持され、共通モジュールと統合されていない（docstring に差異が明記されている）。
- [ ] 追加したテストがタイムゾーン非依存であり、実時間待ち sleep を含まない。
- [ ] 共通モジュールに format 種別の options、Intl 依存、タイムゾーンライブラリ、他の日付処理（週次バケット、相対表記、locale 変換）を追加していない（YAGNI 遵守）。
- [ ] `npm run validate` が成功し、既存ビルド・テスト・ユーザー観測挙動に回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
