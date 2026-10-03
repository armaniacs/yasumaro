# 2026-10-03 holistic ラウンド バックログ台帳（holistic-1003b）

## 出所

- holistic-code-improvement skill による大局的レビューラウンド（6.9.34 時点）。
- 4 領域の地図用 agent（dashboard / popup+content / background+utils / infra）の 4 agents 発見をテーマ TOP5 に統合。
- 差分スコープ: 過去台帳（holistic-1001・archloop-1001 等）で閉じたテーマは再レビュー対象外。
- 実残 20 件を PBI 16–35 に起票した。本台帳は RICE 採点・同点の順位根拠・依存・バッチ計画の SSOT。
- 本ラウンドは起票・採点登録のみで、実装は別ラウンドで行う。

## RICE 採点表（RICE 降順）

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---|---:|
| 1 | 16 | [2026-10-03-16-fix-fetch-5xx-backoff.md](2026-10-03-16-fix-fetch-5xx-backoff.md) | fix | 6 | 2 | 1.0 | 0.5 | 24.0 |
| 2 | 17 | [2026-10-03-17-fix-reload-seam-wiring.md](2026-10-03-17-fix-reload-seam-wiring.md) | fix | 6 | 3 | 1.0 | 1.0 | 18.0 |
| 3 | 18 | [2026-10-03-18-fix-flush-batch-on-dropped.md](2026-10-03-18-fix-flush-batch-on-dropped.md) | fix | 3 | 3 | 1.0 | 0.5 | 18.0 |
| 4 | 19 | [2026-10-03-19-fix-anchor-download-unify.md](2026-10-03-19-fix-anchor-download-unify.md) | fix | 4 | 2 | 1.0 | 0.5 | 16.0 |
| 5 | 20 | [2026-10-03-20-fix-preset-status-orphan-class.md](2026-10-03-20-fix-preset-status-orphan-class.md) | fix | 4 | 2 | 1.0 | 0.5 | 16.0 |
| 6 | 21 | [2026-10-03-21-fix-gateway-version-contract.md](2026-10-03-21-fix-gateway-version-contract.md) | fix | 5 | 1 | 1.0 | 0.5 | 10.0 |
| 7 | 22 | [2026-10-03-22-refactor-status-class-constant.md](2026-10-03-22-refactor-status-class-constant.md) | refactor | 5 | 1 | 1.0 | 0.5 | 10.0 |
| 8 | 23 | [2026-10-03-23-refactor-preset-buttons-id-ssot.md](2026-10-03-23-refactor-preset-buttons-id-ssot.md) | refactor | 5 | 1 | 0.9 | 0.5 | 9.0 |
| 9 | 24 | [2026-10-03-24-refactor-generate-id-unify.md](2026-10-03-24-refactor-generate-id-unify.md) | refactor | 4 | 1 | 1.0 | 0.5 | 8.0 |
| 10 | 25 | [2026-10-03-25-refactor-status-panel-split.md](2026-10-03-25-refactor-status-panel-split.md) | refactor | 5 | 2 | 0.8 | 1.0 | 8.0 |
| 11 | 26 | [2026-10-03-26-refactor-e2e-launch-context.md](2026-10-03-26-refactor-e2e-launch-context.md) | refactor | 5 | 2 | 0.9 | 1.5 | 6.0 |
| 12 | 27 | [2026-10-03-27-test-lint-rule-tautology.md](2026-10-03-27-test-lint-rule-tautology.md) | test | 3 | 1 | 1.0 | 0.5 | 6.0 |
| 13 | 28 | [2026-10-03-28-refactor-archive-panel-split.md](2026-10-03-28-refactor-archive-panel-split.md) | refactor | 6 | 2 | 0.8 | 2.0 | 4.8 |
| 14 | 29 | [2026-10-03-29-refactor-general-settings-panel-split.md](2026-10-03-29-refactor-general-settings-panel-split.md) | refactor | 6 | 2 | 0.8 | 2.0 | 4.8 |
| 15 | 30 | [2026-10-03-30-refactor-i18n-storage-mock-factories.md](2026-10-03-30-refactor-i18n-storage-mock-factories.md) | refactor | 5 | 1 | 0.9 | 1.0 | 4.5 |
| 16 | 31 | [2026-10-03-31-refactor-double-casts-cleanup.md](2026-10-03-31-refactor-double-casts-cleanup.md) | refactor | 4 | 0.5 | 1.0 | 0.5 | 4.0 |
| 17 | 32 | [2026-10-03-32-test-e2e-seeded-panel-fixture.md](2026-10-03-32-test-e2e-seeded-panel-fixture.md) | test | 5 | 1 | 0.8 | 1.0 | 4.0 |
| 18 | 33 | [2026-10-03-33-refactor-message-router-dead-code.md](2026-10-03-33-refactor-message-router-dead-code.md) | refactor | 4 | 0.5 | 0.9 | 0.5 | 3.6 |
| 19 | 34 | [2026-10-03-34-refactor-logger-mock-factory.md](2026-10-03-34-refactor-logger-mock-factory.md) | refactor | 8 | 1 | 0.9 | 3.0 | 2.4 |
| 20 | 35 | [2026-10-03-35-test-timer-clock-migration.md](2026-10-03-35-test-timer-clock-migration.md) | test | 4 | 0.5 | 0.9 | 1.0 | 1.8 |

RICE = R × I × C / E。値は各 PBI 内「優先度」セクションの記載に基づく。

## 同点の順位根拠（tie-break）

- **18.0（17 と 18）**: NN17 先行 — Reach 大（6 vs 3）かつ generalSettingsPanel チェーン（17 → 20 → 23 → 29）の起点で後続 3 件を解放するため。
- **16.0（19 と 20）**: NN19 先行 — 実害の有無（大バックアップでのデータ消失 vs スタイル欠落のみ）。
- **10.0（21 と 22）**: NN21 先行 — 種別 fix > refactor（gateway 契約不一致は実バグ、NN22 は内部定数化）。
- **8.0（24 と 25）**: NN24 先行 — Confidence 高（1.0 vs 0.8）かつ副作用が小さい（NN25 は分割で caller 影響が広い）。
- **4.8（28 と 29）**: NN28 先行 — リポジトリ最大の肥大化ファイル。NN29 はチェーン末端（17 → 20 → 23 → 29）で W6 配置が依存上の先決。
- **4.0（31 と 32）**: NN31 先行 — NN32 は NN26（e2e 起動コンテキスト統一）の後が前提のため。

## 依存マップ（実行順の制約）

- **generalSettingsPanel チェーン（直列）**: 17 → 20 → 23 → 29 — 同一ファイル `generalSettingsPanel.ts` を触る候補群。
- **e2e**: 26 → 32 — NN32 の seeded fixture は NN26 の起動コンテキスト統一後が前提。
- **test 広域**: 34 → 35 — logger モック統合（34）の後に timer clock 移行（35）。
- **25 → 31** — double casts cleanup（31）は statusPanel 分割（25）後。
- 上記以外（16 / 18 / 19 / 21 / 22 / 24 / 27 / 28 / 30 / 33）は依存なし・並列可。

## バッチ計画（W1–W6・ファイル排他）

| Wave | PBI |
|---|---|
| W1 | 16 / 18 / 21 / 24 / 27 / 33 |
| W2 | 26 / 19 / 25 / 30 |
| W3 | 17 / 28 / 22 / 31 / 32 |
| W4 | 20 / 34 |
| W5 | 23 / 35 |
| W6 | 29 |

W1 は依存なし 6 件の並列。W2 以降は先行 Wave の着地とチェーン先頭（17 / 26 / 34 / 25）の完了を前提に依存解錠順で配置。

## 実装状況

| PBI | 状態 |
|---|---|
| 16 | ✅ 完了 |
| 17 | ✅ 完了 |
| 18 | ✅ 完了 |
| 19 | ✅ 完了 |
| 20 | ⬜ 未着手 |
| 21 | ✅ 完了 |
| 22 | ✅ 完了 |
| 23 | ⬜ 未着手 |
| 24 | ✅ 完了 |
| 25 | ✅ 完了 |
| 26 | ✅ 完了 |
| 27 | ✅ 完了 |
| 28 | ✅ 完了 |
| 29 | ⬜ 未着手 |
| 30 | ✅ 完了 |
| 31 | ✅ 完了 |
| 32 | ✅ 完了 |
| 33 | ✅ 完了 |
| 34 | ⬜ 未着手 |
| 35 | ⬜ 未着手 |
