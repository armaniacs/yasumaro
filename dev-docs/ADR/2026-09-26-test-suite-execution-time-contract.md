# ADR: ユニットテストの実行時間を契約として管理する

## ステータス
採用済み

## 日付
2026-09-26

## コンテキスト

`npx vitest run` は 907 ファイル / 14,015 テストを 1 回で走らせる。計測すると、
支配的なのはテストのロジックではなく **1 ファイルあたりの固定コスト**である。

Vitest 自身が出す内訳:

| 段階 | 比率 |
|------|------|
| environment | 54% |
| tests | 24% |
| import | 9% |
| transform | 8% |
| setup | 3% |

ファイル単位で集計した結果:

| 指標 | 値 |
|------|-----|
| wall | 69.78s |
| node プロセスの CPU | 390s（並列度 5.6x） |
| isolated プロジェクト: 平均 / p50 | 118ms / 32ms |
| shared プロジェクト: p50 | 2ms |
| 200ms 未満のファイル | 806 件 / 計 29.2s |
| 200ms 以上のファイル | 100 件 / 計 52.1s |

### 固定コストの実体

自明なテスト 20 件を「1 ファイルずつ隔離実行」して測った。

| プロジェクト | 20 ファイルの Duration | 内訳 |
|---|---|---|
| isolated / node | 803ms | setup 58% / transform 32% |
| isolated / jsdom | 2,930ms | **environment 81%** |

jsdom 環境の構築は、隔離プロジェクトでは 1 ファイルあたり約 106ms かかる。
DOM ファイル 298 件で概算 31.6 秒の CPU に相当する。environment 54% の正体であり、
テストの内容と無関係に毎回支払われている。

### ワーカー数は効きない

| maxWorkers | wall |
|-----------|------|
| 4 | 118.7s |
| 8 | 117.7s |
| 12 | 115.2s |

差分は 3% にすぎない。**スイートは CPU 並列ではなくファイル数に律速されている。**
worker を増やしても改善せず、メモリだけが伸びる。

### 「待つだけ」のテスト

実タイマーの sleep を可視化すると 308 サイト / 10.70s。さらにテストからは見えない
本番側のリトライ待ち（`waitForRetry` の 500ms と 1000ms）が 6 テストぶん、
合計 9.0s ある。**待ち時間は合計約 20s で、壁時計の 21% を占めていた。**

| バケット | サイト | 合計 | 性質 |
|---|---|---|---|
| 0ms | 93 | 0.00s | マクロタスク待ち。ほぼ無料 |
| 6-20ms | 113 | 1.39s | settle 待ち |
| 21-60ms | 85 | 4.25s | **50ms 決め打ちのバリア。最大の無駄** |
| 61-200ms | 12 | 1.20s | 待ちすぎ |
| 201ms 以上 | 3 | 3.85s | 本番タイマーの待ち |

### 効果を出せなかった案

いずれも実測したうえで却下した。

| 案 | 実測 | 判断 |
|---|---|---|
| `pool: 'vmForks'`（環境を worker ごとに 1 回にする） | 94.1s から 106.2s へ（+13%、CPU も 12% 増） | 却下 |
| `pool: 'threads'` | 92.7s。forks の 91.1s と同等 | 効果なし |
| `@peculiar/webcrypto` を Node native WebCrypto に差し替え | 600k 反復 1 回あたり 71.6ms 対 71.8ms（1.0 倍） | 却下。polyfill は遅くない |
| happy-dom への一括移行 | 理論上限は 298 ファイルで wall 約 5s の削減 | 却下。利得が小さく、253 ファイルの挙動変更が残る |
| 隔離判定を shared へ緩和 | 該当は 33 ファイルのみ | 却下。汚染リスクに対して利得が小さい |

wasm と sqlite のインスタンス生成も、推測していた主因ではなかった。
`sqliteHistoryPanel-*.test.ts` 5 件は全体実行で 9.5s だが、単独実行では 2.5s である。
遅さは jsdom と隔離のコストが同時に集中した結果だった。

## 関連するADR
- [module 級 singleton と composition root の併存方針](./2026-09-17-module-singleton-policy.md)

## 決定事項

一度きりの改善ではなく、**遅くならない仕組み**として契約化する。規則は 5 つ。

### R1. 時間で確かめない

経過時間から推測することを禁止する。待つのは条件の成立だけである。
許容する形は 3 つだけ。

| 状況 | 使うもの |
|------|---------|
| mock が呼ばれるのを待つ | `waitForMock()` ― `vi.waitFor(..., { interval: 1, timeout: 1000 })` |
| 本番タイマーの期限を待つ | `useTimerClock()` と `vi.advanceTimersByTimeAsync(期限)` |
| タイマーの無い経路で「起きなかった」ことを示す | `drainMacrotask()` ― マクロタスク 1 ターン |

テストへの `setTimeout(resolve, N)` の直書きは禁止する。N が 20 未満、または 0 の
場合だけ許可する。機械で強制するため `local/no-test-sleep` ルールを入れ、
`npm run lint` で `error` として検出する。既存 40 箇所（16 ファイル）に加えて
`const` 束縛経由の 3 箇所を 1 箇所ずつ判断して消し、2026-09-26（PBI
2026-09-26-05）でゼロにしたので `error` に昇格済み。
ルールの遅延解決は識別子の**ノード**をキーにメモする。名前でキーにすると
同一ファイルに同名の `const` が 2 つあると最初の解決が 2 つ目にも適用され、
実在する 50ms の sleep が検出から漏れる。

**落とし穴:** `vi.useFakeTimers()` の既定 `toFake` には `setImmediate` と
`queueMicrotask` が含まれる。fake クロック中に動的 import を待つテストは、
モジュールランナーが進まず 30 秒でタイムアウトする。実際に出ている。
fake timers を使うときは**タイマー API だけを偽装する。**

**除外している箇所**（理由つきで残す）:

- `src/content/__tests__/loader.trustBoundary.test.ts` の import 後の 50ms 待ち 2 箇所。
  ローダーは動的 import の先で解決し、完了を観測できる信号がない。
- 同ファイルのリトライテスト 1 箇所（1500ms）。このファイルは `Date.now` を固定値に
  モックしている。fake clock と組み合わせると時計の起点がずれて、負荷があると
  巻き戻しが終了しない。実測で再現した。

### R2. 本番のタイマーは注入ポートとして公開する

テストが待つ必要があるタイマーは、設計上の欠陥とみなす。タイマーを持つ
production モジュールは、注入可能なポートを持たなければならない。

- 良い例: `SqliteHistoryModelDeps.scheduler`（`PersistScheduler`）と
  `ObsidianClientOptions.sleep`（`SleepFn`）
- 悪い例: `loader.ts` の `resolveVisitAdmission` は `sleep` を deps として受け取るのに、
  呼び出し側の IIFE がインラインで `setTimeout` を渡している

**panel と factory の層は deps を素通しする。** `createSqliteHistoryPanel(deps)` は
`createSqliteHistoryModel(deps)` にそのまま渡す。seam が 1 層で止まると、
下の層に seam があってもテストは実時間を強いられる。

### R3. 高価なプリミティブは 2 層に分ける

PBKDF2 の 600,000 反復は 1 回 70ms で、`deriveKey` を 80 回呼ぶテストは 8 秒に
達する。設定値が高コストな機能はすべて 2 層に分ける。

- **振る舞いの層**: 反復数を差し替えた KDF を使い、暗号の接合・分岐・エラー処理を
  検証する
- **契約の層**: 本番の値をそのまま使い、「本番値はこれである」ことだけを検証する
  （`cryptoParamsSSOT.test.ts` がこの役割）

どの高コストな設定値でもこの 2 層に分ける。**契約の層を削除しない**ことが条件である。
本件では 4 ファイルで反復数を 1,000 に差し替え、対象 5 ファイルは 17.3s から
2.2s になった。本番の値を検証するファイルは変更していない。

### R4. 固定コストを予算として持ち、リグレッションを落とす

削った実行時間は戻ってくる。戻させない仕組みを入れる。

- `npm run test:perf` を用意する。JSON レポーターで走らせ、ファイル単位の所要時間を
  集計してランキングを `bench/reports/test-perf.md` に出し、
  `bench/baselines/test-perf.budget.json`（ファイル数 / 合計 / p95 / 上位 10 件の閾値）と
  比較する。超過したら非 0 で終わる
- 予算を超えたときの第一対応は、テストファイルの追加と sleep の再導入を止めること。
  固定コストはファイルごとに発生するため、**予算を左右するのはテスト本数ではなく
  ファイル数**である
- **負荷が掛かっているときは合否判定をしない。** load average がコア数を超えたら
  「machine is busy」を出して 0 で終わる。負荷下ではファイル所要時間が 3〜5 倍に
  膨らむため、負荷下の測定で予算を判定すると、正しい実装が遅いコードと区別でき
  なくなり、予算を上げるという最悪の対処格拉デーションに誘われるためである。
  判定はこの load だけを見る。**計測の「後」で見てはいけない** ― スイートは実行中
  全コアを使い切るため、実行後に読んだ load は常に高くなり、静止したマシンでも
  必ず busy 判定になってゲートが一度も verdict を出さなくなる（実測: 8 コアで
  load 18.0）。R5 のとおり計測の前後で読み、前の値で判定する
- **JSON レポーターは固定コストを測れない。** `startTime`/`endTime` はテスト実行の
  区間だけを覆い、environment / transform / import / setup（全体の約 74%）は
  含まれない。実測でもファイル区間合計 87.6s に対しテスト本体合計 87.0s で、
  差分は 0.6s しかない。このゲートで唯一、固定コストを含む数値は wall だが、
  wall はスイートが最も不安定（同じ 8 コアで 6 worker 76.9s / 3 worker 184s /
  2 worker 303s）で、共有ファイルに閾値を持っても開発機と 4 vCPU の CI のどちらかを
  壊す。よって**合否はファイル数だけで判定し、時間系（合計 / p95 / 上位 10 件 /
  wall）はすべて参考値として併記する**。予算ファイルは `gates` と `reference`
  に分けてこの区別を明示する。固定コストを実際に守るのは sleep 禁止ルールと
  ファイル数上限であり、時間閾値ではない。`build` が `needs: validate` のため、
  ランナーの個体差で落下すればビルド成果物まで止まる

**小さいテストファイルの統合は推奨しない。** 概算利得は 150 ファイル × 118ms で
約 18s の CPU だが、1 ファイル 1 論点という現在の規約を壊し、失敗時の局所性を失う。
必要になった時点で別の判断とする。

### R5. 実測はブロックする手段で行い、共有マシン上では定点観測しない

- プロセスの完了待ちは sleep とポーリングではなく、ブロックする手段で待つ
- 同じマシンに他の負荷があると数値が 3 倍飛ぶ。**測定の直前に load average を読み、
  コア数を超えていれば測定を棄却する**。測定の直後にも読み、後始末として表示する。
  直後との差で棄却してはいけない: 全コアを使い切るスイートは実行中に必ず load を
  上げるため、差が 1 以上という規則を文字通り適用すると全測定が棄却され、
  ゲートが一度も判定を出さなくなる（実測: 静止したマシンで 1 回走らせただけで
  load が 3.0 → 14.3 に跳ねた。他の負荷の有無は測定の**前**でしか判定できない）
- バックグラウンドで走らせる前に、孤児プロセスがないことを確認する。孤児プロセスが
  残ったまま測ると、worker の起動タイムアウトで 799s の実行になる（本件で実測）

### 作業のしかた

| 目的 | コマンド | 実測 |
|------|----------|------|
| 反復 | `npm run validate:fast`（`vitest run --changed`） | 数秒 |
| 特定ディレクトリ | `npx vitest run src/background/__tests__` | 数千 ms |
| 1 ファイル | `npx vitest run <path>` | 1 秒前後 |
| 依存ファイルから逆引き | `npx vitest related <file> --run` | 対象による |
| 隔離不要のサブセット | `npx vitest run --project=shared` | 11s |
| ゲート | `npm test` | 約 70s |

反復のたびに `npm test` を回さない。ゲートは最後の 1 回だけ回す。

## 却下した選択肢

`pool: 'vmForks'`、`pool: 'threads'`、happy-dom の一括移行、隔離判定の緩和、
テストファイルの統合。いずれも定性的には正しく見えるが、このスイートでは
実測で得られない効果しかなく、あるいは利得に対して変更範囲が大きすぎる。

## 検証方法

- 固定コストを下げる変更は、他のファイルを壊さないことを最優先する。
  個別ファイル実行、続いて全体実行の順で確認する
- **単体では通っても全体実行で落ちる**。fake timers や短い sleep を入れるときは、
  負荷が掛かった状態で全体実行を数回回す。実測で次の 2 件を捕まえた:
  - `Date.now` を固定したファイルで fake clock を組み合わせた結果、時計の巻き戻しが
    終了しなくなり、全体実行で 30 秒タイムアウトが 6 件発生した
  - 連鎖の最初のステップを待っていたテストが、負荷時に次のステップの直前に戻って
    失敗した（待つべき条件を 1 つ後ろの成果物にした）
- 本番値を差し替えたテストは、契約の層が本番の値を検証していることを確認してから
  受け入れる

## この設計で得られた結果

| 指標 | 変更前 | 変更後 |
|------|--------|--------|
| wall | 91.1s | 69.8s（load 2.87 の時） |
| ファイルあたり合計（直列換算） | 142.4s | 81.3s |
| isolated プロジェクト p50 | 47ms | 32ms |
| 実タイマーの sleep | 308 サイト / 10.70s | 150 サイト / 1.20s |
| 200ms 以上のファイル | 135 件 / 114.2s | 100 件 / 52.1s |
| 本番 600,000 反復を使うテスト | 5 ファイル / 17.3s | 1 ファイル / 1.1s |

残る費用の約半分は jsdom 環境の構築（1 ファイル 106ms × 298 ファイル）である。
上で却下した選択肢を踏まえると、**これ以上はファイル数の削減か環境構築の
費用向下という、別の判断の領域に入る。**

**wall の絶対値はマシンに依存する。** 上記 69.8s は load average 2.87 の状態で
計測した。同じ構成で load 10 のときは 77.2s、load 12 のときは 83.3s だった。
`npm run test:perf` は load average がコア数を超えた場合に「 machines busy」と
報告して判断を見送る。負荷下で測った予算で合否を判定させないためである。

---

## 追記（2026-10-12）: 予算の改定と環境別ゲートの追加

### 何が起きていたか

`gates.fileCount` は 930 のまま 16 日間更新されず、CI の `validate` は
`OVER file count: 1059 / 930 (114%)` で赤だった。`build` は `needs: validate`
のため skipped になり、PR でビルドが走っていなかった。赤が必須チェックでは
ないため（PR は `UNSTABLE` でマージ可能）、赤のまま運用が続いていた。

ファイル数の推移（`git ls-tree` で include 相当を集計）:

| 日付 | コミット | ファイル数 |
|---|---|---|
| 2026-09-26 | `9fe81ed2`（予算 930 を導入） | 910 |
| 2026-09-27 | `ccf8184b` | 932 ← 導入翌日に超過 |
| 2026-10-04 | `0d00c34e` | 985 |
| 2026-10-10 | `22ff50b7` | 1042 |
| 2026-10-12 | `HEAD` | 1059 |

### 根本原因

930 は「導入日の実測 910 + 20」というスナップショットで、スイートが継続的に
成長する運用（毎ラウンド 5〜30 ファイル追加）と、統合を禁じる規約（R4 末尾）を
前提にしていなかった。増加を吸収する更新手続きも無く、判定は CI にしかない
（ローカルの `npm run validate` は `npm test` で終わり `test:perf` を呼ばない）。
**ラチェットが構造的に必ず破られ続ける設計**であり、赤が常態化した。

さらに、総ファイル数は固定コストを**誤って価格付けする**。実測では
isolated/node が 40ms/ファイル、isolated/jsdom が 147ms/ファイル
（environment が 81%、jsdom 構築だけで約 106ms）で、最大 3.7 倍違う。
1 ファイル 1 論点の規約を守る限り総数は単調増加するので、総数だけをゲートに
すると「安い node ファイルを足す」ことも「高い jsdom ファイルを足す」ことも
同じ 1 として止めてしまい、最も守る理由が弱い対象まで止めることになる。

### 決定

1. **`gates.fileCount` を 930 → 1060 に改定する**（clean checkout の実測は 1059）。
2. **`gates.jsdomFileCount` を新設し 360 で pin する。** これもカウントであり
   time ではないため machine-independent（R4 の「machine-independent な指標を
   ゲートにする」基準を満たす）。固定コストの支配要因に直接対応するので、
   安い node / shared のテスト追加は自由、jsdom の追加だけが意図的な判断を
   要求する形になり、R4 末尾の「統合は推奨しない」規約と矛盾しない。
3. **予算の引き上げ手続き**: 引き上げは本 ADR への追記（推移と原因）と同時に
   行う。単独の引き上げは時計を巻き戻すだけである。
4. `reference` に時間系（total / p95 / top10）を残す扱いは変えない。

### 補足・残る論点

- clean checkout の fileCount は 1059。ローカルでは gitignore された作業用
  テスト（`src/utils/crypto/__tests__/tmp/verify-new.test.ts`）が include に
  載って 1060 になる。ゲートは 1060 なのでどちらも通る。
- `fileCount` の引き上げが毎日必要になるようなら、**総数を `reference` へ
  降格し `jsdomFileCount` だけをゲートにする**選択肢がある（R4 末尾が認めて
  いるとおり、総数の削減で得られるのは 150 ファイル × 118ms ≒ 18s CPU 程度で、
  規約と局所性を犠牲にする理由にならない）。再検討トリガー: 次に `fileCount` を
  引き上げる時。
- ローカルで赤が見えない非対称（`validate` が `test:perf` を呼ばない）は、
  ファイル発見ロジックを二重実装するリスクがあるため今回は触らない。

### 2026-10-13 の引き上げ（1060 → 1062）

- **`gates.fileCount` を 1060 → 1062 に改定する**（決定 3 の手続きどおり本追記と
  同時に改定）。clean checkout の実測は 1061 ― review-followup2 で
  `src/__tests__/geturl-extraction-sync.test.ts`（getURL 抽出ルールの二層同期 pin）
  を新設したため。ローカルは gitignore された作業用ファイル込みで 1062。ゲートは
  1062 なのでどちらも通る。CI は 1061 / 1060 で赤（run `38315624155`）。
- 原因は suite の成長であり、欠陥や追加ゲートの必要はない。`jsdomFileCount` は
  359 / 360 で余裕があるため据え置く。

### 2026-10-18 の降格（`fileCount` をゲートから外す）

- **再検討トリガー（「次に `fileCount` を引き上げる時」）に到達した。** CI は
  `OVER file count: 1093 / 1062 (103%)` と `OVER jsdom files: 362 / 360 (101%)`
  で赤だった（PR #180 / run `39123791697`）。`validate` 以外のジョブは緑で、
  失敗は suite の成長のみが原因。
- **決定**: `gates.fileCount` を削除し `reference.fileCount` へ降格する。
  `gates.jsdomFileCount` は 360 → 362 に改定してゲートとして残す。
- 理由: 決定 2 と R4 末尾の議論のとおり、総数は固定コストを誤って価格付け
  する（isolated/node 40ms / isolated/jsdom 147ms）。1 ファイル 1 論点の規約の
  下で総数は単調増加し、引き上げが常態化していた（930 → 1060 → 1062 → 今回）。
  安い node/shared の追加を止める理由は無く、高い jsdom の追加だけを意図的な
  判断にすればよい。
- 効果: `file count` は advisory 行として表示され続けるので増加は可視のまま
  である。ゲートは固定コストの支配要因（jsdom 構築 約 106ms/ファイル）に
  直接対応する。
- 実装: `scripts/test-perf/report.mjs` の `loadIndependentGates` から
  `file count` を外し、`advisories` の先頭へ移した。
- 今後の `jsdomFileCount` の引き上げは、決定 3 の手続き（本 ADR への追記と
  同時に改定）に従う。

#### `jsdomFileCount` の推移と 360 → 362 の内訳（2026-10-19 追記）

`65057bf0` は値を 362 に改定したが、決定 3 が求める「推移と原因」を残してい
なかった。PBI `2026-10-19-08` で履歴を実測して埋めた（推測は使っていない）。

| 時点 | 件数 | 何が動いたか |
|---|---:|---|
| `c2e28943`（2026-10-13、`jsdomFileCount: 360` の新設） | 360 | 新設値はその時点の実測と一致していた（`git grep` で 360） |
| `004b05c7` / `375f60a9`（manifest 権限ゲートの復旧） | 359 | `src/__tests__/manifest.test.ts` が `@jest-environment jsdom` を落とした。checked-in の `manifest.json` ではなく `wxt.config.ts` を検証する形に書き換わり、DOM が不要になったため（node 側へ移動）。ゲートは据え置きなので 1 ファイル分の余裕が生まれた |
| `7a3a39e0`（2026-10-16） | +1 | `src/offscreen/__tests__/opfsWorker-loadShedRetry.test.ts` |
| `b9f9df3c`（2026-10-17） | +1 | `src/popup/__tests__/pausePanel.test.ts` |
| `ce410903`（2026-10-17） | +1 | `src/background/handlers/dashboardSqlite/__tests__/maintenanceBatchHandler-purge-plan.test.ts` |
| `65057bf0`（2026-10-18） | 362 | 上記 3 ファイル追加（359 + 3）。CI の実測も `362 / 360 (101%)` で一致 |

3 ファイルはいずれも DOM を必要とする（`document` / `window` を直接操作する、
または popup・offscreen の UI 経路を検証する）ため、`scripts/test-perf/report.mjs`
の `JSDOM_DOCBLOCK` 判定で jsdom 側に分類される。**362 という値自体は正しく、
欠けていたのは「そこに至る履歴」だけ**だった。

#### 次に `jsdomFileCount` を引き上げるときの手順（1 箇所にまとめる）

1. `npm run test:perf` の `OVER jsdom files: N / M` で現状値を確認する。
2. 増えた分を**ファイル単位で特定**する:
   `git grep -lE '@(vitest|jest)-environment[[:space:]]+jsdom' <前回改定の rev> -- '*test.ts'`
   と現在の同コマンドの差分を取る（削除・docblock 除去も必ず拾う）。
3. 各ファイルについて「なぜ jsdom なのか」（DOM を直接使う／UI 経路を検証す
   る）を 1 行で書く。**特定できなかった場合は「特定できなかった」と根拠を
   書く**（推測で埋めない）。
4. 本 ADR に**推移表の行を足す**（時点・件数・何が動いたか）。
5. `bench/baselines/test-perf.budget.json` の `_comment` の推移文を同じ内容に
   更新する（2 箇所が矛盾しないように）。
6. `gates.jsdomFileCount` の値だけを改定し、`npm run test:perf` で `ok jsdom
   files: N / N` を確認する。

#### `jsdomFileCount` 362 → 374 の内訳（2026-10-25 追記）

2026-10-24 の CI（PR #198 / run `40129693375`）と main（2026-10-22 / run
`39773221409`）が `OVER jsdom files: 374 / 362` で赤だった。`validate` 以外の
ジョブは緑で、失敗は suite の成長のみが原因（同 run の通常テスト本体も緑）。
前回改定 rev `65057bf0` からの差分を `git grep` で特定した（推測なし）。
検証対象 PR 自身の新規テスト 3 件は node 環境で、jsdom 件数への寄与は 0。

| 増減 | ファイル | なぜ jsdom なのか |
|---|---|---|
| +1 | `src/content/__tests__/mediaKind.test.ts` | メディア種別判定の DOM（document.body）利用 |
| +1 | `src/dashboard/__tests__/markdownTemplateSave.test.ts` | テンプレート保存 UI の DOM 操作・イベント検証 |
| +1 | `src/dashboard/__tests__/onboardingBanner.test.ts` | オンボーディングバナーの DOM 構築検証 |
| +1 | `src/dashboard/__tests__/proposalRowWiring.test.ts` | 提案行の DOM 配線検証 |
| +1 | `src/dashboard/__tests__/tagsPanel-proposalPin.test.ts` | タグパネル提案 UI の DOM 検証 |
| +1 | `src/dashboard/generalSettings/__tests__/connectionTests-conflictFeedback.test.ts` | 接続テストフィードバック UI の DOM 検証 |
| +1 | `src/dashboard/panels/__tests__/rowCapNotice.test.ts` | 行数上限通知 UI の DOM 検証 |
| +1 | `src/dashboard/panels/asyncData/__tests__/busyButton.test.ts` | ビジー状態ボタン UI の DOM 検証 |
| +1 | `src/dashboard/panels/asyncData/__tests__/domainAnalysisPanel-proposalPin.test.ts` | ドメイン分析パネル提案 UI の DOM 検証 |
| +1 | `src/dashboard/panels/asyncData/__tests__/historyPanelRegionActions.test.ts` | パネル領域アクション（DOM を伴う配線）の検証 |
| +1 | `src/dashboard/panels/diagnostic/__tests__/exportLogsPanel.dateFilename.test.ts` | エクスポートログパネル UI の DOM 検証 |
| +1 | `src/dashboard/settings/__tests__/aiDomainPolicySettings.test.ts` | AI ドメイン政策設定 UI の DOM 検証 |
| +1 | `src/utils/__tests__/domClear.test.ts` | DOM クリアユーティリティ自体の検証 |
| +1 | `src/utils/__tests__/settingsExportImportUiCore.test.ts` | 確認ダイアログ（DOM モーダル）を含む取込経路の検証 |
| -1 | `src/content/__tests__/contentKernel.dynamic.test.ts` | ファイル削除（死にコード整理 `1d5fee42`） |
| -1 | `src/utils/trustDb/__tests__/trancoChangeDetector.test.ts` | ファイル削除（死にコード整理 `d253fcc2`） |

**決定**: `gates.jsdomFileCount` を 362 → 374 に改定する。増加分は DOM を
直接使う UI・パネル経路の検証が中心で、suite の成長は正当なため、欠陥や
追加ゲートの必要はない。