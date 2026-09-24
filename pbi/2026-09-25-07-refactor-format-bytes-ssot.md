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

- [ ] バイト表示 policy を一つ決定し、実装とテストで同じ policy を使う。
- [ ] 共通 helper は `src/utils` ではなく dashboard-local に置く。
- [ ] 既存の三つの `formatBytes` 定義を削除し、SSOT を一つにする。
- [ ] production の active 経路六か所すべてが共通 helper を使う。
  - `renderStatsSummary`: 一か所
  - `renderFunnelChart`: 一か所
  - `describeDelta`: 三か所（`src/dashboard/panels/asyncData/historyEntryPresentation.ts:255,270,300`）
  - `historyEntryPresentation` からの直接呼び出し: 一か所
- [ ] 単位表記は B/KB/MB/GB の固定表記を維持し、i18n を追加しない。
- [ ] ESM import には `.js` 拡張子を付ける。
- [ ] policy の変更に応じて snapshot と expected string の期待値を更新する。
- [ ] `src/messaging/__tests__/limits-drift.test.ts` の allowlist は維持し、byte helper を message-size limit と区別する。
- [ ] dormant API の `makeCleansingProgressBar` と `renderFunnelSummary` は変更しない。
- [ ] 依存 PBI `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` を先に片付ける。

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
- 0 byte、1 GB 以上、少数桁の丸めを、共通 helper のどの責務とテストへ固定するか。
- 選択した policy の具体的な expected string と snapshot を、実装開始前に確定する。

## Definition of Done

- [ ] 依存 PBI `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` が完了している。
- [ ] 単一の byte 表示 policy と境界値方針が `## 決定事項` で確定している。
- [ ] dashboard-local に共通 helper が一つだけ存在する。
- [ ] 既存の三つの byte helper 定義と local shadow が削除されている。
- [ ] 六つの production active 経路が共通 helper を使用している。
- [ ] BDD 受け入れシナリオに対応するテストと snapshot、expected string が更新されている。
- [ ] `limits-drift.test.ts` の message-size limit allowlist が維持されている。
- [ ] dormant API 2 つの挙動が変更されていない。
- [ ] B/KB/MB/GB の固定表記と ESM `.js` import 規約を維持している。
- [ ] `src/utils` への移動や不要な i18n 追加が発生していない。
- [ ] すべての関連テストと型チェックが成功し、コードレビューを完了している。
