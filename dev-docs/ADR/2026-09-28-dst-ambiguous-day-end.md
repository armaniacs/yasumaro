# ADR: DST 曖昧時刻における「その日の終端」の裁定 — 「ローカル日付の最後の瞬間」を契約にする

## ステータス

採用（裁定のみ。実装は後続 fix PBI）

## 日付

2026-09-28

## 作成者

PBI 2026-09-28-22（investigate）

## コンテキスト

`endOfLocalDayMs`（`src/utils/localDate.ts:83-87`）は `d.setHours(23, 59, 59, 999)` で
ローカル日付の終端を作る。ECMAScript の `MakeDay` / `MakeTime` は「互換」disambiguation を
既定とするため、**曖昧なローカル時刻には最初の出現を選ぶ**。結果として、遷移が
ローカル 23:00-24:00 帯にあるゾーンでは、同じローカル日付に 23:59:59.999 が 2 回現れる日があり、
2 回目の区間がいかなる日レンジにも含まれない。

`localDayRangeFromDateString`（`src/utils/localDate.ts:93-96`）は
`since = parseLocalDateStart(value)` / `until = endOfLocalDayMs(since)` を返す。
PBI 2026-09-28-11 は固定オフセット（`since + 86_400_000 - 1`）の 2 バグを解消したが、
**曖昧時刻の最初の出現を選ぶ残留**は明示的な裁定なしにコードに残っている。

本 ADR は 3 案（a: 現状維持 / b: 2 回目の出現を採用 / c: 翌ローカル日付の最初の瞬間 − 1ms）を
実測で比較し、終端の契約を決める。実装は行わない。

### 判定の基準（「正解」の定義）

**「ローカル日付 D の最後の瞬間」= D+1 の最初の瞬間 − 1ms** と定義する。これは
「`until` 以下の instants のうち、`formatLocalDateString` が D になるものの最大値」という
集合の端であり、`since`（D の最初の瞬間）との間に隙間も重複もない。
この定義は `since` 側の実装（`parseLocalDateStart` = `new Date('D T00:00:00')`）と対称で、
「日レンジ = そのローカル日付に属する全 instants 」という 1 つの契約として表現できる。

D+1 の最初の瞬間が `new Date('D+1 T00:00:00')` と一致することは実測で確認した
（UTC / America/Santiago / Australia/Lord_Howe / America/Havana / Pacific/Chatham /
Asia/Beirut の 6 ゾーン × 366 日で不一致 0 件）。存在しない 00:00 では 01:00 に
前方正規化され（＝その日付の最初の瞬間）、曖昧な 00:00 では最初の出現になる
（＝その日付の最初の瞬間）。よって正解値は常に「`parseLocalDateStart(D+1) - 1`」として
一意に決まる。

## 実測（Node v26.10.0 / macOS、`/tmp/pbi22/` の throwaway、実装は変更していない）

### 計測方法

- 各ゾーンのローカル日付を 2026 年の 366 日ぶん列挙し、日ごとに
  「最初の瞬間」「最後の瞬間」「(a)」「(b)」「(c)」「`until + 1 === 翌日の since`」を計算した。
- 「(b)」は、ローカル壁時計 `D 23:59:59.999` に一致する epoch ms を、遷移前後 ±30 時間の
  オフセット集合（61 個）全てについて候補生成し、書式一致で検証したうえ最大値を取った。
- 「(c)」は 2 つの実装形を分けて計測した。
  - (c) = `setDate(getDate() + 1)` → `setHours(0,0,0,0)` → `-1`
  - (c2) = `new Date(y, m, d + 1, 0, 0, 0, 0).getTime() - 1`（数値コンストラクタの暦 day overflow）
- タイムゾーンは `TZ=<zone> node <script>` で明示した（Node は実行中の `process.env.TZ` 変更にも
  追従することを別途確認した。したがって 1 プロセス内で 418 ゾーンを走査できている）。

### A. 比較表（3 案の終端値）

| ゾーン | ローカル日付 | 遷移形状 | 日長 | 正解（ground truth） | (a) 現状 | (b) 2 回目 | (c)/(c2) |
|---|---|---|---|---|---|---|---|
| America/Santiago | 2026-04-04 | 23:00-23:59 が 2 回 | 25.00h | `2026-04-05T03:59:59.999Z` | `…T02:59:59.999Z`（**1h 早い**） | 同正解 | 同正解 |
| Africa/Cairo | 2026-10-29 | 23:00-23:59 が 2 回 | 25.00h | `2026-10-29T21:59:59.999Z` | `…T20:59:59.999Z`（**1h 早い**） | 同正解 | 同正解 |
| America/Godthab | 2026-10-24 | 23:00-23:59 が 2 回 | 25.00h | `2026-10-25T01:59:59.999Z` | `…T00:59:59.999Z`（**1h 早い**） | 同正解 | 同正解 |
| America/Godthab | 2026-03-28 | 23:00-23:59 が**存在しない** | 23.00h | `2026-03-29T00:59:59.999Z` | `…T01:59:59.999Z`（**1h 遅い＝翌日 0 時台へ越境**） | 同正解 | 同正解 |
| Australia/Lord_Howe | 2026-04-05 | 01:30-01:59 が 2 回（30 分 DST） | 24.50h | `2026-04-05T13:29:59.999Z` | 同正解 | 同正解 | 同正解 |
| America/Havana | 2026-11-01 | 00:00-00:59 が 2 回 | 25.00h | `2026-11-02T04:59:59.999Z` | 同正解 | 同正解 | 同正解 |
| America/Santiago | 2026-09-06 | 00:00-00:59 が**存在しない** | 23.00h | `2026-09-07T02:59:59.999Z` | 同正解 | 同正解 | 同正解 |

`until - since`（日レンジの実測長）:

| ゾーン / 日付 | (a) | (b) | (c)/(c2) | 正解 |
|---|---|---|---|---|
| Santiago 2026-04-04 | 86,399,999 | 89,999,999 | 89,999,999 | 89,999,999 |
| Cairo 2026-10-29 | 86,399,999 | 89,999,999 | 89,999,999 | 89,999,999 |
| Godthab 2026-03-28 | 86,399,999 | 82,799,999 | 82,799,999 | 82,799,999 |
| Lord Howe 2026-04-05 | 88,199,999 | 88,199,999 | 88,199,999 | 88,199,999 |
| Havana 2026-11-01 | 89,999,999 | 89,999,999 | 89,999,999 | 89,999,999 |

重要な読み取り:

- **(a) の失敗は 1 形状ではない。** 23:00-23:59 が 2 回現れる日は 1h **早い**（反復区間が
  どの日レンジにも属さない）。23:00-23:59 が存在しない日は 1h **遅い**（翌日の 0 時台を
  取り込み、`sqliteHistoryQuery.ts:143-144` の「never bleeds into its neighbour」契約に
  違反する）。前者は「取りこぼし」、後者は「取り込み」の実害であり、方向が逆。
- **(a) は 25h の日を 24h の日として数える**（86,399,999 ms = 24h − 1ms）。したがって
  `localDate.test.ts:170-185` の `shifted` フィルタ（`lengthMs !== DAY_MS - 1`）に
  入場できず、曖昧な 25h 日は既存 DST pin の**網から漏れる**。
- **23:59:59.999 の壁時計表現は (b)/(c) でも保たれる。** 2 回目の出現もローカルでは
  `D 23:59:59.999` と描画される。よって「壁時計 23:59:59.999」という表記を捨てなくてよい。
  唯一の例外は Godthab 2026-03-28（23:00-23:59 が存在しない日）であり、正解値は
  ローカル `D 22:59:59.999` になる（実測: `cLocal=2026-03-28 22:59:59.999`）。
  この日では壁時計 23:59:59.999 が**物理的に存在しない**ため、表現が変わるのではなく
  定義どおりの値になる。

### B. (b) と (c) は数値的に同一（418 ゾーン × 366 日 × 2 年で検証）

- 2026 年: `(b) != (c)` は **0 ゾーン日**。`(c) != 正解` も **0 ゾーン日**。
- 2027 年: 同様に 0 / 0。
- 6 ゾーンの 366 日 walk でも `(a)==(b)` 364/365、`(b)==(c)` 365/365（Santiago）、
  366/366（Lord Howe・Havana・Chatham・Beirut・UTC）であった。

理由: 「壁時計 `D 23:59:59.999` の 2 回目の出現」は、定義上「D+1 の最初の瞬間の 1ms 前」
である（23:00-24:00 帯の遷移しかこの形状を作らないため）。したがって (b) と (c) は
**同じ値を選ぶ異なる導出経路**であり、裁定は実装形の選択に帰着する。

### C. (c) の 2 実装形の差（実測で 1 つが落ちる）

15 分刻み・全ゾーン・全 instants の掃引（**14,646,720 サンプル**、Node v26.10.0）:

| 実装 | `endOf(ts) != 正解` のサンプル数 | 率 |
|---|---|---|
| (a) `setHours(23,59,59,999)` | **684** | 0.00467% |
| (b) 壁時計候補の走査（ガードあり） | 0 | 0% |
| (c) `setDate(+1)` → `setHours(0,0,0,0)` → `-1` | **8** | 0.00005% |
| (c2) 数値コンストラクタの day overflow | **0** | 0% |

(c) の 8 件はすべて `America/Godthab` / `America/Scoresbysund` の **2026-03-27 の
23:00-23:45 の 4 サンプル**。理由は 2 段の正規化である。`ts` のローカル日付を
`setDate(+1)` で 2026-03-28 に送ると、その日の 23:00-23:59 は存在しないため前方正規化で
**2026-03-29 00:30** に飛ばされ、続く `setHours(0,0,0,0)` が 2026-03-29 00:00 になり、
返るのは「2026-03-28 の終端」= 1 日ずれる。

(c2) は日付の暦演算と時刻指定を**同じ 1 回のコンストラクタ呼び出し**で行うため、
中間 Date の正規化が発生しない。これは `localDate.test.ts:120-129` の
「each day is constructed on its own from the numeric Date constructor（day-overflow が
カレンダールールを処理する）」という既存テストの考え方と同じ形である。
**裁定の含意: (c) の実装は (c2) の形でなければならない。**

### D. 「翌日の重複なし」契約（`until + 1 === next.since`）

- 2026 年の全 418 ゾーン × 366 日で、(b) と (c)/(c2) は **365/365・366/366 すべて成立**。
- (a) は 2 形状で破れる: 早期型 5 ゾーン日（Santiago 04-04 / Cairo 10-29 /
  Godthab 10-24 / Scoresbysund 10-24 / Beirut 10-24）と、遅延型 2 ゾーン日
  （Godthab 03-28 / Scoresbysund 03-28）。Gap 幅はいずれも 3,600,000 ms。

### E. 実害の範囲

- **保存側の欠落は無い。** `browsing_logs.created_at` は `INTEGER`（epoch ms、
  `src/offscreen/schema.ts:15`）で、ローカル日付は表示・フィルタ時に初めて付与される。
  影響するのは**範囲フィルタの網羅性のみ**。`until` を広げても行は消えない。
- **影響ゾーンは全 418 ゾーン中 7 ゾーン**（2026 年）。すべての DST 移行日で起きるのではなく、
  遷移が**ローカル 23:00-24:00 帯**で起きるゾーンだけが対象:
  Africa/Cairo、America/Godthab、America/Scoresbysund、America/Santiago、Asia/Beirut。
  2027 年も同じ 7 ゾーン（日付のみ移動）。
- **非 24h のローカル日付をもつゾーンは 130 ゾーン**（2026）なので、末端 bound が
  壊れているのはそのうち 7 ゾーン（5.4%）。130 ゾーン中 123 ゾーンは (a) でも正しい。
- 1 ゾーンあたりの影響は**年 1〜2 日 × 1 時間**。30 分の DST ステップをもつゾーンは
  2026 年で `Australia/Lord_Howe` のみ（実測: 24.50h / 23.50h の日を持ち、
  `Pacific/Chatham` は 25.00h / 23.00h）。同ゾーンの反復区間は 01:30-01:59 にあり
  23:00-23:59 には及ばないため、**(a) でも正しい**。
  PBI spec の「Lord Howe が 23:59:59.999 の曖昧性を持つ」という前提は実測で反証された。
- 緊急度は高くない。ユーザーが体感する差は「その日の履歴一覧に 1 時間分の行が出ない」
  という範囲の狭さであり、データ消失・集計破壊ではない。

### F. 影響を受ける消費者（`until` を読む経路）

`until` は inclusive として渡され、SQL では `created_at <= ?`
（`src/offscreen/queryPlan.ts:108`）、in-memory 経路でも
`record.created_at > dateTo` で落ちることになる（`src/offscreen/queryPlan.ts:241`）。
したがって **両エンジンで同一の inclusive 契約**であり、`until` を広げても翌日の行を取り込まない（`until` は D+1 の最初の瞬間の 1ms 前でしかない）。

| 経路 | 呼び出し元 | 影響 |
|---|---|---|
| `dateRangeFromSelectedDate`（`sqliteHistoryQuery.ts:146-149`）→ `localDayRangeFromDateString` | `sqliteHistoryModel.ts:756` の `fetchData`、履歴パネルのカレンダー日付選択 | 履歴一覧・その日に紐づく集約の表示範囲 |
| `endOfLocalDayMs` 直呼び（`sqliteHistoryPanelView.ts:781`） | カレンダーのクイックボタン「過去 N 日（クリック日を含む）」 | 同上（N 日窓の終端） |
| `endOfLocalDay`（`periodFilter.ts:70-73` → `customRangeToBounds:109`） | 期間フィルタのカスタム「to」日付。`asyncDataPanelLifecycle`（Word Cluster / Domain Analysis / Tag Cluster / Time Heatmap / Tag Cooccurrence / Revisit Insights） | 各パネルのカスタム範囲クエリ |
| `dateRangeToTimestamps`（`markdownExport.ts:218-225`、T23:59:59） | Markdown エクスポート | **対象外契約**（下記 H） |

### G. 既存 pin への当てはめ（各案 × 各ゾーンで実測）

`localDate.test.ts` / `sqliteHistoryQuery.test.ts` / `periodFilter.test.ts` の該当
アサーションを 3 案それぞれに当てて評価した（`since` は numeric Date コンストラクタと
`new Date('D T00:00:00')` が全ゾーン全日で一致することを先に確認した上で、pin 本体の
ロジックをそのまま再現した）。

| pin | (a) | (b) | (c)/(c2) | 備考 |
|---|---|---|---|---|
| `localDate.test.ts:92-96` | PASS | PASS | PASS | 2026-08-08 は全ゾーンで非遷移日 |
| `localDate.test.ts:98-103` | PASS | PASS | PASS | |
| `localDate.test.ts:107-111` | PASS | PASS | PASS | |
| `localDate.test.ts:140-148`（全日が 23:59:59.999 に終わる） | **FAIL**（Godthab・Scoresbysund 2026-03-28） | **FAIL**（同左） | **FAIL**（同左） | 2026-03-28 は 23:00-23:59 が存在しないため**定義上 23:59:59.999 にならない**。3 案いずれでも書き換え（表現の言換え）が必要な唯一の pin |
| `localDate.test.ts:150-159`（翌日へ漏れない） | **FAIL**（Godthab・Scoresbysund 2026-03-28） | PASS | PASS | (a) の 1h 越境の証拠 |
| `localDate.test.ts:161-168`（23h-25h） | PASS | PASS | PASS | ただし (a) では反復 23:xx の日が 24h に見えるため**この pin も空振り** |
| `localDate.test.ts:170-185`（DST 日にちょうど 1 回カバーする） | PASS（ただし当該日を選別できない = 空振り） | PASS | PASS | `shifted` フィルタの非空虚性: UTC 0 日 / Santiago 2 日 / Lord Howe 2 日 / Havana 2 日 / Godthab 2 日 |
| `localDate.test.ts:266-274`（parity） | PASS | PASS | PASS | SSOT 同士を比較する自己言及のため機械的には常に成立 |
| `sqliteHistoryQuery.test.ts:237-244` | PASS | PASS | PASS | 2026-08-08 は非遷移日 |
| `sqliteHistoryQuery.test.ts:247-251`（`until + 1 === next.since`） | PASS（固定 2 日） | PASS | PASS | 固定日付のため (a) でも通る。**年全体で成立する形に拡張した variant は (a) が FAIL**（下記 H） |
| `periodFilter.test.ts:46-57` / `:82-85` | PASS | PASS | PASS | |

結論: **(b) と (c)/(c2) は既存 pin を 1 本も壊さない。** (c)/(c2) で唯一変わるのは
`:140-148` で、書き換えは数値の差し替えではなく**契約の言換え**
（「全ローカル日の `until` は壁時計 23:59:59.999 に描画される」→「`until` は
そのローカル日付の最後の瞬間である。壁時計 23:00-23:59 が存在しない遷移日では
23:00 前の時刻になる」）になる。

### H. 観測可能性（CI ではこの差は見えない）

- `.github/workflows/*.yml` に `TZ` の指定は 0 件（実測: `rg 'TZ' .github/workflows/*.yml` → 該当なし）。
  よって実行ゾーンはランナー既定であり、GitHub ホスト型ランナーは UTC。
  UTC では pin は全 PASS かつ `shifted` フィルタは 0 日 = **空虚**（既存コメント
  `localDate.test.ts:170-172` の記載どおり、2026 年の pin 回帰で実測確認）。
- 参考: 現行コードのまま `TZ=America/Godthab` で該当 3 ファイルを実行すると
  `localDate.test.ts:140-148` と `:150-159` の **2 件が FAIL** した（実装変更なし）。
  `TZ=America/Santiago` では 83 件すべて PASS。すなわち**影響ゾーンで CI を回さない限り
  この種のバグは緑のまま通る**。
- `process.env.TZ` の実行時変更が Node で効くことは実測した。したがって後続 fix PBI では
  テスト内 TZ 差し替えによる非空虚な pin を追加できる（vitest ワーカーが env を継承することは
  今回 `TZ=... npx vitest run` で確認済み）。

## 関連するADR

- なし（`dev-docs/ADR/2026-09-28-session-store-overflow-persistence.md` と同じ「裁定のみ・実装は
  後続 PBI」の分割方針を採る）

## 決定事項

### 1. 採用：(c) — 「そのローカル日付の最後の瞬間」を契約にする

`endOfLocalDayMs` の返り値を **`parseLocalDateStart(翌日の YYYY-MM-DD) - 1`**、
すなわち**「`formatLocalDateString` がその日付になる最大の instant」** と定義する。

- 理由 1（正しさ）: 15 分刻み 14,646,720 サンプルの全ゾーン走査で不正 0 件（C）。
  `since` 側と対称で、日レンジがそのローカル日付の instants を**過不足なく**覆う。
- 理由 2（契約の単純さ）: 契約が 1 文で書ける。「`[since, until]` = そのローカル日付の
  instants の集合」。曖昧時刻・存在しない時刻の分岐がコードに現れない。
  `since` は既に同じ定義（`parseLocalDateStart`）で、SSOT 内の 2 つの bound が
  同じ原理に立つ。
- 理由 3（最小差分）: 既存 pin を壊さない（C）。書き換えが必要なのは契約文言 1 本。
  消費側は 4 経路すべてが無変更で自動的に受益する（`until` が広がるだけで、
  呼び出し規約は inclusive のまま）。
- 理由 4（予測可能性）: 値がゾーンの DST ルールに依存しない。`setHours` の
  disambiguation 仕様やオフセット差の検出ヒューリスティックに依存しない。
- 理由 5（コスト）: 数値コンストラクタ 1 回 = 116-202 ns/call（(a) の 113-187 ns と同階）。
- **実装は (c2) 形式を必須とする**（C の 8 件の測定理由）。
  `setDate(getDate() + 1)` を使う形は却下。既存テストの `everyLocalDayOf2026` と同じ
  数値コンストラクタ + day overflow の形を使う。

### 2. 不採用：(a) 現状維持（最初の出現）

- 2 形状の失敗（1h 早い／1h 遅い = 翌日越境）。全ゾーン走引で 684 サンプルの不正。
- 25h の日を 24h と報告し、既存の DST pin 網（`shifted` フィルタ）から漏れる。
- Godthab / Scoresbysund では既存 pin 2 件が実際に落ちる（実測）。
- 影響は小さいが「コードに残した未決着」であることが最大の欠陥であり、
  PBI 2026-09-28-11 が意図的に裁定を先送りにした部分を閉じる義務がある。

### 3. 不採用（数値的には (c) と同一）：(b) 2 回目の出現を採用

- 値が (c) と同一である（B）ので、**この選択は意味論ではなく実装形の選択**。
- 実装形としてのコストで (c2) に負ける:
  - 「壁時計 `D 23:59:59.999` に一致する epoch ms」の列挙は、遷移前後 ±30 時間の
    オフセット集合を走査する必要がある。実測 3.9-4.1 µs/call で、
    (c2) の 116-202 ns/call の **20-35 倍**。
  - 候補数は 0 / 1 / 2 の 3 通りがあり、分岐とフォールバックが必要になる。
  - 素朴な実装（`setHours` 後の `Date` から日付を取り直す）は、23:00-23:59 が
    存在しない日に前方正規化で日付を 1 日進め、**正解より 24 時間後の値を返す**ことが
    実測された（Godthab 2026-03-28 で `bNaive=2026-03-30T00:59:59.999Z`）。
  - 「2 回目は存在しない」というゾーンごとの前提をコードに持ち込むことになる。
- (c2) が使えない環境の想定は不要である。DOM/Intl 非依存の Layer 0 で、
  数値コンストラクタ 1 回だけで完結し、「翌日の最初の瞬間」という概念を持ち込む必要がない。

### 4. 保留（別 PBI 起票基準を下記に記す）

- `archiveGuards.cutoffMsFromLocalDate`（`src/utils/archiveGuards.ts:91-102`）は
  同じ `new Date(y, m-1, d, 23, 59, 59, 999)` を使うため、反復 23:xx 日に
  **1h 早い cutoff** になる（実測: Cairo 2026-10-29 で正解との差 3,600,000 ms）。
  round-trip 検証は年・月・日しか見ていないため検出しない。
  **本裁定はこれを変更しない。** archive cutoff は operator 入力の strict 契約という
  別のポリシー境界にあり、`localDate.ts:16-20` と `archiveGuards.ts:85-89` が
  「意図的な重複であり統合候補ではない」と明記している。統合はしない。
  別途 PBI を起こす価値はある（archive の cutoff 日が 1h 短く締まる）。
- `src/background/reviewSummaryGenerator.ts:67-90` は週次・月次の終端を
  SSOT を使わず自前で計算している（`sunday.setHours(23,59,59,999)`、
  `new Date(year, month + 1, 0, 23, 59, 59, 999)`）。同じ形状のコピーだが、
  2026-2027 年の影響日 7 日は**いずれも日曜でも月末でもない**（実測）ため、
  現状は誰もに当たらない。`localDate.ts:22-24` は週/月バケットを SSOT の対象外と
  明記しているため、本裁定の範囲外とし、別途「週/月ピースの SSOT 化」を検討する。
- `src/dashboard/markdownExport.ts:221-224` の T23:59:59 契約は**維持**する。
  影響の記録のみ: 反復 23:xx 日に 3,600,999 ms 早い（実測）。PBI 11 で
  意図的に現状維持とされた契約であり、広げると既存 export 対象が変わる。

### 5. 除外した契約とその理由

- `archiveGuards.cutoffMsFromLocalDate`: operator 入力の strict（往復検証して throw）契約。
  lenient な SSOT とは別のポリシー境界。統合しない。
- `markdownExport.dateRangeToTimestamps` の `T23:59:59`: 歴史的な export 契約。
  23:59:59.999 へ広げると既存 export 対象が変わる。PBI 11 で現状維持と決定済み。
- `periodSplit`（`src/dashboard/periodSplit.ts:28-37`）: `[since, until]` を
  2 つの include 区間に分ける純関数のため、`until` の値には依存しない。
- `revisitInsightsAggregate` / `formatBucketDate`: `startOfLocalDay` のみを使うため
  終端変更の影響を受けない。

## 結果

### メリット

- 反復する 1 時間を含む正しい日レンジになり、Godthab / Scoresbysund 型の
  1h 越境（翌日取り込み）も消える。
- `until + 1 === next.since` が全ゾーン全日で構造的に成立する（D）。
- 既存 pin は数値の書き換え 0 件。文言の言換え 1 件のみ（G）。
- 「日レンジ = そのローカル日付の instants」という 1 つの契約に単純化され、
  DST の存在形状（4 種類）に対して分岐を持たないコードで表現できる。

### デメリット

- `endOfLocalDayMs` の doc コメント（`localDate.ts:76`）が
  「Inclusive local end of the day（23:59:59.999）」という**壁時計固定の記述**から
  「the last instant of that local date」で始まる定義記述に変わる。
- 23:00-23:59 が存在しない遷移日（Greenland 型の年 1 日 × 2 ゾーン）では
  `until` が壁時計 22:59:59.999 として描画される。`localDate.test.ts:140-148` の
  pin の文言を直す必要がある（数値は変えない）。
- CI（UTC）では差が観測できない。`shifted` フィルタは 0 日で空虚なまま。
  後続 PBI で TZ 差し替え pin を追加しないと、将来この契約が壊れても緑になる。

### 影響範囲

- `src/utils/localDate.ts:83-87`（`endOfLocalDayMs` の本体と doc コメント）
  のみ。エクスポートのシグネチャも他関数の body も変えない。
- `src/utils/__tests__/localDate.test.ts:140-148`（pin の文言。数値は変えない）と、
  新規の TZ 差し替え pin（`process.env.TZ` 差し替え。影響ゾーンの 7 日 =
  反復型 5 日 + 欠落型 2 日を直接固定する）。
- 消費側 4 経路（`sqliteHistoryQuery.ts:146-149`、`sqliteHistoryModel.ts:756`、
  `sqliteHistoryPanelView.ts:781`、`periodFilter.ts:70-73`）は**コード変更なし**。

### 後続 fix PBI の起票基準

**fix PBI**: 「`endOfLocalDayMs` をローカル日付の最後の瞬間（翌日の最初の瞬間 − 1ms）に改める」

- スコープ: `src/utils/localDate.ts` + `src/utils/__tests__/localDate.test.ts` のみ。
  消費側 4 経路と `markdownExport` / `archiveGuards` は触らない。
- 実装 MUST: 数値コンストラクタの day overflow 形式（(c2)）。
  ```ts
  export function endOfLocalDayMs(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime() - 1;
  }
  ```
  `setDate(getDate() + 1)` を使う形は本 ADR C の 8 件の測定により**禁止**。
- 受入基準:
  1. `TZ=America/Santiago` で `localDayRangeFromDateString('2026-04-04')` の
     `until - since === 89_999_999`（= 25h − 1ms）であり、`until + 1` が 2026-04-05 の
     `since` に等しいこと。
  2. `TZ=America/Godthab` で 2026-10-24 の `until - since === 89_999_999`、
     かつ 2026-03-28 の `until` が 2026-03-29 の `since` の 1ms 前であること
     （1h 越境の再発防止）。
  3. `TZ=America/Havana`（00:00 曖昧）と `TZ=Australia/Lord_Howe`（30 分 DST）で
     値が変化しないこと（= 3 案一致の実測結果を固定する pin）。
  4. 既存 pin の**数値は 1 件も変更しない**こと。`localDate.test.ts:140-148` は
     文言のみ「`until` はそのローカル日付の最後の瞬間。壁時計 23:00-23:59 が存在しない
     遷移日ではそれより前の時刻になりうる」へ変更する。
  5. `TZ=UTC`（CI 既定）で全テスト green であること。
  6. TZ 差し替え pin は必ず `afterEach` で `process.env.TZ` を元に戻し、
     固定タイム Sleep を使わない（リポジトリの TEST_RULE に従う）。
  7. `npx vitest run src/utils/__tests__/localDate.test.ts --repeats=20` が全 green。
- 別 PBI（起票推奨・本裁定の範囲外）:
  - 「`archiveGuards.cutoffMsFromLocalDate` の反復 23:xx 日の cutoff を是正する」
  - 「`reviewSummaryGenerator` の週次・月次期間を localDate SSOT へ寄せる」
  - 「`markdownExport` の T23:59:59 契約が DST 日に 1h 短い件の明示（挙動変更なし）」

### 未実施（investigate PBI の範囲）

本 PBI は裁定のみ。`src/` / `entrypoints/` / `testDir/` / `eslint/` 配下一切を変更していない。
throwaway 計測スクリプトは `/tmp/pbi22/` に置き、コミットしていない。
本 ADR を唯一の裁定記録とする。

## 参照

- `src/utils/localDate.ts:16-20`（archiveGuards とのポリシー境界）・`:22-24`（SSOT の対象外）・
  `:63-66`（`parseLocalDateStart`）・`:69-73`（`startOfLocalDayMs`）・`:75-87`（`endOfLocalDayMs`）・
  `:93-96`（`localDayRangeFromDateString`）
- `src/utils/__tests__/localDate.test.ts:91-104,106-118,120-186,266-274`
- `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts:228-252`
- `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:140-149`
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:756`
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:771-786`
- `src/dashboard/components/periodFilter.ts:61-73,95-111`
- `src/dashboard/components/__tests__/periodFilter.test.ts:20-21,45-57,75-86,155-174`
- `src/offscreen/queryPlan.ts:107-108,240-241`（inclusive な `created_at >= ?` / `<= ?`）
- `src/offscreen/schema.ts:15`（`created_at INTEGER NOT NULL`）
- `src/dashboard/markdownExport.ts:214-226`（対象外契約）
- `src/utils/archiveGuards.ts:73-110`（対象外契約）
- `src/background/reviewSummaryGenerator.ts:64-91`（非 SSOT の週/月コピー）
- `src/dashboard/periodSplit.ts:1-38`（`until` の値に依存しない）
- `pbi/2026-09-28-22-investigate-dst-ambiguous-day-end.md`
- `pbi/2026-09-28-11-refactor-local-date-utilities-ssot.md`（localDate SSOT の導入 PBI。
  固定オフセットの 2 バグを解消）
