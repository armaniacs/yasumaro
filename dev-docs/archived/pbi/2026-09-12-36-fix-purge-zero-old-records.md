# PBI 2026-09-12-36 — planPurge(0,0) が SQLITE_PURGE 経路でデフォルト purge になる（round 12 契約の追半分）

- **種別**: 🔧非功能追加（fix・破壊的操作の契約確定）
- **優先度**: 4 位 / RICE **19.2**（R6 × I2 × C80% / E0.5人日）
- **出典**: round 13 診断 候補 36・サブエージェント探索 + 直接検証

## 背景（なぜ）

round 12 PBI 26 で `planPurge(0,0)` を `{retentionDays: undefined, maxRecords: undefined}` に正規化したが、`handlePurge`（sqliteMessageHandlers.ts:178-184）がそれをそのまま `sqlitePurgeOldRecords(undefined, undefined)` に渡し、**dbMaintenance のデフォルト引数（90/1000）が発火して purge が実行される**（dbMaintenance.ts:20-23）。3 義: planner は「スキップ」、handler+デフォルトは「90/1000 で purge」、直接 backend 呼び出しは `purgeCutoffMs(0)=now`（未スター全件削除）。`>0` スキップガードは content-purge path にしか無く old-records path はどの層にも無い（IdbVfsBackend.ts:221-247 / purgeHandlers.ts:23-53 は必須 number で常に両 phase 実行）。

## スコープ

- `purgeOldRecords` を 3 backend + dbMaintenance で `!= null && > 0` スキップガードに統一（purgeContent と同一契約）
- `handlePurge` は `undefined` をそのまま pass-through（ガードが undefined=skip と解釈）
- E2E pin: `handlePurge(0,0)` → backend purge が実行されない（punged:0）

## 受け入れ基準（BDD）

### シナリオ 1: (0,0) は 2 op ともスキップ（ハッピーパス）
```gherkin
Given planPurge(0,0) の出力
When SQLITE_PURGE / SQLITE_CONTENT_PURGE の両方を実行する
then 両 op とも backend purge が実行されず purged:0 が返る
```

### シナリオ 2: 正常値は現行どおり（境界）
```gherkin
Given retentionDays=90 / maxRecords=1000
When purge_old_records を実行する
then 現行と同一の結果が返る
```

## DoD

- [x] スキップガード統一（3 backend + dbMaintenance）
- [x] E2E pin テスト新設
- [x] offscreen purge 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟡軽微（`0` が「全件削除」から「スキップ」に確定 — UI は 0 を送らないため実害なし）

## 実装メモ（2026-09-12）

- `purgeOldRecords` を 3 backend（IdbVfsBackend / opfsWorker purgeHandlers / storageFallback）で `!= null && > 0` スキップガードに統一（purgeContent と同一契約）。StorageBackend interface の引数を optional 化
- IdbVfsBackend は statements を無条件生成（plain SQL strings）し実行のみを gate — purgeCutoffMs の NaN bind を構造排除
- opfsWorker purgeHandlers / storageFallback に同一ガード。dbMaintenance はダミー引数除去（backend がガード担当）
- `handlePurge`（planPurge → sqlitePurgeOldRecords）の E2E pin: (0,0) → backend purge 未実行（punged:0）
- 検証: offscreen 全 77 ファイル 1068 tests green・type-check green・lint 0 errors
