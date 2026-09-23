# PBI 2026-09-23-08 — VisitGating Module（content 側 gate 寿命の一元化）

**優先度**: 順位 8 / RICE 10.7（Reach 5 × Impact 2 × Confidence 80% ÷ Effort 0.75 人週）
**根拠**: gate 構築 3 箇所＋fallback 2 連鎖＋scheduler 同居の 533 行 kernel。閾値ソース変更が kernel+timer+extractor+tests に分散する。寿命一元化で gate 行列を約 10 テストに畳める。
**種別**: refactor（非機能追加）

## 背景

`contentKernel.ts` に 3 つの gate 構築箇所が共存する: `shouldRecordVisit` の per-call `new VisitGate`（:348-354）、`createVisitGate`（`pageState.toVisitGateThresholds()`、:360-362、`extractor.ts:100-101` 経由でも re-export）、`DeadlineTimer` の cache+drift-rebuild（:34-57）。`checkVisitConditions`（:364-375）は 2 つの fallback（`deadlineTimer.thresholds ?? pageState…`、`deadlineTimer.gate ?? createVisitGate()`）を連鎖する。同一ファイルに `IdleScheduler` 実装（:34-108）と約 90 行の settings 対応表（:239-330）が同居する。

## 実装戦略

1. `VisitGating` Module を新設し、`evaluate(state, now)` を唯一 interface にする。閾値 cache 所有・gate 寿命一元化（timer は借用、再構築しない）。
2. kernel の `shouldRecordVisit` / `checkVisitConditions` を 3 行 Adapter に縮退する。
3. `IdleScheduler` を `content/scheduler.ts` に分離する。`loadSettings` 対応表は単一 `applySettingsTable()` 呼び出しに寄せる。
4. nullable pre-init fallback（PBI 2026-09-11-01/2026-09-12-29 のクラッシュ修正）を明示エラー様式として保持し、E2E `__OW_TEST_STATE` 形状を維持する。scroll の trusted/untrusted 分割の振る舞いは不変。

## 受け入れ基準（BDD）

### シナリオ 1: gate 寿命は 1 箇所が所有する
- **Given** 閾値変更・drift・pre-init null の各状態
- **When** `evaluate(state, now)` を呼ぶ
- **Then** 3 構築箇所・2 fallback と同一の判定が返り、構築コードは Module 内のみに存在する

### シナリオ 2: kernel は orchestration のみに縮退する
- **Given** `contentKernel.ts` の行構成
- **When** 分離後に走査する
- **Then** IdleScheduler 実装（約 75 行）が別ファイルにあり、gate 構築コードが kernel に残っていない

### シナリオ 3: 初期化前・E2E の契約は不変
- **Given** 初期化前の null 状態と E2E テスト状態
- **When** 評価する
- **Then** nullable fallback の振る舞いと `__OW_TEST_STATE` 形状が同一である

## DoD（Definition of Done）

- [ ] `evaluate(state, now)` が唯一 Seam になり、3 構築箇所・2 fallback が消える
- [ ] IdleScheduler が別モジュールに分離される
- [ ] 既存の content gate テストが無修正で緑（語義不変の証明）
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
