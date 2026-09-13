# PBI 2026-09-12-19 — planPurge（破壊的 purge の trust-boundary を fail-closed に）

- **種別**: 🔧非機能追加（refactor + hardening）
- **優先度**: 3 位 / RICE **9.6**（R6 × I1 × C80% / E0.5人日）
- **出典**: round 11 診断 候補 19・サブエージェント探索（台帳「purge trust-boundary」の concrete 解）

## 背景（なぜ）

クラスタ唯一の破壊的操作（purge）が生 number を 3 backend まで素通し: `sqliteMessageHandlers.ts:173-183` が raw forward → `dbMaintenance.ts:20-26` のデフォルト（90/1000）は `undefined` のみ適用で NaN/負/Infinity は通過 → `purgeCutoffMs(NaN)=NaN` が bind され silent 0-purge で `success:true`（「対象なし」と区別不能）。負 maxRecords は content 経路で無視・age 経路で常に真（偶然の backend 一致）。validator は purge_now を bare で受理。

## スコープ

- `planPurge(payload)` seam（有限・正整数チェック、undefined→現行デフォルト、NaN/負/Infinity は fail-closed）を planner に新設
- `purgeOldRecords` / `purgeContent` の両 wire 経路（sqliteMessageHandlers）で適用
- backend は clean な数値の算術のみ（振る舞い: 正常値は不変、異常値は fail-closed）

## 受け入れ基準（BDD）

### シナリオ 1: 正常値は現行どおり（ハッピーパス）
```gherkin
Given retentionDays=90 / maxRecords=1000
When purge_old_records を実行する
Then 現行と同一の結果が返る
```

### シナリオ 2: 異常値は fail-closed（境界）
```gherkin
Given retentionDays が NaN / -1 / Infinity のいずれか
When purge_old_records を実行する
Then success:false で拒否され、silent 0-purge にならない
```

## DoD

- [ ] planPurge 新設・両 wire 経路適用
- [ ] parametric テーブル（undefined/NaN/-1/0/1.5/Infinity）新設
- [ ] offscreen purge 関連テスト green
- [ ] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし（異常値入力は現行でも無意味だったため）
