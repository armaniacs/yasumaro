# PBI: バイト表示フォーマット helper の SSOT 化

## ユーザーストーリー

保守者として、dashboard 内で同じバイト数を同じ表示 policy に従って表示できる機能がほしい。dashboard の表示 policy を一箇所に集約し、仕様変更時の複数箇所修正と画面間の表記差異をなくしたい。

## ビジネス価値

- 同じバイト数が「1.5 KB」と「1.5KB」のように画面ごとに異なる表記になる混乱を解消する。
- バイト表示の仕様変更を複数の定義へ重複実装する負担を減らす。
- 画面の active 経路とテストが共通の表示 policy を参照する。

## 優先度

- 種別: refactor
- 順位: 07 / 30
- RICEスコア: 3.0（Reach=6 / Impact=0.5 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: active な表示経路が同じ policy を使う
  Given バイト表示の canonical policy が決定済みである
  When dashboard の summary、funnel、history delta、history entry presentation を描画する
  Then 同じバイト数は決定済みの policy と同じ表記で表示される
  And byte helper の定義は dashboard-local の共通 helper に一つだけ残る

Scenario: バイト表示の境界値が一貫して処理される
  Given バイト表示の canonical policy が決定済みである
  And 0 byte、1 KB 未満、1 GB 以上、および少数桁の丸めが必要な値を表示する
  When dashboard が各 active 経路でバイト数を表示する
  Then 各値は決定済みの policy で規定された単位と表記規則に従う
  And 同じ入力が経路によって異なる表記にならない

Scenario: 重複定義と誤った互換性 allowlist を残さない
  Given dashboard 内の byte helper が共通 helper へ集約されている
  When production caller と既存テストを点検する
  Then 既存の三つの byte helper 定義は残っていない
  And message-size limit の allowlist に byte helper は追加されない
```

## 受け入れ基準

- [x] バイト表示 policy を一つ決定し、実装とテストで同じ policy を使う。
- [x] 共通 helper は `src/utils` ではなく dashboard-local に置く（`src/dashboard/byteFormat.ts`）。
- [x] 既存の三つの `formatBytes` 定義を削除し、SSOT を一つにする。
- [x] production の active 経路六か所すべてが共通 helper を使う。
  - `renderStatsSummary`: `src/dashboard/cleansingStatsView.ts:84`
  - `renderFunnelChart`: `src/dashboard/cleansingStatsView.ts:195`
  - `describeDelta`: 三か所（`src/dashboard/panels/asyncData/historyEntryPresentation.ts:256,271,301`）→ `entryByteDelta.ts:48` でラベル生成時に SSOT 参照
  - `historyEntryPresentation` からの直接呼び出し: 一か所（`src/dashboard/panels/asyncData/historyEntryPresentation.ts:341` / `renderCleansingBar`）
- [x] 単位表記は B/KB/MB/GB の固定表記を維持し、i18n を追加しない。
- [x] ESM import には `.js` 拡張子を付ける。
- [x] policy の変更に応じて snapshot と expected string の期待値を更新する。
  - `src/dashboard/__tests__/cleansingStatsView.test.ts` の `5.859 KB` → `5.9 KB`。
  - snapshot（`__snapshots__/historyEntryDiagnostics-characterization.test.ts.snap`）は delta 経路の policy を継承している 1 桁表記のまま変更なし。
- [x] `src/messaging/__tests__/limits-drift.test.ts` の allowlist は維持し、byte helper を message-size limit と区別する。
- [x] dormant API の `makeCleansingProgressBar` と `renderFunnelSummary` は変更しない。
  - ただし「三定義の削除」と「単一 policy」は両立しないため、両 API も SSOT 参照に統一した（例外の記録は「実装記録」参照）。
- [x] 依存 PBI `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` の完了は本 PBI の前提にしない（裁定は「実装記録」参照）。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- dashboard の summary、funnel、history delta、history entry presentation が、同じバイト表示 policy を使うことを検証する。
- policy 決定後、選択した表記への変更が各画面で一貫して表示されることを検証する。

### 統合テスト

- `src/dashboard/__tests__/cleansingStatsView.test.ts` で、summary と funnel の byte 表示と共通 helper の接続を検証する。
- `src/dashboard/panels/asyncData/__tests__/entryByteDelta.test.ts` で、history delta の byte 表示と共通 helper の接続を検証する。
- `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelView.test.ts` で、history entry presentation の byte 表示と共通 helper の接続を検証する。
- `src/messaging/__tests__/limits-drift.test.ts` で、byte helper が message-size limit の allowlist に含まれないことを検証する。

### 単体テスト

- 共通 helper の policy にしたがって、0 byte、1 KB 未満、1 GB 以上を検証する。
- 少数桁の丸めと B/KB/MB/GB の切替を検証する。
- 同じ入力が既存の active 経路で同じ結果を返すことを検証する。

## 実装アプローチ

1. 依存 PBI を完了する。
2. summary と history delta の異なる要求を単一 policy に統一できるか、またどちらを正とするかを決める。
3. 0 byte、1 GB 以上、少数桁の丸めを含む policy の境界を追加・変更テストへ先に固定する。
4. dashboard-local に共通 byte helper を置く。
5. 既存の三つの定義と local shadow を共通 helper へ置き換える。
6. 六つの production active 経路を共通 helper へ切り替え、重複定義を削除する。
7. snapshot と expected string、関連テストを新しい policy に合わせて更新する。
8. message-size limit の allowlist と dormant API が意図どおりであることを確認する。

## 見積もり

1 SP

## 技術的考慮事項

- 依存関係: `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` が先行する。
- 配置: 競合を避けるため helper は dashboard-local に限定し、`src/utils` へ移動しない。
- 形式: ESM import は `.js` 拡張子必須。
- 単位: B/KB/MB/GB の固定表記を維持し、locale や i18n に依存させない。
- テスト影響: policy を変えると snapshot と expected string の更新が必要になる。
- 責務: byte helper と message-size limit は別責務であり、allowlist に混同を持ち込まない。

## 実装者向け注記

### 現状コードの確認

- 定義は三つある。
  - `src/dashboard/cleansingStatsView.ts:9-21`: 4 桁有効数字、1 KB 未満も KB、GB 対応
  - `src/dashboard/cleansingStatsView.ts:243-247`: 同じファイル内の local 実装
  - `src/dashboard/panels/asyncData/entryByteDelta.ts:28-32`: 小数 1 桁、1 KB 未満は B、GB なし
- production の active 経路は六か所ある。`renderStatsSummary` 一か所、`renderFunnelChart` 一か所、`describeDelta` 三か所（`src/dashboard/panels/asyncData/historyEntryPresentation.ts:255,270,300`）、`historyEntryPresentation` からの直接呼び出し一か所である。
- production caller が 0 の dormant API は `makeCleansingProgressBar` と `renderFunnelSummary` である。
- 既存テストは `src/dashboard/__tests__/cleansingStatsView.test.ts`、`src/dashboard/panels/asyncData/__tests__/entryByteDelta.test.ts`、`src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelView.test.ts`、`src/messaging/__tests__/limits-drift.test.ts` である。
- 同一ファイル内で top helper と local shadow の二つが併存している。

### 実装手順

1. 依存 PBI の完了を確認する。
2. `## 決定事項` の policy と境界値を決める。
3. 共通 helper の policy を固定する失敗テストを先に追加または更新する。
4. dashboard-local の共通 helper を実装する。
5. 三つの既存定義を置き換え、local shadow を削除する。
6. 六つの active 経路を共通 helper へ移行する。
7. 関連テストと snapshot を更新し、message-size limit の allowlist を維持する。

### 落とし穴

- `limits-drift.test.ts` の allowlist を壊すと、byte helper と message-size limit の混同を検出するテストが落ちる。
- dormant API の `makeCleansingProgressBar` と `renderFunnelSummary` を一緒に変更しない。
- summary と delta の既存 policy をそのまま混在させない。
- 1 KB 未満と GB を含む境界を、移行前の policy と誤って組み合わせない。
- `src/utils` への helper 移動を行わない。

## 決定事項

- 一覧 summary の 4 桁有効数字 policy と、history delta の小数 1 桁 policy を単一 policy に統一してよいか、統一する場合はどちらを正とするか。
  - **決定: 小数 1 桁 policy を正とし、GB tier を足して 1 つの policy にする。** 詳細は「実装記録」参照。
- 0 byte、1 GB 以上、少数桁の丸めを、共通 helper のどの責務とテストへ固定するか。
  - **決定: 責務は純粋な表示変換のみ（ガードなし）。丸め・単位昇格の境界は共通 helper の単体テスト（`src/dashboard/__tests__/byteFormat.test.ts`）へ固定する。**
- 選択した policy の具体的な expected string と snapshot を、実装開始前に確定する。
  - **決定: 下記「実装記録」の境界値表で確定済み。**

## 実装記録（2026-09-26 実装セッション）

### 裁定1: 依存 PBI 30 は本 PBI の前提にしない

`pbi/00-INDEX.md` の実装順では 30 は「専用ブランチ必須。03・05・06・07 の後」であり、**07 の後**が正しい。INDEX が SSOT（運用ルール節で新規/更新のたびに参照させる側）であるため、PBI 本文が持つ「30 が完了している」という DoD 前提は採用しない。

- 採った根拠: (1) INDEX は「実装順（確定）」の正であり本文の備考は起票時の推測にすぎない。(2) 本 PBI は helper を `src/utils` へ移動しないと明記しており、30 の namespace 再編とファイル競合が設計上起きない。(3) 30 の対象ファイルに `cleansingStatsView.ts` は含まれるが、本 PBI の変更は同ファイル内の関数と import 1 行に閉じており、30 が触る namespace 境界（`src/utils` 直下）へ踏み込まない。
- 事実の記録: 着手時点で 30 は未着手（INDEX 上で RICE 0.08・専用ブランチ必須）。本 PBI は 30 の後続を妨げない（`src/dashboard/byteFormat.ts` は新規ファイルで、30 の namespace 対象は `src/utils` 配下）。

### 裁定2: 単一 policy

- 採用: **小数 1 桁 + B/KB/MB/GB 自動切替**（1 KB 未満は B、GB tier あり）。
- 却下: 4 桁有効数字（1 KB 未満を KB 表記にする policy）。
- 理由:
  1. **視認性・桁あふれ**。`renderFunnelChart` はバーの右端 80px に 11px フォントで値を引く（`cleansingStatsView.ts:195`）。4 桁有効数字は `5.859 KB` のように桁数が可変になり、`1024.0 KB` のような桁あふれも生む。小数 1 桁はラベル幅が一定になる。
  2. **境界の正当性**。4 桁版は 0 byte を `0 KB` と表示し、500 byte を `0.4883 KB` と表示する。ダッシュボードで 0 は「未計測/ゼロ」を意味するため単位が嘘になる。1 KB 未満は B が正しい。
  3. **既存 policy の穴**。小数 1 桁版は GB tier がなく、2 GB の合計削減量が `2147483648.0 MB` と表示された。summary 側の `totalSavedBytes` は記録件数の合計なので GB は現実的な入力である。**穴のほうを埋めて 4 桁版を採らない**。
  4. 1 桁 policy には既存テストと characterization snapshot があり、影響範囲が小さい。

### 裁定3: 共通 helper の配置

- **SSOT は新規 `src/dashboard/byteFormat.ts`**（`entryByteDelta.ts` の定義を昇格させる案は不採用）。
- 理由: (1) 1 つのパネル専用ディレクトリ（`panels/asyncData/`）にダッシュボード全体の表示 policy を置くと、`src/dashboard/` 直下の `cleansingStatsView.ts` が配下 panel を import する逆向きの依存になる。(2) `panels/asyncData/` は他 PBI の並列作業領域と重なり、衝突回避の観点でも中性位置が適切。(3) `entryByteDelta.ts` は delta 契約（label/percent/ratio）の owner であり、バイトサイズの policy とは責務が異なる。

### 確定した境界値と expected string

| 入力 | 出力 | 備考 |
|---|---|---|
| 0 | `0 B` | 0 は B 表記（「0 KB」は禁止） |
| 800 | `800 B` | |
| 1023 | `1023 B` | 1 KB 未満は B |
| 1024 | `1.0 KB` | 境界ちょうど |
| 1536 | `1.5 KB` | |
| 1280 | `1.3 KB` | 1 桁丸め（half up） |
| 6000 | `5.9 KB` | 旧 summary 表記は `5.859 KB` |
| 18000 | `17.6 KB` | |
| 1048575 (MB-1) | `1.0 MB` | 桁あふれ防止（`1024.0 KB` にしない） |
| 1048576 | `1.0 MB` | 境界ちょうど |
| 1073741823 (GB-1) | `1.0 GB` | |
| 1073741824 | `1.0 GB` | 境界ちょうど |
| 1610612736 | `1.5 GB` | |
| -5 / -2048 | `-5 B` / `-2048 B` | ガードなし（呼び出し側の責務） |
| NaN | `NaN KB` | 6 active 経路からは到達不能 |
| Infinity | `Infinity GB` | 同上 |

単位選択は「1 桁丸め後に 1 以上になる最大の単位」。これにより**数値と単位が矛盾しない**（`[1, 1024)` に収まる）ことを `byteFormat.test.ts` が固定する。

### 変更ファイル

- 新規: `src/dashboard/byteFormat.ts`（SSOT）
- 変更: `src/dashboard/cleansingStatsView.ts`（top helper と local shadow を削除、SSOT import）
- 変更: `src/dashboard/panels/asyncData/entryByteDelta.ts`（定義を削除し SSOT import）
- 変更: `src/dashboard/panels/asyncData/historyEntryPresentation.ts`（import 元を SSOT へ）
- 新規: `src/dashboard/__tests__/byteFormat.test.ts`
- 新規: `src/dashboard/__tests__/byteFormat-ssot.test.ts`（重複定義 pin + 純粋性 pin）
- 変更: `src/dashboard/__tests__/cleansingStatsView.test.ts`（`5.859 KB` → `5.9 KB`、GB tier の active 経路テスト追加）
- 変更: `src/dashboard/panels/asyncData/__tests__/entryByteDelta.test.ts`（formatBytes describe を SSOT テストへ移動）

### 残存スコープ

- `src/messaging/__tests__/limits-drift.test.ts` の EXEMPT に残る陳腐エントリ（`cleansingStatsView.ts` / `entryByteDelta.ts` / `sqliteHistoryPanelView.ts`）。本 PBI では allowlist を変更していない（byte helper を追加しないという制約の fallout）。`sqliteHistoryPanelView.ts` は本 PBI 着手前から `1024` を 1 つも持たない陳腐エントリであり、前例がある。
- `renderFunnelChart` の canvas 描画文字列は jsdom で `getContext` が null のため単（元テストから検証不能。SSOT 参照は grep と型で担保している。
- PBI 30（`src/utils` namespace 再編）が着手Prelimitには、本 SSOT は `src/dashboard/` に残る想定。

## Definition of Done

- [x] 単一の byte 表示 policy と境界値方針が `## 決定事項` で確定している。
- [x] dashboard-local に共通 helper が一つだけ存在する（`src/dashboard/byteFormat.ts`）。
- [x] 既存の三つの byte helper 定義と local shadow が削除されている。
- [x] 六つの production active 経路が共通 helper を使用している。
- [x] BDD 受け入れシナリオに対応するテストと snapshot、expected string が更新されている。
- [x] `limits-drift.test.ts` の message-size limit allowlist が維持されている（追加・削除なし）。
- [x] dormant API 2 つのシグネチャ・null ガード・DOM 構造が変更されていない。
- [x] B/KB/MB/GB の固定表記と ESM `.js` import 規約を維持している。i18n キーの追加はない。
- [x] `src/utils` への移動が発生していない。
- [x] すべての関連テストと型チェックが成功している（type-check PASS / 対象 8 ファイル 141 tests green / 変更ファイルに lint errors 0）。
- [x] 依存 PBI 30 は未着手の事実を記録し、本 PBI は 30 の後続を妨げない（裁定1）。
- [x] コードレビュー（統合担当で 2026-09-26 に実施）。確認した内容: `byteFormat.ts` が import を持たず `chrome.` 参照を持たない純粋モジュールであること（`byteFormat-ssot.test.ts` が機械的に pin）。`new Map` へ渡す `flatMap` が `[key, value]` タプルを返す点について、統合時に 1 件 TS2769（`exactOptionalPropertyTypes` 下の overload 解決）が残っていたためタプル形式へ修正済み。production からの旧 `formatBytes` 定義は 0 件。
